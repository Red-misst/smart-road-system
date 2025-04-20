import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { promises as fsPromises, createReadStream } from 'fs';
import { join } from 'path';
import { WebSocket } from 'ws';
import axios from 'axios';

// Track different types of clients with camera identification
const clients = {
  cameras: new Map(), // Map to store camera clients with their IDs: Map<cameraId, ws>
  browsers: new Set() // Set of browser clients
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
  apiEndpoint: 'http://localhost:8000/detect',
  confidenceThreshold: 0.25,
  detectionInterval: 100, // ms between detections (limit to ~10 fps for API)
  lastDetectionTime: new Map(), // Track last detection time per camera
  detectionResults: new Map(), // Store latest detection results per camera
  processingCount: 0, // Track currently processing detections
  maxConcurrent: 3, // Maximum concurrent detection requests
  errorCount: 0, // Track consecutive errors
  maxErrors: 10 // Maximum consecutive errors before disabling
};

// Model training state
const modelTraining = {
  active: false,
  statusPollInterval: null,
  lastStatus: null
};

// Camera metadata storage
const cameraMetadata = new Map(); // Map<cameraId, {info}>
let pendingFrames = new Map(); // For handling metadata + binary frame pairs

// Create HTTP server with error handling
const server = createServer(async (req, res) => {
  console.log(`HTTP request: ${req.method} ${req.url}`);
  
  if (req.url === '/' || req.url === '/index.html') {
    const indexPath = join(process.cwd(), 'index.html');
    
    try {
      await fsPromises.access(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      createReadStream(indexPath).pipe(res);
    } catch (err) {
      console.error(`index.html not found: ${err}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error: index.html not found');
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
      hasDetections: objectDetection.detectionResults.has(id) // Whether we have detection data
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
 * Object detection function - sends frame to Python API for processing
 * @param {Buffer} frameBuffer - Binary JPEG frame data
 * @param {string} cameraId - ID of the camera source
 * @returns {Promise<Object>} - Detection results
 */
async function detectObjects(frameBuffer, cameraId) {
  // Skip if detection is disabled or too many concurrent requests
  if (!objectDetection.enabled || 
      objectDetection.processingCount >= objectDetection.maxConcurrent) {
    return null;
  }
  
  // Track processing count
  objectDetection.processingCount++;
  
  try {
    // Convert buffer to base64
    const base64Image = frameBuffer.toString('base64');
    
    // Log occasional status (every 10th frame)
    if (Math.random() < 0.1) {
      console.log(`Sending frame (${frameBuffer.length} bytes) from ${cameraId} for detection...`);
    }
    
    // Start the request timer
    const requestStart = Date.now();
    
    // Send to Python API
    const response = await axios.post(objectDetection.apiEndpoint, {
      image: base64Image,
      confidence: objectDetection.confidenceThreshold
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000 // 5 second timeout
    });
    
    // Calculate request time
    const requestTime = Date.now() - requestStart;
    
    // Reset error counter on success
    objectDetection.errorCount = 0;
    
    // Log occasional detection statistics (every 10th detection)
    if (Math.random() < 0.1) {
      console.log(`Detection for ${cameraId} completed in ${requestTime}ms. Found ${response.data.detections.length} objects.`);
    }
    
    // Store detection results with timestamp
    const results = {
      ...response.data,
      receivedAt: Date.now(),
      cameraId
    };
    objectDetection.detectionResults.set(cameraId, results);
    
    // Broadcast detection results to browser clients
    broadcastDetectionResults(cameraId, results);
    
    return results;
  } catch (error) {
    // Increment error counter
    objectDetection.errorCount++;
    
    console.error(`Detection error for ${cameraId}: ${error.message}`);
    
    // If too many consecutive errors, disable detection temporarily
    if (objectDetection.errorCount >= objectDetection.maxErrors) {
      console.error(`Too many consecutive detection errors. Disabling detection for 30 seconds.`);
      objectDetection.enabled = false;
      
      // Re-enable after 30 seconds
      setTimeout(() => {
        objectDetection.enabled = true;
        objectDetection.errorCount = 0;
        console.log('Object detection re-enabled after cooldown');
      }, 30000);
    }
    
    return null;
  } finally {
    // Always decrement the processing count
    objectDetection.processingCount--;
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

/**
 * Start model training with the specified parameters
 * @param {Object} params - Training parameters
 * @param {number} params.epochs - Number of training epochs
 * @param {number} params.batch_size - Batch size for training
 * @returns {Promise<Object>} - Training response
 */
async function startModelTraining(params) {
  try {
    // Send training request to API
    const response = await axios.post('http://localhost:8000/train', {
      epochs: params.epochs || 10,
      batch_size: params.batch_size || 16
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    });
    
    // Set up status polling if training started successfully
    if (response.data && response.data.status === 'started') {
      modelTraining.active = true;
      
      // Start polling for training status updates
      startTrainingStatusPolling();
    }
    
    return response.data;
  } catch (error) {
    console.error(`Training error: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Stop ongoing model training
 * @returns {Promise<Object>} - Stop training response
 */
async function stopModelTraining() {
  try {
    const response = await axios.post('http://localhost:8000/train/stop', {}, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 2000
    });
    
    return response.data;
  } catch (error) {
    console.error(`Error stopping training: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Poll for training status updates and broadcast to browsers
 */
function startTrainingStatusPolling() {
  // Clear any existing polling interval
  if (modelTraining.statusPollInterval) {
    clearInterval(modelTraining.statusPollInterval);
  }
  
  // Poll every 1 second
  modelTraining.statusPollInterval = setInterval(async () => {
    try {
      const response = await axios.get('http://localhost:8000/train/status', {
        timeout: 2000
      });
      
      // Cache the status
      modelTraining.lastStatus = response.data;
      
      // Broadcast status to all browsers
      broadcastTrainingStatus(response.data);
      
      // Check if we should stop polling
      if (response.data.status === 'idle' || response.data.status === 'error') {
        modelTraining.active = false;
        clearInterval(modelTraining.statusPollInterval);
        modelTraining.statusPollInterval = null;
      }
    } catch (error) {
      console.error(`Error polling training status: ${error.message}`);
    }
  }, 1000);
}

/**
 * Broadcast training status to all connected browser clients
 * @param {Object} status - Training status from the API
 */
function broadcastTrainingStatus(status) {
  if (!status) return;
  
  const statusMessage = {
    type: 'training_status',
    ...status,
    timestamp: Date.now()
  };
  
  // Send to all connected browsers
  for (const browser of clients.browsers) {
    if (browser.readyState === WebSocket.OPEN) {
      try {
        browser.send(JSON.stringify(statusMessage));
      } catch (error) {
        console.error(`Error sending training status: ${error.message}`);
      }
    }
  }
}

// Process and distribute video frames - optimized for performance
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
  
  // Perform object detection at controlled intervals
  if (objectDetection.enabled) {
    const now = Date.now();
    const lastDetection = objectDetection.lastDetectionTime.get(cameraId) || 0;
    
    // Only run detection if enough time has passed since last detection
    if (now - lastDetection >= objectDetection.detectionInterval) {
      // Update last detection time right away to prevent scheduling too many
      objectDetection.lastDetectionTime.set(cameraId, now);
      
      // Run detection asynchronously
      detectObjects(frame, cameraId).catch(err => {
        console.error(`Unhandled detection error: ${err.message}`);
      });
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
  
  // Determine client type (camera or browser)
  const url = new URL(`http://localhost${req.url}`);
  const clientType = url.searchParams.get('type') || 'browser';
  const isCamera = clientType === 'camera';
  
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
  } else {
    // Browser client
    clients.browsers.add(ws);
    console.log(`Browser client connected: ${clientIp}`);
    
    // Send camera list to the new browser client
    sendCameraInfo();
    
    // Send current training status if active
    if (modelTraining.active && modelTraining.lastStatus) {
      try {
        ws.send(JSON.stringify({
          type: 'training_status',
          ...modelTraining.lastStatus,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(`Error sending training status to new browser: ${error.message}`);
      }
    }
    
    ws.on('message', (data) => {
      // Skip processing if it's binary data from browser
      if (data instanceof Buffer || isBinaryData(data)) {
        // Binary data from browser is unexpected but we'll just ignore it
        return;
      }
      
      try {
        // Only try to parse as JSON if it's not binary data
        const message = JSON.parse(data.toString());
        
        // Handle browser commands
        if (message.command === 'get_info') {
          sendCameraInfo(message.cameraId); // Can be undefined to get all
        }
        else if (message.command === 'list_cameras') {
          sendCameraInfo();
        }
        else if (message.command === 'get_latest_frame' && message.cameraId) {
          // Send the requested camera's latest frame
          const cameraId = message.cameraId;
          
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
        else if (message.command === 'get_latest_detections' && message.cameraId) {
          // Send the requested camera's latest detection results
          const cameraId = message.cameraId;
          if (objectDetection.detectionResults.has(cameraId)) {
            const results = objectDetection.detectionResults.get(cameraId);
            
            ws.send(JSON.stringify({
              type: 'detection_results',
              ...results,
              timestamp: Date.now()
            }));
          }
        }
        else if (message.command === 'set_detection_config') {
          // Update object detection configuration
          if (message.enabled !== undefined) {
            objectDetection.enabled = !!message.enabled;
          }
          
          if (message.interval && typeof message.interval === 'number') {
            objectDetection.detectionInterval = Math.max(100, Math.min(5000, message.interval));
          }
          
          if (message.confidence && typeof message.confidence === 'number') {
            objectDetection.confidenceThreshold = Math.max(0.1, Math.min(0.9, message.confidence));
          }
          
          // Send config acknowledgment
          ws.send(JSON.stringify({
            type: 'detection_config',
            ...objectDetection,
            timestamp: Date.now()
          }));
        }
        else if (message.command === 'train_model') {
          // Handle model training request
          if (modelTraining.active) {
            ws.send(JSON.stringify({
              type: 'training_status',
              status: 'error',
              message: 'Training already in progress',
              timestamp: Date.now()
            }));
          } else {
            // Start the training
            startModelTraining({
              epochs: message.epochs,
              batch_size: message.batch_size
            }).then(response => {
              // Initial response is sent via the status polling mechanism
              console.log(`Training started: ${JSON.stringify(response)}`);
            }).catch(error => {
              ws.send(JSON.stringify({
                type: 'training_status',
                status: 'error',
                message: error.message || 'Training failed to start',
                timestamp: Date.now()
              }));
            });
          }
        }
        else if (message.command === 'stop_training') {
          // Handle training stop request
          if (modelTraining.active) {
            stopModelTraining().then(response => {
              console.log(`Training stop requested: ${JSON.stringify(response)}`);
            }).catch(error => {
              console.error(`Error stopping training: ${error.message}`);
            });
          }
        }
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
    } else if (clients.browsers.has(ws)) {
      clients.browsers.delete(ws);
      console.log(`Browser client disconnected - Code: ${code}`);
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

// Server error handling
server.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`WebSocket server ready for ESP32-CAM connections`);
  
  // Check if the object detection API is available
  const apiHealthy = await checkDetectionApiHealth();
  if (apiHealthy) {
    console.log('Object detection API is ready. Detection enabled.');
    objectDetection.enabled = true;
  } else {
    console.log('Object detection API is not available. Detection disabled.');
    objectDetection.enabled = false;
  }
});