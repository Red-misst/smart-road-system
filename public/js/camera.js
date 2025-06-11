/**
 * Smart Road System - Camera Module
 * Manages camera feeds and processes incoming frames
 */

import app from './app-config.js';
import { connection } from './connection.js';
import { ui } from './ui.js';

// Camera management
export const camera = {
    // Store current frame metadata
    currentFrameMetadata: null,
    
    /**
     * Update the list of available cameras
     */
    updateCameraList(cameraList) {
        if (!cameraList || !Array.isArray(cameraList)) {
            console.warn('Received invalid camera list');
            return;
        }
        
        // Clear old cameras that are no longer connected
        const newCameraIds = new Set(cameraList.map(cam => cam.id));
        
        for (const [id, _] of app.cameras) {
            if (!newCameraIds.has(id)) {
                app.cameras.delete(id);
                
                // Release object URL if exists
                if (app.latestFrames.has(id)) {
                    URL.revokeObjectURL(app.latestFrames.get(id));
                    app.latestFrames.delete(id);
                }
            }
        }
        
        // Add or update cameras
        cameraList.forEach(cam => {
            app.cameras.set(cam.id, cam);
        });
        
        // Update UI
        ui.updateCameraCount(app.cameras.size);
        ui.updateCameraGrid();
    },
    
    /**
     * Update information for a specific camera
     */
    updateCameraInfo(cameraInfo) {
        if (!cameraInfo || !cameraInfo.id) return;
        
        app.cameras.set(cameraInfo.id, {
            ...app.cameras.get(cameraInfo.id),
            ...cameraInfo
        });
        
        // Update active camera display if this is the selected camera
        if (app.activeCameraId === cameraInfo.id) {
            ui.updateActiveCameraInfo();
        }
    },
      /**
     * Process binary frame data (JPEG image)
     */
    processBinaryFrame(data) {
        // Ensure we have metadata for this frame
        if (!this.currentFrameMetadata) {
            console.warn('Received binary frame without metadata');
            return;
        }
        
        const cameraId = this.currentFrameMetadata.id;
        this.currentFrameMetadata = null; // Clear metadata after use
        
        if (!cameraId) {
            console.warn('Frame metadata missing camera ID');
            return;
        }
        
        // Convert binary data to object URL
        let blob;
        if (data instanceof Blob) {
            blob = data;
        } else {
            blob = new Blob([data], { type: 'image/jpeg' });
        }
        
        // Clean up previous object URL if exists
        if (app.latestFrames.has(cameraId)) {
            URL.revokeObjectURL(app.latestFrames.get(cameraId));
        }
        
        const objectUrl = URL.createObjectURL(blob);
        app.latestFrames.set(cameraId, objectUrl);
          // Update UI for this camera
        ui.updateCameraFrame(cameraId, objectUrl);
        
        // Update FPS counter
        app.frameCounter++;
        const now = Date.now();
        if (now - app.lastFpsUpdate >= 1000) {
            app.fpsCounter = app.frameCounter;
            app.frameCounter = 0;
            app.lastFpsUpdate = now;
            
            // Update FPS in UI if needed
            if (app.activeCameraId === cameraId) {
                ui.updateFps(app.fpsCounter);
            }
        }
        
        // Request next frame if streaming is active for this camera
        if (app.wsConnected && app.activeCameraId === cameraId) {
            // Short timeout to prevent overwhelming the server
            setTimeout(() => {
                connection.requestFrame(cameraId);
            }, 40); // ~25fps target
        }
    },
      /**
     * Handle camera disconnection
     */
    handleCameraDisconnect(cameraId) {
        if (!cameraId) return;
        
        const camera = app.cameras.get(cameraId);
        
        if (camera) {
            // Mark as disconnected but keep in list
            app.cameras.set(cameraId, {
                ...camera,
                connected: false,
                disconnectedAt: new Date().toISOString()
            });
            
            // Update UI
            ui.updateCameraStatus(cameraId);
        
            // Handle disconnection if this was the active camera
            if (app.activeCameraId === cameraId) {
                // Hide live indicator
                document.getElementById('stream-indicator').classList.add('hidden');
                
                // Reset streaming state
                app.streamingStarted = false;
                
                // Show disconnection message
                if (ui.showNotification) {
                    ui.showNotification('Camera disconnected', 'warning');
                }
            }
        }
    },
    
    /**
     * Select a camera to show as active
     */
    selectCamera(cameraId) {
        const camera = app.cameras.get(cameraId);
        
        if (!camera) {
            console.warn(`Attempted to select non-existent camera: ${cameraId}`);
            return;
        }
        
        // Set as active camera
        app.activeCameraId = cameraId;
        
        // Update UI
        ui.updateActiveCameraInfo();
        
        // Request a fresh frame if needed
        connection.requestFrame(cameraId);
        
        return camera;
    }
};