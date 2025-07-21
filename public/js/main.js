/**
 * Smart Road System - Main Application Module
 * Entry point for the traffic analysis dashboard
 */

// Global application state
const app = {
    websocket: null,
    map: null,
    cameras: new Map(),
    detections: new Map(),
    currentSession: null,
    videoFrames: new Map(), // Store latest video frames
    canvasContexts: new Map() // Store canvas contexts for drawing
};

// WebSocket connection management
const websocket = {
    connection: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    reconnectDelay: 3000,

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}?type=browser`;
        
        try {
            this.connection = new WebSocket(wsUrl);
            app.websocket = this.connection;
            
            this.connection.onopen = () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
                ui.updateConnectionStatus(true);
                
                // Request camera list
                this.send({ type: 'get_camera_list' });
            };
            
            this.connection.onmessage = (event) => {
                this.handleMessage(event);
            };
            
            this.connection.onclose = () => {
                console.log('WebSocket disconnected');
                ui.updateConnectionStatus(false);
                this.attemptReconnect();
            };
            
            this.connection.onerror = (error) => {
                console.error('WebSocket error:', error);
                ui.updateConnectionStatus(false);
            };
            
            // Set binary type to arraybuffer for handling binary frames
            this.connection.binaryType = 'arraybuffer';
            
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.attemptReconnect();
        }
    },

    send(data) {
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.connection.send(JSON.stringify(data));
        }
    },

    handleMessage(event) {
        // Handle binary data (video frames)
        if (event.data instanceof ArrayBuffer) {
            if (app.currentFrameMetadata) {
                const cameraId = app.currentFrameMetadata.cameraId;
                ui.updateVideoFrame(cameraId, event.data);
                
                // Reset metadata after using it
                app.currentFrameMetadata = null;
            }
            return;
        }
        
        // Handle text data (JSON)
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'camera_list':
                    this.handleCameraList(data.cameras);
                    break;
                case 'camera_info':
                case 'camera_list_item':
                    this.handleCameraInfo(data);
                    break;
                case 'camera_direct_connect':
                    this.handleDirectConnect(data);
                    break;
                case 'detection_results':
                    this.handleDetectionResults(data);
                    break;
                case 'session_status':
                    this.handleSessionStatus(data);
                    break;
                case 'traffic_redirection':
                    this.handleTrafficRedirection(data);
                    break;
                case 'camera_disconnected':
                    this.handleCameraDisconnected(data);
                    break;
                case 'frame_metadata':
                    app.currentFrameMetadata = data;
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    },

    handleCameraList(cameras) {
        console.log('Received camera list:', cameras);
        cameras.forEach(camera => {
            this.handleCameraInfo(camera);
        });
        ui.updateCameraCount(cameras.length);
    },

    handleCameraInfo(camera) {
        app.cameras.set(camera.id, camera);
        ui.addCameraToGrid(camera);
        
        if (camera.ip_address) {
            // Setup direct video stream
            ui.setupDirectVideoStream(camera);
        }
    },

    handleDirectConnect(data) {
        const camera = app.cameras.get(data.id);
        if (camera) {
            camera.stream_url = data.stream_url;
            camera.ip_address = data.ip_address;
            app.cameras.set(data.id, camera);
            ui.setupDirectVideoStream(camera);
        }
    },

    handleDetectionResults(data) {
        app.detections.set(data.cameraId, data);
        ui.updateDetectionDisplay(data);
    },

    handleSessionStatus(data) {
        app.currentSession = data;
        ui.updateSessionDisplay(data);
    },

    handleTrafficRedirection(data) {
        ui.updateTrafficStatus(data);
    },

    handleCameraDisconnected(data) {
        app.cameras.delete(data.id);
        ui.removeCameraFromGrid(data.id);
    },

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            
            setTimeout(() => {
                this.connect();
            }, this.reconnectDelay);
        } else {
            console.error('Max reconnection attempts reached');
            ui.showConnectionError();
        }
    }
};

// UI management
const ui = {
    updateConnectionStatus(connected) {
        const status = document.getElementById('camera-status');
        if (status) {
            status.textContent = connected ? 'Connected to server' : 'Disconnected from server';
            status.className = connected ? 'text-green-600 text-sm mr-3' : 'text-red-600 text-sm mr-3';
        }
    },

    updateCameraCount(count) {
        const element = document.getElementById('cameras-count');
        if (element) element.textContent = count;
    },

    addCameraToGrid(camera) {
        const grid = document.getElementById('camera-feeds');
        if (!grid) return;

        // Check if camera already exists
        const existingCard = document.getElementById(`camera-card-${camera.id}`);
        if (existingCard) {
            this.updateCameraCard(camera);
            return;
        }

        const cameraCard = document.createElement('div');
        cameraCard.id = `camera-card-${camera.id}`;
        cameraCard.className = 'bg-gray-50 rounded-lg overflow-hidden shadow-sm border border-gray-200';
        
        cameraCard.innerHTML = `
            <div class="relative">
                <div id="video-container-${camera.id}" class="relative w-full h-48 bg-gray-200 flex items-center justify-center">
                    <canvas id="video-stream-${camera.id}" 
                         class="w-full h-full object-cover hidden"></canvas>
                    <div id="video-placeholder-${camera.id}" class="flex flex-col items-center justify-center text-gray-500">
                        <span class="material-icons text-4xl mb-2">videocam_off</span>
                        <span class="text-sm">Connecting...</span>
                    </div>
                </div>
                <div id="detection-overlay-${camera.id}" class="absolute top-0 left-0 w-full h-full pointer-events-none"></div>
                <div class="absolute top-2 right-2">
                    <span id="status-${camera.id}" class="px-2 py-1 text-xs font-medium rounded bg-yellow-100 text-yellow-800">
                        Connecting
                    </span>
                </div>
                <div class="absolute bottom-2 right-2 bg-blue-600 bg-opacity-80 text-white text-xs px-2 py-1 rounded">
                    <span id="fps-counter-${camera.id}">0 fps</span>
                </div>
            </div>
            <div class="p-3">
                <h4 class="font-medium text-gray-800 mb-1">Camera ${camera.id}</h4>
                <div class="text-sm text-gray-600 space-y-1">
                    <p>Location: ${camera.location || 'Unknown'}</p>
                    <p>Status: <span id="connection-status-${camera.id}">Connecting</span></p>
                    <p>Detections: <span id="detection-count-${camera.id}">0</span></p>
                </div>
            </div>
        `;

        grid.appendChild(cameraCard);
        
        // Initialize canvas context for this camera
        const canvas = document.getElementById(`video-stream-${camera.id}`);
        if (canvas) {
            const ctx = canvas.getContext('2d');
            app.canvasContexts.set(camera.id, ctx);
        }
        
        // Request a frame to start the stream
        this.requestVideoFrame(camera.id);
    },

    updateCameraCard(camera) {
        const statusElement = document.getElementById(`connection-status-${camera.id}`);
        if (statusElement) {
            statusElement.textContent = camera.connected ? 'Connected' : 'Disconnected';
        }
    },
    
    setupDirectVideoStream(camera) {
        if (!camera.stream_url && !camera.ip_address) return;
        
        const canvasElement = document.getElementById(`video-stream-${camera.id}`);
        const placeholder = document.getElementById(`video-placeholder-${camera.id}`);
        const statusElement = document.getElementById(`status-${camera.id}`);
        
        if (!canvasElement || !placeholder || !statusElement) return;
        
        // Show we're ready to receive frames
        placeholder.classList.add('hidden');
        canvasElement.classList.remove('hidden');
        statusElement.textContent = 'Live';
        statusElement.className = 'px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800';
        
        const connectionStatus = document.getElementById(`connection-status-${camera.id}`);
        if (connectionStatus) connectionStatus.textContent = 'Live Stream';
        
        // Start FPS counter
        this.startFpsCounter(camera.id);
    },
    
    // Request a video frame for a specific camera
    requestVideoFrame(cameraId) {
        if (websocket.connection && websocket.connection.readyState === WebSocket.OPEN) {
            websocket.send({
                type: 'request_frame',
                cameraId: cameraId
            });
        }
    },
    
    // Update video frame on canvas
    updateVideoFrame(cameraId, frameData) {
        const ctx = app.canvasContexts.get(cameraId);
        const canvasElement = document.getElementById(`video-stream-${cameraId}`);
        const placeholder = document.getElementById(`video-placeholder-${cameraId}`);
        const statusElement = document.getElementById(`status-${cameraId}`);
        
        if (!ctx || !canvasElement) return;
        
        // First time receiving a frame for this camera
        if (placeholder && placeholder.classList.contains('hidden') === false) {
            placeholder.classList.add('hidden');
            canvasElement.classList.remove('hidden');
            
            if (statusElement) {
                statusElement.textContent = 'Live';
                statusElement.className = 'px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800';
            }
            
            const connectionStatus = document.getElementById(`connection-status-${cameraId}`);
            if (connectionStatus) connectionStatus.textContent = 'Live Stream';
            
            // Start FPS counter
            this.startFpsCounter(cameraId);
        }
        
        // Convert ArrayBuffer to blob
        const blob = new Blob([frameData], {type: 'image/jpeg'});
        
        // Create an image from the blob and draw it on the canvas when loaded
        const img = new Image();
        img.onload = () => {
            // Set canvas dimensions if needed
            if (canvasElement.width !== img.width || canvasElement.height !== img.height) {
                canvasElement.width = img.width;
                canvasElement.height = img.height;
            }
            
            ctx.drawImage(img, 0, 0);
            
            // Store frame timestamp for FPS calculation
            if (!app.videoFrames.has(cameraId)) {
                app.videoFrames.set(cameraId, []);
            }
            app.videoFrames.get(cameraId).push(Date.now());
            
            // We no longer draw detection boxes directly on stream for smoother experience
            
            // Request next frame
            this.requestVideoFrame(cameraId);
        };
        
        img.src = URL.createObjectURL(blob);
    },
    
    // FPS counter for each camera
    startFpsCounter(cameraId) {
        if (!app.videoFrames.has(cameraId)) {
            app.videoFrames.set(cameraId, []);
        }
        
        // Update FPS every second
        setInterval(() => {
            const fpsElement = document.getElementById(`fps-counter-${cameraId}`);
            if (!fpsElement) return;
            
            const frames = app.videoFrames.get(cameraId);
            if (!frames || frames.length === 0) {
                fpsElement.textContent = '0 fps';
                return;
            }
            
            // Calculate FPS based on frames received in last second
            const now = Date.now();
            const recentFrames = frames.filter(timestamp => now - timestamp < 1000);
            
            // Update the FPS counter
            fpsElement.textContent = `${recentFrames.length} fps`;
            
            // Clean up old frame timestamps
            app.videoFrames.set(cameraId, recentFrames);
        }, 1000);
    },

    updateDetectionDisplay(data) {
        const detectionCount = document.getElementById(`detection-count-${data.cameraId}`);
        if (detectionCount) {
            detectionCount.textContent = data.detections ? data.detections.length : 0;
        }

        // We store detection data but don't draw boxes directly on the video stream
        // for a smoother streaming experience
    },

    drawDetectionBoxes(cameraId, detections) {
        const canvas = document.getElementById(`video-stream-${cameraId}`);
        const ctx = app.canvasContexts.get(cameraId);
        
        if (!canvas || !ctx) return;
        
        // Get canvas dimensions for proper scaling
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear previous detection overlay by redrawing the frame
        // (The next frame will already have been drawn by updateVideoFrame)
        
        // Draw new detection boxes
        detections.forEach(detection => {
            // Convert normalized coordinates to pixels
            const x1 = detection.bbox[0] * width;
            const y1 = detection.bbox[1] * height;
            const x2 = detection.bbox[2] * width;
            const y2 = detection.bbox[3] * height;
            const boxWidth = x2 - x1;
            const boxHeight = y2 - y1;
            
            // Draw bounding box
            ctx.strokeStyle = detection.class_name === 'accident' ? '#FF0000' : '#00FF00';
            ctx.lineWidth = 2;
            ctx.strokeRect(x1, y1, boxWidth, boxHeight);
            
            // Draw label background
            const label = `${detection.class_name} (${(detection.confidence * 100).toFixed(0)}%)`;
            ctx.font = '12px Arial';
            const textWidth = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(x1, y1 - 18, textWidth + 6, 18);
            
            // Draw label text
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(label, x1 + 3, y1 - 5);
        });
    },

    updateSessionDisplay(sessionData) {
        console.log('Session status update:', sessionData);
        // Implement session status display updates
    },

    updateTrafficStatus(trafficData) {
        console.log('Traffic status update:', trafficData);
        // Implement traffic status display updates
    },

    showConnectionError() {
        const status = document.getElementById('camera-status');
        if (status) {
            status.textContent = 'Connection failed - please refresh page';
            status.className = 'text-red-600 text-sm mr-3';
        }
    }
};

// Event handlers
const eventHandlers = {
    init() {
        // Camera section toggle
        const showCamerasBtn = document.getElementById('show-cameras-btn');
        const camerasSection = document.getElementById('cameras-section');
        const closeCamerasBtn = document.getElementById('close-cameras');

        if (showCamerasBtn && camerasSection) {
            showCamerasBtn.addEventListener('click', () => {
                camerasSection.classList.toggle('hidden');
            });
        }

        if (closeCamerasBtn && camerasSection) {
            closeCamerasBtn.addEventListener('click', () => {
                camerasSection.classList.add('hidden');
            });
        }

        // Sidebar toggle for mobile
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const sidebar = document.getElementById('sidebar');

        if (sidebarToggle && sidebar) {
            sidebarToggle.addEventListener('click', () => {
                sidebar.classList.toggle('hidden');
            });
        }

        // Camera toggle button
        const cameraToggle = document.getElementById('camera-toggle');
        if (cameraToggle) {
            cameraToggle.addEventListener('click', () => {
                if (camerasSection) {
                    camerasSection.classList.toggle('hidden');
                }
            });
        }
    }
};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    console.log('Smart Road System - Initializing...');
    
    // Initialize event handlers
    eventHandlers.init();
    
    // Connect WebSocket
    websocket.connect();
    
    console.log('Smart Road System - Initialized');
});

// Initialize global variables
let map,
    markers = new Map(),
    intersections = [],
    routeLines = {},
    activeRoutes = { visible: false },
    path;

// Document ready event
document.addEventListener("DOMContentLoaded", () => {
  // Initialize map first
  initializeMap();

  // API status elements
  const apiStatusBanner = document.getElementById("api-status-banner");
  const apiStatusDot = document.getElementById("api-status-dot");
  const apiStatusText = document.getElementById("api-status-text");
  const apiStatusIndicator = document.getElementById("api-status-indicator");
  const apiStatusModal = document.getElementById("api-status-modal");
  const apiModalClose = document.getElementById("api-modal-close");
  const apiModalMessage = document.getElementById("api-modal-message");

  // Show API status banner initially
  apiStatusBanner.classList.remove("hidden");

  // Close modal button
  apiModalClose.addEventListener("click", () => {
    apiStatusModal.classList.add("hidden");
  });

  // Setup event listeners for UI elements
  setupUIEventListeners();
  
  // Function to check API status
  function checkApiStatus() {
    const apiUrl = "/health"; 

    fetch(apiUrl)
      .then((response) => response.json())
      .then((data) => {
        if (data.status === "healthy" && data.model_loaded) {
          // API is ready
          apiStatusBanner.classList.add("hidden");
          apiStatusDot.classList.remove("bg-yellow-400", "bg-red-500");
          apiStatusDot.classList.add("bg-green-500");
          apiStatusDot.classList.remove("pulse");
          apiStatusText.textContent = "API Ready";
          apiStatusText.classList.remove("text-yellow-700", "text-red-700");
          apiStatusText.classList.add("text-green-700");
          apiStatusIndicator.classList.remove("bg-yellow-50", "bg-red-50");
          apiStatusIndicator.classList.add("bg-green-50");
        }
      })
      .catch(() => {
        // API is not available
        apiStatusBanner.classList.remove("hidden");
        apiStatusDot.classList.remove("bg-yellow-400", "bg-green-500");
        apiStatusDot.classList.add("bg-red-500", "pulse");
        apiStatusText.textContent = "API Offline";
        apiStatusText.classList.remove("text-yellow-700", "text-green-700");
        apiStatusText.classList.add("text-red-700");
        apiStatusIndicator.classList.remove("bg-yellow-50", "bg-green-50");
        apiStatusIndicator.classList.add("bg-red-50");

        // Show modal after a delay if API is still offline
        setTimeout(() => {
          if (apiStatusText.textContent === "API Offline") {
            apiStatusModal.classList.remove("hidden");
            apiModalMessage.innerHTML = `
              <strong class="text-red-600">The traffic detection service is currently offline.</strong><br><br>
              Traffic analysis and vehicle detection require the AI service to be running.<br><br>
              Please check that the Python AI service has started properly.
            `;
          }
        }, 5000);
      });
  }

  // Check status initially after a delay
  setTimeout(checkApiStatus, 2000);

  // Check periodically
  setInterval(checkApiStatus, 10000);

  // Update time display
  setInterval(() => {
    document.getElementById("current-time").textContent = new Date().toLocaleTimeString(
      [], 
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }
    );
  }, 1000);
});

function setupUIEventListeners() {
  // Close buttons setup
  document.getElementById("close-cameras")?.addEventListener("click", () => {
    document.getElementById("cameras-section").classList.add("hidden");
  });

  document.getElementById("close-detail")?.addEventListener("click", () => {
    document.getElementById("intersection-detail").classList.add("hidden");
  });

  // Camera toggle button
  document.getElementById("camera-toggle")?.addEventListener("click", function() {
    // Toggle camera logic would go here
    alert("Camera connection feature would activate here");
  });

  // Sidebar toggle for mobile
  document.getElementById("sidebar-toggle")?.addEventListener("click", function() {
    const sidebar = document.getElementById("sidebar");
    sidebar.classList.toggle("hidden");
  });
}

function initializeMap() {
  // Default location (Nairobi, Kenya)
  const defaultLocation = [-1.2921, 36.8219];
  
  // Create Leaflet map
  map = L.map("map", {
    zoomControl: false,
    attributionControl: false
  }).setView(defaultLocation, 15);

  // Add tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);
  
  // Initialize path
  path = L.polyline([], { color: 'red', weight: 4 }).addTo(map);

  // Add map style customization
  const mapStyleElement = document.createElement('style');
  mapStyleElement.textContent = `
.leaflet-container {
  background-color: #e8eef1;       /* soft blue-gray */
  border: 2px solid #b0c4d1;       /* muted border */
  border-radius: 12px;             /* rounded corners */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); /* subtle shadow */
  padding: 8px;                    /* internal spacing */
  outline: none;                   /* remove focus outline */
}

    .leaflet-tile-pane {
      filter: saturate(1.1) contrast(1.05);
    }
    .route-path-animation {
      stroke-dasharray: 8, 12;
      animation: dash 30s linear infinite;
    }
    @keyframes dash {
      to {
        stroke-dashoffset: -1000;
      }
    }
  `;
  document.head.appendChild(mapStyleElement);

  // Add zoom control to top-right
  L.control.zoom({
    position: "topright"
  }).addTo(map);

  // Add attribution to bottom-right
  L.control.attribution({
    position: "bottomright",
    prefix: false
  }).addTo(map);

  // Update coordinates display
  map.on("mousemove", (e) => {
    document.getElementById("map-coordinates").innerText = 
      `LAT: ${e.latlng.lat.toFixed(6)} LNG: ${e.latlng.lng.toFixed(6)}`;
  });

  // Setup map-related event listeners
  setupMapEventListeners();

  // Add sample intersections
  addSampleIntersections();

  // Add route lines
  addRouteLines();

  // Fix map display
  fixMapDisplay();
}

function setupMapEventListeners() {
  document.getElementById("map-fullscreen-btn").addEventListener("click", toggleFullscreen);
  document.getElementById("show-cameras-btn").addEventListener("click", toggleCamerasSection);
  document.getElementById("show-routes-btn").addEventListener("click", toggleRouteLines);
  document.getElementById("toggle-route-planner-btn").addEventListener("click", toggleRoutePlanner);
  document.getElementById("close-route-planner").addEventListener("click", () => {
    document.getElementById("route-planner-panel").classList.add("hidden");
  });
  document.getElementById("calculate-route-btn").addEventListener("click", calculateAndDisplayRoute);
  document.getElementById("pick-start-point").addEventListener("click", () => enableMapPointSelection("start"));
  document.getElementById("pick-end-point").addEventListener("click", () => enableMapPointSelection("end"));
}

// Route planning functionality
let routeMarkers = { start: null, end: null };
let currentRoutePolyline = null;
let mapSelectionMode = null; // 'start', 'end', or null

function toggleRoutePlanner() {
  const routePlannerPanel = document.getElementById("route-planner-panel");
  routePlannerPanel.classList.toggle("hidden");

  // Populate location dropdowns with intersection names
  if (!routePlannerPanel.classList.contains("hidden")) {
    populateLocationDropdowns();
  }
}

function populateLocationDropdowns() {
  const startSelect = document.getElementById("start-point");
  const endSelect = document.getElementById("end-point");

  // Clear existing options (except the first one)
  while (startSelect.options.length > 1) startSelect.options.remove(1);
  while (endSelect.options.length > 1) endSelect.options.remove(1);

  // Add intersection options
  intersections.forEach((intersection) => {
    const startOption = document.createElement("option");
    startOption.value = `${intersection.lat},${intersection.lng}`;
    startOption.textContent = intersection.name;
    startSelect.appendChild(startOption);

    const endOption = document.createElement("option");
    endOption.value = `${intersection.lat},${intersection.lng}`;
    endOption.textContent = intersection.name;
    endSelect.appendChild(endOption);
  });

  // Set up change event listeners for dropdown selections
  startSelect.addEventListener("change", function () {
    if (this.value) {
      const [lat, lng] = this.value.split(",").map(parseFloat);
      setRoutePoint("start", [lat, lng], intersection.name);
    }
  });

  endSelect.addEventListener("change", function () {
    if (this.value) {
      const [lat, lng] = this.value.split(",").map(parseFloat);
      setRoutePoint("end", [lat, lng], intersection.name);
    }
  });
}

function enableMapPointSelection(pointType) {
  // Update selection mode
  mapSelectionMode = pointType;

  // Update cursor and show helper message
  map.getContainer().style.cursor = "crosshair";

  // Show a notification to the user
  const apiStatusBanner = document.getElementById("api-status-banner");
  apiStatusBanner.classList.remove("hidden", "bg-yellow-500");
  apiStatusBanner.classList.add("bg-blue-500");
  apiStatusBanner.innerHTML = `<div class="container mx-auto px-4 flex items-center justify-center gap-2">
    <span class="material-icons text-sm">place</span>
    <span>Click on the map to select ${pointType === "start" ? "starting point" : "destination"}</span>
    <button id="cancel-selection" class="ml-4 bg-white bg-opacity-20 px-2 py-1 rounded text-xs">Cancel</button>
  </div>`;

  document.getElementById("cancel-selection").addEventListener("click", cancelMapPointSelection);

  // Add one-time click handler to the map
  map.once("click", function (e) {
    setRoutePoint(pointType, [e.latlng.lat, e.latlng.lng]);
    cancelMapPointSelection();
  });
}

function cancelMapPointSelection() {
  mapSelectionMode = null;
  map.getContainer().style.cursor = "";
  const apiStatusBanner = document.getElementById("api-status-banner");
  apiStatusBanner.classList.add("hidden");
}

function setRoutePoint(pointType, coordinates, name = null) {
  // Remove existing marker if any
  if (routeMarkers[pointType]) {
    map.removeLayer(routeMarkers[pointType]);
  }

  // Create marker icon based on point type
  const markerIcon = L.divIcon({
    className: `shadow-lg rounded-full bg-${pointType === "start" ? "green" : "red"}-600 flex items-center justify-center border-2 border-white`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<span class="material-icons" style="font-size: 16px; color: white;">
      ${pointType === "start" ? "trip_origin" : "place"}
    </span>`
  });

  // Create and add new marker
  routeMarkers[pointType] = L.marker(coordinates, {
    icon: markerIcon,
    draggable: true
  }).addTo(map);

  // Set popup content
  const popupContent = `<div class="font-medium p-1">
    <div class="text-${pointType === "start" ? "green" : "red"}-600 font-bold">
      ${pointType === "start" ? "Starting Point" : "Destination"}
    </div>
    ${name ? "<div class='text-gray-600 text-sm'>" + name + "</div>" : ""}
  </div>`;
  
  routeMarkers[pointType].bindPopup(popupContent);

  // Update dropdown selection if using a custom point
  if (!name) {
    document.getElementById(`${pointType}-point`).selectedIndex = 0;
  }

  // Event handler for when marker is dragged
  routeMarkers[pointType].on("dragend", function () {
    if (routeMarkers.start && routeMarkers.end) {
      calculateAndDisplayRoute();
    }
  });
  
  // If both markers are set, calculate route
  if (routeMarkers.start && routeMarkers.end) {
    calculateAndDisplayRoute();
  }
}

function calculateAndDisplayRoute() {
  // Check if both start and end points are set
  if (!routeMarkers.start || !routeMarkers.end) {
    alert("Please select both starting point and destination");
    return;
  }

  // Remove existing route if any
  if (currentRoutePolyline) {
    map.removeLayer(currentRoutePolyline);
  }

  // Get coordinates
  const startPoint = routeMarkers.start.getLatLng();
  const endPoint = routeMarkers.end.getLatLng();
  
  // Show loading indicator
  const apiStatusBanner = document.getElementById("api-status-banner");
  apiStatusBanner.classList.remove("hidden");
  apiStatusBanner.classList.add("bg-blue-500");
  apiStatusBanner.innerHTML = `<div class="container mx-auto px-4 flex items-center justify-center gap-2">
    <span class="material-icons text-sm animate-spin">sync</span>
    <span>Calculating best route...</span>
  </div>`;
  
  // Use OSRM API to get actual road routes
  const osrmAPI = `https://router.project-osrm.org/route/v1/driving/${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}?overview=full&geometries=geojson`;
  
  fetch(osrmAPI)
    .then(response => response.json())
    .then(data => {
      apiStatusBanner.classList.add("hidden");
      
      if (data.code === 'Ok' && data.routes.length > 0) {
        // Get the coordinates from the route
        const routeCoordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        
        // Create route polyline with animation effect
        currentRoutePolyline = L.polyline(routeCoordinates, {
          color: '#3b82f6',
          weight: 5,
          opacity: 0.8,
          lineCap: 'round',
          lineJoin: 'round',
          className: 'route-path-animation'
        }).addTo(map);
        
        // Add route info
        const duration = Math.round(data.routes[0].duration / 60); // minutes
        const distance = (data.routes[0].distance / 1000).toFixed(1); // km
        
        currentRoutePolyline.bindTooltip(`
          <div class="font-medium text-sm">
            <div class="flex items-center"><span class="material-icons text-sm mr-1">schedule</span> ${duration} min</div>
            <div class="flex items-center"><span class="material-icons text-sm mr-1">straighten</span> ${distance} km</div>
          </div>
        `, {sticky: true});
        
        // Fit map bounds to show the entire route
        map.fitBounds(currentRoutePolyline.getBounds(), {
          padding: [50, 50]
        });
      } else {
        alert('Unable to calculate route. Please try different points.');
      }
    })
    .catch(error => {
      apiStatusBanner.classList.add("hidden");
      alert('Error calculating route: ' + error.message);
    });
}

function addSampleIntersections() {
  intersections = [
    {
      id: "int1",
      name: "Main St & Central Ave",
      lat: 0.513,
      lng: 35.27,
      status: "green",
      cameras: ["cam1"]
    },
    {
      id: "int2",
      name: "Highway 101 & Oak St",
      lat: 0.514,
      lng: 35.272,
      status: "yellow",
      cameras: ["cam2"]
    },
    {
      id: "int3",
      name: "Industrial Rd & Pine Ave",
      lat: 0.5125,
      lng: 35.275,
      status: "red",
      cameras: ["cam3"]
    }
  ];

  intersections.forEach((intersection) => {
    addIntersectionMarker(intersection);
  });

  // Update counts
  document.getElementById("intersections-count").textContent = intersections.length;
  document.getElementById("cameras-count").textContent = intersections.length;

  const congestedCount = intersections.filter((i) => i.status === "red").length;
  document.getElementById("congested-count").textContent = congestedCount;
}

function addIntersectionMarker(intersection) {
  const icon = createIntersectionIcon(intersection.status);

  const marker = L.marker([intersection.lat, intersection.lng], {
    icon,
    title: intersection.name
  }).addTo(map);

  marker.bindPopup(createIntersectionPopup(intersection));
  markers.set(intersection.id, marker);
}

function createIntersectionIcon(status) {
  const statusClass =
    status === "red"
      ? "bg-red-600"
      : status === "yellow"
      ? "bg-yellow-500"
      : "bg-green-600";

  return L.divIcon({
    className: `rounded-full ${statusClass} flex items-center justify-center`,
    iconSize: [24, 24],
    html: '<span class="material-icons" style="font-size: 14px; color: white;">traffic</span>'
  });
}

function createIntersectionPopup(intersection) {
  const statusColor =
    intersection.status === "red"
      ? "text-red-600"
      : intersection.status === "yellow"
      ? "text-yellow-600"
      : "text-green-600";

  return `
    <div class="popup-content">
      <div class="font-semibold text-gray-800">${intersection.name}</div>
      <div class="mt-2 text-sm">
        <div class="flex items-center mb-1">
          <span class="material-icons mr-1 ${statusColor}" style="font-size: 16px;">circle</span>
          <span class="font-medium ${statusColor}">Traffic: ${intersection.status.toUpperCase()}</span>
        </div>
        <div class="flex items-center">
          <span class="material-icons mr-1 text-gray-600" style="font-size: 14px;">videocam</span>
          <span class="text-gray-600">Camera: ${intersection.cameras ? intersection.cameras[0] : "None"}</span>
        </div>
      </div>
      <button class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 mt-3 text-xs rounded-full" 
              onclick="showIntersectionDetails('${intersection.id}')">View Analysis</button>
    </div>
  `;
}

function addRouteLines() {
  // Main Highway Route (red)
  const route1Coords = [
    [0.5142, 35.2697],
    [0.5138, 35.271],
    [0.5132, 35.2725],
    [0.5126, 35.274],
    [0.5123, 35.2755]
  ];

  // Alternate Bypass Route (green)
  const route2Coords = [
    [0.5142, 35.2697],
    [0.515, 35.271],
    [0.5155, 35.2725],
    [0.5145, 35.274],
    [0.5123, 35.2755]
  ];

  const route1Line = L.polyline(route1Coords, {
    color: "#dc2626",
    weight: 4,
    opacity: 0.8,
    lineCap: "round",
    lineJoin: "round"
  });

  const route2Line = L.polyline(route2Coords, {
    color: "#16a34a",
    weight: 4,
    opacity: 0.8,
    lineCap: "round",
    lineJoin: "round",
    dashArray: "10, 10"
  });

  routeLines = {
    "route-1": route1Line,
    "route-2": route2Line
  };
}

function toggleRouteLines() {
  const routeVisible = !activeRoutes.visible;
  activeRoutes.visible = routeVisible;

  Object.values(routeLines).forEach((line) => {
    if (routeVisible) {
      if (!map.hasLayer(line)) {
        map.addLayer(line);
      }
    } else {
      if (map.hasLayer(line)) {
        map.removeLayer(line);
      }
    }
  });

  const btn = document.getElementById("show-routes-btn");
  if (btn) {
    btn.innerHTML = routeVisible
      ? '<span class="material-icons text-sm mr-1">visibility_off</span> Hide Routes'
      : '<span class="material-icons text-sm mr-1">alt_route</span> Routes';
  }
}

function toggleFullscreen() {
  const mapElement = document.getElementById("map");
  const isFullscreen = mapElement.classList.contains("fixed");

  if (!isFullscreen) {
    mapElement.classList.add(
      "fixed",
      "top-0",
      "left-0",
      "w-full",
      "h-full",
      "z-50"
    );
    document
      .getElementById("map-fullscreen-btn")
      .querySelector("span").textContent = "fullscreen_exit";
  } else {
    mapElement.classList.remove(
      "fixed",
      "top-0",
      "left-0",
      "w-full",
      "h-full",
      "z-50"
    );
    document
      .getElementById("map-fullscreen-btn")
      .querySelector("span").textContent = "fullscreen";
  }

  setTimeout(() => {
    map.invalidateSize();
  }, 100);
}

function toggleCamerasSection() {
  const camerasSection = document.getElementById("cameras-section");
  const isHidden = camerasSection.classList.contains("hidden");

  if (isHidden) {
    camerasSection.classList.remove("hidden");
  } else {
    camerasSection.classList.add("hidden");
  }
}

function showIntersectionDetails(intersectionId) {
  const intersection = intersections.find((i) => i.id === intersectionId);
  if (intersection) {
    const detailSection = document.getElementById("intersection-detail");
    document.getElementById("detail-title").innerHTML = `
      <span class="material-icons text-primary mr-1">traffic</span>
      <span>${intersection.name}</span>
    `;
    document.getElementById("detail-density").textContent = intersection.status.toUpperCase();
    document.getElementById("detail-vehicles").textContent = Math.floor(Math.random() * 20) + 5;

    detailSection.classList.remove("hidden");
  }
}

function fixMapDisplay() {
  window.addEventListener("resize", () => {
    map.invalidateSize();
  });

  setTimeout(() => {
    map.invalidateSize();
  }, 500);
}

// Make the showIntersectionDetails function globally available for the onClick in the popup
window.showIntersectionDetails = showIntersectionDetails;
