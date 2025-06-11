// UI helper functions for the Smart Road System

// Set up UI event handlers
export function setupUI() {
  // Add document-level event delegation for dynamically added elements
  document.addEventListener('click', (event) => {
    // Handle "view-details" buttons in map popups
    if (event.target.classList.contains('view-details')) {
      const intersectionId = event.target.dataset.id;
      if (intersectionId) {
        // Import and call the function from the module where it's defined
        import('./map.js').then(mapModule => {
          mapModule.showIntersectionDetails(intersectionId);
        });
      }
    }
  });
  
  // Handle routes button click
  document.getElementById('show-routes-btn').addEventListener('click', () => {
    // Show a message about the available route between intersections
    const routeInfo = document.createElement('div');
    routeInfo.className = 'absolute top-20 right-4 bg-surface p-3 rounded-md shadow-md z-10 text-sm';
    routeInfo.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <h3 class="font-medium text-white">Rupa Mall - Bypass Route</h3>
        <button class="close-info text-gray-400 hover:text-white">&times;</button>
      </div>
      <p class="text-gray-300 mb-2">Distance: 0.7 km</p>
      <p class="text-gray-300 mb-2">Current traffic: Moderate</p>
      <div class="flex items-center">
        <span class="inline-block w-3 h-3 rounded-full bg-yellow-500 mr-2"></span>
        <span>Moderate congestion at Rupa Mall Junction</span>
      </div>
    `;
    
    document.body.appendChild(routeInfo);
    
    // Handle close button
    routeInfo.querySelector('.close-info').addEventListener('click', () => {
      routeInfo.remove();
    });
    
    // Remove after 10 seconds
    setTimeout(() => {
      if (document.body.contains(routeInfo)) {
        routeInfo.remove();
      }
    }, 10000);
  });
}

// Update intersection details in UI components
export function updateIntersectionDetails(intersection) {
    console.log("Updating UI for intersection:", intersection.id);
    
    // Update dashboard status based on selected intersection
    updateDashboardForIntersection(intersection);
    
    // Add special notes for certain intersections
    addSpecialNotes(intersection);
}

// Update dashboard stats based on selected intersection
function updateDashboardForIntersection(intersection) {
    // This would normally use actual data from your system
    // For now, just use the intersection data we have
    try {
        // Simplified example using intersection data
        document.getElementById('congested-count').textContent = 
            intersection.status === 'heavy' ? '1' : '0';
            
        document.getElementById('moderate-traffic-count').textContent = 
            intersection.status === 'moderate' ? '1' : '0';
            
        document.getElementById('normal-traffic-count').textContent = 
            intersection.status === 'normal' ? '1' : '0';
    } catch (error) {
        console.error("Error updating dashboard:", error);
    }
}

// Add special notes for certain intersections
function addSpecialNotes(intersection) {
    // Check for Rupa Mall to add special note
    if (intersection.id === 'intersection-1') { // Rupa Mall Junction
        try {
            const detailsSection = document.getElementById('intersection-detail');
            if (!detailsSection) return;
            
            // Check if the note already exists to avoid duplicates
            if (!document.getElementById('rupa-mall-note')) {
                const noteDiv = document.createElement('div');
                noteDiv.id = 'rupa-mall-note';
                noteDiv.className = 'mt-3 bg-blue-900 bg-opacity-30 p-2 rounded border-l-2 border-blue-500';
                noteDiv.innerHTML = `
                    <p class="text-xs text-blue-300">Rupa Mall Area Information</p>
                    <p class="text-xs text-gray-300">Shopping peak hours: 10:00 - 19:00</p>
                    <p class="text-xs text-gray-300">Consider using Bypass during peak hours</p>
                `;
                
                const detailsContainer = detailsSection.querySelector('.md\\:w-2\\/3');
                if (detailsContainer) {
                    detailsContainer.appendChild(noteDiv);
                }
            }
        } catch (error) {
            console.error("Error adding special notes:", error);
        }
    } else {
        // Remove the note if it exists and we're viewing a different intersection
        try {
            const existingNote = document.getElementById('rupa-mall-note');
            if (existingNote) {
                existingNote.remove();
            }
        } catch (error) {
            console.error("Error removing special notes:", error);
        }
    }
}

// Update traffic counts based on current data
function updateTrafficCounts() {
  // This would be implemented based on your data tracking
  // The map.js module already handles this in our implementation
}

// Export other UI-related functions as needed
