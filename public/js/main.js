/**
 * Smart Road System - Main Application Module
 * Entry point for the traffic analysis dashboard
 */

// Global application state
const app = {
  websocket: null,
  map: null,
  detections: new Map(),
  currentSession: null
};

// WebSocket connection management
const websocket = {
  connection: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  reconnectDelay: 3000,

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}?type=browser`;

    try {
      this.connection = new WebSocket(wsUrl);
      app.websocket = this.connection;

      this.connection.onopen = () => {
        console.log("WebSocket connected");
        this.reconnectAttempts = 0;
        ui.updateConnectionStatus(true);

        //
      };

      this.connection.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.connection.onclose = () => {
        console.log("WebSocket disconnected");
        ui.updateConnectionStatus(false);
        this.attemptReconnect();
      };

      this.connection.onerror = (error) => {
        console.error("WebSocket error:", error);
        ui.updateConnectionStatus(false);
      };

      // Set binary type to arraybuffer for handling binary frames
      this.connection.binaryType = "arraybuffer";
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
      this.attemptReconnect();
    }
  },

  send(data) {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      this.connection.send(JSON.stringify(data));
    }
  },

  handleMessage(event) {
    // Handle text data (JSON)
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "detection_results":
          if (data.sessionId && data.detections) {
            const accidents = data.detections.filter(
              (d) => d.class_name === "accident"
            );
            if (accidents.length > 0) {
              routeManager.handleAlert("accident");
            }
          }
          break;
        case "session_status":
          if (data.status === "active" && !routeManager.activeRoute) {
            routeManager.createNewRoute();
          } else if (data.status === "completed") {
            routeManager.reset();
          }
          break;
        case "traffic_redirection":
          this.handleTrafficRedirection(data);
          break;

        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  },

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );

      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay);
    } else {
      console.error("Max reconnection attempts reached");
      ui.showConnectionError();
    }
  }
};

// UI management
const ui = {
  updateConnectionStatus(connected) {
  },

  updateSessionDisplay(sessionData) {
    console.log("Session status update:", sessionData);
    // Implement session status display updates
  }
};

// Event handlers
const eventHandlers = {
  init() {

    // Sidebar toggle for mobile
    const sidebarToggle = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");

    if (sidebarToggle && sidebar) {
      sidebarToggle.addEventListener("click", () => {
        sidebar.classList.toggle("hidden");
      });
    }
  }
};

// Initialize application
document.addEventListener("DOMContentLoaded", () => {
  console.log("Smart Road System - Initializing...");

  // Initialize map first
  initializeMap();

  // Initialize event handlers
  eventHandlers.init();

  // Connect WebSocket
  websocket.connect();

  console.log("Smart Road System - Initialized");
});

// Define key road intersections in Eldoret
const ELDORET_INTERSECTIONS = {
  center: [0.5167, 35.2833], // CBD
  uganda_road: [0.5142, 35.2697],
  iten_road: [0.5138, 35.271],
  kisumu_road: [0.5132, 35.2725],
  kaptagat_road: [0.5126, 35.274]
};

// Define main road networks
const ROAD_NETWORKS = {
  main_roads: [
    // Uganda Road
    [[0.5167, 35.2833], [0.5142, 35.2697]],
    // Iten Road
    [[0.5167, 35.2833], [0.5138, 35.271]],
    // Kisumu Road
    [[0.5167, 35.2833], [0.5132, 35.2725]],
    // Kaptagat Road
    [[0.5167, 35.2833], [0.5126, 35.274]]
  ],
  alternative_roads: [
    // Alternative route 1 (via residential areas)
    [[0.5167, 35.2833], [0.5155, 35.2725], [0.5142, 35.2697]],
    // Alternative route 2 (via bypass)
    [[0.5167, 35.2833], [0.5175, 35.2745], [0.5132, 35.2725]],
    // Alternative route 3 (via industrial area)
    [[0.5167, 35.2833], [0.5145, 35.2815], [0.5126, 35.274]]
  ]
};

// Route management
const routeManager = {
  activeRoute: null,
  alternativeRoute: null,
  isAlertActive: false,
  routeColors: {
    normal: "#3b82f6",
    alert: "#dc2626",
    alternative: "#16a34a"
  },

  async createNewRoute() {
    // Clear existing routes
    if (this.activeRoute) app.map.removeLayer(this.activeRoute);
    if (this.alternativeRoute) app.map.removeLayer(this.alternativeRoute);
    // Remove existing markers
    if (this.startMarker) app.map.removeLayer(this.startMarker);
    if (this.endMarker) app.map.removeLayer(this.endMarker);

    // Select a random main road
    const randomRoadIndex = Math.floor(Math.random() * ROAD_NETWORKS.main_roads.length);
    const selectedRoad = ROAD_NETWORKS.main_roads[randomRoadIndex];

    try {
      const start = selectedRoad[0];
      const end = selectedRoad[selectedRoad.length - 1];
      const routePoints = await this.getOSRMRoute(start, end);

      // Create animated route line
      this.activeRoute = L.polyline(routePoints, {
        color: this.routeColors.normal,
        weight: 5,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '10, 15',
        className: 'route-path-animation'
      }).addTo(app.map);

      // Add start marker
      this.startMarker = L.marker(routePoints[0], {
        icon: L.divIcon({
          className: 'custom-marker-icon start-marker',
          html: '<div class="marker-content"><span class="material-icons">trip_origin</span></div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(app.map);

      // Add end marker
      this.endMarker = L.marker(routePoints[routePoints.length - 1], {
        icon: L.divIcon({
          className: 'custom-marker-icon end-marker',
          html: '<div class="marker-content"><span class="material-icons">place</span></div>',
          iconSize: [30, 30],
          iconAnchor: [15, 30]
        })
      }).addTo(app.map);

      // Fit map to show the route
      app.map.fitBounds(this.activeRoute.getBounds(), { padding: [50, 50] });

      return routePoints;
    } catch (error) {
      console.error('Error creating route:', error);
      // Fallback to direct polyline if OSRM fails
      this.activeRoute = L.polyline(selectedRoad, {
        color: this.routeColors.normal,
        weight: 5,
        opacity: 0.8,
        dashArray: '10, 15',
        className: 'route-path-animation'
      }).addTo(app.map);

      // Add markers even in fallback mode
      this.startMarker = L.marker(selectedRoad[0], {
        icon: L.divIcon({
          className: 'custom-marker-icon start-marker',
          html: '<div class="marker-content"><span class="material-icons">trip_origin</span></div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(app.map);

      this.endMarker = L.marker(selectedRoad[selectedRoad.length - 1], {
        icon: L.divIcon({
          className: 'custom-marker-icon end-marker',
          html: '<div class="marker-content"><span class="material-icons">place</span></div>',
          iconSize: [30, 30],
          iconAnchor: [15, 30]
        })
      }).addTo(app.map);

      app.map.fitBounds(this.activeRoute.getBounds(), { padding: [50, 50] });
      return selectedRoad;
    }
  },

  async createAlternativeRoute(originalPoints) {
    // Find nearest alternative road based on start point
    const start = originalPoints[0];
    const end = originalPoints[originalPoints.length - 1];
    
    // Find closest alternative route
    const alternativeRoute = this.findNearestAlternativeRoute(start, end);

    try {
      // Get actual route using OSRM
      const routePoints = await this.getOSRMRoute(alternativeRoute[0], alternativeRoute[alternativeRoute.length - 1]);

      this.alternativeRoute = L.polyline(routePoints, {
        color: this.routeColors.alternative,
        weight: 5,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '10, 15',
        className: 'route-path-animation alternative-route'
      }).addTo(app.map);

      return routePoints;
    } catch (error) {
      console.error('Error creating alternative route:', error);
      // Fallback to direct polyline
      this.alternativeRoute = L.polyline(alternativeRoute, {
        color: this.routeColors.alternative,
        weight: 5,
        opacity: 0.8,
        dashArray: '10, 15',
        className: 'route-path-animation'
      }).addTo(app.map);
      return alternativeRoute;
    }
  },

  // Get actual road route using OSRM
  async getOSRMRoute(start, end) {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`
    );
    const data = await response.json();
    
    if (data.code === 'Ok' && data.routes.length > 0) {
      // Convert coordinates from [lon, lat] to [lat, lon] for Leaflet
      return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
    }
    throw new Error('No route found');
  },

  // Find nearest alternative route based on start and end points
  findNearestAlternativeRoute(start, end) {
    let nearestRoute = ROAD_NETWORKS.alternative_roads[0];
    let shortestDistance = Infinity;

    ROAD_NETWORKS.alternative_roads.forEach(route => {
      const startDistance = this.getDistance(start, route[0]);
      const endDistance = this.getDistance(end, route[route.length - 1]);
      const totalDistance = startDistance + endDistance;

      if (totalDistance < shortestDistance) {
        shortestDistance = totalDistance;
        nearestRoute = route;
      }
    });

    return nearestRoute;
  },

  // Calculate distance between two points (Haversine formula)
  getDistance(point1, point2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(point2[0] - point1[0]);
    const dLon = this.toRad(point2[1] - point1[1]);
    const lat1 = this.toRad(point1[0]);
    const lat2 = this.toRad(point2[0]);

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  },

  toRad(value) {
    return value * Math.PI / 180;
  },

  handleAlert(type) {
    if (!this.activeRoute || this.isAlertActive) return;

    this.isAlertActive = true;

    // Change original route color to red
    this.activeRoute.setStyle({ color: this.routeColors.alert });

    // Create alternative route if none exists
    if (!this.alternativeRoute) {
      const originalPoints = this.activeRoute.getLatLngs();
      this.createAlternativeRoute(originalPoints);
    }

    // Add alert to the UI
    const alertsContainer = document.getElementById("alerts-container");
    const alertDiv = document.createElement("div");
    alertDiv.className = "bg-red-50 border-l-4 border-red-500 p-4 mb-3";
    alertDiv.innerHTML = `
      <div class="flex items-center">
        <span class="material-icons text-red-500 mr-2">warning</span>
        <div>
          <h4 class="text-red-800 font-medium">${
            type === "threshold"
              ? "Traffic Threshold Exceeded"
              : "Accident Detected"
          }</h4>
          <p class="text-red-600 text-sm">Alternative route suggested</p>
        </div>
      </div>
    `;
    alertsContainer.innerHTML = ""; // Clear existing alerts
    alertsContainer.appendChild(alertDiv);
  },

  reset() {
    this.isAlertActive = false;
    if (this.activeRoute) {
      this.activeRoute.setStyle({ color: this.routeColors.normal });
    }
    if (this.alternativeRoute) {
      app.map.removeLayer(this.alternativeRoute);
      this.alternativeRoute = null;
    }
    // Remove markers
    if (this.startMarker) {
      app.map.removeLayer(this.startMarker);
      this.startMarker = null;
    }
    if (this.endMarker) {
      app.map.removeLayer(this.endMarker);
      this.endMarker = null;
    }

    // Clear alerts
    const alertsContainer = document.getElementById("alerts-container");
    alertsContainer.innerHTML = `
      <div class="flex items-center justify-center py-4 text-gray-500 text-sm">
        No alerts at this time
      </div>
    `;
  }
};


// Update the map initialization
function initializeMap() {
  const eldoretLocation = [0.5167, 35.2833];

  // Initialize the map with full functionality
  app.map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    minZoom: 12 // Restrict zoom out level
  }).setView(eldoretLocation, 15);

  // Use OpenStreetMap tile layer for better coverage of Eldoret
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(app.map);

  // Add scale control
  L.control.scale().addTo(app.map);

  // Update coordinates display on mouse move
  app.map.on("mousemove", (e) => {
    const coords = document.getElementById("map-coordinates");
    coords.textContent = `LAT: ${e.latlng.lat.toFixed(
      6
    )} LNG: ${e.latlng.lng.toFixed(6)}`;
  });



  // Route polyline
  const path = L.polyline([], {
    color: "#39ff14", // Neon green
    weight: 5,
    opacity: 0.9
  }).addTo(app.map);

  // Custom styling
  const mapStyleElement = document.createElement("style");
  mapStyleElement.textContent = `
    .leaflet-container {
      background-color: #f8f8f8;
      border: 2px solid #00cc99;
      border-radius: 12px;
      box-shadow: 0 0 15px #00ffcc;
      color: #222;
    }

    .leaflet-tile-pane {
      filter: saturate(1.1) contrast(1.05);
    }

    .leaflet-control-zoom a {
      background-color: #fff;
      color: #00aa88;
      border: 1px solid #00aa88;
    }

    .leaflet-control-zoom a:hover {
      background-color: #00aa88;
      color: #fff;
    }

    #map-coordinates {
      font-family: "Courier New", monospace;
      color: #00aa88;
      background: rgba(255, 255, 255, 0.8);
      padding: 4px 8px;
      border-radius: 6px;
      position: absolute;
      bottom: 10px;
      left: 10px;
      z-index: 999;
    }

    .route-path-animation {
      stroke-dasharray: 10, 15;
      animation: dash 30s linear infinite;
    }

    .alternative-route {
      animation: dash 30s linear infinite reverse;
    }

    .custom-marker-icon {
      background: none;
      border: none;
    }

    .marker-content {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }

    .start-marker .marker-content {
      color: #16a34a;
      filter: drop-shadow(0 0 6px rgba(22, 163, 74, 0.5));
    }

    .end-marker .marker-content {
      color: #dc2626;
      filter: drop-shadow(0 0 6px rgba(220, 38, 38, 0.5));
    }

    .start-marker .material-icons,
    .end-marker .material-icons {
      font-size: 24px;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
    }

    @keyframes dash {
      to {
        stroke-dashoffset: -50;
      }
    }
  `;
  document.head.appendChild(mapStyleElement);

  // Controls
  L.control.zoom({ position: "topright" }).addTo(app.map);
  L.control
    .attribution({ position: "bottomright", prefix: false })
    .addTo(app.map);

  // Coordinate display
  app.map.on("mousemove", (e) => {
    document.getElementById(
      "map-coordinates"
    ).innerText = `LAT: ${e.latlng.lat.toFixed(6)} LNG: ${e.latlng.lng.toFixed(
      6
    )}`;
  });

  // Add WebSocket message handler
  if (websocket.connection) {
    websocket.connection.addEventListener("message", handleWebSocketMessage);
  }

  // Map hooks
  setupMapEventListeners();
  fixMapDisplay();
}

function setupMapEventListeners() {
  document
    .getElementById("map-fullscreen-btn")
    .addEventListener("click", toggleFullscreen);
  document
    .getElementById("toggle-route-planner-btn")
    .addEventListener("click", toggleRoutePlanner);
  document
    .getElementById("close-route-planner")
    .addEventListener("click", () => {
      document.getElementById("route-planner-panel").classList.add("hidden");
    });
  document
    .getElementById("calculate-route-btn")
    .addEventListener("click", calculateAndDisplayRoute);
  document
    .getElementById("pick-start-point")
    .addEventListener("click", () => enableMapPointSelection("start"));
  document
    .getElementById("pick-end-point")
    .addEventListener("click", () => enableMapPointSelection("end"));
}

// Route planning functionality
let routeMarkers = { start: null, end: null };
let currentRoutePolyline = null;
let mapSelectionMode = null; // 'start', 'end', or null

function toggleRoutePlanner() {
  const routePlannerPanel = document.getElementById("route-planner-panel");
  routePlannerPanel.classList.toggle("hidden");

  // Populate location dropdowns with intersection names
  if (!routePlannerPanel.classList.contains("hidden")) {
    populateLocationDropdowns();
  }
}

function populateLocationDropdowns() {
  const startSelect =
    document.getElementById("start-point") || document.createElement("select");
  const endSelect =
    document.getElementById("end-point") || document.createElement("select");

  // Return if elements don't exist
  if (
    !document.getElementById("start-point") ||
    !document.getElementById("end-point")
  ) {
    console.warn("Route planner dropdown elements not found");
    return;
  }

  // Clear existing options (except the first one)
  while (startSelect.options.length > 1) startSelect.options.remove(1);
  while (endSelect.options.length > 1) endSelect.options.remove(1);

  // Add intersection options
  intersections.forEach((intersection) => {
    const startOption = document.createElement("option");
    startOption.value = `${intersection.lat},${intersection.lng}`;
    startOption.textContent = intersection.name;
    startSelect.appendChild(startOption);

    const endOption = document.createElement("option");
    endOption.value = `${intersection.lat},${intersection.lng}`;
    endOption.textContent = intersection.name;
    endSelect.appendChild(endOption);
  });

  // Set up change event listeners for dropdown selections
  startSelect.addEventListener("change", function () {
    if (this.value) {
      const [lat, lng] = this.value.split(",").map(parseFloat);
      setRoutePoint("start", [lat, lng], intersection.name);
    }
  });

  endSelect.addEventListener("change", function () {
    if (this.value) {
      const [lat, lng] = this.value.split(",").map(parseFloat);
      setRoutePoint("end", [lat, lng], intersection.name);
    }
  });
}

function enableMapPointSelection(pointType) {
  // Update selection mode
  mapSelectionMode = pointType;

  // Update cursor and show helper message
  app.map.getContainer().style.cursor = "crosshair";

  // Show a notification to the user
  const apiStatusBanner = document.getElementById("api-status-banner");
  apiStatusBanner.classList.remove("hidden", "bg-yellow-500");
  apiStatusBanner.classList.add("bg-blue-500");
  apiStatusBanner.innerHTML = `<div class="container mx-auto px-4 flex items-center justify-center gap-2">
    <span class="material-icons text-sm">place</span>
    <span>Click on the map to select ${
      pointType === "start" ? "starting point" : "destination"
    }</span>
    <button id="cancel-selection" class="ml-4 bg-white bg-opacity-20 px-2 py-1 rounded text-xs">Cancel</button>
  </div>`;

  document
    .getElementById("cancel-selection")
    .addEventListener("click", cancelMapPointSelection);

  // Add one-time click handler to the map
  app.map.once("click", function (e) {
    setRoutePoint(pointType, [e.latlng.lat, e.latlng.lng]);
    cancelMapPointSelection();
  });
}

function cancelMapPointSelection() {
  mapSelectionMode = null;
  map.getContainer().style.cursor = "";
  const apiStatusBanner = document.getElementById("api-status-banner");
  apiStatusBanner.classList.add("hidden");
}

function setRoutePoint(pointType, coordinates, name = null) {
  // Remove existing marker if any
  if (routeMarkers[pointType]) {
    app.map.removeLayer(routeMarkers[pointType]);
  }

  // Create marker icon based on point type
  const markerIcon = L.divIcon({
    className: `shadow-lg rounded-full bg-${
      pointType === "start" ? "green" : "red"
    }-600 flex items-center justify-center border-2 border-white`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<span class="material-icons" style="font-size: 16px; color: white;">
      ${pointType === "start" ? "trip_origin" : "place"}
    </span>`
  });

  // Create and add new marker
  routeMarkers[pointType] = L.marker(coordinates, {
    icon: markerIcon,
    draggable: true
  }).addTo(app.map);

  // Set popup content
  const popupContent = `<div class="font-medium p-1">
    <div class="text-${pointType === "start" ? "green" : "red"}-600 font-bold">
      ${pointType === "start" ? "Starting Point" : "Destination"}
    </div>
    ${name ? "<div class='text-gray-600 text-sm'>" + name + "</div>" : ""}
  </div>`;

  routeMarkers[pointType].bindPopup(popupContent);

  // Update dropdown selection if using a custom point
  if (!name) {
    document.getElementById(`${pointType}-point`).selectedIndex = 0;
  }

  // Event handler for when marker is dragged
  routeMarkers[pointType].on("dragend", function () {
    if (routeMarkers.start && routeMarkers.end) {
      calculateAndDisplayRoute();
    }
  });

  // If both markers are set, calculate route
  if (routeMarkers.start && routeMarkers.end) {
    calculateAndDisplayRoute();
  }
}

function calculateAndDisplayRoute() {
  // Check if both start and end points are set
  if (!routeMarkers.start || !routeMarkers.end) {
    alert("Please select both starting point and destination");
    return;
  }

  // Remove existing route if any
  if (currentRoutePolyline) {
    app.map.removeLayer(currentRoutePolyline);
  }

  // Get coordinates
  const startPoint = routeMarkers.start.getLatLng();
  const endPoint = routeMarkers.end.getLatLng();

  // Show loading indicator
  const apiStatusBanner = document.getElementById("api-status-banner");
  apiStatusBanner.classList.remove("hidden");
  apiStatusBanner.classList.add("bg-blue-500");
  apiStatusBanner.innerHTML = `<div class="container mx-auto px-4 flex items-center justify-center gap-2">
    <span class="material-icons text-sm animate-spin">sync</span>
    <span>Calculating best route...</span>
  </div>`;

  // Use OSRM API to get actual road routes
  const osrmAPI = `https://router.project-osrm.org/route/v1/driving/${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}?overview=full&geometries=geojson`;

  fetch(osrmAPI)
    .then((response) => response.json())
    .then((data) => {
      apiStatusBanner.classList.add("hidden");

      if (data.code === "Ok" && data.routes.length > 0) {
        // Get the coordinates from the route
        const routeCoordinates = data.routes[0].geometry.coordinates.map(
          (coord) => [coord[1], coord[0]]
        );

        // Create route polyline with animation effect
        currentRoutePolyline = L.polyline(routeCoordinates, {
          color: "#3b82f6",
          weight: 5,
          opacity: 0.8,
          lineCap: "round",
          lineJoin: "round",
          className: "route-path-animation"
        }).addTo(app.map);

        // Add route info
        const duration = Math.round(data.routes[0].duration / 60); // minutes
        const distance = (data.routes[0].distance / 1000).toFixed(1); // km

        currentRoutePolyline.bindTooltip(
          `
          <div class="font-medium text-sm">
            <div class="flex items-center"><span class="material-icons text-sm mr-1">schedule</span> ${duration} min</div>
            <div class="flex items-center"><span class="material-icons text-sm mr-1">straighten</span> ${distance} km</div>
          </div>
        `,
          { sticky: true }
        );

        // Fit map bounds to show the entire route
        app.map.fitBounds(currentRoutePolyline.getBounds(), {
          padding: [50, 50]
        });
      } else {
        alert("Unable to calculate route. Please try different points.");
      }
    })
    .catch((error) => {
      apiStatusBanner.classList.add("hidden");
      alert("Error calculating route: " + error.message);
    });
}

function toggleFullscreen() {
  const mapElement = document.getElementById("map");
  const isFullscreen = mapElement.classList.contains("fixed");

  if (!isFullscreen) {
    mapElement.classList.add(
      "fixed",
      "top-0",
      "left-0",
      "w-full",
      "h-full",
      "z-50"
    );
    document
      .getElementById("map-fullscreen-btn")
      .querySelector("span").textContent = "fullscreen_exit";
  } else {
    mapElement.classList.remove(
      "fixed",
      "top-0",
      "left-0",
      "w-full",
      "h-full",
      "z-50"
    );
    document
      .getElementById("map-fullscreen-btn")
      .querySelector("span").textContent = "fullscreen";
  }

  setTimeout(() => {
    app.map.invalidateSize();
  }, 100);
}

function fixMapDisplay() {
  window.addEventListener("resize", () => {
    app.map.invalidateSize();
  });

  setTimeout(() => {
    app.map.invalidateSize();
  }, 500);
}
