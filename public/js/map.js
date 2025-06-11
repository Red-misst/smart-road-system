import { updateIntersectionDetails } from './ui.js';

// Map configuration
let map;
let markers = [];
let intersections = [];

// Intersection coordinates - focusing on a small section just past Rupa Mall in Eldoret
// Updated coordinates to be precisely on the roads
const INTERSECTIONS = [
  {
    id: 'intersection-1',
    name: 'Rupa Mall Junction',
    location: [0.5252, 35.2798], // Adjusted to be exactly on the Uganda Highway road
    status: 'moderate',
    cameras: ['camera-101'],
    description: 'Main junction near Rupa Mall with Uganda Highway'
  },
  {
    id: 'intersection-2',
    name: 'Eldoret Bypass',
    location: [0.5243, 35.2875], // Adjusted to be exactly on the bypass road
    status: 'normal',
    cameras: ['camera-102'],
    description: 'Bypass intersection just past Rupa Mall'
  }
];

// Highway route coordinates for a small section past Rupa Mall - adjusted for accurate road placement
const HIGHWAY_ROUTE = [
  [0.5252, 35.2798], // Rupa Mall junction - precisely on road
  [0.5248, 35.2836], // Intermediate point on Uganda Highway - precisely on road
  [0.5243, 35.2875]  // Bypass intersection - precisely on road
];

// Initialize the map
export function initMap() {
  // Create map centered on the small section past Rupa Mall
  try {
    console.log("Initializing map...");
    // Make sure the map container exists
    const mapContainer = document.getElementById('map');
    if (!mapContainer) {
      console.error("Map container not found!");
      return null;
    }
    
    // Set explicit height to ensure visibility
    mapContainer.style.height = '500px';
    
    map = L.map('map').setView([0.5249, 35.2837], 16); // Higher zoom level (16) for small area
    
    // Add base tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    
    // Add the small highway section as a polyline
    const highwayPath = L.polyline(HIGHWAY_ROUTE, {
      color: '#4CAF50',
      weight: 5,
      opacity: 0.7
    }).addTo(map);
    
    // Add points of interest - Rupa Mall marker
    L.marker([0.5258, 35.2795]).addTo(map)
      .bindPopup("<b>Rupa Mall</b><br>Shopping center in Eldoret");
    
    // Add intersections to the map
    addIntersectionsToMap();
    
    // Update coordinates display on mouse move
    map.on('mousemove', (e) => {
      const { lat, lng } = e.latlng;
      const coordsElement = document.getElementById('map-coordinates');
      if (coordsElement) {
        coordsElement.textContent = `LAT: ${lat.toFixed(6)} LNG: ${lng.toFixed(6)}`;
      }
    });
    
    console.log("Map initialized successfully");
    return map;
  } catch (error) {
    console.error("Error initializing map:", error);
    return null;
  }
}

// Add intersection markers to the map
function addIntersectionsToMap() {
  intersections = INTERSECTIONS;
  
  intersections.forEach(intersection => {
    // Create custom icon based on traffic status
    const icon = createIntersectionIcon(intersection.status);
    
    // Create marker with popup
    const marker = L.marker(intersection.location, { icon })
      .addTo(map)
      .bindPopup(createPopupContent(intersection));
    
    // Add click handler
    marker.on('click', () => {
      showIntersectionDetails(intersection.id);
    });
    
    // Store the marker with its intersection ID
    markers.push({
      id: intersection.id,
      marker
    });
  });
}

// Create custom icon based on traffic status
function createIntersectionIcon(status) {
  const iconColor = status === 'heavy' ? '#ff3d00' :
                   status === 'moderate' ? '#ffab00' : '#4caf50';
  
  return L.divIcon({
    className: 'custom-intersection-marker',
    html: `<div style="background-color: ${iconColor}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white;"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

// Create popup content for intersection
function createPopupContent(intersection) {
  return `
    <div class="intersection-popup">
      <h3 class="font-medium text-base">${intersection.name}</h3>
      <p class="text-xs text-gray-600">${intersection.description}</p>
      <div class="mt-2">
        <button class="text-xs bg-accent-dark text-white px-2 py-1 rounded view-details" 
                data-id="${intersection.id}">
          View Details
        </button>
      </div>
    </div>
  `;
}

// Show intersection details in the panel
export function showIntersectionDetails(intersectionId) {
  const intersection = intersections.find(i => i.id === intersectionId);
  if (!intersection) return;
  
  // Display the intersection details panel
  const detailPanel = document.getElementById('intersection-detail');
  if (detailPanel) {
    detailPanel.classList.remove('hidden');
  }
  
  // Update the details in the panel
  const titleElement = document.getElementById('detail-title');
  if (titleElement) {
    titleElement.textContent = intersection.name;
  }
  
  // Set traffic density indicator
  const densityText = intersection.status === 'heavy' ? 'Heavy' : 
                      intersection.status === 'moderate' ? 'Moderate' : 'Normal';
  const densityElement = document.getElementById('detail-density');
  if (densityElement) {
    densityElement.textContent = densityText;
    densityElement.className = ''; // Clear existing classes
    densityElement.classList.add('text-xl', 'font-light');
    
    // Add color based on status
    if (intersection.status === 'heavy') {
      densityElement.classList.add('text-red-500');
    } else if (intersection.status === 'moderate') {
      densityElement.classList.add('text-yellow-500');
    } else {
      densityElement.classList.add('text-green-500');
    }
  }
  
  // Update other UI elements if they exist
  // ... existing code for camera streams and vehicle counts ...
  
  // Pass the intersection data to the UI update function if it exists
  if (typeof updateIntersectionDetails === 'function') {
    updateIntersectionDetails(intersection);
  }
}

// Update the status of an intersection marker
export function updateIntersectionStatus(intersectionId, status) {
  // Find the intersection
  const intersectionIndex = intersections.findIndex(i => i.id === intersectionId);
  if (intersectionIndex === -1) return;
  
  // Update the status
  intersections[intersectionIndex].status = status;
  
  // Find the marker
  const markerObj = markers.find(m => m.id === intersectionId);
  if (!markerObj) return;
  
  // Update the icon
  const newIcon = createIntersectionIcon(status);
  markerObj.marker.setIcon(newIcon);
  
  // Update the popup content
  markerObj.marker.setPopupContent(createPopupContent(intersections[intersectionIndex]));
}

// Close the intersection detail panel
export function closeIntersectionDetails() {
  const detailPanel = document.getElementById('intersection-detail');
  if (detailPanel) {
    detailPanel.classList.add('hidden');
  }
  
  const streamIndicator = document.getElementById('stream-indicator');
  if (streamIndicator) {
    streamIndicator.classList.add('hidden');
  }
}

// Toggle map full screen
export function toggleMapFullscreen() {
  const mapContainer = document.getElementById('map');
  if (mapContainer) {
    mapContainer.classList.toggle('fullscreen-map');
    
    // Notify the map that its container has been resized
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 100);
    }
  }
}

// Export the intersections data for use in other modules
export const getIntersections = () => intersections;
