import { createServer } from 'http';
import { promises as fsPromises, createReadStream, existsSync } from 'fs';
import { join, dirname } from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import axios from 'axios';
import dotenv from 'dotenv';
import {
  createSession,
  endSession,
  addDetectionToSession,
  getSessions,
  getSessionData,
  getSessionDetections
} from './mongo.js';

dotenv.config();

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Track different types of clients with camera identification
const clients = {
  cameras: new Map(), // Map to store camera clients with their IDs: Map<cameraId, ws>
  browsers: new Set(), // Set of browser clients
  ai: null // AI WebSocket connection
};

// Session tracking for accident counts and other session-specific data
const sessionTracking = {
  accidentCounts: new Map() // Map to store accident counts per session
};

// Settings for video streaming - optimized for 60fps delivery with intelligent frame dropping
const streamSettings = {
  frameInterval: 16, // ~60 fps (milliseconds between frames to browsers)
  maxQueueSize: 5,   // Increased for smoother processing
  lastFrameSent: new Map(),
  frameQueue: new Map(),
  latestFrames: new Map(), // Store latest frame from each camera: Map<cameraId, frame>
  frameCounter: new Map(), // Count frames per camera for logging
  lastLogTime: new Map(),   // Track last log time per camera
  frameTimestamps: new Map(), // Track frame timestamps for age-based dropping
  processingQueue: new Map() // Queue for frames pending AI processing
};

// Object detection configuration - optimized for active sessions only
const isProduction = process.env.NODE_ENV === 'production';
const serverConfig = {
  wsUrl: isProduction ? process.env.NODE_SERVER_URL_PRODUCTION : process.env.NODE_SERVER_URL_LOCAL,
  host: isProduction ? process.env.NODE_SERVER_HOST_PRODUCTION : process.env.NODE_SERVER_HOST_LOCAL,
  port: isProduction ? process.env.NODE_SERVER_PORT_PRODUCTION : process.env.NODE_SERVER_PORT_LOCAL
};

const objectDetection = {
  enabled: true,
  // Use environment-specific WebSocket URL for AI service
  apiEndpoint: isProduction
    ? 'wss://smart-road-system.onrender.com/ai-ws'
    : `ws://localhost:${process.env.PYTHON_API_PORT || 8000}/ws`,
  httpApiEndpoint: isProduction
    ? 'https://smart-road-system.onrender.com/detect'
    : `http://localhost:${process.env.PYTHON_API_PORT || 8000}/detect`, // HTTP endpoint as backup
  confidenceThreshold: 0.60, // Default threshold
  carConfidenceThreshold: 0.65, // Higher threshold for cars
  accidentConfidenceThreshold: 0.80, // Much higher threshold for accidents
  detectionInterval: 100, // Reduced to 50ms for more frequent updates (~20 fps)
  lastDetectionTime: new Map(), // Track last detection time per camera
  detectionResults: new Map(), // Store latest detection results per camera
  processingCount: 0, // Track currently processing detections
  maxConcurrent: 4, // Increased concurrent processing
  errorCount: 0, // Track consecutive errors
  maxErrors: 10, // Maximum consecutive errors before disabling
  pythonProcess: null, // Store reference to the Python process
  trafficStatus: new Map(), // Track traffic status for each intersection: Map<cameraId, status>
  detectionLog: new Map(), // Comprehensive detection logging per session
  rateLimit: {
    maxRequestsPerMinute: 400, // Maximum requests per minute (5 per second)
    requestCounter: 0,  // Counter for current period
    lastResetTime: Date.now(), // Last time the counter was reset
  }
};

// Camera metadata storage
const cameraMetadata = new Map(); // Map<cameraId, {info}>
let pendingFrames = new Map(); // For handling metadata + binary frame pairs

// Function to start the Python API
function startPythonAPI() {
  // Check if Python process is already running
  if (objectDetection.pythonProcess !== null &&
    objectDetection.pythonProcess.exitCode === null) {
    console.log("Python detection API is already running");
    return;
  }

  console.log("Starting Python detection API...");

  const pythonScript = join(__dirname, 'ai', 'object_detection_api.py');

  // Determine Python executable based on platform
  let pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  // Make sure clients.ai is reset
  clients.ai = null;

  // Try to verify Python is available before starting
  try {
    // First, check if the script exists
    const scriptExists = existsSync(pythonScript);
    if (!scriptExists) {
      throw new Error(`Python script not found at path: ${pythonScript}`);
    }

    // Clear any previous Python process reference
    objectDetection.pythonProcess = null;

    // Start the Python script
    const pythonProcess = spawn(pythonCmd, [pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: join(__dirname, 'ai'),
      // Set higher buffer size for outputs
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });

    // Store reference to the process
    objectDetection.pythonProcess = pythonProcess;

    // Handle Python process output
    pythonProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      console.log(`Python API: ${message}`);

      // Check for specific startup messages that indicate the server is ready
      if (message.includes('Application startup complete') ||
        message.includes('Uvicorn running on') ||
        message.includes('Model loaded successfully')) {
        console.log('Detected Python API startup message. API may be ready soon.');
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString().trim();
      console.error(`Python API Error: ${error}`);

      // Don't treat warnings as fatal errors
      if (error.toLowerCase().includes('warning')) {
        return;
      }

      // Check for specific error messages
      if (error.includes('Address already in use')) {
        console.error('Python API port 8000 is already in use. Possibly another instance is running.');
        objectDetection.enabled = false;
      }
    });

    // Handle process exit
    pythonProcess.on('close', (code) => {
      console.log(`Python API process exited with code ${code}`);
      objectDetection.pythonProcess = null;
      objectDetection.enabled = false;

      // Attempt to restart if it crashed
      if (code !== 0) {
        console.log("Attempting to restart Python API in 5 seconds...");
        setTimeout(() => {
          startPythonAPI();
        }, 5000);
      }
    });

    // Handle process errors
    pythonProcess.on('error', (err) => {
      console.error(`Failed to start Python process: ${err.message}`);
      objectDetection.pythonProcess = null;
      objectDetection.enabled = false;
    });

    console.log("Python API process started, waiting for it to initialize...");

    // Setup health check retry mechanism
    let healthCheckAttempt = 0;
    const maxHealthCheckAttempts = 10;
    const healthCheckInterval = setInterval(async () => {
      healthCheckAttempt++;
      console.log(`Performing health check attempt ${healthCheckAttempt}...`);

      try {
        // Check if the API is running
        const response = await axios.get('http://localhost:8000/health', {
          timeout: 3000,
          validateStatus: () => true // Accept any status code
        });

        if (response.status === 200 && response.data && response.data.status === 'healthy') {
          console.log("Python API is running and healthy");
          objectDetection.enabled = true;
          clearInterval(healthCheckInterval);
        } else {
          console.log(`API responded with status: ${response.status}, but may not be fully ready yet`);
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          console.log("API server not accepting connections yet, will retry...");
        } else {
          console.error("Failed to connect to Python API:", error.message);
        }
      }

      // If we've reached max attempts, stop trying
      if (healthCheckAttempt >= maxHealthCheckAttempts) {
        clearInterval(healthCheckInterval);
        console.error(`Failed to connect to Python API after ${maxHealthCheckAttempts} attempts.`);

        if (objectDetection.pythonProcess && objectDetection.pythonProcess.exitCode === null) {
          console.log("Python process is still running but API is not responsive. You may need to check for errors.");
        }
      }
    }, 3000); // Check every 3 seconds

  } catch (error) {
    console.error(`Failed to start Python API: ${error.message}`);
    objectDetection.pythonProcess = null;
    objectDetection.enabled = false;
  }
}

// Keep track of active session
let activeSessionId = null;
let sessionStartTime = null;
let sessionParams = null;

// Create HTTP server with error handling
const server = createServer(async (req, res) => {
  console.log(`HTTP request: ${req.method} ${req.url}`);
  // --- API: Session Management ---
  if (req.url === '/api/session/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const { duration, count } = JSON.parse(body);

        // Check if there's already an active session
        if (activeSessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'A session is already active. End it before starting a new one.' }));
          return;
        }

        const sessionId = await createSession({ duration, count });
        // Set as active session
        activeSessionId = sessionId.toString();
        sessionStartTime = new Date();
        sessionParams = { duration, count };

        console.log(`[SESSION START] New session started: ${activeSessionId}, duration: ${duration}min, count: ${count}`);

        // Notify all browser clients about new session
        for (const browser of clients.browsers) {
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(JSON.stringify({
              type: 'session_status',
              sessionId: activeSessionId,
              startTime: sessionStartTime,
              params: sessionParams,
              status: 'active'
            }));
          }
        }

        console.log(`[SESSION START] Notified ${clients.browsers.size} browsers about new session`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId }));
        // Set auto-end timer
        setTimeout(async () => {
          if (activeSessionId === sessionId.toString()) {
            try {
              console.log(`[SESSION AUTO-END] Auto-ending session ${sessionId} after ${duration} minutes`);
              await endSession(activeSessionId);

              // Notify all browser clients about session end
              for (const browser of clients.browsers) {
                if (browser.readyState === WebSocket.OPEN) {
                  browser.send(JSON.stringify({
                    type: 'session_status',
                    sessionId: activeSessionId,
                    status: 'completed'
                  }));
                }
              }

              // Reset active session
              activeSessionId = null;
              sessionStartTime = null;
              sessionParams = null;

              console.log(`Session ${sessionId} auto-ended after ${duration} minutes`);
            } catch (error) {
              console.error(`Error auto-ending session: ${error.message}`);
            }
          }
        }, duration * 60 * 1000); // Convert minutes to milliseconds

      } catch (e) {
        console.error(`Error starting session: ${e.message}`);
        res.writeHead(500);
        res.end('Failed to start session');
      }
    });
    return;
  }
  if (req.url === '/api/session/end' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body);

        // Only end if this is the active session
        if (sessionId !== activeSessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session ID does not match active session' }));
          return;
        }

        await endSession(sessionId);

        // Notify all browser clients about session end
        for (const browser of clients.browsers) {
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(JSON.stringify({
              type: 'session_status',
              sessionId: sessionId,
              status: 'completed'
            }));
          }
        }

        // Reset active session
        activeSessionId = null;
        sessionStartTime = null;
        sessionParams = null;

        res.writeHead(200);
        res.end('Session ended');
      } catch (e) {
        console.error(`Error ending session: ${e.message}`);
        res.writeHead(500);
        res.end('Failed to end session');
      }
    });
    return;
  }
  if (req.url === '/api/sessions' && req.method === 'GET') {
    try {
      const sessions = await getSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
    } catch (e) {
      res.writeHead(500);
      res.end('Failed to fetch sessions');
    }
    return;
  } if (req.url.startsWith('/api/session/') && req.url.endsWith('/data') && req.method === 'GET') {
    const sessionId = req.url.split('/')[3];
    try {
      const session = await getSessionData(sessionId);

      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      // Get latest detections for this session
      const detections = await getSessionDetections(sessionId, 1000, 0);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        session,
        detections,
        isActive: sessionId === activeSessionId
      }));
    } catch (e) {
      console.error(`Error fetching session data: ${e.message}`);
      res.writeHead(500);
      res.end('Failed to fetch session data');
    }
    return;
  }

  // API endpoint for session detections with pagination
  if (req.url.match(/^\/api\/session\/[^\/]+\/detections/) && req.method === 'GET') {
    const urlParts = req.url.split('/');
    const sessionId = urlParts[3];

    // Parse query parameters
    const queryString = req.url.split('?')[1] || '';
    const params = new URLSearchParams(queryString);
    const limit = parseInt(params.get('limit') || '100', 10);
    const skip = parseInt(params.get('skip') || '0', 10);

    try {
      // Get detections for this session with pagination
      const detections = await getSessionDetections(sessionId, limit, skip);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detections }));
    } catch (e) {
      console.error(`Error fetching session detections: ${e.message}`);
      res.writeHead(500);
      res.end('Failed to fetch session detections');
    }
    return;
  }

  // System status endpoint
  if (req.url === '/api/status' && req.method === 'GET') {
    const status = {
      timestamp: new Date().toISOString(),
      server: {
        port: PORT,
        uptime: process.uptime()
      },
      objectDetection: {
        enabled: objectDetection.enabled,
        aiConnected: clients.ai ? true : false,
        processingCount: objectDetection.processingCount,
        errorCount: objectDetection.errorCount,
        confidenceThreshold: objectDetection.confidenceThreshold,
        detectionInterval: objectDetection.detectionInterval,
        rateLimit: objectDetection.rateLimit
      },
      clients: {
        cameras: Array.from(clients.cameras.keys()),
        browsers: clients.browsers.size,
        aiConnected: clients.ai ? true : false
      },
      session: {
        active: activeSessionId ? true : false,
        sessionId: activeSessionId,
        startTime: sessionStartTime,
        params: sessionParams
      },
      streamSettings: {
        frameInterval: streamSettings.frameInterval,
        latestFrames: Array.from(streamSettings.latestFrames.keys())
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
    return;
  }

  // Serve static files from the public directory
  const publicFiles = [
    '/',
    '/index.html',
    '/public/admin/admin.html', // Add admin.html to allowed files
    '/page.js',
    '/styles.css'
  ];

  const url = req.url === '/' ? '/index.html' : req.url;

  if (publicFiles.includes(url) || url.startsWith('/public/')) {
    const filePath = url.startsWith('/public/')
      ? join(__dirname, url)
      : join(__dirname, 'public', url.replace('/', ''));

    try {
      await fsPromises.access(filePath);

      // Determine content type
      let contentType = 'text/plain';
      if (filePath.endsWith('.html')) contentType = 'text/html';
      if (filePath.endsWith('.js')) contentType = 'application/javascript';
      if (filePath.endsWith('.css')) contentType = 'text/css';
      if (filePath.endsWith('.json')) contentType = 'application/json';
      if (filePath.endsWith('.png')) contentType = 'image/png';
      if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) contentType = 'image/jpeg';

      res.writeHead(200, { 'Content-Type': contentType });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error(`File not found: ${filePath}, Error: ${err}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Create WebSocket server with performance options
const wss = new WebSocketServer({
  server,
  perMessageDeflate: false, // Disable compression for performance
  maxPayload: 16 * 1024 * 1024 // Allow larger messages (16MB)
});

// Send camera information to browsers
function sendCameraInfo(cameraId) {
  // If specific camera requested, send just that one
  if (cameraId && cameraMetadata.has(cameraId)) {
    const cameraInfo = cameraMetadata.get(cameraId);
    const infoString = JSON.stringify({
      ...cameraInfo,
      type: 'camera_info',
      timestamp: new Date().toISOString()
    });

    for (const browser of clients.browsers) {
      if (browser.readyState === WebSocket.OPEN) {
        try {
          browser.send(infoString);
        } catch (error) {
          console.error(`Error sending camera info: ${error}`);
        }
      }
    }
  }
  // Otherwise send all camera info
  else {
    // Get list of all cameras
    const allCameras = Array.from(cameraMetadata.entries()).map(([id, info]) => ({
      ...info,
      type: 'camera_list_item',
      connected: clients.cameras.has(id), // Check if camera is currently connected
      hasDetections: objectDetection.detectionResults.has(id), // Whether we have detection data
      trafficStatus: objectDetection.trafficStatus.get(id) || 'unknown'
    }));

    const cameraList = {
      type: 'camera_list',
      cameras: allCameras,
      timestamp: new Date().toISOString()
    };

    const infoString = JSON.stringify(cameraList);

    for (const browser of clients.browsers) {
      if (browser.readyState === WebSocket.OPEN) {
        try {
          browser.send(infoString);
        } catch (error) {
          console.error(`Error sending camera list: ${error}`);
        }
      }
    }
  }
}

/**
 * Handle traffic redirection based on detection results
 * @param {string} cameraId - ID of the camera source
 * @param {Object} analysis - Traffic analysis results
 */
function handleTrafficRedirection(cameraId, analysis) {
  // Update traffic status for this camera
  if (analysis && analysis.density) {
    objectDetection.trafficStatus.set(cameraId, analysis.density);

    // Broadcast traffic status to all browsers
    const redirectionMessage = {
      type: 'traffic_redirection',
      cameraId,
      status: analysis.density,
      vehicleCount: analysis.vehicle_count || 0,
      countsByType: analysis.counts_by_type || {},
      timestamp: Date.now(),
      alternativeRoutes: generateAlternativeRoutes(cameraId, analysis.density)
    };

    for (const browser of clients.browsers) {
      if (browser.readyState === WebSocket.OPEN) {
        try {
          browser.send(JSON.stringify(redirectionMessage));
        } catch (error) {
          console.error(`Error sending traffic redirection: ${error.message}`);
        }
      }
    }
  }
}

/**
 * Generate alternative routes based on traffic density
 * @param {string} cameraId - Camera/intersection ID
 * @param {string} density - Traffic density (low, moderate, high)
 * @returns {Array} - List of alternative routes
 */
function generateAlternativeRoutes(cameraId, density) {
  // This is a simplified example - in a real system, you would use actual map data
  // and routing algorithms to generate alternative routes

  if (density === 'low') {
    return []; // No need for alternatives when traffic is low
  }

  // Mock alternative routes based on camera ID
  const routes = [];

  if (density === 'moderate') {
    routes.push({
      description: `Alternative route via nearby streets`,
      estimatedTime: '5 min',
      status: 'recommended'
    });
  } else if (density === 'high') {
    routes.push({
      description: `Emergency route via side streets`,
      estimatedTime: '7 min',
      status: 'recommended'
    });
    routes.push({
      description: `Longer route via highway`,
      estimatedTime: '12 min',
      status: 'alternative'
    });
  }

  return routes;
}

/**
 * Process and distribute video frames - optimized for 60fps streaming to frontend
 * @param {Buffer} frame - Binary JPEG frame data
 * @param {string} cameraId - ID of the camera source
 */
function processVideoFrame(frame, cameraId) {
  const now = Date.now();

  // Add timestamp to frame
  frame.timestamp = now;

  // Store the latest frame from this camera
  streamSettings.latestFrames.set(cameraId, frame);
  streamSettings.frameTimestamps.set(cameraId, now);

  // Update frame counter for this camera
  const currentCount = streamSettings.frameCounter.get(cameraId) || 0;
  streamSettings.frameCounter.set(cameraId, currentCount + 1);

  // Log frame statistics every 5 seconds
  const lastLog = streamSettings.lastLogTime.get(cameraId) || 0;
  if (now - lastLog > 5000) { // Log every 5 seconds
    const frameCount = streamSettings.frameCounter.get(cameraId) || 0;
    const fps = frameCount / ((now - lastLog) / 1000);
    console.log(`[FRAME STATS] Camera ${cameraId}: Receiving ~${fps.toFixed(1)} fps, frame size: ${frame.length} bytes`);
    streamSettings.lastLogTime.set(cameraId, now);
    streamSettings.frameCounter.set(cameraId, 0);
  }

  // Get or initialize processing queue for this camera
  if (!streamSettings.processingQueue.has(cameraId)) {
    streamSettings.processingQueue.set(cameraId, []);
  }
  const queue = streamSettings.processingQueue.get(cameraId);

  // Stream to browsers at 60fps (forward all frames immediately for real-time viewing)
  broadcastFrameToBrowsers(frame, cameraId);

  // Log session and AI detection status every 50 frames to reduce spam
  if (Math.random() < 0.02) { // 2% chance = roughly every 50 frames
    console.log(`[DETECTION STATUS] Session: ${activeSessionId || 'NONE'}, AI enabled: ${objectDetection.enabled}, AI connected: ${clients.ai ? 'YES' : 'NO'}`);
  }

  // Perform object detection ONLY if all conditions are met
  if (objectDetection.enabled && clients.ai && activeSessionId) {
    // Check rate limiting
    if (now - objectDetection.rateLimit.lastResetTime > 60000) {
      objectDetection.rateLimit.requestCounter = 0;
      objectDetection.rateLimit.lastResetTime = now;
    }

    // Add frame to processing queue
    queue.push({ frame, timestamp: now });

    // Manage queue size - drop older frames if queue gets too large
    if (queue.length > streamSettings.maxQueueSize) {
      // Keep most recent frames and drop older ones
      const numToRemove = Math.floor(queue.length / 2);
      queue.splice(0, numToRemove);
      console.log(`[QUEUE MANAGEMENT] Dropped ${numToRemove} old frames for camera ${cameraId}`);
    }

    // Process frame if we're under rate limit and enough time has passed
    if (objectDetection.rateLimit.requestCounter < objectDetection.rateLimit.maxRequestsPerMinute) {
      const lastDetection = objectDetection.lastDetectionTime.get(cameraId) || 0;

      if (now - lastDetection >= objectDetection.detectionInterval) {
        // Get the newest frame from queue
        const frameToProcess = queue.pop();

        if (frameToProcess) {
          const frameAge = now - frameToProcess.timestamp;

          // Skip if frame is too old (more than 2 seconds)
          if (frameAge > 2000) {
            console.log(`[FRAME SKIP] Skipping old frame (${frameAge}ms old) for camera ${cameraId}`);
            return;
          }

          objectDetection.lastDetectionTime.set(cameraId, now);
          objectDetection.rateLimit.requestCounter++;

          console.log(`[DETECTION TRIGGER] Processing frame (age: ${frameAge}ms, queue: ${queue.length}, rate: ${objectDetection.rateLimit.requestCounter}/${objectDetection.rateLimit.maxRequestsPerMinute})`);

          sendFrameToAI(frameToProcess.frame, cameraId);
        }
      }
    } else if (Math.random() < 0.01) {
      console.log(`[RATE LIMIT] Rate limit reached: ${objectDetection.rateLimit.requestCounter} requests/minute`);
    }
  } else if (Math.random() < 0.005) {
    const reasons = [];
    if (!objectDetection.enabled) reasons.push('AI disabled');
    if (!clients.ai) reasons.push('AI not connected');
    if (!activeSessionId) reasons.push('No active session');

    if (reasons.length > 0) {
      console.log(`[DETECTION SKIP] Not eligible for AI processing: ${reasons.join(', ')}`);
    }
  }
}

/**
 * Broadcast frame to all connected browser clients at 60fps
 * @param {Buffer} frame - Binary JPEG frame data
 * @param {string} cameraId - ID of the camera source
 */
function broadcastFrameToBrowsers(frame, cameraId) {
  const now = Date.now();
  const lastSent = streamSettings.lastFrameSent.get(cameraId) || 0;

  // Enforce 60fps limit for browser streaming (16ms interval)
  if (now - lastSent >= streamSettings.frameInterval) {
    streamSettings.lastFrameSent.set(cameraId, now);

    // Broadcast to all browser clients
    let successCount = 0;
    let errorCount = 0;

    for (const browser of clients.browsers) {
      if (browser.readyState === WebSocket.OPEN &&
        // Only send to browsers subscribed to this session or browsers without specific session
        (!browser.sessionId || browser.sessionId === activeSessionId)) {
        try {
          // First send metadata about the frame
          browser.send(JSON.stringify({
            type: 'frame_metadata',
            cameraId: cameraId,
            timestamp: now
          }));

          // Then send the actual binary frame
          browser.send(frame, { binary: true });
          successCount++;
        } catch (error) {
          console.error(`[BROWSER STREAMING] Error sending frame to browser: ${error.message}`);
          errorCount++;
        }
      }
    }

    // Log broadcasting stats occasionally
    if (Math.random() < 0.01) { // 1% chance = roughly every 100 frames
      console.log(`[BROWSER STREAMING] Sent to ${successCount} browsers, ${errorCount} errors`);
    }
  }
}

/**
 * Send frame to AI service via WebSocket (only during active sessions)
 * @param {Buffer} frame - Binary JPEG frame data
 * @param {string} cameraId - ID of the camera source
 */
function sendFrameToAI(frame, cameraId) {
  // Only send frames to AI if there's an active session
  if (!activeSessionId) {
    if (Math.random() < 0.01) { // Log occasionally to avoid console spam
      console.log('[AI FRAME] Skipping AI detection: No active session');
    }
    return;
  }

  // Check if AI WebSocket is connected and try to reconnect if not
  if (!clients.ai || clients.ai.readyState !== WebSocket.OPEN) {
    console.warn('[AI FRAME] AI service not connected, skipping detection');

    // Try to start the Python API if it's not running
    if (!objectDetection.pythonProcess || objectDetection.pythonProcess.exitCode !== null) {
      console.log('[AI FRAME] Attempting to start Python API...');
      startPythonAPI();
    }
    return;
  }

  // Validate camera ID
  if (!cameraId) {
    console.warn('[AI FRAME] sendFrameToAI: cameraId is missing or unknown!');
    return;
  }

  // Check if we're under the processing limit
  if (objectDetection.processingCount >= objectDetection.maxConcurrent) {
    if (Math.random() < 0.05) { // Log occasionally to avoid console spam
      console.log(`[AI FRAME] Skipping detection: already processing ${objectDetection.processingCount} frames`);
    }
    return;
  }

  try {
    // Increment the processing counter
    objectDetection.processingCount++;

    console.log(`[AI FRAME] Sending frame from camera ${cameraId} to AI for processing (session: ${activeSessionId}, queue: ${objectDetection.processingCount})`);

    // Create detection request with metadata
    const metadata = {
      type: 'detection_request_metadata',
      camera_id: cameraId,
      confidence: objectDetection.confidenceThreshold,
      timestamp: Date.now(),
      session_id: activeSessionId
    };

    console.log(`[AI METADATA] Sending metadata:`, metadata);

    // First send the metadata as JSON
    clients.ai.send(JSON.stringify(metadata));

    // Then send the actual binary frame directly
    setTimeout(() => {
      if (clients.ai && clients.ai.readyState === WebSocket.OPEN) {
        console.log(`[AI BINARY] Sending binary frame data: ${frame.length} bytes`);
        clients.ai.send(frame, { binary: true }, (err) => {
          if (err) {
            console.error(`[AI BINARY] Error sending binary frame to AI: ${err.message}`);
            // Decrement the processing counter on error
            objectDetection.processingCount = Math.max(0, objectDetection.processingCount - 1);
          } else {
            console.log(`[AI BINARY] Successfully sent binary frame to AI`);
          }
        });
      } else {
        // Decrement the processing counter if connection closed while waiting
        objectDetection.processingCount = Math.max(0, objectDetection.processingCount - 1);
        console.warn('[AI BINARY] AI connection lost while sending frame');
      }
    }, 5);
  } catch (error) {
    console.error(`[AI FRAME] Error sending frame to AI: ${error.message}`);
    // Decrement the processing counter on error
    objectDetection.processingCount = Math.max(0, objectDetection.processingCount - 1);
  }
}

/**
 * Process AI detection response with comprehensive logging
 * @param {Object} message - Detection response from AI
 */
// SMS notification configuration
const SMS_CONFIG = {
  BASE_URL: 'https://api.textbee.dev/api/v1',
  DEVICE_ID: process.env.TEXTBEE_DEVICE_ID,
  API_KEY: process.env.TEXTBEE_API_KEY,
  ACCIDENT_NUMBER: process.env.ACCIDENT_NOTIFY_NUMBER,
  THRESHOLD_NUMBER: process.env.THRESHOLD_NOTIFY_NUMBER,
  MAX_MESSAGES_PER_SESSION: 2 // Maximum messages per number per session
};

async function sendSMSAlert(recipient, message, session) {
  try {
    // Validate session parameter
    if (!session || !session._id) {
      console.error('[SMS ALERT] Cannot send SMS: Invalid session');
      return false;
    }

    // Get fresh session data to ensure we have latest counters
    const currentSession = await getSessionData(session._id);
    if (!currentSession) {
      console.error('[SMS ALERT] Cannot send SMS: Session not found in database');
      return false;
    }

    // Initialize SMS counters in memory if they don't exist
    if (!currentSession.smsCounters) {
      currentSession.smsCounters = new Map();
    }

    // Get current counter for this recipient
    const currentCount = currentSession.smsCounters.get(recipient) || 0;

    // Check if we've hit the limit for this recipient
    if (currentCount >= SMS_CONFIG.MAX_MESSAGES_PER_SESSION) {
      console.log(`[SMS ALERT] Skipping SMS to ${recipient}: Message limit (${SMS_CONFIG.MAX_MESSAGES_PER_SESSION}) reached for this session`);
      return false;
    }

    // Send the SMS
    const response = await axios.post(
      `${SMS_CONFIG.BASE_URL}/gateway/devices/${SMS_CONFIG.DEVICE_ID}/send-sms`,
      {
        recipients: [recipient],
        message: message
      },
      { headers: { 'x-api-key': SMS_CONFIG.API_KEY } }
    );

    // Update counter in session data
    currentSession.smsCounters.set(recipient, currentCount + 1);
    
    // Use endSession and createSession to update the session
    // This is a workaround since we don't have direct update functionality
    await endSession(currentSession._id);
    await createSession({
      ...currentSession,
      smsCounters: Object.fromEntries(currentSession.smsCounters)
    });

    console.log(`[SMS ALERT] Successfully sent SMS to ${recipient} (${currentCount + 1}/${SMS_CONFIG.MAX_MESSAGES_PER_SESSION} for this session)`);

    return true;
  } catch (error) {
    console.error('[SMS ALERT] Failed to send SMS:', error.message);
    return false;
  }
}

async function processAIResponse(message) {
  // Decrement the processing counter for completed detection
  objectDetection.processingCount = Math.max(0, objectDetection.processingCount - 1);

  // Only process if there are results and we have an active session
  if (!activeSessionId || !message || !message.results) {
    console.warn('Received AI response but no active session or results');
    return;
  }

  const results = message.results;
  const cameraId = message.camera_id;
  const timestamp = new Date();

  if (!cameraId) {
    console.warn('Received AI response without camera ID');
    return;
  }

  // Store detection results
  objectDetection.detectionResults.set(cameraId, results);

  // Reset error counter on successful response
  objectDetection.errorCount = 0;

  // Process detections to count objects by class
  const detections = (results.detections || []).filter(detection => {
        switch (detection.class_name) {
            case 'car':
                return detection.confidence >= objectDetection.carConfidenceThreshold;
            case 'accident':
                return detection.confidence >= objectDetection.accidentConfidenceThreshold;
            default:
                return detection.confidence >= objectDetection.confidenceThreshold;
        }
    });
  let carCount = 0;
  let accidentCount = 0;

  detections.forEach(detection => {
    if (detection.class_name === 'car') {
      carCount++;
    } else if (detection.class_name === 'accident') {
      accidentCount++;
    }
  });

  // === COMPREHENSIVE LOGGING FOR EVERY AI CHECK ===
  console.log('=== AI DETECTION COMPLETE ===');
  console.log(`Timestamp: ${timestamp.toISOString()}`);
  console.log(`Camera: ${cameraId}`);
  console.log(`Session: ${activeSessionId}`);
  console.log(`Processing Time: ${results.total_time?.toFixed(3)}s (inference: ${results.inference_time?.toFixed(3)}s)`);
  console.log(`Image Size: ${results.image_size?.[1]}x${results.image_size?.[0]}`);
  console.log(`Total Detections: ${detections.length}`);
  console.log(`Cars Detected: ${carCount}`);
  console.log(`Accidents Detected: ${accidentCount}`);
  console.log(`Traffic Density: ${results.traffic_analysis?.density || 'unknown'}`);

  // Log individual detections
  if (detections.length > 0) {
    console.log('Individual Detections:');
    detections.forEach((detection, index) => {
      console.log(`  ${index + 1}. ${detection.class_name} (confidence: ${detection.confidence.toFixed(3)}, bbox: [${detection.bbox.map(b => b.toFixed(1)).join(', ')}])`);
    });
  } else {
    console.log('No objects detected in this frame');
  }
  console.log('========================\n');

  // Store detection in session log for duplicate prevention and analysis
  if (!objectDetection.detectionLog.has(activeSessionId)) {
    objectDetection.detectionLog.set(activeSessionId, []);
  }

  const sessionLog = objectDetection.detectionLog.get(activeSessionId);
  const detectionEntry = {
    timestamp,
    cameraId,
    detections,
    carCount,
    accidentCount,
    processingTime: results.total_time,
    inferenceTime: results.inference_time,
    imageSize: results.image_size
  };

  sessionLog.push(detectionEntry);

  // Keep only last 1000 detections per session to prevent memory issues
  if (sessionLog.length > 1000) {
    sessionLog.splice(0, sessionLog.length - 1000);
  }

  // Create detection record for database
  const detectionRecord = {
    timestamp,
    cameraId: cameraId,
    detections: detections,
    carCount,
    accidentCount,
    inference_time: results.inference_time || 0,
    total_time: results.total_time || 0,
    image_size: results.image_size || [0, 0],
    sessionId: activeSessionId
  };

  try {
    // Always add the detection to the active session in MongoDB
    await addDetectionToSession(activeSessionId, detectionRecord);
    console.log(`Detection saved to database for session ${activeSessionId}`);

    // Get session parameters for threshold checks
    const session = await getSessionData(activeSessionId);

    // Check if session exists
    if (!session) {
      console.error(`[AI DETECTION] No session found for ID: ${activeSessionId}`);
      return;
    }
    broadcastDetectionResults(cameraId, results);
    // Initialize SMS counters if they don't exist
    if (!session.smsCounters) {
      session.smsCounters = {};
      // Save the initialized counters
      await updateSession(session._id, { smsCounters: {} });
    }

    // Check car count threshold
    if (session && session.count > 0) {  // if count threshold was set
      // Get all detections for this session
      const allDetections = await getSessionDetections(activeSessionId, 1000, 0);
      const totalCars = allDetections.reduce((sum, det) => sum + (det.carCount || 0), 0);
      if (totalCars >= session.count) {
        // Send threshold alerts with rate limiting
        const smsMsg = `ALERT: Traffic threshold exceeded at route X. Congestion imminent. Find alternative routes: https://ai-vision.onrender.com`;
        await sendSMSAlert(SMS_CONFIG.THRESHOLD_NUMBER, smsMsg, session);
        const adminMsg = `ALERT: Traffic threshold exceeded threshold: ${session.count} at route X. Deploy traffic management.`;
        await sendSMSAlert(SMS_CONFIG.ACCIDENT_NUMBER, adminMsg, session);
      }
    }

    // Check for accidents and send alerts with rate limiting
    if (accidentCount > 0) {
      // Get current accident count for this session
      const currentAccidents = sessionTracking.accidentCounts.get(activeSessionId) || 0;
      
      if (currentAccidents >= 1) {
        console.log(`[ACCIDENT LIMIT] Already detected an accident for session ${activeSessionId}, skipping alerts`);
        // Remove accident detections from the record
        detectionRecord.detections = detectionRecord.detections.filter(d => d.class_name !== 'accident');
        detectionRecord.accidentCount = 0;
      } else {
        // Increment accident count for this session
        sessionTracking.accidentCounts.set(activeSessionId, currentAccidents + 1);
        
        // Send SMS alerts
        const smsMsg = `URGENT: Accident detected at route X. Traffic congestion expected. Find alternative routes: https://ai-vision.onrender.com`;
        const adminMsg = `URGENT: Accident detected at camera route X Time: ${new Date().toLocaleString()}. Send Authorities.`;
        
        await sendSMSAlert(SMS_CONFIG.THRESHOLD_NUMBER, smsMsg, session);
        await sendSMSAlert(SMS_CONFIG.ACCIDENT_NUMBER, adminMsg, session);
      }
    }
    // Broadcast detection results to browser clients


    // Handle traffic redirection based on analysis
    if (results.traffic_analysis) {
      handleTrafficRedirection(cameraId, results.traffic_analysis);
    }
  } catch (error) {
    console.error(`Error processing detection result: ${error.message}`);
  }
}

/**
 * Broadcast detection results to all connected browser clients
 * @param {string} cameraId - ID of the camera source
 * @param {Object} results - Detection results from the API
 */
function broadcastDetectionResults(cameraId, results) {
  if (!results) return;

  // Filter detections based on class-specific confidence thresholds
  const validDetections = (results.detections || []).filter(detection => {
    switch (detection.class_name) {
      case 'car':
        return detection.confidence >= objectDetection.carConfidenceThreshold;
      case 'accident':
        return detection.confidence >= objectDetection.accidentConfidenceThreshold;
      default:
        return detection.confidence >= objectDetection.confidenceThreshold;
    }
  });

  // Only broadcast if we have valid detections or explicitly want to show no detections
  const detectionMessage = {
    type: 'detection_results',
    cameraId,
    detections: validDetections,
    inference_time: results.inference_time,
    confidence_thresholds: {
      default: objectDetection.confidenceThreshold,
      car: objectDetection.carConfidenceThreshold,
      accident: objectDetection.accidentConfidenceThreshold
    },
    timestamp: Date.now(),
    sessionId: activeSessionId,
    metadata: {
      total_detections: results.detections?.length || 0,
      filtered_detections: validDetections.length,
      density: results.traffic_analysis?.density || 'unknown'
    }
  };

  // Log filtering results occasionally (1% of the time to avoid spam)
  if (Math.random() < 0.01) {
    console.log(`[DETECTION BROADCAST] Camera ${cameraId}:`);
    console.log(`- Total detections: ${results.detections?.length || 0}`);
    console.log(`- Filtered detections: ${validDetections.length}`);
    console.log(`- Confidence thresholds:`);
    console.log(`  • Cars: ${objectDetection.carConfidenceThreshold}`);
    console.log(`  • Accidents: ${objectDetection.accidentConfidenceThreshold}`);
    console.log(`  • Default: ${objectDetection.confidenceThreshold}`);
  }

  // Send to all connected browsers
  for (const browser of clients.browsers) {
    if (browser.readyState === WebSocket.OPEN) {
      // If browser is subscribed to a specific session, only send if it matches
      if (browser.sessionId && browser.sessionId !== activeSessionId) {
        continue;
      }

      try {
        browser.send(JSON.stringify(detectionMessage));
      } catch (error) {
        console.error(`Error sending detection results: ${error.message}`);
      }
    }
  }
}

// --- WebSocket Keepalive and Robustness Enhancements ---
// Track all active sockets for keepalive
const allSockets = new Set();

function setupWebSocketKeepAlive(ws, label = 'client') {
  ws.isAlive = true;
  allSockets.add(ws);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    allSockets.delete(ws);
  });

  ws.on('error', () => {
    allSockets.delete(ws);
  });
}

// Global interval to terminate dead sockets
setInterval(() => {
  for (const ws of allSockets) {
    if (ws.isAlive === false) {
      ws.terminate();
      allSockets.delete(ws);
    } else {
      ws.isAlive = false;
      try { ws.ping(); } catch { }
    }
  }
}, 30000);

// Helper function to check if data is binary
function isBinaryData(data) {
  // Check if it's a Buffer
  if (data instanceof Buffer) return true;

  // Check if it's an ArrayBuffer
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return true;

  // Check for Blob (in browser environments)
  if (typeof Blob !== 'undefined' && data instanceof Blob) return true;

  // For string data, check if it starts with JPEG signature
  if (typeof data === 'string') {
    // Check common binary file signatures
    if (data.startsWith('\xFF\xD8\xFF')) return true; // JPEG signature
    if (data.startsWith('GIF87a') || data.startsWith('GIF89a')) return true; // GIF signature
    if (data.startsWith('\x89PNG\r\n\x1A\n')) return true; // PNG signature
  }

  return false;
}

// Helper function to check if data is binary JPEG
function isJpegData(data) {
  if (data instanceof Buffer) {
    // Check for JPEG header signature (FF D8 FF)
    return data.length >= 3 &&
      data[0] === 0xFF &&
      data[1] === 0xD8 &&
      data[2] === 0xFF;
  }
  return false;
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;

  // Determine client type (camera, browser, or ai)
  const url = new URL(`http://localhost${req.url}`);
  const clientType = url.searchParams.get('type') || 'browser';
  const isCamera = clientType === 'camera';
  const isAI = clientType === 'ai';

  // Send ping frame every 30 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

  // Store metadata received before binary frame
  let currentMetadata = null;
  if (isCamera) {
    // Camera ID will be set when we receive the first metadata
    let cameraId = url.searchParams.get('id') || null;

    console.log(`[CAMERA CONNECTION] Camera client connected from ${clientIp}, waiting for identification...`);

    ws.on('message', (data) => {
      try {        // First check if this is JPEG data - ESP32CAMs often send raw JPEGs
        if (isJpegData(data)) {
          // If we know the camera ID, process the frame
          if (cameraId) {

            processVideoFrame(data, cameraId);
          } else {
            console.warn("[CAMERA FRAME] Received JPEG frame but camera ID is not yet known");
          }
          return;
        }

        // Check if this is a text message (metadata)
        if (typeof data === 'string' || data.toString !== undefined) {
          try {
            const dataStr = data.toString();
            const message = JSON.parse(dataStr);

            // If this has camera ID, use it to identify the camera
            if (message.id) {
              cameraId = message.id;
              // Register this camera if not already registered
              if (!clients.cameras.has(cameraId)) {
                clients.cameras.set(cameraId, ws);
                console.log(`[CAMERA REGISTRATION] Camera identified as: ${cameraId}`);
              }

              // Store or update camera metadata
              if (message.type === 'camera_info') {
                cameraMetadata.set(cameraId, message);
                console.log(`[CAMERA METADATA] Updated metadata for camera: ${cameraId}`, {
                  position: message.position,
                  description: message.description,
                  resolution: message.resolution
                });

                // Broadcast camera connection to all browsers
                sendCameraInfo(cameraId);
              }
              // Store frame metadata for next binary frame
              else if (message.type === 'frame_metadata') {
                pendingFrames.set(cameraId, message);
                // Log occasionally
                if (Math.random() < 0.01) {
                  console.log(`[CAMERA METADATA] Received frame metadata for ${cameraId}`);
                }
              }
            }
          } catch (parseError) {
            // If we can't parse as JSON but it's a buffer, try to detect if it's an image
            if (data instanceof Buffer && isJpegData(data)) {
              if (cameraId) {
                console.log(`Processing detected JPEG frame: ${data.length} bytes`);
                processVideoFrame(data, cameraId);
              }
            } else {
              console.warn(`Received non-JSON text from camera: ${data.toString().substring(0, 50)}...`);
            }
          }
        }        // Binary data (camera frame)
        else if (cameraId) {
          console.log(`[CAMERA FRAME] Received binary frame from ${cameraId}: ${data.length} bytes`);
          processVideoFrame(data, cameraId);
        } else {
          console.warn(`[CAMERA FRAME] Received binary data but no camera ID set`);
        }
      } catch (error) {
        console.error(`Error processing camera data: ${error.message}`);
      }
    });
  } else if (isAI) {
    // Store the AI connection
    clients.ai = ws;
    console.log(`[AI CONNECTION] AI service connected from ${clientIp}`);

    // Reset error count when connection is established
    objectDetection.errorCount = 0;

    // Handle messages from the AI service
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'detection_response') {
          console.log(`[AI RESPONSE] Received detection response from AI service`);
          processAIResponse(data);
        }
        else if (data.type === 'ai_connected') {
          console.log(`[AI CONNECTION] AI service connected: ${data.message}`);
          // Reset processing count
          objectDetection.processingCount = 0;
        }
        else if (data.type === 'pong') {
          // Received ping response
          console.log('[AI PING] AI service ping response received');
        }
        else if (data.type === 'error') {
          console.error(`[AI ERROR] AI service error: ${data.message}`);
          objectDetection.errorCount++;
          // If too many errors occur, temporarily disable object detection
          if (objectDetection.errorCount >= objectDetection.maxErrors) {
            console.error(`[AI ERROR] Too many AI service errors (${objectDetection.errorCount}). Disabling object detection temporarily.`);
            objectDetection.enabled = false;

            // Try to re-enable after a cooling period
            setTimeout(() => {
              console.log('[AI RECOVERY] Attempting to re-enable object detection after cooling period');
              objectDetection.errorCount = 0;
              objectDetection.enabled = true;
            }, 30000); // 30 second cooling period
          }
        } else {
          console.log(`[AI MESSAGE] Unknown message type from AI: ${data.type}`);
        }
      } catch (error) {
        console.error(`[AI MESSAGE] Error processing message from AI: ${error.message}`);
        objectDetection.errorCount++;
      }
    });
  } else {
    // Browser client
    clients.browsers.add(ws);
    console.log(`[BROWSER CONNECTION] Browser client connected: ${clientIp}`);

    // Send camera list to the new browser client
    sendCameraInfo();
    // Send active session status if there is one
    if (activeSessionId) {
      console.log(`[BROWSER SESSION] Sending active session status to new browser: ${activeSessionId}`);
      ws.send(JSON.stringify({
        type: 'session_status',
        sessionId: activeSessionId,
        startTime: sessionStartTime,
        params: sessionParams,
        status: 'active'
      }));
    }

    // Send direct connection information to browser
    for (const [cameraId, info] of cameraMetadata.entries()) {
      if (info.ip_address) {
        ws.send(JSON.stringify({
          type: 'camera_direct_connect',
          id: cameraId,
          ip_address: info.ip_address,
          stream_url: `http://${info.ip_address}:81/stream`, // Standard ESP32-CAM stream URL
          timestamp: Date.now()
        }));
      }
    }

    ws.on('message', async (message) => {
      try {
        // Try to parse as JSON
        const data = JSON.parse(message.toString());

        // Handle browser commands
        if (data.type === 'get_camera_list') {
          sendCameraInfo();
        }
        else if (data.type === 'get_camera_info' && data.cameraId) {
          sendCameraInfo(data.cameraId);
        }
        else if (data.type === 'subscribe_session' && data.sessionId) {
          // Subscribe to a specific session
          ws.sessionId = data.sessionId;
          console.log(`Browser client subscribed to session: ${data.sessionId}`);
        }
        else if (data.type === 'request_frame' && data.cameraId) {
          // Send the requested camera's latest frame - only for testing or fallback
          const cameraId = data.cameraId;

          if (streamSettings.latestFrames.has(cameraId)) {
            const frame = streamSettings.latestFrames.get(cameraId);

            // Send metadata first
            const metadata = JSON.stringify({
              type: 'frame_metadata',
              id: cameraId,
              timestamp: Date.now(),
              requested: true,
              message: 'This is a fallback frame. For live streaming, connect directly to the camera stream URL.'
            });

            ws.send(metadata);

            // Then send the frame
            ws.send(frame, { binary: true });
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Frame not available. Please connect directly to camera stream.',
              cameraId: data.cameraId,
              timestamp: Date.now()
            }));
          }
        }
        // Add other browser commands as needed
      } catch (error) {
        console.error(`Error processing browser message: ${error.message}`);
      }
    });
  }

  // Setup keepalive for this WebSocket connection
  setupWebSocketKeepAlive(ws);

  // Handle WebSocket errors and closure
  ws.on('error', (error) => {
    console.error(`WebSocket error: ${error.message}`);
  });

  ws.on('close', (code, reason) => {
    clearInterval(pingInterval);

    // Check if this was a camera client
    let disconnectedCameraId = null;

    for (const [id, camera] of clients.cameras.entries()) {
      if (camera === ws) {
        disconnectedCameraId = id;
        break;
      }
    }

    if (disconnectedCameraId) {
      clients.cameras.delete(disconnectedCameraId);
      console.log(`Camera ${disconnectedCameraId} disconnected - Code: ${code}`);

      // Notify browsers about camera disconnection
      for (const browser of clients.browsers) {
        if (browser.readyState === WebSocket.OPEN) {
          try {
            browser.send(JSON.stringify({
              type: 'camera_disconnected',
              id: disconnectedCameraId,
              timestamp: new Date().toISOString()
            }));
          } catch (error) {
            console.error(`Error notifying browser of camera disconnect: ${error.message}`);
          }
        }
      }
    }
    else if (clients.browsers.has(ws)) {
      clients.browsers.delete(ws);
      console.log(`Browser client disconnected - Code: ${code}`);
    }
    else if (clients.ai === ws) {
      clients.ai = null;
      console.log(`AI service disconnected - Code: ${code}`);
    }
  });
});

// Add special endpoint for AI connections
wss.on('upgrade', (request, socket, head) => {
  const url = new URL(`http://localhost${request.url}`);
  const path = url.pathname;

  if (path === '/ai') {
    console.log('AI service attempting to connect via WebSocket');
  }
});


// Check AI service health and send ping
function checkAIServiceHealth() {
  if (clients.ai && clients.ai.readyState === WebSocket.OPEN) {
    try {
      clients.ai.send(JSON.stringify({
        type: 'ping',
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error(`Error pinging AI service: ${error.message}`);
    }
  }

  // Reset processing count if it seems stuck
  if (objectDetection.processingCount > 0) {
    const now = Date.now();
    const detectionTimes = Array.from(objectDetection.lastDetectionTime.values());
    const lastDetectionTime = detectionTimes.length > 0 ? Math.max(...detectionTimes) : 0;

    // If no detections for over 30 seconds but processingCount > 0, reset it
    if (now - lastDetectionTime > 30000) {
      console.log(`Resetting stuck processing count from ${objectDetection.processingCount} to 0`);
      objectDetection.processingCount = 0;
    }
  }
}

// Setup periodic health checks
setInterval(checkAIServiceHealth, 15000); // Every 15 seconds

// Server error handling
server.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
});

// --- During detection, add results to session if active ---
// Example: In processAIResponse or similar detection handler
// if (currentSessionId) await addDetectionToSession(currentSessionId, detectionResult);
// ...existing code...

// Start server
const PORT = process.env.PORT || serverConfig.port || 3000;
server.listen(PORT, async () => {
  console.log(`[SERVER START] Server listening on port ${PORT}`);
  console.log(`[SERVER START] WebSocket server ready for connections`);

  // Log initial system status
  console.log(`[SYSTEM STATUS] Object detection enabled: ${objectDetection.enabled}`);
  console.log(`[SYSTEM STATUS] Confidence threshold: ${objectDetection.confidenceThreshold}`);
  console.log(`[SYSTEM STATUS] Detection interval: ${objectDetection.detectionInterval}ms`);
  console.log(`[SYSTEM STATUS] Max concurrent: ${objectDetection.maxConcurrent}`);
  console.log(`[SYSTEM STATUS] Rate limit: ${objectDetection.rateLimit.maxRequestsPerMinute} req/min`);

  // Start Python detection API
  console.log(`[STARTUP] Starting Python API...`);
  startPythonAPI();

  // Reset rate limit counters
  objectDetection.rateLimit.requestCounter = 0;
  objectDetection.rateLimit.lastResetTime = Date.now();
  // Function to check API health
  async function checkDetectionApiHealth() {
    const apiPort = process.env.PYTHON_API_PORT || 8000;
    const healthUrl = isProduction
      ? `https://${serverConfig.host}/health`
      : `http://localhost:${apiPort}/health`;
    try {
      const response = await axios.get(healthUrl, {
        timeout: 3000,
        validateStatus: () => true // Accept any status code
      });

      return response.status === 200 && response.data && response.data.status === 'healthy';
    } catch (error) {
      console.error(`[API HEALTH] Health check failed: ${error.message}`);
      return false;
    }
  }

  // Wait a bit longer for the Python API to start
  setTimeout(async () => {
    console.log(`[STARTUP] Checking Python API health...`);
    // Check if the object detection API is available
    const apiHealthy = await checkDetectionApiHealth();
    if (apiHealthy) {
      console.log('[STARTUP] Object detection API is ready. Detection enabled.');
      objectDetection.enabled = true;
      objectDetection.errorCount = 0;
      objectDetection.processingCount = 0;
    } else {
      console.log('[STARTUP] Object detection API is not available. Detection disabled.');

      // Try again after a short delay in case it's still starting up
      setTimeout(async () => {
        console.log(`[STARTUP] Retrying Python API health check...`);
        const retryHealthy = await checkDetectionApiHealth();
        if (retryHealthy) {
          console.log('[STARTUP] Object detection API is now ready on second attempt. Detection enabled.');
          objectDetection.enabled = true;
          objectDetection.errorCount = 0;
          objectDetection.processingCount = 0;
        } else {
          console.log('[STARTUP] Python API still not ready after retry. Will continue monitoring...');
        }
      }, 5000);
    }

    // Log final system status
    console.log(`[STARTUP COMPLETE] Final system status:`);
    console.log(`  - Object detection enabled: ${objectDetection.enabled}`);
    console.log(`  - AI service connected: ${clients.ai ? 'YES' : 'NO'}`);
    console.log(`  - Cameras connected: ${clients.cameras.size}`);
    console.log(`  - Browsers connected: ${clients.browsers.size}`);
    console.log(`  - Active session: ${activeSessionId || 'NONE'}`);

  }, 10000);
});