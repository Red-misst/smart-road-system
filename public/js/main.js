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
    currentSession: null
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
                    <img id="video-stream-${camera.id}" 
                         class="w-full h-full object-cover hidden" 
                         alt="Camera ${camera.id}">
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
    },

    updateCameraCard(camera) {
        const statusElement = document.getElementById(`connection-status-${camera.id}`);
        if (statusElement) {
            statusElement.textContent = camera.connected ? 'Connected' : 'Disconnected';
        }
    },

    setupDirectVideoStream(camera) {
        if (!camera.stream_url && !camera.ip_address) return;

        const videoElement = document.getElementById(`video-stream-${camera.id}`);
        const placeholder = document.getElementById(`video-placeholder-${camera.id}`);
        const statusElement = document.getElementById(`status-${camera.id}`);

        if (!videoElement || !placeholder || !statusElement) return;

        // Use the stream URL or construct it from IP address
        const streamUrl = camera.stream_url || `http://${camera.ip_address}:81/stream`;
        
        console.log(`Setting up video stream for camera ${camera.id}: ${streamUrl}`);

        // Set up the video stream
        videoElement.src = streamUrl;
        videoElement.onload = () => {
            placeholder.classList.add('hidden');
            videoElement.classList.remove('hidden');
            statusElement.textContent = 'Live';
            statusElement.className = 'px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800';
            
            const connectionStatus = document.getElementById(`connection-status-${camera.id}`);
            if (connectionStatus) connectionStatus.textContent = 'Live Stream';
        };

        videoElement.onerror = () => {
            placeholder.classList.remove('hidden');
            videoElement.classList.add('hidden');
            statusElement.textContent = 'Error';
            statusElement.className = 'px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800';
            
            const connectionStatus = document.getElementById(`connection-status-${camera.id}`);
            if (connectionStatus) connectionStatus.textContent = 'Stream Error';
            
            console.error(`Failed to load video stream for camera ${camera.id}`);
        };
    },

    removeCameraFromGrid(cameraId) {
        const cameraCard = document.getElementById(`camera-card-${cameraId}`);
        if (cameraCard) {
            cameraCard.remove();
        }
    },

    updateDetectionDisplay(data) {
        const detectionCount = document.getElementById(`detection-count-${data.cameraId}`);
        if (detectionCount) {
            detectionCount.textContent = data.detections ? data.detections.length : 0;
        }

        // Update detection overlay
        this.drawDetectionBoxes(data.cameraId, data.detections || []);
    },

    drawDetectionBoxes(cameraId, detections) {
        const overlay = document.getElementById(`detection-overlay-${cameraId}`);
        if (!overlay) return;

        // Clear existing boxes
        overlay.innerHTML = '';

        // Draw new detection boxes
        detections.forEach((detection, index) => {
            const box = document.createElement('div');
            box.className = 'absolute border-2 border-red-500 bg-red-500 bg-opacity-20';
            
            // Convert normalized coordinates to pixels
            const containerRect = overlay.getBoundingClientRect();
            const x1 = (detection.bbox[0] / 640) * containerRect.width;
            const y1 = (detection.bbox[1] / 640) * containerRect.height;
            const x2 = (detection.bbox[2] / 640) * containerRect.width;
            const y2 = (detection.bbox[3] / 640) * containerRect.height;
            
            box.style.left = `${x1}px`;
            box.style.top = `${y1}px`;
            box.style.width = `${x2 - x1}px`;
            box.style.height = `${y2 - y1}px`;
            
            // Add label
            const label = document.createElement('div');
            label.className = 'absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 rounded';
            label.textContent = `${detection.class_name} (${(detection.confidence * 100).toFixed(1)}%)`;
            box.appendChild(label);
            
            overlay.appendChild(box);
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

// Export for use in other modules
window.smartRoadApp = {
    app,
    websocket,
    ui,
    eventHandlers
};
