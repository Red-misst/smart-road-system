document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');
    let lastDetections = [];
    const detectionStats = document.getElementById('detection-stats');
    const ws = new WebSocket('ws://localhost:3000?type=browser'); // Connect to Node.js server with browser type identifier

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
        // Request initial camera list
        ws.send(JSON.stringify({ type: 'get_camera_list' }));
    };    // Store the current metadata for upcoming binary frames
    let currentFrameMetadata = null;
    
    ws.onmessage = (event) => {
        // Check if the message is binary data (video frame)
        if (event.data instanceof Blob) {
            // Process binary frame only if we have metadata for it
            if (currentFrameMetadata) {
                // Render frame to canvas and overlay boxes
                const blobUrl = URL.createObjectURL(event.data);
                const img = new Image();
                img.onload = () => {
                    // Resize canvas to match frame
                    canvas.width = img.width;
                    canvas.height = img.height;
                    // Draw frame
                    ctx.drawImage(img, 0, 0);
                    // Draw bounding boxes
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'red';
                    ctx.font = '16px sans-serif';
                    ctx.fillStyle = 'red';
                    lastDetections.forEach(det => {
                        const [x1, y1, x2, y2] = det.bbox;
                        const w = x2 - x1;
                        const h = y2 - y1;
                        ctx.strokeRect(x1, y1, w, h);
                        ctx.fillText(det.class || det.class_name, x1, y1 - 5);
                    });
                    // Clean up
                    URL.revokeObjectURL(blobUrl);
                };
                img.src = blobUrl;
            }
            return;
        }
        
        // If not binary, process as JSON
        try {
            const data = JSON.parse(event.data);
            
            // Save metadata for upcoming frame
            if (data.type === 'frame_metadata') {
                currentFrameMetadata = data;
                return;
            }
            
            // Process detection results when received
            if (data.type === 'detection_results' && data.detections) {
                // Store latest detections and update stats
                lastDetections = data.detections;
                updateDetectionStats(data.detections);
            }
        } catch (error) {
            console.log('Error processing message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed');
    };    function updateDetectionStats(detections) {
        // Extract counts by class name from detections
        const counts = {};
        detections.forEach(det => {
            const className = det.class_name || det.class;
            counts[className] = (counts[className] || 0) + 1;
        });

        // Display counts for our primary traffic classes
        const carCount = counts['car'] || 0;
        const personCount = counts['person'] || 0;

        let statsHtml = `
            <p><strong>Cars:</strong> ${carCount}</p>
            <p><strong>People:</strong> ${personCount}</p>
            <hr class="my-2 border-gray-600">
        `;

        // Show individual detections with confidence
        detections.forEach(det => {
            const className = det.class_name || det.class;
            const confidence = det.confidence;
            statsHtml += `<p>${className}: ${Math.round(confidence * 100)}%</p>`;
        });

        detectionStats.innerHTML = statsHtml;
    }
});
