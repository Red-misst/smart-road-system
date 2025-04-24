/**
 * Smart Road System - Styles 
 * Custom CSS for styling elements related to traffic
 */

// Custom CSS for styling elements related to traffic
export const styles = {
    // Add CSS styles here if Tailwind is not sufficient
    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .traffic-indicator {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                display: inline-block;
            }
            
            .pulse {
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0% { opacity: 0.7; }
                50% { opacity: 1; }
                100% { opacity: 0.7; }
            }
            
            .traffic-green {
                background-color: #4CAF50;
            }
            
            .traffic-yellow {
                background-color: #FFC107;
            }
            
            .traffic-red {
                background-color: #F44336;
            }
            
            .intersection-marker {
                border-radius: 50%;
                text-align: center;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 5px rgba(0,0,0,0.5);
            }
            
            .detection-box {
                position: absolute;
                border: 2px solid;
                border-radius: 2px;
                pointer-events: none;
            }
            
            .detection-label {
                position: absolute;
                top: -20px;
                left: 0;
                font-size: 12px;
                padding: 2px 4px;
                border-radius: 2px;
                color: white;
                font-weight: bold;
                white-space: nowrap;
            }
            
            .box-car { border-color: #4CAF50; }
            .box-truck { border-color: #2196F3; }
            .box-bus { border-color: #9C27B0; }
            .box-motorcycle { border-color: #FF9800; }
            .box-bicycle { border-color: #00BCD4; }
            .box-person { border-color: #F44336; }
            
            .label-car { background-color: #4CAF50; }
            .label-truck { background-color: #2196F3; }
            .label-bus { background-color: #9C27B0; }
            .label-motorcycle { background-color: #FF9800; }
            .label-bicycle { background-color: #00BCD4; }
            .label-person { background-color: #F44336; }
            
            .camera-container {
                position: relative;
                overflow: hidden;
                border-radius: 0.375rem;
                transition: transform 0.2s;
            }
            
            .camera-container:hover {
                transform: translateY(-3px);
            }
            
            .camera-feed-image {
                width: 100%;
                height: auto;
                min-height: 120px;
                background-color: #202124;
            }
            
            /* New styles for route visualization and improved mobile view */
            
            .route-highlight {
                animation: dash-animation 1s linear infinite;
            }
            
            @keyframes dash-animation {
                to {
                    stroke-dashoffset: 20;
                }
            }
            
            /* Responsive fixes for small screens */
            @media (max-width: 640px) {
                #map {
                    min-height: 300px !important;
                    height: 300px !important;
                }
                
                #cameras-section {
                    max-height: 400px;
                    overflow-y: auto;
                }
                
                #intersection-detail {
                    max-height: 450px;
                    overflow-y: auto;
                }
            }
            
            /* Better mobile navigation */
            @media (max-width: 480px) {
                .nav-content {
                    flex-direction: column;
                    align-items: flex-start;
                }
                
                .nav-right {
                    margin-top: 0.5rem;
                    width: 100%;
                    justify-content: space-between;
                }
            }
            
            /* Route path styling */
            .route-path {
                transition: all 0.3s ease;
            }
            
            .route-path:hover {
                stroke-width: 6px;
                filter: drop-shadow(0 0 3px rgba(255,255,255,0.5));
            }
        `;
        document.head.appendChild(style);
    }
};