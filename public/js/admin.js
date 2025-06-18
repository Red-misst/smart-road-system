document.addEventListener('DOMContentLoaded', () => {
    const cameraFeed = document.getElementById('camera-feed');
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
                // Create a more direct URL for the image
                const blobUrl = URL.createObjectURL(event.data);
                cameraFeed.src = blobUrl;
                
                // Clean up the URL after the image loads to prevent memory leaks
                cameraFeed.onload = () => {
                    URL.revokeObjectURL(blobUrl);
                };
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
                updateDetectionStats(data.detections);
                // Bounding box overlay would be handled here
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
