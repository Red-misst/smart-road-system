import { createServer } from 'http';
import { promises as fsPromises, createReadStream, existsSync } from 'fs';
import { join, dirname } from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import axios from 'axios';
import {
  createSession,
  endSession,
  addDetectionToSession,
  getSessions,
  getSessionData,
  getSessionDetections
} from './mongo.js';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Track different types of clients with camera identification
const clients = {
  cameras: new Map(), // Map to store camera clients with their IDs: Map<cameraId, ws>
  browsers: new Set(), // Set of browser clients
  ai: null // AI WebSocket connection
};

// Settings for video streaming - optimized for smoother delivery
const streamSettings = {
  frameInterval: 16, // ~60 fps maximum (milliseconds between frames)
  maxQueueSize: 2,   // Smaller queue for lower latency
  lastFrameSent: new Map(),
  frameQueue: new Map(),
  latestFrames: new Map() // Store latest frame from each camera: Map<cameraId, frame>
};

// Object detection configuration
const objectDetection = {
  enabled: true,
  apiEndpoint: 'ws://localhost:8000/ws', // Using WebSocket for better performance
  httpApiEndpoint: 'http://localhost:8000/detect', // HTTP endpoint as backup
  confidenceThreshold: 0.05, // Set to 0.05 as requested
  detectionInterval: 100, // ms between detections (limit to 60 fps for API)
  lastDetectionTime: new Map(), // Track last detection time per camera
  detectionResults: new Map(), // Store latest detection results per camera
  processingCount: 0, // Track currently processing detections
  maxConcurrent: 3, // Maximum concurrent detection requests
  errorCount: 0, // Track consecutive errors
  maxErrors: 10, // Maximum consecutive errors before disabling
  pythonProcess: null, // Store reference to the Python process
  trafficStatus: new Map() // Track traffic status for each intersection: Map<cameraId, status>
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
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId }));
        
        // Set auto-end timer
        setTimeout(async () => {
          if (activeSessionId === sessionId.toString()) {
            try {
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
  }  if (req.url.startsWith('/api/session/') && req.url.endsWith('/data') && req.method === 'GET') {
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
 * Process and distribute video frames - optimized for performance
 * @param {Buffer} frame - Binary JPEG frame data
 * @param {string} cameraId - ID of the camera source
 */
function processVideoFrame(frame, cameraId) {
  // Store the latest frame from this camera
  streamSettings.latestFrames.set(cameraId, frame);
  
  // Log once per 100 frames to reduce overhead
  if (Math.random() < 0.01) {
    console.log(`Processing frame from ${cameraId}: ${frame.length} bytes`);
  }
  
  // Send to all connected browser clients
  for (const browser of clients.browsers) {
    if (browser.readyState !== WebSocket.OPEN) continue;
    
    try {
      // First send the camera ID that this frame belongs to
      const metadata = JSON.stringify({
        type: 'frame_metadata',
        id: cameraId,
        timestamp: Date.now(),
        size: frame.length
      });
      
      browser.send(metadata);
      
      // Wait a tiny bit to ensure metadata is processed before binary frame
      setTimeout(() => {
        // Then send the actual frame
        if (browser.readyState === WebSocket.OPEN) {
          browser.send(frame, { binary: true }, (err) => {
            if (err) {
              console.error(`Error sending frame: ${err.message}`);
            }
          });
        }
      }, 5);
    } catch (error) {
      console.error(`Frame sending error: ${error.message}`);
    }
  }
  
  // Perform object detection at controlled intervals via WebSocket
  if (objectDetection.enabled && clients.ai) {
    const now = Date.now();
    const lastDetection = objectDetection.lastDetectionTime.get(cameraId) || 0;
    
    // Only run detection if enough time has passed since last detection
    if (now - lastDetection >= objectDetection.detectionInterval) {
      // Update last detection time right away to prevent scheduling too many
      objectDetection.lastDetectionTime.set(cameraId, now);
      
      // Send frame to AI via WebSocket
      sendFrameToAI(frame, cameraId);
    }
  }
}

/**
 * Send frame to AI service via WebSocket
 * @param {Buffer} frame - Binary JPEG frame data
 * @param {string} cameraId - ID of the camera source
 */
function sendFrameToAI(frame, cameraId) {
  if (!clients.ai || clients.ai.readyState !== WebSocket.OPEN) {
    // AI WebSocket not connected
    return;
  }
  if (!cameraId) {
    console.warn('sendFrameToAI: cameraId is missing or unknown!');
  }
  try {
    // Create detection request with metadata
    const metadata = {
      type: 'detection_request_metadata',
      camera_id: cameraId || 'unknown',
      confidence: objectDetection.confidenceThreshold,
      timestamp: Date.now()
    };
    
    // First send the metadata as JSON
    clients.ai.send(JSON.stringify(metadata));
    
    // Then send the actual binary frame directly (without base64 conversion)
    // This avoids the UTF-8 decode error in Python
    setTimeout(() => {
      if (clients.ai && clients.ai.readyState === WebSocket.OPEN) {
        clients.ai.send(frame, { binary: true }, (err) => {
          if (err) {
            console.error(`Error sending binary frame to AI: ${err.message}`);
          }
        });
      }
    }, 5);
  } catch (error) {
    console.error(`Error sending frame to AI: ${error.message}`);
  }
}

/**
 * Process AI detection response
 * @param {Object} message - Detection response from AI
 */
async function processAIResponse(message) {
  if (!message || !message.results) return;
  
  const results = message.results;
  const cameraId = message.camera_id;
  
  if (!cameraId) return;
  
  // Store detection results
  objectDetection.detectionResults.set(cameraId, results);
  
  // Process detections to count objects by class
  const detections = results.detections || [];
  let carCount = 0;
  let accidentCount = 0;
  
  detections.forEach(detection => {
    if (detection.class_name === 'car') {
      carCount++;
    } else if (detection.class_name === 'accident') {
      accidentCount++;
    }
  });
  
  // Create detection record
  const detectionRecord = {
    timestamp: new Date(),
    cameraId: cameraId,
    detections: detections,
    carCount,
    accidentCount,
    inference_time: results.inference_time || 0,
    total_time: results.total_time || 0,
    image_size: results.image_size || [0, 0]
  };
  
  // If there's an active session, add the detection to MongoDB
  if (activeSessionId) {
    try {
      await addDetectionToSession(activeSessionId, detectionRecord);
    } catch (error) {
      console.error(`Error saving detection to MongoDB: ${error.message}`);
    }
  }
  
  // Broadcast detection results to browser clients
  broadcastDetectionResults(cameraId, results);
  
  // Handle traffic redirection based on analysis
  if (results.traffic_analysis) {
    handleTrafficRedirection(cameraId, results.traffic_analysis);
  }
}

/**
 * Broadcast detection results to all connected browser clients
 * @param {string} cameraId - ID of the camera source
 * @param {Object} results - Detection results from the API
 */
function broadcastDetectionResults(cameraId, results) {
  if (!results) return;
  
  // Create a message to send to browsers
  const detectionMessage = {
    type: 'detection_results',
    cameraId,
    detections: results.detections,
    inference_time: results.inference_time,
    timestamp: Date.now(),
    sessionId: activeSessionId // Include the active session ID if there is one
  };
  
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
      try { ws.ping(); } catch {}
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
    
    console.log(`Camera client connected from ${clientIp}, waiting for identification...`);
    
    ws.on('message', (data) => {
      try {
        // First check if this is JPEG data - ESP32CAMs often send raw JPEGs
        if (isJpegData(data)) {
          // If we know the camera ID, process the frame
          if (cameraId) {
            processVideoFrame(data, cameraId);
          } else {
            console.warn("Received JPEG frame but camera ID is not yet known");
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
                console.log(`Camera identified as: ${cameraId}`);
              }
              
              // Store or update camera metadata
              if (message.type === 'camera_info') {
                cameraMetadata.set(cameraId, message);
                console.log(`Updated metadata for camera: ${cameraId}`);
                
                // Broadcast camera connection to all browsers
                sendCameraInfo(cameraId);
              } 
              // Store frame metadata for next binary frame
              else if (message.type === 'frame_metadata') {
                pendingFrames.set(cameraId, message);
                // Log occasionally
                if (Math.random() < 0.01) {
                  console.log(`Received frame metadata for ${cameraId}`);
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
        }
        // Binary data (camera frame)
        else if (cameraId) {
          console.log(`Received binary frame from ${cameraId}: ${data.length} bytes`);
          processVideoFrame(data, cameraId);
        }
      } catch (error) {
        console.error(`Error processing camera data: ${error.message}`);
      }
    });
  } 
  else if (isAI) {
    // Store the AI connection
    clients.ai = ws;
    console.log(`AI service connected from ${clientIp}`);
    
    // Handle messages from the AI service
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log(`Received message from AI: ${data.type}`);
        
        if (data.type === 'detection_response') {
          processAIResponse(data);
        }
        else if (data.type === 'ai_connected') {
          console.log(`AI service connected: ${data.message}`);
        }
        else if (data.type === 'pong') {
          // Received ping response
          console.log('AI service ping response received');
        }
        // Add other message types if needed
      } catch (error) {
        console.error(`Error processing message from AI: ${error.message}`);
      }
    });
  }  else {
    // Browser client
    clients.browsers.add(ws);
    console.log(`Browser client connected: ${clientIp}`);
    
    // Send camera list to the new browser client
    sendCameraInfo();
    
    // Send active session status if there is one
    if (activeSessionId) {
      ws.send(JSON.stringify({
        type: 'session_status',
        sessionId: activeSessionId,
        startTime: sessionStartTime,
        params: sessionParams,
        status: 'active'
      }));
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
          // Send the requested camera's latest frame
          const cameraId = data.cameraId;
          
          if (streamSettings.latestFrames.has(cameraId)) {
            const frame = streamSettings.latestFrames.get(cameraId);
            
            // Send metadata first
            const metadata = JSON.stringify({
              type: 'frame_metadata',
              id: cameraId,
              timestamp: Date.now(),
              requested: true
            });
            
            ws.send(metadata);
            
            // Then send the frame
            ws.send(frame, { binary: true });
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

// Check health of the object detection API
async function checkDetectionApiHealth() {
  try {
    const response = await axios.get('http://localhost:8000/health', { timeout: 3000 });
    console.log('Object detection API health check: ', response.data);
    return true;
  } catch (error) {
    console.error(`Object detection API health check failed: ${error.message}`);
    return false;
  }
}

// Server error handling
server.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
});

// --- During detection, add results to session if active ---
// Example: In processAIResponse or similar detection handler
// if (currentSessionId) await addDetectionToSession(currentSessionId, detectionResult);
// ...existing code...

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`WebSocket server ready for connections`);
  
  // Start Python detection API
  startPythonAPI();
  
  // Wait a bit longer for the Python API to start (increased from 6000ms to 10000ms)
  setTimeout(async () => {
    // Check if the object detection API is available
    const apiHealthy = await checkDetectionApiHealth();
    if (apiHealthy) {
      console.log('Object detection API is ready. Detection enabled.');
      objectDetection.enabled = true;
    } else {
      console.log('Object detection API is not available. Detection disabled.');
      
      // Try again after a short delay in case it's still starting up
      setTimeout(async () => {
        const retryHealthy = await checkDetectionApiHealth();
        if (retryHealthy) {
          console.log('Object detection API is now ready on second attempt. Detection enabled.');
          objectDetection.enabled = true;
        }
      }, 5000);
    }
  }, 10000);
});