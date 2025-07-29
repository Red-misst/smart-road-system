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
  userSelectedRoute: null,
  startMarker: null,
  endMarker: null,
  isAlertActive: false,
  routeColors: {
    normal: "#3b82f6",
    alert: "#dc2626",
    alternative: "#16a34a"
  },

  async createNewRoute() {
    // Clear existing routes and markers
    if (this.activeRoute) app.map.removeLayer(this.activeRoute);
    if (this.alternativeRoute) app.map.removeLayer(this.alternativeRoute);
    if (this.startMarker) app.map.removeLayer(this.startMarker);
    if (this.endMarker) app.map.removeLayer(this.endMarker);

    let start, end;

    // Check for user-selected route points first
    if (routeMarkers && routeMarkers.start && routeMarkers.end) {
      const startLatLng = routeMarkers.start.getLatLng();
      const endLatLng = routeMarkers.end.getLatLng();
      start = [startLatLng.lat, startLatLng.lng];
      end = [endLatLng.lat, endLatLng.lng];
      this.userSelectedRoute = { start, end };
    } else {
      // Fall back to random route if no user selection
      const randomRoadIndex = Math.floor(Math.random() * ROAD_NETWORKS.main_roads.length);
      const selectedRoad = ROAD_NETWORKS.main_roads[randomRoadIndex];
      start = selectedRoad[0];
      end = selectedRoad[selectedRoad.length - 1];
      this.userSelectedRoute = null;
    }

    try {
      const routePoints = await this.getOSRMRoute(start, end);
      this.activeRoute = await this.createRouteWithPoints(routePoints);
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

  // Helper method to create route with given points
  async createRouteWithPoints(routePoints, isAlternative = false) {
    const routeColor = isAlternative ? this.routeColors.alternative : this.routeColors.normal;
    const routeLine = L.polyline(routePoints, {
      color: routeColor,
      weight: 5,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '10, 15',
      className: `route-path-animation ${isAlternative ? 'alternative-route' : ''}`
    }).addTo(app.map);

    if (!isAlternative) {
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
      app.map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
    }

    return routeLine;
  },

async createAlternativeRoute(originalPoints) {
    if (!this.activeRoute) return;

    // Get start and end points from the active route
    const routePoints = this.activeRoute.getLatLngs();
    const start = routePoints[0];
    const end = routePoints[routePoints.length - 1];

    try {
      // Ensure we have valid coordinates for the OSRM API
      const startCoords = start.hasOwnProperty('lng') ? [start.lng, start.lat] : [start[1], start[0]];
      const endCoords = end.hasOwnProperty('lng') ? [end.lng, end.lat] : [end[1], end[0]];

      // For user-selected routes, use OSRM alternatives API
      if (this.userSelectedRoute) {
        // Remove existing alternative route if any
        if (this.alternativeRoute) {
          app.map.removeLayer(this.alternativeRoute);
        }

        try {
          // Request alternative routes from OSRM
          const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}?overview=full&geometries=geojson&alternatives=3`
          );
          const data = await response.json();

          if (data.code === 'Ok' && data.routes.length > 1) {
            // Get coordinates of the current active route for comparison
            const activeRouteCoords = this.activeRoute.getLatLngs().map(point => [point.lat, point.lng]);
            
            // Find the most different alternative route
            let selectedRoute = null;
            let maxDifference = 0;

            for (let i = 1; i < data.routes.length; i++) {
              const route = data.routes[i];
              const routeCoords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
              
              // Skip if identical to active route
              const isIdentical = JSON.stringify(routeCoords) === JSON.stringify(activeRouteCoords);
              if (isIdentical) continue;

              // Calculate route difference score
              const distDiff = Math.abs(route.distance - data.routes[0].distance) / data.routes[0].distance;
              const timeDiff = Math.abs(route.duration - data.routes[0].duration) / data.routes[0].duration;
              const difference = distDiff + timeDiff;

              if (difference > maxDifference) {
                maxDifference = difference;
                selectedRoute = route;
              }
            }

            if (selectedRoute) {
              const alternativeRoutePoints = selectedRoute.geometry.coordinates.map(coord => [coord[1], coord[0]]);
              this.alternativeRoute = await this.createRouteWithPoints(alternativeRoutePoints, true);

              // Add route info tooltip with actual duration and distance
              const duration = Math.round(selectedRoute.duration / 60); // minutes
              const distance = (selectedRoute.distance / 1000).toFixed(1); // km

              this.alternativeRoute.bindTooltip(
                `<div class="font-medium text-sm">
                  <div class="text-green-600">Alternative Route</div>
                  <div class="flex items-center"><span class="material-icons text-sm mr-1">schedule</span> ${duration} min</div>
                  <div class="flex items-center"><span class="material-icons text-sm mr-1">straighten</span> ${distance} km</div>
                </div>`,
                { sticky: true }
              );

              return alternativeRoutePoints;
            }
          }
          
          // If no alternative found from OSRM, fall back to manual route
          return this.createManualAlternativeRoute(startCoords, endCoords);
        } catch (error) {
          console.error('Error getting OSRM alternative routes:', error);
          return this.createManualAlternativeRoute(startCoords, endCoords);
        }
      } else {
        // Original logic for random routes
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}?overview=full&geometries=geojson&alternatives=3`
        );
        const data = await response.json();

        if (data.code === 'Ok' && data.routes.length > 0) {
          // Remove existing alternative route if any
          if (this.alternativeRoute) {
            app.map.removeLayer(this.alternativeRoute);
          }

          // Exclude the original route and find the most different alternative
          const originalRouteCoords = this.activeRoute.getLatLngs().map(point => [point.lat, point.lng]);
          let selectedRoute = null;
          let maxDifference = 0;

          for (let i = 1; i < data.routes.length; i++) {
            const route = data.routes[i];
            const routeCoords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

            // Check if the route is identical to the original route
            const isIdentical = JSON.stringify(routeCoords) === JSON.stringify(originalRouteCoords);
            if (isIdentical) continue;

            // Calculate how different this route is based on distance and duration
            const distDiff = Math.abs(route.distance - data.routes[0].distance) / data.routes[0].distance;
            const timeDiff = Math.abs(route.duration - data.routes[0].duration) / data.routes[0].duration;
            const difference = distDiff + timeDiff;

            if (difference > maxDifference) {
              maxDifference = difference;
              selectedRoute = route;
            }
          }

          // If no distinct route is found, fallback to the second route
          if (!selectedRoute && data.routes.length > 1) {
            selectedRoute = data.routes[1];
          }

          if (selectedRoute) {
            const alternativeRoutePoints = selectedRoute.geometry.coordinates.map(coord => [coord[1], coord[0]]);

            // Create new alternative route using helper method
            this.alternativeRoute = await this.createRouteWithPoints(alternativeRoutePoints, true);

            // Add route info tooltip using the selected route's data
            const duration = Math.round(selectedRoute.duration / 60); // minutes
            const distance = (selectedRoute.distance / 1000).toFixed(1); // km

            this.alternativeRoute.bindTooltip(
              `<div class="font-medium text-sm">
                <div class="text-green-600">Alternative Route</div>
                <div class="flex items-center"><span class="material-icons text-sm mr-1">schedule</span> ${duration} min</div>
                <div class="flex items-center"><span class="material-icons text-sm mr-1">straighten</span> ${distance} km</div>
              </div>`,
              { sticky: true }
            );

            return alternativeRoutePoints;
          } else {
            console.error('No distinct alternative route found');
            return null;
          }
        } else {
          console.error('No routes found from OSRM service');
          return null;
        }
      }
    } catch (error) {
      console.error('Error creating alternative route:', error);
      return null;
    }
  },

  // Find best alternative road from predefined networks
  findBestAlternativeRoad(startCoords, endCoords) {
    const startLat = startCoords[1];
    const startLng = startCoords[0];
    const endLat = endCoords[1];
    const endLng = endCoords[0];
    
    let bestRoute = null;
    let minTotalDistance = Infinity;
    
    // Check all alternative roads
    for (const alternativeRoad of ROAD_NETWORKS.alternative_roads) {
      const roadStart = alternativeRoad[0];
      const roadEnd = alternativeRoad[alternativeRoad.length - 1];
      
      // Calculate distance from user points to road endpoints
      const startToRoadStart = Math.sqrt(
        Math.pow(startLat - roadStart[0], 2) + Math.pow(startLng - roadStart[1], 2)
      );
      const endToRoadEnd = Math.sqrt(
        Math.pow(endLat - roadEnd[0], 2) + Math.pow(endLng - roadEnd[1], 2)
      );
      
      // Also check reverse direction
      const startToRoadEnd = Math.sqrt(
        Math.pow(startLat - roadEnd[0], 2) + Math.pow(startLng - roadEnd[1], 2)
      );
      const endToRoadStart = Math.sqrt(
        Math.pow(endLat - roadStart[0], 2) + Math.pow(endLng - roadStart[1], 2)
      );
      
      // Choose the better orientation
      const normalDirection = startToRoadStart + endToRoadEnd;
      const reverseDirection = startToRoadEnd + endToRoadStart;
      
      if (normalDirection < reverseDirection && normalDirection < minTotalDistance) {
        minTotalDistance = normalDirection;
        bestRoute = [
          [startLat, startLng],
          ...alternativeRoad,
          [endLat, endLng]
        ];
      } else if (reverseDirection < minTotalDistance) {
        minTotalDistance = reverseDirection;
        bestRoute = [
          [startLat, startLng],
          ...alternativeRoad.slice().reverse(),
          [endLat, endLng]
        ];
      }
    }
    
    // If no good direct alternative, try connecting through intersections
    if (!bestRoute || minTotalDistance > 0.02) {
      bestRoute = this.createIntersectionBasedRoute(startLat, startLng, endLat, endLng);
    }
    
    return bestRoute;
  },

  // Create route through intersections
  createIntersectionBasedRoute(startLat, startLng, endLat, endLng) {
    const intersectionValues = Object.values(ELDORET_INTERSECTIONS);
    
    // Find two different intersections to route through
    let midIntersection1 = intersectionValues[1]; // uganda_road
    let midIntersection2 = intersectionValues[2]; // iten_road
    
    // Create a route that goes through alternative intersections
    return [
      [startLat, startLng],
      midIntersection1,
      midIntersection2,
      ELDORET_INTERSECTIONS.center,
      [endLat, endLng]
    ];
  },

  // Calculate polyline distance
  calculatePolylineDistance(polyline) {
    let totalDistance = 0;
    for (let i = 0; i < polyline.length - 1; i++) {
      const lat1 = polyline[i][0];
      const lng1 = polyline[i][1];
      const lat2 = polyline[i + 1][0];
      const lng2 = polyline[i + 1][1];
      
      // Haversine formula for distance calculation
      const R = 6371; // Earth's radius in kilometers
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      totalDistance += R * c;
    }
    return totalDistance;
  },

  // Create manual alternative route when OSRM fails - using predefined road polylines
  async createManualAlternativeRoute(startCoords, endCoords) {
    const startLat = startCoords[1];
    const startLng = startCoords[0];
    const endLat = endCoords[1];
    const endLng = endCoords[0];
    
    // Find the closest alternative road network from ROAD_NETWORKS
    let bestAlternativeRoute = null;
    let minDistance = Infinity;
    
    // Check each alternative road in ROAD_NETWORKS
    for (const alternativeRoad of ROAD_NETWORKS.alternative_roads) {
      const roadStart = alternativeRoad[0];
      const roadEnd = alternativeRoad[alternativeRoad.length - 1];
      
      // Calculate distance from user points to this road's endpoints
      const startDistance = Math.sqrt(
        Math.pow(startLat - roadStart[0], 2) + Math.pow(startLng - roadStart[1], 2)
      );
      const endDistance = Math.sqrt(
        Math.pow(endLat - roadEnd[0], 2) + Math.pow(endLng - roadEnd[1], 2)
      );
      
      const totalDistance = startDistance + endDistance;
      
      if (totalDistance < minDistance) {
        minDistance = totalDistance;
        bestAlternativeRoute = alternativeRoad;
      }
    }
    
    // If no good alternative found, create a composite route using multiple road segments
    if (!bestAlternativeRoute || minDistance > 0.02) {
      // Try to connect user points through existing road intersections
      const nearestStartIntersection = this.findNearestIntersection([startLat, startLng]);
      const nearestEndIntersection = this.findNearestIntersection([endLat, endLng]);
      
      if (nearestStartIntersection && nearestEndIntersection) {
        // Create route: user start -> nearest intersection -> alternative intersection -> user end
        const alternativeIntersection = this.findAlternativeIntersection(nearestStartIntersection, nearestEndIntersection);
        
        bestAlternativeRoute = [
          [startLat, startLng],
          nearestStartIntersection,
          alternativeIntersection,
          nearestEndIntersection,
          [endLat, endLng]
        ];
      } else {
        // Last resort: use one of the predefined alternative roads
        bestAlternativeRoute = ROAD_NETWORKS.alternative_roads[0];
      }
    }

    // Remove existing alternative route if any
    if (this.alternativeRoute) {
      app.map.removeLayer(this.alternativeRoute);
    }

    // Create the alternative route using the selected road polyline
    this.alternativeRoute = L.polyline(bestAlternativeRoute, {
      color: this.routeColors.alternative,
      weight: 5,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '10, 15',
      className: 'route-path-animation alternative-route'
    }).addTo(app.map);

    this.alternativeRoute.bindTooltip(
      `<div class="font-medium text-sm">
        <div class="text-green-600">Alternative Route</div>
        <div class="text-xs text-gray-500">Via alternative roads</div>
      </div>`,
      { sticky: true }
    );

    return bestAlternativeRoute;
  },

  // Helper method to find nearest intersection
  findNearestIntersection(point) {
    let nearestIntersection = null;
    let minDistance = Infinity;
    
    Object.values(ELDORET_INTERSECTIONS).forEach(intersection => {
      const distance = Math.sqrt(
        Math.pow(point[0] - intersection[0], 2) + Math.pow(point[1] - intersection[1], 2)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestIntersection = intersection;
      }
    });
    
    return nearestIntersection;
  },

  // Helper method to find alternative intersection for routing
  findAlternativeIntersection(startIntersection, endIntersection) {
    const intersections = Object.values(ELDORET_INTERSECTIONS);
    
    // Find an intersection that's not the start or end intersection
    for (const intersection of intersections) {
      if (intersection !== startIntersection && intersection !== endIntersection) {
        return intersection;
      }
    }
    
    // Fallback to center if no alternative found
    return ELDORET_INTERSECTIONS.center;
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
    this.userSelectedRoute = null;

    // Clear routes
    if (this.activeRoute) {
      this.activeRoute.setStyle({ color: this.routeColors.normal });
      app.map.removeLayer(this.activeRoute);
      this.activeRoute = null;
    }
    if (this.alternativeRoute) {
      app.map.removeLayer(this.alternativeRoute);
      this.alternativeRoute = null;
    }
    
    // Clear markers
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
      animation: dash 8s linear infinite;
    }

    .alternative-route {
      animation: dash 8s linear infinite reverse;
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
