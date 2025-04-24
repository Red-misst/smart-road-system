/**
 * Smart Road System - UI Module
 * Manages all user interface elements and updates
 */

import app from './app-config.js';
import { camera } from './camera.js';
import { detection } from './detection.js';
import { traffic } from './traffic.js';

// UI management
export const ui = {
    /**
     * Initialize the UI
     */
    init() {
        this.setupEventListeners();
        this.updateCamerasSection();
        this.updateConnectionStatus('disconnected');
        this.setupClockUpdate();
    },
    
    /**
     * Setup UI-related event listeners
     */
    setupEventListeners() {
        // Connect/disconnect button
        document.getElementById('camera-toggle').addEventListener('click', function() {
            if (app.wsConnected) {
                connection.disconnect();
            } else {
                connection.connect();
            }
        });
        
        // Close cameras section
        document.getElementById('close-cameras').addEventListener('click', () => {
            this.toggleCamerasSection(false);
        });
        
        // Close intersection details
        document.getElementById('close-detail').addEventListener('click', () => {
            this.hideIntersectionDetails();
        });
        
        // Handle popup buttons inside map
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('view-details') || 
                e.target.parentElement.classList.contains('view-details')) {
                    
                const button = e.target.classList.contains('view-details') ? 
                    e.target : e.target.parentElement;
                    
                const id = button.getAttribute('data-id');
                const intersection = app.intersections.find(i => i.id === id);
                
                if (intersection) {
                    app.selectedIntersection = id;
                    ui.updateIntersectionDetails(intersection);
                }
            }
        });
    },
    
    /**
     * Setup clock update
     */
    setupClockUpdate() {
        // Update the clock every second
        setInterval(() => {
            const now = new Date();
            document.getElementById('current-time').innerText = now.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });
        }, 1000);
        
        // Initialize with current time
        document.getElementById('current-time').innerText = new Date().toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
    },
    
    /**
     * Update the WebSocket connection status in UI
     */
    updateConnectionStatus(status) {
        const statusElement = document.getElementById('system-status');
        const cameraToggle = document.getElementById('camera-toggle');
        const indicator = document.querySelector('.traffic-indicator');
        
        switch (status) {
            case 'connected':
                statusElement.textContent = 'System Online';
                statusElement.className = 'text-sm text-accent-green';
                indicator.className = 'traffic-indicator pulse bg-accent-green mr-2';
                cameraToggle.querySelector('span:not(.material-icons)').textContent = 'Disconnect';
                break;
                
            case 'disconnected':
                statusElement.textContent = 'System Offline';
                statusElement.className = 'text-sm text-gray-400';
                indicator.className = 'traffic-indicator bg-gray-500 mr-2';
                cameraToggle.querySelector('span:not(.material-icons)').textContent = 'Connect Camera';
                break;
                
            case 'connecting':
                statusElement.textContent = 'Connecting...';
                statusElement.className = 'text-sm text-yellow-400';
                indicator.className = 'traffic-indicator pulse bg-yellow-400 mr-2';
                cameraToggle.querySelector('span:not(.material-icons)').textContent = 'Connecting...';
                break;
                
            case 'error':
                statusElement.textContent = 'Connection Error';
                statusElement.className = 'text-sm text-red-500';
                indicator.className = 'traffic-indicator bg-red-500 mr-2';
                cameraToggle.querySelector('span:not(.material-icons)').textContent = 'Retry Connection';
                break;
        }
    },
    
    /**
     * Update the cameras section
     */
    updateCamerasSection() {
        const camerasSection = document.getElementById('cameras-section');
        
        if (app.camerasVisible) {
            camerasSection.classList.remove('hidden');
        } else {
            camerasSection.classList.add('hidden');
        }
    },
    
    /**
     * Toggle cameras section visibility
     */
    toggleCamerasSection(show) {
        if (show === undefined) {
            app.camerasVisible = !app.camerasVisible;
        } else {
            app.camerasVisible = show;
        }
        
        this.updateCamerasSection();
    },
    
    /**
     * Update the camera grid with available cameras
     */
    updateCameraGrid() {
        const cameraFeeds = document.getElementById('camera-feeds');
        if (!cameraFeeds) return;
        
        // Clear existing content
        cameraFeeds.innerHTML = '';
        
        // Show message if no cameras
        if (app.cameras.size === 0) {
            cameraFeeds.innerHTML = `
                <div class="col-span-full flex items-center justify-center p-6 text-gray-500">
                    <span class="material-icons mr-2">videocam_off</span>
                    No cameras connected
                </div>
            `;
            return;
        }
        
        // Add camera cards
        app.cameras.forEach((camera, id) => {
            const card = document.createElement('div');
            card.className = 'camera-container bg-surface rounded overflow-hidden shadow-md cursor-pointer';
            card.id = `camera-${id}`;
            card.dataset.cameraId = id;
            
            // Handle click to select camera
            card.addEventListener('click', () => {
                this.selectCameraById(id);
            });
            
            // Camera feed image
            const img = document.createElement('img');
            img.className = 'camera-feed-image';
            img.alt = `Camera ${id} feed`;
            
            // Set image source if we have a frame
            if (app.latestFrames.has(id)) {
                img.src = app.latestFrames.get(id);
            }
            
            // Camera status indicator
            const statusBar = document.createElement('div');
            statusBar.className = 'flex justify-between items-center p-2 bg-gray-800';
            
            const label = document.createElement('div');
            label.className = 'text-xs font-medium';
            label.textContent = `Camera ${id}`;
            
            const status = document.createElement('div');
            status.className = `flex items-center text-xs ${camera.connected ? 'text-green-400' : 'text-red-400'}`;
            status.innerHTML = `
                <span class="traffic-indicator ${camera.connected ? 'bg-green-400' : 'bg-red-400'} mr-1"></span>
                <span>${camera.connected ? 'Online' : 'Offline'}</span>
            `;
            
            statusBar.appendChild(label);
            statusBar.appendChild(status);
            
            // Add to card
            card.appendChild(img);
            card.appendChild(statusBar);
            
            // Add to grid
            cameraFeeds.appendChild(card);
        });
        
        // Update camera status message
        document.getElementById('camera-status').textContent = 
            `${app.cameras.size} camera${app.cameras.size !== 1 ? 's' : ''} connected`;
    },
    
    /**
     * Update a specific camera's frame
     */
    updateCameraFrame(cameraId, imageUrl) {
        // Update in grid
        const cameraCard = document.getElementById(`camera-${cameraId}`);
        if (cameraCard) {
            const img = cameraCard.querySelector('img');
            if (img) {
                img.src = imageUrl;
            }
        }
        
        // Update in active view if this is the selected camera
        if (app.activeCameraId === cameraId) {
            this.updateActiveCamera(imageUrl);
        }
    },
    
    /**
     * Select a camera by ID
     */
    selectCameraById(cameraId) {
        // Update camera selection
        camera.selectCamera(cameraId);
        
        // Update UI
        this.updateActiveCameraInfo();
    },
    
    /**
     * Update the active camera information
     */
    updateActiveCameraInfo() {
        if (!app.activeCameraId) return;
        
        // Get camera info
        const cameraInfo = app.cameras.get(app.activeCameraId);
        if (!cameraInfo) return;
        
        // Find intersection that has this camera
        const intersection = app.intersections.find(i => 
            i.cameras && i.cameras.includes(app.activeCameraId)
        );
        
        // If found, update intersection details
        if (intersection) {
            app.selectedIntersection = intersection.id;
            this.updateIntersectionDetails(intersection);
        }
        
        // Update active camera display
        const imageUrl = app.latestFrames.get(app.activeCameraId);
        if (imageUrl) {
            this.updateActiveCamera(imageUrl);
        }
    },
    
    /**
     * Update the active camera display
     */
    updateActiveCamera(imageUrl) {
        const cameraFeed = document.getElementById('traffic-camera-feed');
        if (!cameraFeed) return;
        
        // Check if there's already an image element
        let img = cameraFeed.querySelector('img');
        
        if (!img) {
            // Create new image element
            cameraFeed.innerHTML = '';
            img = document.createElement('img');
            img.className = 'w-full h-full object-cover';
            img.alt = 'Camera Feed';
            cameraFeed.appendChild(img);
        }
        
        // Update image source
        img.src = imageUrl;
        
        // Render detection boxes if available
        const cameraId = app.activeCameraId;
        if (cameraId && app.showDetections && detection.results.has(cameraId)) {
            detection.renderDetectionBoxes(cameraId);
        }
    },
    
    /**
     * Update intersection details panel
     */
    updateIntersectionDetails(intersection) {
        if (!intersection) return;
        
        // Show the detail panel
        const detailPanel = document.getElementById('intersection-detail');
        detailPanel.classList.remove('hidden');
        
        // Update intersection title
        document.getElementById('detail-title').textContent = intersection.name;
        
        // Get traffic status
        const status = app.trafficStatus.get(intersection.id) || intersection.status || 'unknown';
        
        // Get traffic conditions for this route
        const trafficConditions = traffic.trafficConditions[intersection.id] || {
            congestion: 'low',
            accidents: false,
            speed: 'normal'
        };
        
        // Update traffic density display
        const densityElem = document.getElementById('detail-density');
        let displayStatus = 'Unknown';
        let statusColor = 'text-gray-400';
        
        switch (status) {
            case 'green':
            case 'low':
                displayStatus = 'Low';
                statusColor = 'text-green-500';
                break;
            case 'yellow':
            case 'moderate':
                displayStatus = 'Moderate';
                statusColor = 'text-yellow-400';
                break;
            case 'red':
            case 'high':
                displayStatus = 'High';
                statusColor = 'text-red-400';
                break;
        }
        
        densityElem.textContent = displayStatus;
        densityElem.className = `text-xl font-light ${statusColor}`;
        
        // Update vehicle count (if available from detection)
        let vehicleCount = 0;
        
        // If intersection has cameras, check for detection results
        if (intersection.cameras && intersection.cameras.length > 0) {
            for (const camId of intersection.cameras) {
                if (detection.results.has(camId)) {
                    const results = detection.results.get(camId);
                    
                    // Count vehicles in detection results
                    if (results.detections) {
                        vehicleCount = results.detections.filter(d => 
                            ['car', 'truck', 'bus', 'motorcycle'].includes(d.class_name.toLowerCase())
                        ).length;
                    }
                }
            }
        }
        
        document.getElementById('detail-vehicles').textContent = vehicleCount;
        
        // Update camera feed for this intersection
        if (intersection.cameras && intersection.cameras.length > 0) {
            // Use the first camera for this intersection
            const cameraId = intersection.cameras[0];
            
            // Select this camera as active
            camera.selectCamera(cameraId);
        } else {
            // No camera available
            document.getElementById('traffic-camera-feed').innerHTML = `
                <div class="flex flex-col items-center justify-center h-full">
                    <span class="material-icons text-4xl text-gray-600">videocam_off</span>
                    <span class="text-sm text-gray-500 mt-2">No camera available</span>
                </div>
            `;
        }
        
        // Update traffic condition indicators
        this.updateTrafficConditionIndicators(intersection.id, trafficConditions);
        
        // Update alternative routes
        this.updateAlternativeRoutes(intersection, status);
    },
    
    /**
     * Update traffic condition indicators
     */
    updateTrafficConditionIndicators(routeId, conditions) {
        // Create traffic condition indicators if they don't exist
        const container = document.querySelector('.grid.grid-cols-2.gap-3.mb-3');
        if (!container) return;
        
        // Add a third row for additional traffic parameters
        if (!document.getElementById('traffic-conditions-row')) {
            const trafficConditionsRow = document.createElement('div');
            trafficConditionsRow.id = 'traffic-conditions-row';
            trafficConditionsRow.className = 'bg-surface p-3 rounded-md shadow-md col-span-2';
            
            trafficConditionsRow.innerHTML = `
                <h4 class="text-gray-400 text-xs mb-2">Traffic Conditions</h4>
                <div class="grid grid-cols-3 gap-2">
                    <div>
                        <div class="flex items-center">
                            <span class="material-icons text-sm mr-1 text-yellow-500">speed</span>
                            <span class="text-xs text-gray-300">Speed</span>
                        </div>
                        <p id="traffic-speed" class="text-sm font-medium">Normal</p>
                    </div>
                    <div>
                        <div class="flex items-center">
                            <span class="material-icons text-sm mr-1 text-red-500">warning</span>
                            <span class="text-xs text-gray-300">Accidents</span>
                        </div>
                        <p id="traffic-accidents" class="text-sm font-medium">None</p>
                    </div>
                    <div>
                        <div class="flex items-center">
                            <span class="material-icons text-sm mr-1 text-blue-500">route</span>
                            <span class="text-xs text-gray-300">Route ID</span>
                        </div>
                        <p id="route-camera" class="text-sm font-medium">${routeId}</p>
                    </div>
                </div>
            `;
            
            // Insert after the first row
            container.parentNode.insertBefore(trafficConditionsRow, container.nextSibling);
        }
        
        // Update condition values
        const speedElement = document.getElementById('traffic-speed');
        const accidentsElement = document.getElementById('traffic-accidents');
        const routeElement = document.getElementById('route-camera');
        
        if (speedElement && accidentsElement && routeElement) {
            // Update speed
            let speedText, speedClass;
            switch (conditions.speed) {
                case 'slow':
                    speedText = 'Slow';
                    speedClass = 'text-red-400';
                    break;
                case 'moderate':
                    speedText = 'Moderate';
                    speedClass = 'text-yellow-400';
                    break;
                default:
                    speedText = 'Normal';
                    speedClass = 'text-green-400';
            }
            speedElement.textContent = speedText;
            speedElement.className = `text-sm font-medium ${speedClass}`;
            
            // Update accidents
            if (conditions.accidents) {
                accidentsElement.textContent = 'Detected';
                accidentsElement.className = 'text-sm font-medium text-red-500';
            } else {
                accidentsElement.textContent = 'None';
                accidentsElement.className = 'text-sm font-medium text-gray-300';
            }
            
            // Update route info
            routeElement.textContent = routeId;
            
            // Find which camera is on this route
            const route = app.intersections.find(r => r.id === routeId);
            if (route && route.cameras && route.cameras.length > 0) {
                const cameraId = route.cameras[0];
                routeElement.textContent = `${routeId} (Camera ${cameraId})`;
            }
        }
    },
    
    /**
     * Update alternative routes display
     */
    updateAlternativeRoutes(intersection, status) {
        const routesContainer = document.getElementById('detail-routes');
        if (!routesContainer) return;
        
        // Default message for no routes needed
        if (status === 'green' || status === 'low') {
            routesContainer.innerHTML = `
                <p class="text-sm text-gray-500">No alternative routes needed</p>
            `;
            return;
        }
        
        // Get the other route to recommend
        const otherRouteId = intersection.id === 'route-1' ? 'route-2' : 'route-1';
        const otherRoute = app.intersections.find(r => r.id === otherRouteId);
        
        if (!otherRoute) {
            routesContainer.innerHTML = `
                <p class="text-sm text-gray-500">No alternative routes available</p>
            `;
            return;
        }
        
        // Get status of the other route
        const otherStatus = app.trafficStatus.get(otherRouteId) || 'green';
        
        // Only recommend if the other route is in better condition
        const statusRank = {
            'green': 0,
            'low': 0,
            'yellow': 1,
            'moderate': 1,
            'red': 2,
            'high': 2
        };
        
        if (statusRank[otherStatus] < statusRank[status]) {
            routesContainer.innerHTML = `
                <div class="flex items-start space-x-2">
                    <span class="material-icons text-accent-green mt-0.5">recommend</span>
                    <div>
                        <p class="text-sm font-medium text-white">${otherRoute.name}</p>
                        <p class="text-xs text-gray-400 mt-1">${otherRoute.description || 'Alternative route with better traffic conditions'}</p>
                        <button class="bg-accent-green text-white px-3 py-1 mt-2 text-xs rounded-full show-on-map" 
                                data-route="${otherRouteId}">Show on Map</button>
                    </div>
                </div>
            `;
            
            // Add event listener to "Show on Map" button
            routesContainer.querySelector('.show-on-map').addEventListener('click', (e) => {
                const routeId = e.target.dataset.route;
                map.highlightRoute(routeId);
            });
        } else {
            routesContainer.innerHTML = `
                <p class="text-sm text-gray-500">All alternate routes are similarly congested</p>
            `;
        }
    },
    
    /**
     * Hide intersection details panel
     */
    hideIntersectionDetails() {
        document.getElementById('intersection-detail').classList.add('hidden');
        app.selectedIntersection = null;
    },
    
    /**
     * Update FPS counter
     */
    updateFps(fps) {
        const fpsElem = document.getElementById('fps-counter');
        if (fpsElem) {
            fpsElem.textContent = `${fps} FPS`;
        }
    },
    
    /**
     * Update camera status indicator
     */
    updateCameraStatus(cameraId) {
        const cameraCard = document.getElementById(`camera-${cameraId}`);
        if (!cameraCard) return;
        
        const camera = app.cameras.get(cameraId);
        if (!camera) return;
        
        const statusElem = cameraCard.querySelector('.text-xs:last-child');
        
        if (statusElem) {
            statusElem.className = `flex items-center text-xs ${camera.connected ? 'text-green-400' : 'text-red-400'}`;
            statusElem.innerHTML = `
                <span class="traffic-indicator ${camera.connected ? 'bg-green-400' : 'bg-red-400'} mr-1"></span>
                <span>${camera.connected ? 'Online' : 'Offline'}</span>
            `;
        }
    },
    
    /**
     * Update alerts display
     */
    updateAlerts() {
        const alertsContainer = document.getElementById('alerts-container');
        if (!alertsContainer) return;
        
        // Clear existing alerts
        alertsContainer.innerHTML = '';
        
        if (app.alerts.length === 0) {
            alertsContainer.innerHTML = `
                <div class="flex items-center justify-center py-4 text-gray-500 text-sm">
                    No alerts at this time
                </div>
            `;
            return;
        }
        
        // Add alerts
        app.alerts.forEach(alert => {
            const alertElem = document.createElement('div');
            alertElem.className = 'bg-card rounded-md p-3 shadow-md border-l-4';
            
            // Add appropriate border color based on alert type
            if (alert.type === 'accident') {
                alertElem.classList.add('border-red-600');
            } else if (alert.type === 'traffic-high') {
                alertElem.classList.add('border-red-500');
            } else if (alert.type === 'traffic-moderate') {
                alertElem.classList.add('border-yellow-500');
            } else if (alert.type === 'reroute') {
                alertElem.classList.add('border-blue-500');
            } else {
                alertElem.classList.add('border-gray-500');
            }
            
            // Format time
            const timeFormatted = alert.timestamp.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            
            // Create alert content
            alertElem.innerHTML = `
                <div class="flex justify-between items-start">
                    <h4 class="text-sm font-medium text-white">${alert.title}</h4>
                    <span class="text-xs text-gray-400">${timeFormatted}</span>
                </div>
                <p class="text-xs text-gray-300 mt-1">${alert.message}</p>
            `;
            
            alertsContainer.appendChild(alertElem);
        });
    },
    
    /**
     * Show notification to the user
     */
    showNotification(message, type = 'info') {
        // Create a simple notification that fades away
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-4 right-4 p-3 rounded-md text-sm shadow-lg transition-opacity duration-300';
        
        // Style based on type
        switch (type) {
            case 'error':
                notification.classList.add('bg-red-600', 'text-white');
                break;
            case 'warning':
                notification.classList.add('bg-yellow-500', 'text-white');
                break;
            case 'success':
                notification.classList.add('bg-accent-green', 'text-white');
                break;
            default:
                notification.classList.add('bg-blue-600', 'text-white');
        }
        
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Fade out and remove after 5 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 5000);
    },
    
    /**
     * Update camera count in UI
     */
    updateCameraCount(count) {
        const camerasCount = document.getElementById('cameras-count');
        if (camerasCount) {
            camerasCount.textContent = count;
        }
    },
    
    /**
     * Update intersections count in UI
     */
    updateIntersectionsCount(count) {
        const intersectionsCount = document.getElementById('intersections-count');
        if (intersectionsCount) {
            intersectionsCount.textContent = count;
        }
    },
    
    /**
     * Update congested count in UI
     */
    updateCongestedCount(count) {
        const congestedCount = document.getElementById('congested-count');
        if (congestedCount) {
            congestedCount.textContent = count;
        }
    },
    
    /**
     * Update alerts count in UI
     */
    updateAlertsCount(count) {
        const alertsCount = document.getElementById('alerts-count');
        if (alertsCount) {
            alertsCount.textContent = count;
        }
    }
};