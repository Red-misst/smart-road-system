/**
 * Smart Road System - App Configuration
 * Manages global application state and configuration
 */

// Global state - publicly accessible across modules
const app = {
    // WebSocket connection
    ws: null,
    wsConnected: false,
    reconnectAttempts: 0,
    reconnectInterval: null,
    
    // Camera feeds
    cameras: new Map(), // Map<cameraId, cameraInfo>
    activeCameraId: null,
    latestFrames: new Map(), // Map<cameraId, objectURL>
    
    // Traffic data
    intersections: [], // List of traffic intersections
    trafficStatus: new Map(), // Map<intersectionId, status>
    alerts: [],
    
    // Frame processing
    frameCounter: 0,
    fpsCounter: 0,
    lastFpsUpdate: Date.now(),
    
    // Map elements
    map: null,
    markers: new Map(), // Map<intersectionId, L.marker>
    
    // UI state
    camerasVisible: false,
    selectedIntersection: null,
    fullScreenMode: false,
    
    // Detection settings
    confidenceThreshold: 0.25,
    showDetections: true
};

// Export for use in other modules
export default app;