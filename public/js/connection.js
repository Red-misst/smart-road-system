/**
 * Smart Road System - Connection Manager
 * Handles WebSocket connection to server for real-time data
 */

import app from './app-config.js';
import { camera } from './camera.js';
import { detection } from './detection.js';
import { traffic } from './traffic.js';
import { ui } from './ui.js';

// WebSocket connection management
export const connection = {
    /**
     * Initialize WebSocket connection to the server
     */
    connect() {
        if (app.ws && app.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket is already connected');
            return;
        }
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/?type=browser`;
        
        try {
            app.ws = new WebSocket(wsUrl);
            
            // Configure WebSocket callbacks
            app.ws.onopen = this.onOpen;
            app.ws.onclose = this.onClose;
            app.ws.onmessage = this.onMessage;
            app.ws.onerror = this.onError;
            
            console.log('Connecting to WebSocket server...');
            ui.updateConnectionStatus('connecting');
        } catch (error) {
            console.error('WebSocket connection error:', error);
            ui.updateConnectionStatus('error');
        }
    },
    
    /**
     * Disconnect WebSocket from server
     */
    disconnect() {
        if (app.ws) {
            app.ws.close();
        }
    },
      /**
     * Handle WebSocket open event
     */
    onOpen() {
        console.log('WebSocket connected');
        app.wsConnected = true;
        app.reconnectAttempts = 0;
        
        if (app.reconnectInterval) {
            clearInterval(app.reconnectInterval);
            app.reconnectInterval = null;
        }
        
        ui.updateConnectionStatus('connected');
        
        // Request initial camera list
        connection.sendMessage({
            type: 'get_camera_list'
        });
        
        // Show live indicator
        document.getElementById('stream-indicator').classList.remove('hidden');
    },
    
    /**
     * Handle WebSocket close event
     */
    onClose(event) {
        console.log(`WebSocket disconnected: ${event.code}`, event.reason);
        app.wsConnected = false;
        ui.updateConnectionStatus('disconnected');
        
        // Clear camera data
        app.cameras.clear();
        
        // Setup reconnect if needed
        if (!app.reconnectInterval && app.reconnectAttempts < 20) {
            app.reconnectInterval = setInterval(() => {
                if (!app.wsConnected) {
                    app.reconnectAttempts++;
                    console.log(`Reconnection attempt ${app.reconnectAttempts}...`);
                    connection.connect();
                }
            }, 5000); // Try every 5 seconds
        }
    },
    
    /**
     * Handle WebSocket error event
     */
    onError(error) {
        console.error('WebSocket error:', error);
        ui.updateConnectionStatus('error');
    },
    
    /**
     * Handle WebSocket messages
     */
    onMessage(event) {
        try {
            // Check if message is binary data (likely video frame)
            if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
                // Process binary frame
                camera.processBinaryFrame(event.data);
                return;
            }
            
            // Otherwise parse as JSON
            const message = JSON.parse(event.data);
            
            // Process based on message type
            switch (message.type) {
                case 'frame_metadata':
                    // Store metadata for next binary frame
                    camera.currentFrameMetadata = message;
                    break;
                    
                case 'camera_list':
                    // Update camera list
                    camera.updateCameraList(message.cameras);
                    break;
                    
                case 'camera_info':
                    // Update specific camera info
                    camera.updateCameraInfo(message);
                    break;
                    
                case 'camera_disconnected':
                    // Handle camera disconnection
                    camera.handleCameraDisconnect(message.id);
                    break;
                    
                case 'detection_results':
                    // Handle object detection results
                    detection.processResults(message);
                    break;
                    
                case 'traffic_redirection':
                    // Handle traffic redirection data
                    traffic.handleRedirection(message);
                    break;
                    
                default:
                    console.log('Received unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    },
    
    /**
     * Send WebSocket message to server
     */
    sendMessage(data) {
        if (app.ws && app.ws.readyState === WebSocket.OPEN) {
            app.ws.send(JSON.stringify(data));
            return true;
        } else {
            console.warn('Cannot send message, WebSocket is not connected');
            return false;
        }
    },
    
    /**
     * Request a specific camera frame
     */
    requestFrame(cameraId) {
        this.sendMessage({
            type: 'request_frame',
            cameraId: cameraId
        });
    }
};