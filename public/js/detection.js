/**
 * Smart Road System - Detection Module
 * Processes object detection results and renders detection boxes
 */

import app from './app-config.js';

// Object detection
export const detection = {
    results: new Map(), // Map<cameraId, detectionResults>
    
    /**
     * Process detection results from the server
     */
    processResults(message) {
        if (!message || !message.cameraId || !message.detections) return;
        
        const { cameraId, detections, inference_time = 0 } = message;
        
        // Store results
        this.results.set(cameraId, {
            detections,
            inference_time,
            timestamp: Date.now()
        });
        
        // Update UI if this is the active camera
        if (app.activeCameraId === cameraId && app.showDetections) {
            this.renderDetectionBoxes(cameraId);
        }
    },
    
    /**
     * Render detection boxes on the current camera view
     */
    renderDetectionBoxes(cameraId) {
        const results = this.results.get(cameraId);
        if (!results) return;
        
        const boxesContainer = document.getElementById('detection-boxes-container');
        if (!boxesContainer) return;
        
        // Clear previous boxes
        boxesContainer.innerHTML = '';
        
        // Get container dimensions
        const container = document.getElementById('traffic-camera-feed');
        if (!container) return;
        
        const containerRect = container.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const containerHeight = containerRect.height;
        
        // Only render boxes if we have detections and the container has dimensions
        if (containerWidth > 0 && containerHeight > 0 && results.detections?.length > 0) {
            results.detections.forEach(detection => {
                const [x1, y1, x2, y2] = detection.bbox;
                const confidence = detection.confidence;
                
                // Skip if below threshold
                if (confidence < app.confidenceThreshold) return;
                
                const className = detection.class_name.toLowerCase();
                
                // Calculate dimensions in pixels
                const boxWidth = (x2 - x1) * containerWidth;
                const boxHeight = (y2 - y1) * containerHeight;
                const boxLeft = x1 * containerWidth;
                const boxTop = y1 * containerHeight;
                
                // Create box element
                const box = document.createElement('div');
                box.className = `detection-box box-${className}`;
                box.style.left = `${boxLeft}px`;
                box.style.top = `${boxTop}px`;
                box.style.width = `${boxWidth}px`;
                box.style.height = `${boxHeight}px`;
                
                // Create label
                const label = document.createElement('div');
                label.className = `detection-label label-${className}`;
                label.textContent = `${className} ${(confidence * 100).toFixed(0)}%`;
                
                box.appendChild(label);
                boxesContainer.appendChild(box);
            });
        }
    }
};