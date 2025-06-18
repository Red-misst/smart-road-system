document.addEventListener('DOMContentLoaded', () => {
    // --- Session Controls ---
    const sessionForm = document.getElementById('session-form');
    const sessionTimeInput = document.getElementById('session-time');
    const sessionCountInput = document.getElementById('session-count');
    const startBtn = document.getElementById('start-session-btn');
    const stopBtn = document.getElementById('stop-session-btn');
    const sessionStatus = document.getElementById('session-status');
    const liveSection = document.getElementById('live-section');
    const sessionsList = document.getElementById('sessions-list');
    const sessionDataDiv = document.getElementById('session-data');

    let currentSessionId = null;
    let sessionTimer = null;

    // --- WebSocket for live video/detections ---
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');
    let lastDetections = [];
    const detectionStats = document.getElementById('detection-stats');
    let ws = null;
    let currentFrameMetadata = null;

    // --- Session Form Handlers ---
    sessionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const duration = parseInt(sessionTimeInput.value, 10);
        const count = parseInt(sessionCountInput.value, 10);
        startBtn.disabled = true;
        sessionStatus.textContent = 'Starting session...';
        try {
            const res = await fetch('/api/session/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ duration, count })
            });
            const data = await res.json();
            if (data.sessionId) {
                currentSessionId = data.sessionId;
                sessionStatus.textContent = `Session started (ID: ${currentSessionId})`;
                startBtn.classList.add('hidden');
                stopBtn.classList.remove('hidden');
                liveSection.classList.remove('hidden');
                openWebSocket();
                // Auto-stop after duration
                sessionTimer = setTimeout(() => stopSession(), duration * 60 * 1000);
            } else {
                sessionStatus.textContent = 'Failed to start session.';
                startBtn.disabled = false;
            }
        } catch (err) {
            sessionStatus.textContent = 'Error starting session.';
            startBtn.disabled = false;
        }
    });

    stopBtn.addEventListener('click', stopSession);

    async function stopSession() {
        if (!currentSessionId) return;
        stopBtn.disabled = true;
        sessionStatus.textContent = 'Stopping session...';
        try {
            await fetch(`/api/session/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: currentSessionId })
            });
        } catch {}
        sessionStatus.textContent = 'Session ended.';
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        liveSection.classList.add('hidden');
        stopBtn.disabled = false;
        startBtn.disabled = false;
        currentSessionId = null;
        if (sessionTimer) clearTimeout(sessionTimer);
        if (ws) ws.close();
        fetchSessions();
    }

    // --- WebSocket for live video/detections ---
    function openWebSocket() {
        ws = new WebSocket('ws://localhost:3000?type=browser');
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'subscribe_session', sessionId: currentSessionId }));
        };
        ws.onmessage = (event) => {
            if (event.data instanceof Blob) {
                if (currentFrameMetadata) {
                    const blobUrl = URL.createObjectURL(event.data);
                    const img = new Image();
                    img.onload = () => {
                        canvas.width = img.width;
                        canvas.height = img.height;
                        ctx.drawImage(img, 0, 0);
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
                        URL.revokeObjectURL(blobUrl);
                    };
                    img.src = blobUrl;
                }
                return;
            }
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'frame_metadata') {
                    currentFrameMetadata = data;
                    return;
                }
                if (data.type === 'detection_results' && data.detections) {
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
        };
    }

    function updateDetectionStats(detections) {
        const counts = {};
        detections.forEach(det => {
            const className = det.class_name || det.class;
            counts[className] = (counts[className] || 0) + 1;
        });
        const carCount = counts['car'] || 0;
        const accidentCount = counts['accident'] || 0;
        let statsHtml = `
            <p><strong>Cars:</strong> ${carCount}</p>
            <p><strong>Accidents:</strong> ${accidentCount}</p>
            <hr class="my-2 border-gray-600">
        `;
        detections.forEach(det => {
            const className = det.class_name || det.class;
            const confidence = det.confidence;
            statsHtml += `<p>${className}: ${Math.round(confidence * 100)}%</p>`;
        });
        detectionStats.innerHTML = statsHtml;
    }

    // --- Session History ---
    async function fetchSessions() {
        sessionsList.innerHTML = '<span class="text-gray-400">Loading...</span>';
        try {
            const res = await fetch('/api/sessions');
            const sessions = await res.json();
            if (!sessions.length) {
                sessionsList.innerHTML = '<span class="text-gray-400">No sessions found.</span>';
                return;
            }
            sessionsList.innerHTML = '';
            sessions.forEach(sess => {
                const btn = document.createElement('button');
                btn.className = 'text-left px-3 py-2 rounded bg-surface hover:bg-gray-700 transition';
                btn.textContent = `Session ${sess._id} | ${sess.startTime ? new Date(sess.startTime).toLocaleString() : ''}`;
                btn.onclick = () => showSessionData(sess._id);
                sessionsList.appendChild(btn);
            });
        } catch {
            sessionsList.innerHTML = '<span class="text-red-400">Failed to load sessions.</span>';
        }
    }

    async function showSessionData(sessionId) {
        sessionDataDiv.innerHTML = '<span class="text-gray-400">Loading session data...</span>';
        try {
            const res = await fetch(`/api/session/${sessionId}/data`);
            const data = await res.json();
            let html = `<h4 class="font-semibold mb-2">Session Results</h4>`;
            html += `<div class="text-sm mb-2">Started: ${data.session.startTime ? new Date(data.session.startTime).toLocaleString() : ''}</div>`;
            html += `<div class="text-sm mb-2">Duration: ${data.session.duration} min, Count: ${data.session.count}</div>`;
            html += `<div class="text-sm mb-2">Detections: ${data.detections.length}</div>`;
            html += '<ul class="text-xs">';
            data.detections.forEach(d => {
                html += `<li>${d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : ''} - Car: ${d.carCount}, Accident: ${d.accidentCount}</li>`;
            });
            html += '</ul>';
            sessionDataDiv.innerHTML = html;
        } catch {
            sessionDataDiv.innerHTML = '<span class="text-red-400">Failed to load session data.</span>';
        }
    }

    // Initial load
    fetchSessions();
});
