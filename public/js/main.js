/**
 * Smart Road System - Main Entry Point
 * Initializes and coordinates all system modules
 */

import app from './app-config.js';
import { styles } from './styles.js';
import { connection } from './connection.js';
import { camera } from './camera.js';
import { detection } from './detection.js';
import { traffic } from './traffic.js';
import { map } from './map.js';
import { ui } from './ui.js';

// Main initialization
function initApp() {
    console.log('Initializing Smart Road System...');
    
    // Add custom styles
    styles.addStyles();
    
    // Initialize UI first
    ui.init();
    
    // Initialize map
    map.init();
    
    // Initialize traffic data
    traffic.init();
      // Connect to WebSocket server automatically
    connection.connect();
    
    console.log('Smart Road System initialized');
}

// Start when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);

// Export for use in debugging
export {
    app,
    connection,
    camera,
    detection, 
    traffic,
    map,
    ui
};