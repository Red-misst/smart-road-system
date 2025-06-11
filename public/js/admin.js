// Smart Road System - Admin Dashboard JavaScript

// DOM Elements
const currentTimeEl = document.getElementById('current-time');
const systemStatusEl = document.getElementById('system-status');
const intersectionSelect = document.getElementById('intersection-select');
const activateCamerasBtn = document.getElementById('activate-cameras');
const trafficPatternBtn = document.getElementById('traffic-pattern');
const emergencyModeBtn = document.getElementById('emergency-mode');
const autoControlBtn = document.getElementById('auto-control');
const cycleDurationInput = document.getElementById('cycle-duration');
const cycleValueEl = document.getElementById('cycle-value');
const flowRateInput = document.getElementById('flow-rate');
const flowValueEl = document.getElementById('flow-value');
const confidenceThresholdInput = document.getElementById('confidence-threshold');
const thresholdValueEl = document.getElementById('threshold-value');
const showDetectionsCheckbox = document.getElementById('show-detections');
const enableAnalyticsCheckbox = document.getElementById('enable-analytics');
const saveDataCheckbox = document.getElementById('save-data');
const systemLogEl = document.getElementById('system-log');
const clearLogBtn = document.getElementById('clear-log');
const intersectionContainer = document.getElementById('intersection-simulation');

// Traffic Light Elements
const eastWestStatusEl = document.getElementById('east-west-status');
const northSouthStatusEl = document.getElementById('north-south-status');
const eastRed = document.getElementById('east-red');
const eastYellow = document.getElementById('east-yellow');
const eastGreen = document.getElementById('east-green');
const westRed = document.getElementById('west-red');
const westYellow = document.getElementById('west-yellow');
const westGreen = document.getElementById('west-green');
const northRed = document.getElementById('north-red');
const northYellow = document.getElementById('north-yellow');
const northGreen = document.getElementById('north-green');
const southRed = document.getElementById('south-red');
const southYellow = document.getElementById('south-yellow');
const southGreen = document.getElementById('south-green');

// State
const state = {
    isAutoControl: true,
    isEmergencyMode: false,
    cycleDuration: 60,
    flowRate: 5,
    confidenceThreshold: 50,
    showDetections: true,
    enableAnalytics: true,
    saveData: true,
    currentIntersection: 'intersection-1',
    trafficLightState: 'east-west',  // 'east-west' or 'north-south'
    vehicleCount: {
        cars: 65,
        trucks: 20,
        buses: 15
    },
    hourlyTraffic: [150, 120, 90, 75, 60, 90, 200, 350, 320, 280, 220, 200, 
                   210, 230, 280, 330, 390, 360, 310, 240, 190, 170, 160, 140],
    vehicles: [],
    logs: [],
    trafficLightInterval: null
};

// Initialize the dashboard
function initDashboard() {
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    initCharts();
    setupEventListeners();
    startTrafficSimulation();
    addLog('System initialized successfully', 'success');
    addLog('Connected to simulation server', 'normal');
    addLog('Camera 1 connected to intersection', 'normal');
    addLog('Camera 2 connected to intersection', 'normal');
    addLog('Traffic pattern analysis started', 'normal');
    addLog('Traffic density increasing at Main Street intersection', 'warning');
    
    // Start traffic light cycle
    startTrafficLightCycle();
}

// Update current time
function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    currentTimeEl.textContent = timeString;
}

// Initialize charts
function initCharts() {
    // Vehicle Composition Chart
    const vehicleCtx = document.getElementById('vehicle-composition-chart').getContext('2d');
    const vehicleChart = new Chart(vehicleCtx, {
        type: 'doughnut',
        data: {
            labels: ['Cars', 'Trucks', 'Buses'],
            datasets: [{
                data: [state.vehicleCount.cars, state.vehicleCount.trucks, state.vehicleCount.buses],
                backgroundColor: ['#FF5722', '#2196F3', '#9C27B0'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#FFFFFF'
                    }
                }
            }
        }
    });
    
    // Hourly Traffic Chart
    const hourlyCtx = document.getElementById('hourly-traffic-chart').getContext('2d');
    const hourlyChart = new Chart(hourlyCtx, {
        type: 'line',
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [{
                label: 'Traffic Volume',
                data: state.hourlyTraffic,
                backgroundColor: 'rgba(76, 175, 80, 0.2)',
                borderColor: '#4CAF50',
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#4CAF50',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#AAAAAA',
                        maxRotation: 0,
                        callback: (value, index) => {
                            return index % 3 === 0 ? value : '';
                        }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#AAAAAA'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    // Intersection selection
    intersectionSelect.addEventListener('change', function() {
        state.currentIntersection = this.value;
        addLog(`Switched to ${intersectionSelect.options[intersectionSelect.selectedIndex].text}`, 'normal');
    });
    
    // Activate cameras
    activateCamerasBtn.addEventListener('click', function() {
        const btnText = this.querySelector('span:last-child');
        const cameraIcon = this.querySelector('.material-icons');
        
        if (btnText.textContent === 'Activate Cameras') {
            btnText.textContent = 'Deactivate Cameras';
            cameraIcon.textContent = 'videocam_off';
            this.classList.remove('bg-accent-dark');
            this.classList.add('bg-red-700');
            addLog('Cameras activated and streaming', 'normal');
        } else {
            btnText.textContent = 'Activate Cameras';
            cameraIcon.textContent = 'videocam';
            this.classList.remove('bg-red-700');
            this.classList.add('bg-accent-dark');
            addLog('Camera stream paused', 'warning');
        }
    });
    
    // Traffic pattern button
    trafficPatternBtn.addEventListener('click', function() {
        const patterns = ['Regular', 'Rush Hour', 'Weekend', 'Event'];
        const randomPattern = patterns[Math.floor(Math.random() * patterns.length)];
        addLog(`Traffic pattern changed to ${randomPattern} mode`, 'normal');
        
        // Update traffic density temporarily
        document.getElementById('traffic-volume').textContent = (5000 + Math.floor(Math.random() * 2000)).toLocaleString();
    });
    
    // Emergency mode button
    emergencyModeBtn.addEventListener('click', function() {
        state.isEmergencyMode = !state.isEmergencyMode;
        if (state.isEmergencyMode) {
            this.classList.remove('bg-red-700');
            this.classList.add('bg-red-600');
            this.textContent = 'Cancel Emergency';
            
            // Force east-west to green
            setTrafficLightState('east-west', true);
            
            // Stop automatic cycle
            if (state.trafficLightInterval) {
                clearInterval(state.trafficLightInterval);
                state.trafficLightInterval = null;
            }
            
            addLog('EMERGENCY MODE ACTIVATED - All traffic cleared for emergency vehicles', 'error');
        } else {
            this.classList.remove('bg-red-600');
            this.classList.add('bg-red-700');
            this.textContent = 'Emergency Mode';
            
            // Restart automatic cycle
            startTrafficLightCycle();
            
            addLog('Emergency mode deactivated - Returning to normal operation', 'normal');
        }
    });
    
    // Auto control button
    autoControlBtn.addEventListener('click', function() {
        state.isAutoControl = !state.isAutoControl;
        if (state.isAutoControl) {
            this.classList.remove('bg-blue-600');
            this.classList.add('bg-blue-700');
            this.textContent = 'Auto Control';
            startTrafficLightCycle();
            addLog('Traffic lights set to automatic control', 'normal');
        } else {
            this.classList.remove('bg-blue-700');
            this.classList.add('bg-blue-600');
            this.textContent = 'Manual Control';
            if (state.trafficLightInterval) {
                clearInterval(state.trafficLightInterval);
                state.trafficLightInterval = null;
            }
            addLog('Traffic lights set to manual control', 'warning');
        }
    });
    
    // Cycle duration slider
    cycleDurationInput.addEventListener('input', function() {
        state.cycleDuration = parseInt(this.value);
        cycleValueEl.textContent = `${state.cycleDuration}s`;
        
        if (state.isAutoControl && !state.isEmergencyMode) {
            restartTrafficLightCycle();
        }
    });
    
    // Flow rate slider
    flowRateInput.addEventListener('input', function() {
        state.flowRate = parseInt(this.value);
        const flowText = state.flowRate <= 3 ? 'Light' : state.flowRate <= 7 ? 'Medium' : 'Heavy';
        flowValueEl.textContent = flowText;
    });
    
    // Confidence threshold slider
    confidenceThresholdInput.addEventListener('input', function() {
        state.confidenceThreshold = parseInt(this.value);
        thresholdValueEl.textContent = `${state.confidenceThreshold}%`;
    });
    
    // Show detections checkbox
    showDetectionsCheckbox.addEventListener('change', function() {
        state.showDetections = this.checked;
    });
    
    // Enable analytics checkbox
    enableAnalyticsCheckbox.addEventListener('change', function() {
        state.enableAnalytics = this.checked;
        if (this.checked) {
            addLog('Traffic analytics processing enabled', 'normal');
        } else {
            addLog('Traffic analytics processing disabled', 'warning');
        }
    });
    
    // Save data checkbox
    saveDataCheckbox.addEventListener('change', function() {
        state.saveData = this.checked;
    });
    
    // Clear log button
    clearLogBtn.addEventListener('click', function() {
        systemLogEl.innerHTML = '';
        state.logs = [];
        addLog('System log cleared', 'normal');
    });
}

// Add log entry
function addLog(message, type = 'normal') {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    
    const logRow = document.createElement('tr');
    logRow.classList.add('border-b', 'border-gray-700');
    
    const timeCell = document.createElement('td');
    timeCell.classList.add('p-2', 'text-gray-500', 'w-24');
    timeCell.textContent = timeString;
    
    const messageCell = document.createElement('td');
    messageCell.classList.add('p-2');
    
    switch (type) {
        case 'success':
            messageCell.classList.add('text-green-400');
            break;
        case 'warning':
            messageCell.classList.add('text-yellow-400');
            break;
        case 'error':
            messageCell.classList.add('text-red-400');
            break;
        default:
            messageCell.classList.add('text-white');
            break;
    }
    
    messageCell.textContent = message;
    
    logRow.appendChild(timeCell);
    logRow.appendChild(messageCell);
    
    systemLogEl.prepend(logRow);
    
    // Keep log to a reasonable size
    if (systemLogEl.children.length > 100) {
        systemLogEl.removeChild(systemLogEl.lastChild);
    }
}

// Traffic light control
function startTrafficLightCycle() {
    if (state.trafficLightInterval) {
        clearInterval(state.trafficLightInterval);
    }
    
    // Initial state
    setTrafficLightState('east-west');
    
    state.trafficLightInterval = setInterval(() => {
        if (state.trafficLightState === 'east-west') {
            // Switch to north-south
            setTrafficLightState('north-south');
        } else {
            // Switch to east-west
            setTrafficLightState('east-west');
        }
    }, state.cycleDuration * 1000);
}

function restartTrafficLightCycle() {
    if (state.trafficLightInterval) {
        clearInterval(state.trafficLightInterval);
        startTrafficLightCycle();
    }
}

function setTrafficLightState(direction, isEmergency = false) {
    state.trafficLightState = direction;
    
    if (direction === 'east-west') {
        // East-West is GREEN, North-South is RED
        eastRed.classList.remove('active');
        eastYellow.classList.remove('active');
        eastGreen.classList.add('active');
        
        westRed.classList.remove('active');
        westYellow.classList.remove('active');
        westGreen.classList.add('active');
        
        northRed.classList.add('active');
        northYellow.classList.remove('active');
        northGreen.classList.remove('active');
        
        southRed.classList.add('active');
        southYellow.classList.remove('active');
        southGreen.classList.remove('active');
        
        eastWestStatusEl.textContent = 'GREEN';
        eastWestStatusEl.className = 'text-green-500 font-medium';
        
        northSouthStatusEl.textContent = 'RED';
        northSouthStatusEl.className = 'text-red-500 font-medium';
        
        if (!isEmergency) {
            addLog('Traffic flow: East-West direction GREEN', 'normal');
        }
    } else {
        // North-South is GREEN, East-West is RED
        eastRed.classList.add('active');
        eastYellow.classList.remove('active');
        eastGreen.classList.remove('active');
        
        westRed.classList.add('active');
        westYellow.classList.remove('active');
        westGreen.classList.remove('active');
        
        northRed.classList.remove('active');
        northYellow.classList.remove('active');
        northGreen.classList.add('active');
        
        southRed.classList.remove('active');
        southYellow.classList.remove('active');
        southGreen.classList.add('active');
        
        eastWestStatusEl.textContent = 'RED';
        eastWestStatusEl.className = 'text-red-500 font-medium';
        
        northSouthStatusEl.textContent = 'GREEN';
        northSouthStatusEl.className = 'text-green-500 font-medium';
        
        if (!isEmergency) {
            addLog('Traffic flow: North-South direction GREEN', 'normal');
        }
    }
}

// Traffic simulation
function startTrafficSimulation() {
    setInterval(() => {
        if (state.vehicles.length < state.flowRate * 2) {
            createRandomVehicle();
        }
        
        // Update vehicle positions
        updateVehicles();
    }, 1000);
}

function createRandomVehicle() {
    // Decide vehicle type
    const vehicleTypes = ['car', 'car', 'car', 'truck', 'bus'];
    const vehicleType = vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)];
    
    // Decide direction (1: east, 2: west, 3: north, 4: south)
    const direction = Math.floor(Math.random() * 4) + 1;
    
    // Calculate starting position based on direction
    let x, y, rotation;
    
    switch (direction) {
        case 1: // East
            x = -50;
            y = Math.random() * 30 + 180;
            rotation = 0;
            break;
        case 2: // West
            x = 450;
            y = Math.random() * 30 + 210;
            rotation = 180;
            break;
        case 3: // North
            x = Math.random() * 30 + 210;
            y = -50;
            rotation = 90;
            break;
        case 4: // South
            x = Math.random() * 30 + 180;
            y = 450;
            rotation = 270;
            break;
    }
    
    // Create vehicle object
    const vehicle = {
        id: `vehicle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: vehicleType,
        direction: direction,
        x: x,
        y: y,
        rotation: rotation,
        speed: 2 + Math.random() * 2,
        waiting: false,
        element: null
    };
    
    // Create DOM element
    const vehicleEl = document.createElement('div');
    vehicleEl.classList.add('vehicle', vehicleType);
    vehicleEl.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
    
    // Add to container
    intersectionContainer.appendChild(vehicleEl);
    vehicle.element = vehicleEl;
    
    // Add to state
    state.vehicles.push(vehicle);
}

function updateVehicles() {
    const centerX = 200;
    const centerY = 200;
    const intersectionSize = 80;
    
    state.vehicles.forEach((vehicle, index) => {
        // Check if vehicle is in the waiting zone
        const isInIntersection = (
            Math.abs(vehicle.x - centerX) < intersectionSize / 2 &&
            Math.abs(vehicle.y - centerY) < intersectionSize / 2
        );
        
        // Check if vehicle should wait at red light
        let shouldWait = false;
        
        if (!isInIntersection && !vehicle.waiting) {
            // East-West direction
            if ((vehicle.direction === 1 || vehicle.direction === 2) && state.trafficLightState === 'north-south') {
                // Check if approaching intersection
                if (vehicle.direction === 1 && vehicle.x > centerX - intersectionSize / 2 - 40 && vehicle.x < centerX - intersectionSize / 2) {
                    shouldWait = true;
                } else if (vehicle.direction === 2 && vehicle.x < centerX + intersectionSize / 2 + 40 && vehicle.x > centerX + intersectionSize / 2) {
                    shouldWait = true;
                }
            }
            
            // North-South direction
            if ((vehicle.direction === 3 || vehicle.direction === 4) && state.trafficLightState === 'east-west') {
                // Check if approaching intersection
                if (vehicle.direction === 3 && vehicle.y > centerY - intersectionSize / 2 - 40 && vehicle.y < centerY - intersectionSize / 2) {
                    shouldWait = true;
                } else if (vehicle.direction === 4 && vehicle.y < centerY + intersectionSize / 2 + 40 && vehicle.y > centerY + intersectionSize / 2) {
                    shouldWait = true;
                }
            }
        }
        
        vehicle.waiting = shouldWait;
        
        // Move vehicle if not waiting
        if (!vehicle.waiting) {
            switch (vehicle.direction) {
                case 1: // East
                    vehicle.x += vehicle.speed;
                    break;
                case 2: // West
                    vehicle.x -= vehicle.speed;
                    break;
                case 3: // North
                    vehicle.y += vehicle.speed;
                    break;
                case 4: // South
                    vehicle.y -= vehicle.speed;
                    break;
            }
            
            // Update vehicle position
            vehicle.element.style.transform = `translate(${vehicle.x}px, ${vehicle.y}px) rotate(${vehicle.rotation}deg)`;
        }
        
        // Remove vehicles that went off-screen
        if (vehicle.x < -100 || vehicle.x > 500 || vehicle.y < -100 || vehicle.y > 500) {
            if (vehicle.element && vehicle.element.parentNode) {
                vehicle.element.parentNode.removeChild(vehicle.element);
            }
            state.vehicles.splice(index, 1);
        }
    });
}

// Entry point - initialize when page loads
window.addEventListener('DOMContentLoaded', initDashboard);
