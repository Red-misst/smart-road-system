import { createServer } from 'http';
import { promises as fsPromises, createReadStream, existsSync } from 'fs';
import { join, dirname } from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import axios from 'axios';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Track different types of clients with camera identification
const clients = {
  cameras: new Map(), // Map to store camera clients with their IDs: Map<cameraId, ws>
  browsers: new Set(), // Set of browser clients
  admins: new Set(), // Set of admin clients
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
  confidenceThreshold: 0.25,
  detectionInterval: 100, // ms between detections (limit to ~10 fps for API)
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

// Admin dashboard data - track traffic analytics
const adminData = {
  stats: {
    activeIntersections: 4,
    connectedCameras: 0,
    trafficVolume: 0,
    systemStatus: 'operational'
  },
  vehicleComposition: {
    car: 0,
    truck: 0,
    bus: 0,
    motorcycle: 0,
    bicycle: 0,
    person: 0
  },
  hourlyTraffic: {}, // Will store hourly data
  metrics: {
    levelOfService: 'B',
    averageDelay: 18.5,
    queueLength: 42,
    vcRatio: 0.78,
    pceValue: 1.34,
    criticalGap: 4.5,
    saturationFlow: 1850,
    intersectionCapacity: 2400
  },
  intersectionStatus: {
    'intersection-1': {
      eastWest: 'GREEN',
      northSouth: 'RED',
      cycleDuration: 60,
      flowRate: 5
    },
    'intersection-2': {
      eastWest: 'RED',
      northSouth: 'GREEN',
      cycleDuration: 55,
      flowRate: 7
    },
    'intersection-3': {
      eastWest: 'YELLOW',
      northSouth: 'RED',
      cycleDuration: 50,
      flowRate: 4
    },
    'intersection-4': {
      eastWest: 'RED',
      northSouth: 'GREEN',
      cycleDuration: 65,
      flowRate: 6
    }
  },
  logs: [] // System logs
};

// Initialize hourly traffic data
function initHourlyData() {
  const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', 
                 '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];
  hours.forEach(hour => {
    adminData.hourlyTraffic[hour] = Math.floor(Math.random() * 300) + 100;
  });
}
initHourlyData();

// Add system log entry
function addSystemLog(message, level = 'info') {
  const logEntry = {
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    message,
    level
  };
  
  adminData.logs.unshift(logEntry); // Add to beginning of array
  
  // Keep logs under a certain size
  if (adminData.logs.length > 100) {
    adminData.logs.pop(); // Remove oldest entry
  }
  
  // Send to admin clients
  broadcastToAdmins({
    type: 'system_log',
    ...logEntry
  });
}

// Update admin data based on detection results
function updateAdminDataFromDetection(results, cameraId) {
  if (!results || !results.detections) return;
  
  // Count vehicles by type
  const counts = {};
  results.detections.forEach(detection => {
    const className = detection.class_name.toLowerCase();
    counts[className] = (counts[className] || 0) + 1;
  });
  
  // Update vehicle composition
  Object.keys(counts).forEach(className => {
    if (adminData.vehicleComposition[className] !== undefined) {
      adminData.vehicleComposition[className] += counts[className];
    } else {
      adminData.vehicleComposition[className] = counts[className];
    }
  });
  
  // Update total traffic volume
  const newVehicles = Object.values(counts).reduce((sum, count) => sum + count, 0);
  adminData.stats.trafficVolume += newVehicles;
  
  // Update hourly traffic - add to current hour
  const currentHour = new Date().getHours().toString().padStart(2, '0') + ':00';
  if (adminData.hourlyTraffic[currentHour] !== undefined) {
    adminData.hourlyTraffic[currentHour] += newVehicles;
  } else {
    adminData.hourlyTraffic[currentHour] = newVehicles;
  }
  
  // Update traffic metrics based on detection results
  if (results.traffic_analysis) {
    const { density, vehicle_count } = results.traffic_analysis;
    
    // Update Level of Service based on traffic density
    if (density === 'high') {
      adminData.metrics.levelOfService = vehicle_count > 15 ? 'F' : 'E';
      adminData.metrics.averageDelay = 55 + Math.random() * 20;
      adminData.metrics.queueLength = 75 + Math.floor(Math.random() * 25);
      adminData.metrics.vcRatio = 0.9 + Math.random() * 0.1;
    } else if (density === 'moderate') {
      adminData.metrics.levelOfService = 'C';
      adminData.metrics.averageDelay = 25 + Math.random() * 10;
      adminData.metrics.queueLength = 35 + Math.floor(Math.random() * 15);
      adminData.metrics.vcRatio = 0.65 + Math.random() * 0.15;
    } else {
      adminData.metrics.levelOfService = 'B';
      adminData.metrics.averageDelay = 15 + Math.random() * 5;
      adminData.metrics.queueLength = 20 + Math.floor(Math.random() * 10);
      adminData.metrics.vcRatio = 0.4 + Math.random() * 0.1;
    }
    
    // Add to log for significant traffic events
    if (density === 'high' && vehicle_count > 10) {
      addSystemLog(`High traffic detected at camera ${cameraId}: ${vehicle_count} vehicles`, 'warning');
    }
  }
  
  // Broadcast updated data to admin clients
  broadcastAdminDataUpdate();
}

// Process AI detection response - updated to include admin data updates
function processAIResponse(message) {
  if (!message || !message.results) return;
  
  const results = message.results;
  const cameraId = message.camera_id;
  
  if (!cameraId) return;
  
  // Store detection results
  objectDetection.detectionResults.set(cameraId, results);
  
  // Broadcast detection results to browser clients
  broadcastDetectionResults(cameraId, results);
  
  // Update admin data 
  updateAdminDataFromDetection(results, cameraId);
  
  // Handle traffic redirection based on analysis
  if (results.traffic_analysis) {
    handleTrafficRedirection(cameraId, results.traffic_analysis);
  }
}

// Broadcast admin data update to all admin clients
function broadcastAdminDataUpdate() {
  broadcastToAdmins({
    type: 'admin_data',
    data: adminData
  });
}

// Broadcast to all admin clients
function broadcastToAdmins(message) {
  const messageString = typeof message === 'string' ? message : JSON.stringify(message);
  
  for (const admin of clients.admins) {
    if (admin.readyState === WebSocket.OPEN) {
      try {
        admin.send(messageString);
      } catch (error) {
        console.error(`Error sending to admin: ${error.message}`);
      }
    }
  }
}

// Handle traffic light control request from admin
function handleTrafficLightControl(message, ws) {
  const { intersectionId, cycleDuration, flowRate } = message;
  
  // Update intersection status
  if (adminData.intersectionStatus[intersectionId]) {
    adminData.intersectionStatus[intersectionId].cycleDuration = cycleDuration;
    adminData.intersectionStatus[intersectionId].flowRate = flowRate;
    
    // Add to system logs
    addSystemLog(`Updated traffic light settings for ${intersectionId}: cycle ${cycleDuration}s, flow rate ${flowRate}`);
    
    // In a real system, this would send commands to the physical traffic lights
    console.log(`Traffic light control: ${intersectionId}, cycle: ${cycleDuration}s, flow: ${flowRate}`);
    
    // Broadcast updated status to all admins
    broadcastAdminDataUpdate();
    
    return true;
  }
  
  return false;
}

// Handle emergency mode toggle
function handleEmergencyMode(message) {
  const { intersectionId, enabled } = message;
  
  // Update intersection status
  if (adminData.intersectionStatus[intersectionId]) {
    // In emergency mode, set traffic lights to prioritize one direction
    if (enabled) {
      adminData.intersectionStatus[intersectionId].eastWest = 'GREEN';
      adminData.intersectionStatus[intersectionId].northSouth = 'RED';
      
      // Add to system logs
      addSystemLog(`Emergency mode activated for ${intersectionId}`, 'warning');
    } else {
      // Return to normal operation
      addSystemLog(`Emergency mode deactivated for ${intersectionId}`, 'info');
    }
    
    // Broadcast updated status to all admins
    broadcastAdminDataUpdate();
    
    return true;
  }
  
  return false;
}

// Create HTTP server with error handling
const server = createServer(async (req, res) => {
  console.log(`HTTP request: ${req.method} ${req.url}`);
  
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
  // Update admin stats
  adminData.stats.connectedCameras = clients.cameras.size;

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
    
    // Send to browsers
    for (const browser of clients.browsers) {
      if (browser.readyState === WebSocket.OPEN) {
        try {
          browser.send(infoString);
        } catch (error) {
          console.error(`Error sending camera list: ${error}`);
        }
      }
    }
    
    // Also send to admin clients
    for (const admin of clients.admins) {
      if (admin.readyState === WebSocket.OPEN) {
        try {
          admin.send(infoString);
        } catch (error) {
          console.error(`Error sending camera list to admin: ${error.message}`);
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
  
  try {
    // Create detection request with metadata
    const metadata = {
      type: 'detection_request_metadata',
      camera_id: cameraId,
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
    timestamp: Date.now()
  };
  
  // Send to all connected browsers
  for (const browser of clients.browsers) {
    if (browser.readyState === WebSocket.OPEN) {
      try {
        browser.send(JSON.stringify(detectionMessage));
      } catch (error) {
        console.error(`Error sending detection results: ${error.message}`);
      }
    }
  }
}

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
  
  // Determine client type (camera, browser, admin, or ai)
  const url = new URL(`http://localhost${req.url}`);
  const clientType = url.searchParams.get('type') || 'browser';
  const isCamera = clientType === 'camera';
  const isAI = clientType === 'ai';
  const isAdmin = clientType === 'admin';
  
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
            console.log(`Received JPEG frame from ${cameraId}: ${data.length} bytes`);
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
  }
  else if (isAdmin) {
    // Admin client
    clients.admins.add(ws);
    console.log(`Admin client connected: ${clientIp}`);
    
    // Send initial admin data
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'admin_data',
          data: adminData
        }));
        
        // Send camera list
        sendCameraInfo();
      } catch (error) {
        console.error(`Error sending initial admin data: ${error.message}`);
      }
    }
    
    // Handle admin messages
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        console.log(`Received admin message: ${data.type}`);
        
        // Handle different message types
        switch (data.type) {
          case 'get_admin_data':
            // Send all admin data
            ws.send(JSON.stringify({
              type: 'admin_data',
              data: adminData
            }));
            break;
            
          case 'admin_connected':
            // Admin client identified itself
            console.log(`Admin client identified: ${clientIp}`);
            addSystemLog('Admin connected to dashboard', 'info');
            break;
            
          case 'traffic_light_control':
            // Handle traffic light control request
            handleTrafficLightControl(data, ws);
            break;
            
          case 'emergency_mode':
            // Handle emergency mode toggle
            handleEmergencyMode(data);
            break;
            
          case 'auto_control':
            // Handle auto control request
            addSystemLog(`Auto traffic control activated for ${data.intersectionId}`, 'info');
            break;
            
          case 'activate_cameras':
            // Handle camera activation request
            addSystemLog(`Cameras activated for ${data.intersectionId}`, 'info');
            break;
            
          case 'change_traffic_pattern':
            // Handle traffic pattern change
            addSystemLog(`Traffic pattern changed for ${data.intersectionId}`, 'info');
            break;
            
          case 'update_detection_settings':
            // Update object detection settings
            if (data.settings) {
              objectDetection.confidenceThreshold = data.settings.confidenceThreshold;
              console.log(`Detection settings updated: confidence=${objectDetection.confidenceThreshold}`);
              addSystemLog(`Detection settings updated by admin`, 'info');
            }
            break;
            
          default:
            console.log(`Unknown admin message type: ${data.type}`);
        }
      } catch (error) {
        console.error(`Error processing admin message: ${error}`);
      }
    });
  }
  else {
    // Browser client
    clients.browsers.add(ws);
    console.log(`Browser client connected: ${clientIp}`);
    
    // Send camera list to the new browser client
    sendCameraInfo();
    
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
      
      // Update admin stats
      adminData.stats.connectedCameras = clients.cameras.size;
      broadcastAdminDataUpdate();
      
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
    else if (clients.admins.has(ws)) {
      clients.admins.delete(ws);
      console.log(`Admin client disconnected - Code: ${code}`);
      addSystemLog('Admin disconnected from dashboard', 'info');
    }
    else if (clients.ai === ws) {
      clients.ai = null;
      console.log(`AI service disconnected - Code: ${code}`);
      addSystemLog('AI detection service disconnected', 'error');
    }
  });
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

// Start Python detection API
function startPythonAPI() {
  try {
    // Check if the Python API is already running by making a health check request
    checkDetectionApiHealth().then(isRunning => {
      if (isRunning) {
        console.log('Object detection API is already running');
        return;
      }
      
      console.log('Starting Python object detection API...');
      
      // Determine path to the Python script
      const pythonScriptPath = join(__dirname, 'ai', 'object_detection_api.py');
      
      // Check if the script exists
      if (!existsSync(pythonScriptPath)) {
        console.error(`Python script not found at ${pythonScriptPath}`);
        addSystemLog(`Failed to start detection API: Script not found`, 'error');
        return;
      }
      
      // Determine Python executable - use 'python' or 'python3' depending on the system
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      
      // Spawn the Python process
      objectDetection.pythonProcess = spawn(pythonCommand, [pythonScriptPath], {
        stdio: 'pipe',
        detached: false  // Keep attached to parent process
      });
      
      // Handle Python process output
      objectDetection.pythonProcess.stdout.on('data', (data) => {
        console.log(`Python API: ${data.toString().trim()}`);
      });
      
      objectDetection.pythonProcess.stderr.on('data', (data) => {
        console.error(`Python API Error: ${data.toString().trim()}`);
      });
      
      // Handle process exit
      objectDetection.pythonProcess.on('exit', (code, signal) => {
        console.log(`Python API process exited with code ${code} and signal ${signal}`);
        objectDetection.pythonProcess = null;
        
        if (code !== 0) {
          addSystemLog(`Detection API exited unexpectedly with code ${code}`, 'error');
        }
      });
      
      // Handle process error
      objectDetection.pythonProcess.on('error', (err) => {
        console.error(`Failed to start Python API: ${err.message}`);
        objectDetection.pythonProcess = null;
        addSystemLog(`Failed to start detection API: ${err.message}`, 'error');
      });
      
      console.log('Python object detection API process started');
      
      // Add to system log
      addSystemLog('Object detection service starting...', 'info');
    });
  } catch (error) {
    console.error(`Error starting Python API: ${error.message}`);
    addSystemLog(`Failed to start detection API: ${error.message}`, 'error');
  }
}

// Server error handling
server.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`WebSocket server ready for connections`);
  
  // Add initial system log
  addSystemLog('System initialized successfully', 'success');
  
  // Start Python detection API
  startPythonAPI();
  
  // Wait a bit longer for the Python API to start
  setTimeout(async () => {
    // Check if the object detection API is available
    const apiHealthy = await checkDetectionApiHealth();
    if (apiHealthy) {
      console.log('Object detection API is ready. Detection enabled.');
      objectDetection.enabled = true;
      addSystemLog('AI detection service connected and ready', 'success');
    } else {
      console.log('Object detection API is not available. Detection disabled.');
      addSystemLog('AI detection service unavailable', 'error');
      
      // Try again after a short delay in case it's still starting up
      setTimeout(async () => {
        const retryHealthy = await checkDetectionApiHealth();
        if (retryHealthy) {
          console.log('Object detection API is now ready on second attempt. Detection enabled.');
          objectDetection.enabled = true;
          addSystemLog('AI detection service connected and ready', 'success');
        }
      }, 5000);
    }
  }, 10000);
});