// Smart Road System - Admin Dashboard JavaScript

// Global WebSocket connection
let socket;
let trafficData = {
    vehicleCounts: {},
    hourlyData: {},
    metrics: {
        levelOfService: 'B',
        averageDelay: 18.5,
        queueLength: 42,
        vcRatio: 0.78,
        pceValue: 1.34,
        criticalGap: 4.5,
        saturationFlow: 1850,
        intersectionCapacity: 2400
    },
    intersectionStatus: {
        'intersection-1': {
            eastWest: 'GREEN',
            northSouth: 'RED',
            cycleDuration: 60,
            flowRate: 5
        },
        'intersection-2': {
            eastWest: 'RED',
            northSouth: 'GREEN',
            cycleDuration: 55,
            flowRate: 7
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI components
    initUI();
    
    // Connect to WebSocket server
    connectToServer();
    
    // Load admin dashboard data
    loadDashboardData();
    
    // Setup traffic simulation
    setupTrafficSimulation();
    
    // Initialize system controls
    initSystemControls();
    
    // Update time display
    updateTime();
    setInterval(updateTime, 1000);
});

// Connect to WebSocket server
function connectToServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log(`Connecting to WebSocket server at ${wsUrl}...`);
    socket = new WebSocket(wsUrl);
    
    // Connection established
    socket.onopen = () => {
        console.log('Connected to the server');
        showNotification('Connected to server', 'success');
        
        // Identify as admin client
        socket.send(JSON.stringify({
            type: 'admin_connected',
            timestamp: new Date().toISOString()
        }));
        
        // Request initial data
        requestAdminData();
    };
    
    // Message received
    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            processServerMessage(message);
        } catch (error) {
            console.error('Error processing server message:', error);
        }
    };
    
    // Connection closed
    socket.onclose = (event) => {
        console.log('Disconnected from server:', event.code, event.reason);
        showNotification('Disconnected from server. Reconnecting...', 'warning');
        
        // Try to reconnect after 5 seconds
        setTimeout(connectToServer, 5000);
    };
    
    // Connection error
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        showNotification('Connection error', 'error');
    };
}

// Request admin dashboard data
function requestAdminData() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error('Socket not connected');
        return;
    }
    
    // Request traffic analytics data
    socket.send(JSON.stringify({
        type: 'get_admin_data',
        timestamp: new Date().toISOString()
    }));
}

// Process messages from the server
function processServerMessage(message) {
    const { type } = message;
    
    switch (type) {
        case 'admin_data':
            // Update dashboard with admin data
            updateAdminDashboard(message.data);
            break;
            
        case 'traffic_update':
            // Update traffic data
            updateTrafficData(message.data);
            break;
            
        case 'detection_results':
            // Handle detection results from AI
            handleDetectionResults(message);
            break;
            
        case 'system_log':
            // Add to system log
            addSystemLog(message.timestamp, message.message, message.level);
            break;
            
        case 'traffic_redirection':
            // Update traffic redirection data
            updateTrafficRedirection(message);
            break;
            
        case 'camera_list':
            // Update camera list
            updateCameraList(message.cameras);
            break;
    }
}

// Update admin dashboard with received data
function updateAdminDashboard(data) {
    console.log('Updating admin dashboard with data:', data);
    
    if (data.stats) {
        // Update general stats
        document.getElementById('active-intersections').textContent = data.stats.activeIntersections || 4;
        document.getElementById('connected-cameras').textContent = data.stats.connectedCameras || 2;
        document.getElementById('traffic-volume').textContent = data.stats.trafficVolume || '5,247';
        
        // Update system health status
        const systemHealth = document.getElementById('system-health');
        if (data.stats.systemStatus === 'operational') {
            systemHealth.textContent = 'Operational';
            systemHealth.className = 'text-green-500 text-2xl font-light';
        } else if (data.stats.systemStatus === 'warning') {
            systemHealth.textContent = 'Warning';
            systemHealth.className = 'text-yellow-500 text-2xl font-light';
        } else {
            systemHealth.textContent = 'Error';
            systemHealth.className = 'text-red-500 text-2xl font-light';
        }
    }
    
    if (data.vehicleComposition) {
        trafficData.vehicleCounts = data.vehicleComposition;
        updateVehicleCompositionChart();
    }
    
    if (data.hourlyTraffic) {
        trafficData.hourlyData = data.hourlyTraffic;
        updateHourlyTrafficChart();
    }
    
    if (data.metrics) {
        updateTrafficMetrics(data.metrics);
    }
    
    if (data.intersectionStatus) {
        trafficData.intersectionStatus = data.intersectionStatus;
        updateIntersectionStatus();
    }
    
    // Update logs if provided
    if (data.logs && Array.isArray(data.logs)) {
        updateSystemLogs(data.logs);
    }
}

// Update traffic data with real-time information
function updateTrafficData(data) {
    if (data.vehicleCounts) {
        trafficData.vehicleCounts = data.vehicleCounts;
        updateVehicleCompositionChart();
    }
    
    if (data.hourlyData) {
        trafficData.hourlyData = data.hourlyData;
        updateHourlyTrafficChart();
    }
    
    // Update traffic metrics if available
    if (data.metrics) {
        updateTrafficMetrics(data.metrics);
    }
}

// Handle AI detection results
function handleDetectionResults(message) {
    const { detections, cameraId } = message;
    if (!detections) return;
    
    // Count vehicles by type
    const counts = {};
    detections.forEach(detection => {
        const className = detection.class_name.toLowerCase();
        counts[className] = (counts[className] || 0) + 1;
    });
    
    // Update vehicle counts
    trafficData.vehicleCounts = {
        ...trafficData.vehicleCounts,
        ...counts
    };
    
    // Update charts
    updateVehicleCompositionChart();
    
    // Add to system log
    const vehicleCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (vehicleCount > 0) {
        addSystemLog(
            new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            `Detected ${vehicleCount} vehicles at camera ${cameraId}`,
            'info'
        );
    }
}

// Update traffic metrics display
function updateTrafficMetrics(metrics) {
    if (metrics.levelOfService) {
        const losElement = document.getElementById('level-of-service');
        losElement.textContent = metrics.levelOfService;
        
        // Update color based on LOS value
        switch(metrics.levelOfService) {
            case 'A':
                losElement.className = 'text-xl font-light text-green-500';
                break;
            case 'B':
            case 'C':
                losElement.className = 'text-xl font-light text-green-400';
                break;
            case 'D':
                losElement.className = 'text-xl font-light text-yellow-500';
                break;
            case 'E':
                losElement.className = 'text-xl font-light text-orange-500';
                break;
            case 'F':
                losElement.className = 'text-xl font-light text-red-500';
                break;
            default:
                losElement.className = 'text-xl font-light text-white';
        }
    }
    
    // Update other metrics
    if (metrics.averageDelay !== undefined) {
        document.getElementById('average-delay').textContent = metrics.averageDelay.toFixed(1);
    }
    
    if (metrics.queueLength !== undefined) {
        document.getElementById('queue-length').textContent = metrics.queueLength;
    }
    
    if (metrics.vcRatio !== undefined) {
        const vcElement = document.getElementById('v-c-ratio');
        vcElement.textContent = metrics.vcRatio.toFixed(2);
        
        // Color based on v/c ratio
        if (metrics.vcRatio < 0.5) {
            vcElement.className = 'text-xl font-light text-green-500';
        } else if (metrics.vcRatio < 0.85) {
            vcElement.className = 'text-xl font-light text-yellow-500';
        } else {
            vcElement.className = 'text-xl font-light text-red-500';
        }
    }
    
    if (metrics.pceValue !== undefined) {
        document.getElementById('pce-value').textContent = metrics.pceValue.toFixed(2);
    }
    
    if (metrics.criticalGap !== undefined) {
        document.getElementById('critical-gap').textContent = metrics.criticalGap.toFixed(1);
    }
    
    if (metrics.saturationFlow !== undefined) {
        document.getElementById('saturation-flow').textContent = metrics.saturationFlow.toLocaleString();
    }
    
    if (metrics.intersectionCapacity !== undefined) {
        document.getElementById('intersection-capacity').textContent = metrics.intersectionCapacity.toLocaleString();
    }
}

// Update intersection status display
function updateIntersectionStatus() {
    const selectedId = document.getElementById('intersection-select').value;
    const status = trafficData.intersectionStatus[selectedId] || trafficData.intersectionStatus['intersection-1'];
    
    if (status) {
        // Update east-west and north-south status
        const eastWestStatus = document.getElementById('east-west-status');
        eastWestStatus.textContent = status.eastWest || 'RED';
        eastWestStatus.className = status.eastWest === 'GREEN' ? 'text-green-500 font-medium' : 
                                   status.eastWest === 'YELLOW' ? 'text-yellow-500 font-medium' :
                                   'text-red-500 font-medium';
        
        const northSouthStatus = document.getElementById('north-south-status');
        northSouthStatus.textContent = status.northSouth || 'RED';
        northSouthStatus.className = status.northSouth === 'GREEN' ? 'text-green-500 font-medium' : 
                                    status.northSouth === 'YELLOW' ? 'text-yellow-500 font-medium' :
                                    'text-red-500 font-medium';
        
        // Update range inputs
        const cycleDuration = document.getElementById('cycle-duration');
        if (cycleDuration && status.cycleDuration) {
            cycleDuration.value = status.cycleDuration;
            document.getElementById('cycle-value').textContent = `${status.cycleDuration}s`;
        }
        
        const flowRate = document.getElementById('flow-rate');
        if (flowRate && status.flowRate !== undefined) {
            flowRate.value = status.flowRate;
            
            // Update flow text based on value
            const flowText = status.flowRate <= 3 ? 'Light' : 
                             status.flowRate <= 7 ? 'Medium' : 'Heavy';
            document.getElementById('flow-value').textContent = flowText;
        }
    }
}

// Vehicle composition chart
let vehicleCompositionChart = null;

function updateVehicleCompositionChart() {
    const ctx = document.getElementById('vehicle-composition-chart')?.getContext('2d');
    if (!ctx) return;
    
    // Get vehicle counts from data
    const vehicleCounts = trafficData.vehicleCounts;
    
    // Prepare data for chart
    const labels = [];
    const data = [];
    const backgroundColors = [
        'rgba(75, 192, 192, 0.7)',
        'rgba(54, 162, 235, 0.7)',
        'rgba(255, 206, 86, 0.7)',
        'rgba(255, 99, 132, 0.7)',
        'rgba(153, 102, 255, 0.7)',
        'rgba(255, 159, 64, 0.7)'
    ];
    
    // Map the traffic classes to proper names
    const classMapping = {
        'car': 'Cars',
        'truck': 'Trucks',
        'bus': 'Buses',
        'motorcycle': 'Motorcycles',
        'bicycle': 'Bicycles',
        'person': 'Pedestrians'
    };
    
    // Add classes in a specific order
    ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'person'].forEach(cls => {
        if (vehicleCounts[cls] !== undefined) {
            labels.push(classMapping[cls] || cls);
            data.push(vehicleCounts[cls]);
        }
    });
    
    // Add any other classes not in our predefined list
    Object.keys(vehicleCounts).forEach(cls => {
        if (!['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'person'].includes(cls)) {
            labels.push(cls.charAt(0).toUpperCase() + cls.slice(1));
            data.push(vehicleCounts[cls]);
        }
    });
    
    // Create or update chart
    if (vehicleCompositionChart) {
        vehicleCompositionChart.data.labels = labels;
        vehicleCompositionChart.data.datasets[0].data = data;
        vehicleCompositionChart.update();
    } else {
        vehicleCompositionChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: backgroundColors,
                    borderColor: 'rgba(20, 20, 20, 0.8)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: 'white',
                            font: {
                                size: 10
                            }
                        }
                    },
                    title: {
                        display: true,
                        text: 'Vehicle Types Detected',
                        color: 'white',
                        font: {
                            size: 14
                        }
                    }
                }}
            });
    }
}

// Hourly traffic chart
let hourlyTrafficChart = null;

function updateHourlyTrafficChart() {
    const ctx = document.getElementById('hourly-traffic-chart')?.getContext('2d');
    if (!ctx) return;
    
    // Get hourly data or use demo data
    const hourlyData = trafficData.hourlyData;
    let hours = [];
    let vehicles = [];
    
    if (Object.keys(hourlyData).length > 0) {
        hours = Object.keys(hourlyData);
        vehicles = hours.map(hour => hourlyData[hour]);
    } else {
        // Demo data if no real data available
        hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', 
                 '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];
        vehicles = [120, 350, 580, 430, 320, 290, 380, 320, 290, 310, 410, 590, 490, 280];
    }
    
    // Create or update chart
    if (hourlyTrafficChart) {
        hourlyTrafficChart.data.labels = hours;
        hourlyTrafficChart.data.datasets[0].data = vehicles;
        hourlyTrafficChart.update();
    } else {
        hourlyTrafficChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: hours,
                datasets: [{
                    label: 'Traffic Volume',
                    data: vehicles,
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 2,
                    pointBackgroundColor: 'rgba(75, 192, 192, 1)',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'Vehicles Per Hour',
                        color: 'white',
                        font: {
                            size: 14
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.7)'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    x: {
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.7)'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    }
                }
    }});
    }
}

// Update camera list
function updateCameraList(cameras) {
    // Update camera count
    document.getElementById('connected-cameras').textContent = cameras.filter(c => c.connected).length;
    
    // Add to system log
    addSystemLog(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        `Updated camera list: ${cameras.length} cameras, ${cameras.filter(c => c.connected).length} connected`,
        'info'
    );
}

// Update traffic redirection status
function updateTrafficRedirection(data) {
    // Add to system log for significant traffic changes
    if (data.status === 'high') {
        addSystemLog(
            new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            `Heavy traffic detected at camera ${data.cameraId} - ${data.vehicleCount} vehicles`,
            'warning'
        );
    }
    
    // Update traffic metrics based on new data
    const metrics = trafficData.metrics;
    
    // Adjust LOS based on traffic density
    if (data.status === 'high') {
        metrics.levelOfService = 'E';
        metrics.averageDelay = 55 + Math.random() * 10;
        metrics.queueLength = 80 + Math.floor(Math.random() * 20);
        metrics.vcRatio = 0.92 + Math.random() * 0.08;
    } else if (data.status === 'moderate') {
        metrics.levelOfService = 'C';
        metrics.averageDelay = 25 + Math.random() * 10;
        metrics.queueLength = 45 + Math.floor(Math.random() * 15);
        metrics.vcRatio = 0.65 + Math.random() * 0.15;
    } else {
        metrics.levelOfService = 'B';
        metrics.averageDelay = 15 + Math.random() * 5;
        metrics.queueLength = 20 + Math.floor(Math.random() * 10);
        metrics.vcRatio = 0.4 + Math.random() * 0.1;
    }
    
    // Update display
    updateTrafficMetrics(metrics);
}

// Update system logs from server data
function updateSystemLogs(logs) {
    const logContainer = document.getElementById('system-log');
    if (!logContainer) return;
    
    // Clear existing logs
    logContainer.innerHTML = '';
    
    // Add each log entry
    logs.forEach(log => {
        addSystemLog(log.timestamp, log.message, log.level);
    });
}

// Add a log entry to the system log
function addSystemLog(timestamp, message, level = 'info') {
    const logContainer = document.getElementById('system-log');
    if (!logContainer) return;
    
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-700';
    
    // Determine text color based on log level
    let messageClass = 'text-white';
    if (level === 'error') messageClass = 'text-red-400';
    if (level === 'warning') messageClass = 'text-yellow-400';
    if (level === 'success') messageClass = 'text-green-400';
    
    tr.innerHTML = `
        <td class="p-2 text-gray-500 w-24">${timestamp}</td>
        <td class="p-2 ${messageClass}">${message}</td>
    `;
    
    // Add to the top of the log for most recent first
    logContainer.insertBefore(tr, logContainer.firstChild);
    
    // Limit number of log entries to prevent performance issues
    const maxLogs = 100;
    while (logContainer.children.length > maxLogs) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// Send traffic light control updates to server
function sendTrafficLightUpdate() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error('Socket not connected');
        return;
    }
    
    const selectedId = document.getElementById('intersection-select').value;
    const cycleDuration = parseInt(document.getElementById('cycle-duration').value);
    const flowRate = parseInt(document.getElementById('flow-rate').value);
    
    // Send update to server
    socket.send(JSON.stringify({
        type: 'traffic_light_control',
        intersectionId: selectedId,
        cycleDuration: cycleDuration,
        flowRate: flowRate,
        timestamp: new Date().toISOString()
    }));
    
    // Update local data
    if (trafficData.intersectionStatus[selectedId]) {
        trafficData.intersectionStatus[selectedId].cycleDuration = cycleDuration;
        trafficData.intersectionStatus[selectedId].flowRate = flowRate;
    }
    
    // Show notification
    showNotification('Traffic light settings updated', 'success');
}

// Send emergency mode toggle to server
function toggleEmergencyMode() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error('Socket not connected');
        return;
    }
    
    const selectedId = document.getElementById('intersection-select').value;
    const button = document.getElementById('emergency-mode');
    const isEmergency = button.classList.contains('bg-blue-700');
    
    // Toggle button state
    if (isEmergency) {
        button.classList.remove('bg-blue-700', 'hover:bg-blue-600');
        button.classList.add('bg-red-700', 'hover:bg-red-600');
        button.textContent = 'Emergency Mode';
    } else {
        button.classList.remove('bg-red-700', 'hover:bg-red-600');
        button.classList.add('bg-blue-700', 'hover:bg-blue-600');
        button.textContent = 'Normal Mode';
    }
    
    // Send update to server
    socket.send(JSON.stringify({
        type: 'emergency_mode',
        intersectionId: selectedId,
        enabled: !isEmergency, // Toggle state
        timestamp: new Date().toISOString()
    }));
    
    // Show notification
    showNotification(
        !isEmergency ? 'Emergency mode activated' : 'Emergency mode deactivated',
        !isEmergency ? 'warning' : 'success'
    );
    
    // Add to log
    addSystemLog(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        !isEmergency ? `Emergency mode activated for ${selectedId}` : `Emergency mode deactivated for ${selectedId}`,
        !isEmergency ? 'warning' : 'success'
    );
}

// Update cycle duration and flow rate values
function handleRangeChange() {
    const cycleValue = document.getElementById('cycle-duration').value;
    document.getElementById('cycle-value').textContent = `${cycleValue}s`;
    
    const flowValue = document.getElementById('flow-rate').value;
    const flowText = flowValue <= 3 ? 'Light' : flowValue <= 7 ? 'Medium' : 'Heavy';
    document.getElementById('flow-value').textContent = flowText;
    
    // Auto-send updates
    sendTrafficLightUpdate();
}

// UI Initialization
function initUI() {
    // Tab switching functionality
    const tabButtons = document.querySelectorAll('[role="tab"]');
    const tabPanels = document.querySelectorAll('[role="tabpanel"]');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Deactivate all tabs
            tabButtons.forEach(btn => {
                btn.setAttribute('aria-selected', 'false');
                btn.classList.remove('bg-accent-green', 'text-white');
                btn.classList.add('text-gray-400');
            });
            
            // Hide all panels
            tabPanels.forEach(panel => {
                panel.classList.add('hidden');
            });
            
            // Activate selected tab
            button.setAttribute('aria-selected', 'true');
            button.classList.remove('text-gray-400');
            button.classList.add('bg-accent-green', 'text-white');
            
            // Show corresponding panel
            const panelId = button.getAttribute('aria-controls');
            document.getElementById(panelId).classList.remove('hidden');
        });
    });
    
    // Handle form submissions
    setupFormHandlers();
    
    // Handle intersection selection change
    document.getElementById('intersection-select')?.addEventListener('change', () => {
        updateIntersectionStatus();
        
        // Show notification
        const selectedText = document.getElementById('intersection-select').options[
            document.getElementById('intersection-select').selectedIndex
        ].text;
        
        showNotification(`Selected intersection: ${selectedText}`, 'info');
    });
    
    // Handle cycle duration and flow rate changes
    document.getElementById('cycle-duration')?.addEventListener('change', handleRangeChange);
    document.getElementById('flow-rate')?.addEventListener('change', handleRangeChange);
    
    // Handle emergency mode toggle
    document.getElementById('emergency-mode')?.addEventListener('click', toggleEmergencyMode);
    
    // Handle auto control toggle
    document.getElementById('auto-control')?.addEventListener('click', () => {
        // Send to server
        const selectedId = document.getElementById('intersection-select').value;
        
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'auto_control',
                intersectionId: selectedId,
                timestamp: new Date().toISOString()
            }));
        }
        
        showNotification('Auto control mode activated', 'success');
    });
    
    // Handle camera activation
    document.getElementById('activate-cameras')?.addEventListener('click', () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            const selectedId = document.getElementById('intersection-select').value;
            
            socket.send(JSON.stringify({
                type: 'activate_cameras',
                intersectionId: selectedId,
                timestamp: new Date().toISOString()
            }));
        }
        
        showNotification('Cameras activated', 'success');
        
        // Add to log
        addSystemLog(
            new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            'Cameras activated for traffic monitoring',
            'success'
        );
    });
    
    // Handle traffic pattern change
    document.getElementById('traffic-pattern')?.addEventListener('click', () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            const selectedId = document.getElementById('intersection-select').value;
            
            socket.send(JSON.stringify({
                type: 'change_traffic_pattern',
                intersectionId: selectedId,
                timestamp: new Date().toISOString()
            }));
        }
        
        showNotification('Traffic pattern updated', 'info');
    });
    
    // Handle clear log button
    document.getElementById('clear-log')?.addEventListener('click', () => {
        const logContainer = document.getElementById('system-log');
        if (logContainer) {
            logContainer.innerHTML = '';
        }
        
        showNotification('System log cleared', 'info');
    });
    
    // Handle detection settings changes
    document.getElementById('confidence-threshold')?.addEventListener('input', (e) => {
        const value = e.target.value;
        document.getElementById('threshold-value').textContent = `${value}%`;
        
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'update_detection_settings',
                settings: {
                    confidenceThreshold: value / 100,
                    showDetections: document.getElementById('show-detections').checked,
                    enableAnalytics: document.getElementById('enable-analytics').checked,
                    saveData: document.getElementById('save-data').checked
                },
                timestamp: new Date().toISOString()
            }));
        }
    });
    
    // Handle checkbox changes
    ['show-detections', 'enable-analytics', 'save-data'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'update_detection_settings',
                    settings: {
                        confidenceThreshold: document.getElementById('confidence-threshold').value / 100,
                        showDetections: document.getElementById('show-detections').checked,
                        enableAnalytics: document.getElementById('enable-analytics').checked,
                        saveData: document.getElementById('save-data').checked
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            
            showNotification('Detection settings updated', 'info');
        });
    });
}

// Setup form handlers
function setupFormHandlers() {
    // Settings form
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            // Show success message
            showNotification('Settings saved successfully', 'success');
            
            // In a real application, you would send these settings to the backend
            console.log('Settings form submitted');
        });
    }
    
    // Add user form
    const addUserForm = document.getElementById('add-user-form');
    if (addUserForm) {
        addUserForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const email = document.getElementById('email').value;
            const role = document.getElementById('role').value;
            
            // Add user to the table (in a real app, this would be saved to the database)
            addUserToTable(username, email, role);
            
            // Clear form
            addUserForm.reset();
            
            // Show success message
            showNotification(`User ${username} added successfully`, 'success');
        });
    }
}

// Load dashboard data - updated to work with WebSocket data
function loadDashboardData() {
    // Initial request for data is now done via WebSocket in connectToServer()
    
    // Initialize charts with empty data until real data arrives
    updateVehicleCompositionChart();
    updateHourlyTrafficChart();
}

// Update time display
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    document.getElementById('current-time').textContent = timeString;
}

// Traffic simulation setup
function setupTrafficSimulation() {
    // Initialize traffic simulation
    initTrafficSimulation();
    
    // Traffic light cycle simulation
    startTrafficLightCycle();
}

// Initialize traffic simulation
function initTrafficSimulation() {
    console.log('Traffic simulation initialized');
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="material-icons">${getIconForType(type)}</span>
        <span>${message}</span>
    `;
    
    // Add to notifications container
    const container = document.getElementById('notifications');
    if (!container) {
        // Create container if it doesn't exist
        const newContainer = document.createElement('div');
        newContainer.id = 'notifications';
        newContainer.className = 'fixed top-5 right-5 z-50 flex flex-col space-y-2';
        document.body.appendChild(newContainer);
        newContainer.appendChild(notification);
    } else {
        container.appendChild(notification);
    }
    
    // Remove notification after delay
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            notification.remove();
        }, 500);
    }, 5000);
}

// Get icon for notification type
function getIconForType(type) {
    switch(type) {
        case 'success': return 'check_circle';
        case 'error': return 'error';
        case 'warning': return 'warning';
        case 'info': 
        default:
            return 'info';
    }
}

// CSS for admin dashboard
const style = document.createElement('style');
style.textContent = `
    /* Notification styles */
    #notifications {
        pointer-events: none;
    }
    .notification {
        background-color: #303134;
        color: white;
        padding: 12px 16px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slide-in 0.3s ease-out;
        pointer-events: auto;
    }
    .notification.fade-out {
        animation: slide-out 0.5s ease-out forwards;
    }
    .notification.success {
        border-left: 4px solid #4caf50;
    }
    .notification.success .material-icons {
        color: #4caf50;
    }
    .notification.error {
        border-left: 4px solid #f44336;
    }
    .notification.error .material-icons {
        color: #f44336;
    }
    .notification.warning {
        border-left: 4px solid #ff9800;
    }
    .notification.warning .material-icons {
        color: #ff9800;
    }
    .notification.info {
        border-left: 4px solid #2196f3;
    }
    .notification.info .material-icons {
        color: #2196f3;
    }
    @keyframes slide-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slide-out {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    /* Traffic light styles */
    .traffic-light {
        position: absolute;
        width: 8px;
        height: 24px;
        background-color: #333;
        border-radius: 2px;
    }
    .light {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        position: absolute;
        left: 1px;
        opacity: 0.3;
    }
    .light.active {
        opacity: 1;
        box-shadow: 0 0 5px;
    }
    .red-light {
        background-color: #f44336;
        top: 2px;
    }
    .yellow-light {
        background-color: #ffeb3b;
        top: 9px;
    }
    .green-light {
        background-color: #4caf50;
        top: 16px;
    }
    
    /* Position traffic lights around intersections */
    .tl-1-n {
        top: calc(50% - 50px);
        left: calc(25% - 12px);
    }
    .tl-1-s {
        top: calc(50% + 26px);
        left: calc(25% + 4px);
    }
    .tl-1-e {
        top: calc(50% - 12px);
        left: calc(25% + 26px);
        transform: rotate(90deg);
    }
    .tl-1-w {
        top: calc(50% + 4px);
        left: calc(25% - 34px);
        transform: rotate(90deg);
    }
    .tl-2-n {
        top: calc(50% - 50px);
        left: calc(75% - 12px);
    }
    .tl-2-s {
        top: calc(50% + 26px);
        left: calc(75% + 4px);
    }
    .tl-2-e {
        top: calc(50% - 12px);
        left: calc(75% + 26px);
        transform: rotate(90deg);
    }
    .tl-2-w {
        top: calc(50% + 4px);
        left: calc(75% - 34px);
        transform: rotate(90deg);
    }
`;
document.head.appendChild(style);
