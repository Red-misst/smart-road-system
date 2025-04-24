/**
 * Smart Road System - Map Module
 * Manages the Leaflet map visualization and route display
 */

import app from './app-config.js';
import { ui } from './ui.js';

// Map management
export const map = {
    // Store route lines
    routeLines: {},
    activeRoutes: {},
    
    /**
     * Initialize the map
     */
    init() {
        // Create Leaflet map with responsive options
        app.map = L.map('map', {
            zoomControl: false, // We'll add zoom control in better position for mobile
            attributionControl: false // We'll add attribution in better position
        }).setView([0.5132, 35.2712], 14); // Default to center view of both routes
        
        // Medium-dark gray style with emphasized roads/paths and cleaner UI
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '', // Remove from map view
            maxZoom: 19
        }).addTo(app.map);
        
        // Add zoom control to top-right instead of top-left (better for mobile)
        L.control.zoom({
            position: 'topright'
        }).addTo(app.map);
        
        // Add attribution to bottom-right but with better styling
        L.control.attribution({
            position: 'bottomright',
            prefix: false
        }).addTo(app.map);
        
        // Update coordinates display
        app.map.on('mousemove', (e) => {
            document.getElementById('map-coordinates').innerText = 
                `LAT: ${e.latlng.lat.toFixed(6)} LNG: ${e.latlng.lng.toFixed(6)}`;
        });
        
        // Fix map display issue on page load and resize
        this.fixMapDisplay();
        
        // Setup event listeners
        this.setupEventListeners();
    },
    
    /**
     * Fix map display issues on small screens
     */
    fixMapDisplay() {
        // Make sure map properly adjusts to container
        window.addEventListener('resize', () => {
            app.map.invalidateSize();
            
            // For small screens, adjust map height to ensure visibility
            this.adjustMapHeight();
        });
        
        // Initial adjustment
        this.adjustMapHeight();
        
        // Also trigger a resize after a short delay to handle initial rendering
        setTimeout(() => {
            app.map.invalidateSize();
        }, 500);
    },
    
    /**
     * Adjust map height based on screen size
     */
    adjustMapHeight() {
        const mapElement = document.getElementById('map');
        const screenWidth = window.innerWidth;
        
        if (screenWidth < 768) {
            // On small screens, set fixed height to ensure visibility
            mapElement.style.minHeight = '300px';
        } else {
            // On larger screens, use flexible height
            mapElement.style.minHeight = '400px';
        }
    },
    
    /**
     * Setup map-related event listeners
     */
    setupEventListeners() {
        document.getElementById('map-fullscreen-btn').addEventListener('click', () => {
            this.toggleFullscreen();
        });
        
        document.getElementById('show-cameras-btn').addEventListener('click', () => {
            ui.toggleCamerasSection();
        });
        
        document.getElementById('show-routes-btn').addEventListener('click', () => {
            this.toggleRouteLines();
        });
    },
    
    /**
     * Toggle route lines visibility
     */
    toggleRouteLines() {
        const routeVisible = !this.activeRoutes.visible;
        this.activeRoutes.visible = routeVisible;
        
        // Show/hide route lines
        Object.values(this.routeLines).forEach(line => {
            if (routeVisible) {
                if (!app.map.hasLayer(line)) {
                    app.map.addLayer(line);
                }
            } else {
                if (app.map.hasLayer(line)) {
                    app.map.removeLayer(line);
                }
            }
        });
        
        // Update button text
        const btn = document.getElementById('show-routes-btn');
        if (btn) {
            btn.innerHTML = routeVisible ? 
                '<span class="material-icons text-sm mr-1">visibility_off</span> Hide Routes' :
                '<span class="material-icons text-sm mr-1">alt_route</span> Show Routes';
        }
    },
    
    /**
     * Add route lines to visualize the two routes
     */
    addRouteLines() {
        // Define route coordinates - this would ideally come from a real routing API
        // For now, we're using mock data to show two different routes
        
        // Main Highway Route (red)
        const route1Coords = [
            [0.5142, 35.2697], // Start point
            [0.5138, 35.2710],
            [0.5132, 35.2725],
            [0.5126, 35.2740],
            [0.5123, 35.2755] // End point
        ];
        
        // Alternate Bypass Route (green)
        const route2Coords = [
            [0.5142, 35.2697], // Same start point
            [0.5150, 35.2710],
            [0.5155, 35.2725],
            [0.5145, 35.2740],
            [0.5123, 35.2755] // Same end point
        ];
        
        // Create polylines for the routes
        const route1Line = L.polyline(route1Coords, {
            color: '#e53e3e', // Red color for main route
            weight: 4,
            opacity: 0.8,
            dashArray: null
        });
        
        const route2Line = L.polyline(route2Coords, {
            color: '#38a169', // Green color for alternate route
            weight: 4,
            opacity: 0.8,
            dashArray: null
        });
        
        // Add markers for start and end points
        const startMarker = L.marker(route1Coords[0], {
            icon: L.divIcon({
                className: 'intersection-marker bg-blue-500',
                iconSize: [12, 12],
                html: '<span style="font-size: 10px; color: white;">S</span>'
            })
        }).addTo(app.map);
        
        const endMarker = L.marker(route1Coords[route1Coords.length - 1], {
            icon: L.divIcon({
                className: 'intersection-marker bg-purple-500',
                iconSize: [12, 12],
                html: '<span style="font-size: 10px; color: white;">E</span>'
            })
        }).addTo(app.map);
        
        // Store the route lines
        this.routeLines = {
            'route-1': route1Line,
            'route-2': route2Line
        };
        
        // Add to map but hide initially
        route1Line.addTo(app.map);
        route2Line.addTo(app.map);
        
        // Hide routes initially
        this.activeRoutes = { visible: true };
        this.toggleRouteLines();
    },
    
    /**
     * Toggle fullscreen map view
     */
    toggleFullscreen() {
        const mapElement = document.getElementById('map');
        app.fullScreenMode = !app.fullScreenMode;
        
        if (app.fullScreenMode) {
            mapElement.classList.add('fixed', 'top-0', 'left-0', 'w-full', 'h-full', 'z-50');
            document.getElementById('map-fullscreen-btn').querySelector('span').textContent = 'fullscreen_exit';
        } else {
            mapElement.classList.remove('fixed', 'top-0', 'left-0', 'w-full', 'h-full', 'z-50');
            document.getElementById('map-fullscreen-btn').querySelector('span').textContent = 'fullscreen';
        }
        
        // Invalidate map size to ensure it renders properly
        setTimeout(() => {
            app.map.invalidateSize();
        }, 100);
    },
    
    /**
     * Display intersections on the map
     */
    displayIntersections() {
        // Clear existing markers
        app.markers.forEach(marker => {
            app.map.removeLayer(marker);
        });
        app.markers.clear();
        
        // Add markers for each intersection
        app.intersections.forEach(intersection => {
            this.addIntersectionMarker(intersection);
        });
    },
    
    /**
     * Add a marker for an intersection
     */
    addIntersectionMarker(intersection) {
        const icon = this.createIntersectionIcon(intersection.status);
        
        const marker = L.marker([intersection.lat, intersection.lng], {
            icon,
            title: intersection.name
        }).addTo(app.map);
        
        // Add popup
        marker.bindPopup(this.createIntersectionPopup(intersection));
        
        // Add click handler
        marker.on('click', () => {
            app.selectedIntersection = intersection.id;
            ui.updateIntersectionDetails(intersection);
        });
        
        // Store marker
        app.markers.set(intersection.id, marker);
    },
    
    /**
     * Create a custom icon for an intersection based on status
     */
    createIntersectionIcon(status) {
        const statusClass = status === 'red' || status === 'high' ? 'traffic-red' : 
                           (status === 'yellow' || status === 'moderate' ? 'traffic-yellow' : 'traffic-green');
        
        return L.divIcon({
            className: `intersection-marker ${statusClass}`,
            iconSize: [24, 24],
            html: '<span class="material-icons" style="font-size: 14px; color: white;">traffic</span>'
        });
    },
    
    /**
     * Create popup content for an intersection
     */
    createIntersectionPopup(intersection) {
        return `
            <div>
                <div class="font-medium text-gray-100">${intersection.name}</div>
                <div class="mt-2 text-sm">
                    <div class="flex items-center mb-1">
                        <span class="material-icons mr-1" style="font-size: 14px;">info</span>
                        <span>Status: ${intersection.status.toUpperCase()}</span>
                    </div>
                    <div class="flex items-center">
                        <span class="material-icons mr-1" style="font-size: 14px;">videocam</span>
                        <span>Camera: ${intersection.cameras ? intersection.cameras[0] : 'None'}</span>
                    </div>
                </div>
                <button class="bg-accent-green text-white px-3 py-1 mt-3 text-xs rounded-full view-details" 
                        data-id="${intersection.id}">View Details</button>
            </div>
        `;
    },
    
    /**
     * Update the status of a marker
     */
    updateMarkerStatus(intersectionId, status) {
        const marker = app.markers.get(intersectionId);
        if (!marker) return;
        
        // Update marker icon
        marker.setIcon(this.createIntersectionIcon(status));
        
        // Update popup if needed
        const intersection = app.intersections.find(i => i.id === intersectionId);
        if (intersection) {
            intersection.status = status;
            marker.setPopupContent(this.createIntersectionPopup(intersection));
        }
    },
    
    /**
     * Highlight a route on the map
     */
    highlightRoute(routeId) {
        const routeLine = this.routeLines[routeId];
        if (!routeLine) return;
        
        // Make sure route is visible
        if (!this.activeRoutes.visible) {
            this.toggleRouteLines();
        }
        
        // Animate the route line
        if (routeLine._path) {
            routeLine._path.classList.add('route-highlight');
            
            // Pulse animation for the recommended route
            routeLine.setStyle({ 
                weight: 5,
                dashArray: '10, 10',
                opacity: 1
            });
            
            // Create animation
            const animateRoute = () => {
                if (routeLine._path && routeLine._path.classList.contains('route-highlight')) {
                    const currentDashOffset = parseInt(routeLine._path.getAttribute('stroke-dashoffset') || 0);
                    routeLine._path.setAttribute('stroke-dashoffset', (currentDashOffset - 1) % 20);
                    requestAnimationFrame(animateRoute);
                }
            };
            
            // Start animation
            routeLine._path.setAttribute('stroke-dasharray', '10, 10');
            routeLine._path.setAttribute('stroke-dashoffset', '0');
            requestAnimationFrame(animateRoute);
            
            // Reset after 10 seconds
            setTimeout(() => {
                if (routeLine._path) {
                    routeLine._path.classList.remove('route-highlight');
                    routeLine.setStyle({
                        weight: 4,
                        dashArray: null,
                        opacity: 0.8
                    });
                }
            }, 10000);
        }
        
        // Pan to show the route
        const bounds = routeLine.getBounds();
        app.map.fitBounds(bounds, { 
            padding: [50, 50],
            animate: true
        });
    }
};