import { initMap, closeIntersectionDetails, toggleMapFullscreen, updateIntersectionStatus, getIntersections } from './map.js';
import { setupUI } from './ui.js';

// Global WebSocket connection
window.wsConnection = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded, initializing app...");
    
    // Setup the map with debug info
    try {
        console.log("Attempting to initialize map...");
        const map = initMap();
        console.log("Map initialization result:", map ? "Success" : "Failed");
    } catch (error) {
        console.error("Error during map initialization:", error);
    }
    
    // Setup button handlers
    setupButtonHandlers();
    
    // Update time display
    updateClock();
    setInterval(updateClock, 1000);
    
    // Connect to WebSocket server (if available)
    try {
        connectWebSocket();
    } catch (error) {
        console.error("WebSocket connection error:", error);
    }
    
    // Update initial statistics
    updateTrafficStats();
    
    console.log("App initialization completed");
});

// Update the clock display
function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const clockElement = document.getElementById('current-time');
    if (clockElement) {
        clockElement.textContent = timeString;
    }
}

// Connect to WebSocket server (if available in your environment)
function connectWebSocket() {
    // Determine WebSocket URL (same host, different protocol)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?type=browser`;
    
    console.log(`Attempting WebSocket connection to: ${wsUrl}`);
    
    try {
        // Create WebSocket connection
        window.wsConnection = new WebSocket(wsUrl);
        
        // Connection opened
        window.wsConnection.addEventListener('open', (event) => {
            console.log('Connected to server');
            const statusElement = document.getElementById('system-status');
            if (statusElement) {
                statusElement.textContent = 'System Online';
            }
            
            // Request camera list
            window.wsConnection.send(JSON.stringify({
                type: 'get_camera_list'
            }));
        });
        
        // Handle messages, errors and disconnections
        setupSocketHandlers();
    } catch (error) {
        console.error("Failed to establish WebSocket connection:", error);
        const statusElement = document.getElementById('system-status');
        if (statusElement) {
            statusElement.textContent = 'System Offline';
        }
    }
}

// Setup WebSocket event handlers
function setupSocketHandlers() {
    if (!window.wsConnection) return;
    
    // Connection closed
    window.wsConnection.addEventListener('close', (event) => {
        console.log('Disconnected from server:', event.code, event.reason);
        const statusElement = document.getElementById('system-status');
        if (statusElement) {
            statusElement.textContent = 'System Offline';
        }
        
        // Try to reconnect after a delay
        setTimeout(connectWebSocket, 5000);
    });
    
    // Listen for messages
    window.wsConnection.addEventListener('message', (event) => {
        try {
            // Handle binary or text messages appropriately
            if (event.data instanceof Blob) {
                console.log("Received binary data");
                // Process camera frame
            } else {
                const message = JSON.parse(event.data);
                console.log("Received message type:", message.type);
                // Process message based on type
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });
    
    // Handle errors
    window.wsConnection.addEventListener('error', (event) => {
        console.error('WebSocket error:', event);
        const statusElement = document.getElementById('system-status');
        if (statusElement) {
            statusElement.textContent = 'Connection Error';
        }
    });
}

// Setup button handlers
function setupButtonHandlers() {
    // Map fullscreen toggle button
    const fullscreenBtn = document.getElementById('map-fullscreen-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            console.log("Toggling map fullscreen...");
            toggleMapFullscreen();
        });
    }
    
    // Show/hide cameras section
    const camerasBtn = document.getElementById('show-cameras-btn');
    if (camerasBtn) {
        camerasBtn.addEventListener('click', () => {
            const camerasSection = document.getElementById('cameras-section');
            if (camerasSection) {
                camerasSection.classList.toggle('hidden');
            }
            const intersectionDetail = document.getElementById('intersection-detail');
            if (intersectionDetail) {
                intersectionDetail.classList.add('hidden');
            }
        });
    }
    
    // Routes button
    const routesBtn = document.getElementById('show-routes-btn');
    if (routesBtn) {
        routesBtn.addEventListener('click', () => {
            console.log("Showing route information...");
            // Add route display logic
            alert("Routes feature would display alternative paths between intersections");
        });
    }
    
    // Close cameras button
    const closeBtn = document.getElementById('close-cameras');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const camerasSection = document.getElementById('cameras-section');
            if (camerasSection) {
                camerasSection.classList.add('hidden');
            }
        });
    }
    
    // Close detail view button
    const closeDetailBtn = document.getElementById('close-detail');
    if (closeDetailBtn) {
        closeDetailBtn.addEventListener('click', () => {
            closeIntersectionDetails();
        });
    }
    
    // Camera toggle button
    const cameraToggleBtn = document.getElementById('camera-toggle');
    if (cameraToggleBtn) {
        cameraToggleBtn.addEventListener('click', () => {
            alert('Camera connection functionality would be implemented based on your specific camera system');
        });
    }
    
    // Sidebar toggle (for mobile)
    const sidebarToggleBtn = document.getElementById('sidebar-toggle');
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('sidebar-open');
            }
        });
    }
}

// Update traffic statistics
function updateTrafficStats() {
    try {
        // Get intersections data
        const intersections = getIntersections();
        
        // Count by traffic status
        let normalCount = 0;
        let moderateCount = 0;
        let heavyCount = 0;
        
        intersections.forEach(intersection => {
            if (intersection.status === 'heavy') heavyCount++;
            else if (intersection.status === 'moderate') moderateCount++;
            else normalCount++;
        });
        
        // Update counters in the UI
        const normalElement = document.getElementById('normal-traffic-count');
        const moderateElement = document.getElementById('moderate-traffic-count');
        const heavyElement = document.getElementById('heavy-traffic-count');
        const congestedElement = document.getElementById('congested-count');
        const intersectionsElement = document.getElementById('intersections-count');
        
        if (normalElement) normalElement.textContent = normalCount;
        if (moderateElement) moderateElement.textContent = moderateCount;
        if (heavyElement) heavyElement.textContent = heavyCount;
        if (congestedElement) congestedElement.textContent = heavyCount;
        if (intersectionsElement) intersectionsElement.textContent = intersections.length;
        
    } catch (error) {
        console.error("Error updating traffic stats:", error);
    }
}
