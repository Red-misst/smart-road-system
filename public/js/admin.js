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
        
        // Reset session tracking
        sessionCumulativeCarCount = 0;
        sessionDetectionHistory = [];
        if (liveCumulativeChart) {
            liveCumulativeChart.destroy();
            liveCumulativeChart = null;
        }
        
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

    // Track cumulative car counts during a live session
    let sessionCumulativeCarCount = 0;
    let sessionDetectionHistory = [];
    let liveCumulativeChart = null;
    
    function updateDetectionStats(detections) {
        const counts = {};
        detections.forEach(det => {
            const className = det.class_name || det.class;
            counts[className] = (counts[className] || 0) + 1;
        });
        const carCount = counts['car'] || 0;
        const accidentCount = counts['accident'] || 0;
        
        // Update cumulative car count for the session
        sessionCumulativeCarCount += carCount;
        
        // Store this detection for history
        sessionDetectionHistory.push({
            timestamp: new Date(),
            carCount: carCount,
            accidentCount: accidentCount
        });
        
        // Limit history to last 50 detections for performance
        if (sessionDetectionHistory.length > 50) {
            sessionDetectionHistory.shift();
        }
        
        // Update stats display
        let statsHtml = `
            <p class="mb-2"><strong>Current Frame:</strong></p>
            <p class="flex justify-between mb-1">
                <span>Cars:</span>
                <span class="font-medium">${carCount}</span>
            </p>
            <p class="flex justify-between mb-2">
                <span>Accidents:</span>
                <span class="font-medium">${accidentCount}</span>
            </p>
            <div class="bg-gray-200 h-px my-3"></div>
            <p class="mb-2"><strong>Session Totals:</strong></p>
            <p class="flex justify-between mb-1">
                <span>Total Cars Detected:</span>
                <span class="font-medium text-primary">${sessionCumulativeCarCount}</span>
            </p>
            <p class="flex justify-between mb-3">
                <span>Detections:</span>
                <span class="font-medium">${sessionDetectionHistory.length}</span>
            </p>
        `;
        
        // Add canvas for mini live chart
        statsHtml += `
            <div class="mt-3 bg-white rounded p-2 border border-gray-200">
                <h5 class="text-xs font-medium text-gray-700 mb-1">Cumulative Car Count</h5>
                <div class="h-32">
                    <canvas id="liveSessionChart"></canvas>
                </div>
            </div>
        `;
        
        // Add detection details (most recent)
        if (detections.length > 0) {
            statsHtml += `
                <div class="bg-gray-200 h-px my-3"></div>
                <p class="mb-2"><strong>Detection Details:</strong></p>
            `;
            detections.forEach(det => {
                const className = det.class_name || det.class;
                const confidence = det.confidence;
                statsHtml += `<p class="flex justify-between text-xs mb-1">
                    <span>${className}:</span>
                    <span>${Math.round(confidence * 100)}%</span>
                </p>`;
            });
        }
        
        detectionStats.innerHTML = statsHtml;
        
        // Update or create live session chart
        updateLiveSessionChart();
    }
    
    function updateLiveSessionChart() {
        // Make sure canvas exists and we have data
        const canvas = document.getElementById('liveSessionChart');
        if (!canvas || sessionDetectionHistory.length === 0) return;
        
        // Get session target count
        const targetCount = parseInt(sessionCountInput.value) || 5;
        
        // Process data for chart
        const labels = sessionDetectionHistory.map(d => 
            d.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})
        );
        
        // Calculate cumulative count
        let cumulativeCounts = [];
        let sum = 0;
        sessionDetectionHistory.forEach(d => {
            sum += d.carCount;
            cumulativeCounts.push(sum);
        });
        
        // If chart already exists, update it
        if (liveCumulativeChart) {
            liveCumulativeChart.data.labels = labels;
            liveCumulativeChart.data.datasets[0].data = cumulativeCounts;
            liveCumulativeChart.data.datasets[1].data = Array(labels.length).fill(targetCount);
            liveCumulativeChart.update();
            return;
        }
        
        // Create new chart
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 150);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.6)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
        
        liveCumulativeChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Cars',
                        data: cumulativeCounts,
                        borderColor: '#10b981',
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.1,
                        pointRadius: 1,
                        pointHoverRadius: 3
                    },
                    {
                        label: 'Target',
                        data: Array(labels.length).fill(targetCount),
                        borderColor: '#dc2626',
                        borderDash: [3, 3],
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest'
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: true
                    }
                },
                scales: {
                    x: {
                        display: false
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0,
                            font: {
                                size: 10
                            }
                        },
                        grid: {
                            display: true,
                            drawBorder: false
                        }
                    }
                }
            }
        });
    }

    // --- Session History ---
    async function fetchSessions() {
        sessionsList.innerHTML = '<div class="flex justify-center p-4"><div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div></div>';
        try {
            const res = await fetch('/api/sessions');
            const sessions = await res.json();
            if (!sessions.length) {
                sessionsList.innerHTML = `
                    <div class="text-center p-4 text-gray-500">
                        <span class="material-icons block mx-auto mb-2">history_toggle_off</span>
                        <span class="text-sm">No sessions found.</span>
                    </div>
                `;
                return;
            }
            
            sessionsList.innerHTML = '';
            
            // Sort sessions by startTime (newest first)
            const sortedSessions = [...sessions].sort((a, b) => {
                const dateA = a.startTime ? new Date(a.startTime) : new Date(0);
                const dateB = b.startTime ? new Date(b.startTime) : new Date(0);
                return dateB - dateA;
            });
            
            sortedSessions.forEach(sess => {
                const sessionDate = sess.startTime ? new Date(sess.startTime) : null;
                const formattedDate = sessionDate ? sessionDate.toLocaleDateString() : 'Unknown date';
                const formattedTime = sessionDate ? sessionDate.toLocaleTimeString() : '';
                
                const btn = document.createElement('button');
                btn.className = 'text-left p-3 rounded bg-white hover:bg-blue-50 transition border border-gray-100 mb-2 w-full card-hover';
                btn.innerHTML = `
                    <div class="flex items-center justify-between">
                        <div class="flex items-center">
                            <span class="material-icons text-primary mr-2">analytics</span>
                            <div>
                                <div class="font-medium text-gray-800">Session ${sess._id.substring(0, 8)}...</div>
                                <div class="text-xs text-gray-500">${formattedDate} · ${formattedTime}</div>
                            </div>
                        </div>
                        <span class="material-icons text-gray-400">chevron_right</span>
                    </div>
                `;
                btn.onclick = () => {
                    // Highlight the active session
                    document.querySelectorAll('#sessions-list button').forEach(b => 
                        b.classList.remove('bg-blue-50', 'border-blue-200'));
                    btn.classList.add('bg-blue-50', 'border-blue-200');
                    
                    showSessionData(sess._id);
                };
                sessionsList.appendChild(btn);
            });
        } catch (error) {
            console.error('Error fetching sessions:', error);
            sessionsList.innerHTML = `
                <div class="text-center p-4 text-red-500">
                    <span class="material-icons block mx-auto mb-2">error_outline</span>
                    <span class="text-sm">Failed to load sessions.</span>
                </div>
            `;
        }
    }

    async function showSessionData(sessionId) {
        sessionDataDiv.innerHTML = '<span class="text-gray-400">Loading session data...</span>';
        try {
            const res = await fetch(`/api/session/${sessionId}/data`);
            const data = await res.json();
            
            // Prepare the HTML structure for charts and data
            let html = `
                <div class="flex justify-between items-center mb-3">
                    <div>
                        <h4 class="font-semibold mb-1">Session Results</h4>
                        <div class="text-sm text-gray-600">Started: ${data.session.startTime ? new Date(data.session.startTime).toLocaleString() : ''}</div>
                    </div>
                    <button id="fullscreenBtn" class="bg-primary hover:bg-primary-dark text-white px-3 py-1 rounded-md text-sm flex items-center">
                        <span class="material-icons text-sm mr-1">fullscreen</span>
                        <span>Expand</span>
                    </button>
                </div>
                <div class="text-sm mb-2 flex flex-wrap gap-x-4 gap-y-1">
                    <div><span class="font-medium">Duration:</span> ${data.session.duration} min</div>
                    <div><span class="font-medium">Target count:</span> ${data.session.count}</div>
                    <div><span class="font-medium">Total detections:</span> ${data.detections.length}</div>
                </div>
            `;
            
            // Add containers for charts
            html += `
                <div class="mb-6 mt-4">
                    <div class="flex flex-col lg:flex-row gap-4 mb-4">
                        <div class="flex-1 bg-white p-3 rounded shadow-sm border">
                            <h5 class="text-sm font-medium text-gray-700 mb-2">Car Count Over Time</h5>
                            <div class="h-56">
                                <canvas id="carCountChart"></canvas>
                            </div>
                        </div>
                        <div class="flex-1 bg-white p-3 rounded shadow-sm border">
                            <h5 class="text-sm font-medium text-gray-700 mb-2">Accident Detection Over Time</h5>
                            <div class="h-56">
                                <canvas id="accidentChart"></canvas>
                            </div>
                        </div>
                    </div>
                    <div class="bg-white p-3 rounded shadow-sm border">
                        <h5 class="text-sm font-medium text-gray-700 mb-2">Cumulative Car Count</h5>
                        <div class="h-56">
                            <canvas id="cumulativeCarChart"></canvas>
                        </div>
                    </div>
                </div>
            `;
            
            // Add detection data list (collapsed by default)
            html += `
                <div class="mt-4">
                    <button id="toggleDetectionsBtn" class="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded flex items-center">
                        <span class="material-icons text-xs mr-1">list</span>
                        Show Raw Detection Data
                    </button>
                    <div id="rawDetectionsList" class="mt-2 hidden max-h-40 overflow-y-auto text-xs bg-white p-2 rounded border">
                        <table class="w-full">
                            <thead>
                                <tr class="border-b">
                                    <th class="text-left py-1">Time</th>
                                    <th class="text-center py-1">Cars</th>
                                    <th class="text-center py-1">Accidents</th>
                                </tr>
                            </thead>
                            <tbody>
            `;
            
            data.detections.forEach(d => {
                html += `
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                        <td class="py-1">${d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : ''}</td>
                        <td class="text-center py-1">${d.carCount}</td>
                        <td class="text-center py-1">${d.accidentCount}</td>
                    </tr>
                `;
            });
            
            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            
            sessionDataDiv.innerHTML = html;
            
            // Add toggle functionality for raw data
            document.getElementById('toggleDetectionsBtn').addEventListener('click', function() {
                const list = document.getElementById('rawDetectionsList');
                if (list.classList.contains('hidden')) {
                    list.classList.remove('hidden');
                    this.innerHTML = '<span class="material-icons text-xs mr-1">visibility_off</span> Hide Raw Detection Data';
                } else {
                    list.classList.add('hidden');
                    this.innerHTML = '<span class="material-icons text-xs mr-1">list</span> Show Raw Detection Data';
                }
            });
            
            // Setup fullscreen functionality
            document.getElementById('fullscreenBtn').addEventListener('click', function() {
                const historySection = document.querySelector('.session-history-section');
                if (historySection.classList.contains('fullscreen-mode')) {
                    // Exit fullscreen
                    historySection.classList.remove('fullscreen-mode');
                    this.innerHTML = '<span class="material-icons text-sm mr-1">fullscreen</span><span>Expand</span>';
                } else {
                    // Enter fullscreen
                    historySection.classList.add('fullscreen-mode');
                    this.innerHTML = '<span class="material-icons text-sm mr-1">fullscreen_exit</span><span>Exit Fullscreen</span>';
                }
                
                // Redraw charts after transition
                setTimeout(() => {
                    const chartData = processSessionData(data.detections, data.session.count);
                    createCarCountChart('carCountChart', chartData);
                    createAccidentChart('accidentChart', chartData);
                    createCumulativeCarChart('cumulativeCarChart', chartData);
                }, 300);
            });
            
            // Process data for charts
            const chartData = processSessionData(data.detections, data.session.count);
            
            // Create charts
            createCarCountChart('carCountChart', chartData);
            createAccidentChart('accidentChart', chartData);
            createCumulativeCarChart('cumulativeCarChart', chartData);
            
        } catch (error) {
            console.error('Error loading session data:', error);
            sessionDataDiv.innerHTML = '<span class="text-red-400">Failed to load session data.</span>';
        }
    }
    
    // Process session data for charts
    function processSessionData(detections, thresholdCount) {
        // Sort detections by timestamp (oldest first)
        const sortedDetections = [...detections].sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        // Extract data for charts
        const labels = sortedDetections.map(d => 
            d.timestamp ? new Date(d.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}) : ''
        );
        
        const carCounts = sortedDetections.map(d => d.carCount || 0);
        const accidentCounts = sortedDetections.map(d => d.accidentCount || 0);
        
        // Calculate cumulative car counts
        let cumulativeCarCounts = [];
        let sum = 0;
        for (const count of carCounts) {
            sum += count;
            cumulativeCarCounts.push(sum);
        }
        
        return {
            labels,
            carCounts,
            accidentCounts,
            cumulativeCarCounts,
            thresholdCount
        };
    }
    
    // Create car count chart
    function createCarCountChart(canvasId, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Create gradient fill for car counts
        const gradient = ctx.createLinearGradient(0, 0, 0, 225);
        gradient.addColorStop(0, 'rgba(37, 99, 235, 0.5)'); // primary color with transparency
        gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)');
        
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: 'Car Count',
                        data: data.carCounts,
                        borderColor: '#2563eb', // primary color
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.2,
                        pointRadius: 2,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Threshold',
                        data: Array(data.labels.length).fill(data.thresholdCount),
                        borderColor: '#dc2626', // danger color
                        borderDash: [5, 5],
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 6
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: function(tooltipItems) {
                                return tooltipItems[0].label || '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45,
                            autoSkip: true,
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: Math.max(data.thresholdCount + 1, ...data.carCounts) + 1,
                        ticks: {
                            precision: 0
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    }
    
    // Create cumulative car chart
    function createCumulativeCarChart(canvasId, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Create gradient fill for car counts
        const gradient = ctx.createLinearGradient(0, 0, 0, 225);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.6)'); // success/green color with transparency
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
        
        // Area where count exceeds threshold
        const thresholdArea = data.cumulativeCarCounts.map((count, index) => 
            count > data.thresholdCount ? count : null
        );
        
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: 'Cumulative Cars',
                        data: data.cumulativeCarCounts,
                        borderColor: '#10b981', // success/green color
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.1,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        borderWidth: 2
                    },
                    {
                        label: 'Threshold',
                        data: Array(data.labels.length).fill(data.thresholdCount),
                        borderColor: '#dc2626', // danger color
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        fill: false
                    },
                    {
                        label: 'Over Threshold',
                        data: thresholdArea,
                        backgroundColor: 'rgba(239, 68, 68, 0.15)', // lighter red
                        borderWidth: 0,
                        pointRadius: 0,
                        fill: '+1', // Fill to threshold line
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 6,
                            filter: function(item) {
                                // Hide "Over Threshold" from legend
                                return item.text !== 'Over Threshold';
                            }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: function(tooltipItems) {
                                return tooltipItems[0].label || '';
                            },
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y;
                                    
                                    // Add threshold status for cumulative count
                                    if (context.datasetIndex === 0) {
                                        const threshold = data.thresholdCount;
                                        if (context.parsed.y > threshold) {
                                            label += ` (${context.parsed.y - threshold} over threshold)`;
                                        }
                                    }
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45,
                            autoSkip: true,
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: Math.max(data.thresholdCount + 1, ...data.cumulativeCarCounts) + 1,
                        ticks: {
                            precision: 0
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    }
    
    // Create accident chart
    function createAccidentChart(canvasId, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Create gradient fill for accident counts
        const gradient = ctx.createLinearGradient(0, 0, 0, 225);
        gradient.addColorStop(0, 'rgba(220, 38, 38, 0.5)'); // danger color with transparency
        gradient.addColorStop(1, 'rgba(220, 38, 38, 0.0)');
        
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Accidents',
                    data: data.accidentCounts,
                    borderColor: '#dc2626', // danger color
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 3,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 6
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45,
                            autoSkip: true,
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: Math.max(1, ...data.accidentCounts) + 1,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
    }

    // Initial load
    fetchSessions();
});
