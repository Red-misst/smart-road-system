/**
 * Smart Road System - Admin Connection Module
 * Handles communication between admin dashboard and backend services
 */

import { connection } from '../../js/connection.js';

// Admin connection handler
export const adminConnection = {
    /**
     * Initialize connection handlers for admin dashboard
     */
    init() {
        // Listen for WebSocket connection events from connection module
        this.setupConnectionListeners();
        
        // Set up custom event listeners for the admin dashboard
        this.setupCustomEvents();
        
        console.log('Admin connection module initialized');
    },
    
    /**
     * Set up connection listeners
     */
    setupConnectionListeners() {
        // Add additional handlers to connection module for admin-specific events
        if (typeof connection !== 'undefined') {
            // Add handler for traffic control commands
            document.addEventListener('admin-traffic-command', (e) => {
                if (connection.wsConnected) {
                    connection.sendMessage({
                        type: 'traffic_control',
                        command: e.detail.command,
                        params: e.detail.params
                    });
                    
                    console.log(`Sent traffic control command: ${e.detail.command}`);
                }
            });
            
            // Add handler for emergency vehicle priority
            document.addEventListener('admin-emergency', (e) => {
                if (connection.wsConnected) {
                    connection.sendMessage({
                        type: 'emergency_vehicle',
                        vehicleType: e.detail.vehicleType,
                        direction: e.detail.direction,
                        action: e.detail.action || 'dispatch'
                    });
                    
                    console.log(`Sent emergency vehicle command for ${e.detail.vehicleType}`);
                }
            });
        }
    },
    
    /**
     * Set up custom events for the admin dashboard
     */
    setupCustomEvents() {
        // Create custom event dispatchers for use in admin dashboard
        this.dispatchTrafficCommand = (command, params = {}) => {
            document.dispatchEvent(new CustomEvent('admin-traffic-command', {
                detail: { command, params }
            }));
        };
        
        this.dispatchEmergencyCommand = (vehicleType, direction, action = 'dispatch') => {
            document.dispatchEvent(new CustomEvent('admin-emergency', {
                detail: { vehicleType, direction, action }
            }));
        };
    },
    
    /**
     * Request system status update from server
     */
    requestSystemStatus() {
        if (typeof connection !== 'undefined' && connection.wsConnected) {
            connection.sendMessage({
                type: 'get_system_status'
            });
        }
    },
    
    /**
     * Send traffic light control command
     * @param {string} intersectionId - ID of the intersection
     * @param {string} direction - Direction (ns, ew)
     * @param {string} state - Light state (red, yellow, green)
     */
    setTrafficLight(intersectionId, direction, state) {
        this.dispatchTrafficCommand('set_traffic_light', {
            intersectionId,
            direction,
            state
        });
    },
    
    /**
     * Send emergency vehicle dispatch command
     * @param {string} vehicleType - Type of emergency vehicle
     * @param {string} direction - Direction of approach
     */
    dispatchEmergencyVehicle(vehicleType, direction) {
        this.dispatchEmergencyCommand(vehicleType, direction);
    }
};

// Initialize the module when loaded
document.addEventListener('DOMContentLoaded', () => {
    adminConnection.init();
});
