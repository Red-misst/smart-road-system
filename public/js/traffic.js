/**
 * Smart Road System - Traffic Module
 * Manages traffic data, road conditions, and traffic alerts
 */

import app from './app-config.js';
import { map } from './map.js';
import { ui } from './ui.js';

// Traffic management 
export const traffic = {
    // Route data for the two specific routes
    routeData: [
        { id: 'route-1', lat: 0.5142, lng: 35.2697, name: "Main Highway Route", status: "green", cameras: ['camera1'], description: "Primary route through the city center" },
        { id: 'route-2', lat: 0.5123, lng: 35.2745, name: "Alternate Bypass Route", status: "green", cameras: ['camera2'], description: "Secondary route around the city" }
    ],
    
    // Track traffic conditions for each route
    trafficConditions: {
        'route-1': { congestion: 'low', accidents: false, speed: 'normal' },
        'route-2': { congestion: 'low', accidents: false, speed: 'normal' }
    },
    
    /**
     * Initialize traffic data with route information
     */
    init() {
        this.loadIntersections(this.routeData);
        
        // Add route lines to visualize the two routes
        map.addRouteLines();
    },
    
    /**
     * Load intersection data
     */
    loadIntersections(intersections) {
        app.intersections = intersections;
        
        // Initialize traffic status for each intersection
        intersections.forEach(intersection => {
            app.trafficStatus.set(intersection.id, intersection.status);
        });
        
        // Update intersection count in UI
        ui.updateIntersectionsCount(intersections.length);
        
        // Initialize map with these intersections
        map.displayIntersections();
        
        // Update traffic statistics
        this.updateTrafficStats();
    },
    
    /**
     * Update traffic statistics in UI
     */
    updateTrafficStats() {
        let normalCount = 0;
        let moderateCount = 0;
        let heavyCount = 0;
        
        app.trafficStatus.forEach(status => {
            if (status === 'green' || status === 'low') normalCount++;
            if (status === 'yellow' || status === 'moderate') moderateCount++;
            if (status === 'red' || status === 'high') heavyCount++;
        });
        
        // Update congested count
        ui.updateCongestedCount(heavyCount);
        
        // Update traffic status counts
        document.getElementById('normal-traffic-count').textContent = normalCount;
        document.getElementById('moderate-traffic-count').textContent = moderateCount;
        document.getElementById('heavy-traffic-count').textContent = heavyCount;
    },
    
    /**
     * Handle traffic redirection message
     */
    handleRedirection(message) {
        if (!message || !message.cameraId) return;
        
        const { cameraId, status, vehicleCount, countsByType = {} } = message;
        
        // Find the route that has this camera
        const route = app.intersections.find(r => 
            r.cameras && r.cameras.includes(cameraId)
        );
        
        if (route) {
            // Update route status
            const oldStatus = route.status;
            route.status = status;
            app.trafficStatus.set(route.id, status);
            
            // Update traffic conditions
            this.updateTrafficConditions(route.id, message);
            
            // Update map marker
            map.updateMarkerStatus(route.id, status);
            
            // Check if selected route needs update
            if (app.selectedIntersection === route.id) {
                ui.updateIntersectionDetails(route);
            }
            
            // Add alert if traffic got worse
            if (this.statusGotWorse(oldStatus, status)) {
                this.addTrafficAlert(route, status, vehicleCount);
                
                // If status is moderate or high, recommend alternative route
                if (status === 'yellow' || status === 'moderate' || status === 'red' || status === 'high') {
                    this.recommendAlternativeRoute(route.id);
                }
            }
            
            // Update traffic stats
            this.updateTrafficStats();
        }
    },
    
    /**
     * Update traffic conditions based on detection results
     */
    updateTrafficConditions(routeId, data) {
        if (!this.trafficConditions[routeId]) {
            this.trafficConditions[routeId] = {
                congestion: 'low',
                accidents: false,
                speed: 'normal'
            };
        }
        
        // Update congestion based on status
        if (data.status) {
            this.trafficConditions[routeId].congestion = data.status;
        }
        
        // Check for potential accidents (sudden drop in speed or unusual vehicle positions)
        if (data.analysis && data.analysis.potential_accident) {
            this.trafficConditions[routeId].accidents = true;
            
            // Create an accident alert
            this.addAccidentAlert(routeId);
        }
        
        // Update speed based on vehicle counts and status
        if (data.status === 'high' || data.status === 'red') {
            this.trafficConditions[routeId].speed = 'slow';
        } else if (data.status === 'moderate' || data.status === 'yellow') {
            this.trafficConditions[routeId].speed = 'moderate';
        } else {
            this.trafficConditions[routeId].speed = 'normal';
        }
    },
    
    /**
     * Add an accident alert
     */
    addAccidentAlert(routeId) {
        const route = app.intersections.find(r => r.id === routeId);
        if (!route) return;
        
        const alert = {
            id: `alert-accident-${Date.now()}`,
            type: 'accident',
            title: 'Potential Accident Detected',
            message: `${route.name}: Unusual vehicle patterns detected, possible accident`,
            timestamp: new Date()
        };
        
        // Add to alerts list with priority
        app.alerts.unshift(alert);
        
        // Limit to most recent 5 alerts
        if (app.alerts.length > 5) {
            app.alerts.pop();
        }
        
        // Update alerts UI
        ui.updateAlerts();
        ui.updateAlertsCount(app.alerts.length);
        
        // Show a notification
        ui.showNotification('Potential accident detected on ' + route.name, 'error');
    },
    
    /**
     * Recommend alternative route when one route has traffic issues
     */
    recommendAlternativeRoute(problemRouteId) {
        // Find the other route that's not having issues
        const alternativeRoute = app.intersections.find(r => r.id !== problemRouteId);
        if (!alternativeRoute) return;
        
        // Only recommend if alternative route has better conditions
        const problemStatus = app.trafficStatus.get(problemRouteId);
        const alternativeStatus = app.trafficStatus.get(alternativeRoute.id);
        
        const statusRank = {
            'green': 0,
            'low': 0,
            'yellow': 1,
            'moderate': 1,
            'red': 2,
            'high': 2
        };
        
        if (statusRank[alternativeStatus] < statusRank[problemStatus]) {
            // Get the problem route object
            const problemRoute = app.intersections.find(r => r.id === problemRouteId);
            
            const alert = {
                id: `alert-reroute-${Date.now()}`,
                type: 'reroute',
                title: 'Route Change Recommended',
                message: `Traffic detected on ${problemRoute.name}. Consider using ${alternativeRoute.name} instead.`,
                timestamp: new Date()
            };
            
            // Add to alerts list
            app.alerts.unshift(alert);
            
            // Limit to most recent 5 alerts
            if (app.alerts.length > 5) {
                app.alerts.pop();
            }
            
            // Update alerts UI
            ui.updateAlerts();
            ui.updateAlertsCount(app.alerts.length);
            
            // Highlight the alternative route on the map
            map.highlightRoute(alternativeRoute.id);
        }
    },
    
    /**
     * Determine if traffic status got worse
     */
    statusGotWorse(oldStatus, newStatus) {
        const statusRank = {
            'green': 0,
            'low': 0,
            'yellow': 1,
            'moderate': 1,
            'red': 2,
            'high': 2
        };
        
        return (statusRank[newStatus] > statusRank[oldStatus]);
    },
    
    /**
     * Add traffic alert to alerts list
     */
    addTrafficAlert(route, status, vehicleCount) {
        const alertType = status === 'red' || status === 'high' ? 'traffic-high' : 'traffic-moderate';
        const alertTitle = status === 'red' || status === 'high' ? 'Heavy Traffic' : 'Moderate Traffic';
        
        const alert = {
            id: `alert-${Date.now()}`,
            type: alertType,
            title: alertTitle,
            message: `${route.name}: ${vehicleCount || 'Multiple'} vehicles detected`,
            timestamp: new Date()
        };
        
        // Add to alerts list
        app.alerts.unshift(alert);
        
        // Limit to most recent 5 alerts
        if (app.alerts.length > 5) {
            app.alerts.pop();
        }
        
        // Update alerts UI
        ui.updateAlerts();
        ui.updateAlertsCount(app.alerts.length);
    }
};