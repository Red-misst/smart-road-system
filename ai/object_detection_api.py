"""
Traffic Detection API using FastAPI, WebSockets and YOLOv8
This module provides a real-time traffic detection service with 
WebSocket support for smoother communication with the Node.js server.
"""

import base64
import io
import json
import os
import time
from typing import Dict, List, Optional
from contextlib import asynccontextmanager
import logging

import cv2
import numpy as np
import uvicorn
import asyncio
import websockets
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ultralytics import YOLO
from dotenv import load_dotenv

# --- Object Tracking for Duplicate Prevention ---

class ObjectTracker:
    """
    Tracks objects across frames to prevent duplicate counting.
    Uses IoU (Intersection over Union) to associate detections across frames.
    """
    def __init__(self, iou_threshold=0.3, max_age=30, min_hits=3):
        self.next_id = 1
        self.tracked_objects = {}  # id -> object info
        self.object_history = {}   # id -> historical positions
        self.iou_threshold = iou_threshold
        self.max_age = max_age     # Max frames to keep without matching
        self.min_hits = min_hits   # Min detections to confirm as real object
        self.counted_objects = {}  # Objects already counted for statistics
        self.last_cleanup = time.time()
        self.cleanup_interval = 60  # Cleanup old objects every 60 seconds

    def cleanup_old_objects(self, force=False):
        """Remove old objects that haven't been seen for a while"""
        now = time.time()
        if not force and now - self.last_cleanup < self.cleanup_interval:
            return
            
        self.last_cleanup = now
        current_frame_id = max([obj.get('last_frame', 0) for obj in self.tracked_objects.values()]) if self.tracked_objects else 0
        
        # Remove objects that haven't been seen for max_age frames
        ids_to_remove = []
        for obj_id, obj in self.tracked_objects.items():
            if current_frame_id - obj.get('last_frame', 0) > self.max_age:
                ids_to_remove.append(obj_id)
                
        for obj_id in ids_to_remove:
            del self.tracked_objects[obj_id]
            if obj_id in self.object_history:
                del self.object_history[obj_id]

    def calculate_iou(self, box1, box2):
        """Calculate IoU between two bounding boxes [x1, y1, x2, y2]"""
        # Calculate intersection area
        x1 = max(box1[0], box2[0])
        y1 = max(box1[1], box2[1])
        x2 = min(box1[2], box2[2])
        y2 = min(box1[3], box2[3])
        
        if x2 < x1 or y2 < y1:
            return 0.0
            
        intersection_area = (x2 - x1) * (y2 - y1)
        
        # Calculate union area
        box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
        box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
        union_area = box1_area + box2_area - intersection_area
        
        if union_area == 0:
            return 0.0
            
        return intersection_area / union_area

    def update(self, detections, frame_id, image_shape):
        """
        Update tracked objects with new detections.
        Returns filtered detections with tracking IDs.
        """
        # Denormalize bounding boxes if they're normalized
        h, w = image_shape[:2]
        for det in detections:
            if max(det["bbox"]) <= 1.0:  # If normalized
                x1, y1, x2, y2 = det["bbox"]
                det["bbox"] = [x1 * w, y1 * h, x2 * w, y2 * h]
        
        # Match new detections to existing objects using IoU
        matched_indices = []
        unmatched_detections = []
        
        # For each detection, find best matching tracked object
        for det_idx, detection in enumerate(detections):
            best_iou = self.iou_threshold
            best_match = None
            
            for obj_id, tracked_obj in self.tracked_objects.items():
                if tracked_obj['class_name'] != detection['class_name']:
                    continue  # Only match same class
                    
                iou = self.calculate_iou(tracked_obj['bbox'], detection['bbox'])
                if iou > best_iou:
                    best_iou = iou
                    best_match = obj_id
                    
            if best_match is not None:
                # Update existing object
                self.tracked_objects[best_match]['bbox'] = detection['bbox']
                self.tracked_objects[best_match]['confidence'] = detection['confidence']
                self.tracked_objects[best_match]['last_frame'] = frame_id
                self.tracked_objects[best_match]['hits'] += 1
                
                # Update object history
                if best_match not in self.object_history:
                    self.object_history[best_match] = []
                self.object_history[best_match].append(detection['bbox'])
                
                # Add tracking ID to detection
                detection['tracking_id'] = best_match
                matched_indices.append(det_idx)
            else:
                unmatched_detections.append(det_idx)
                
        # Create new tracked objects for unmatched detections
        for det_idx in unmatched_detections:
            detection = detections[det_idx]
            new_id = self.next_id
            self.next_id += 1
            
            self.tracked_objects[new_id] = {
                'bbox': detection['bbox'],
                'class_name': detection['class_name'],
                'confidence': detection['confidence'],
                'first_frame': frame_id,
                'last_frame': frame_id,
                'hits': 1
            }
            
            # Initialize history for the new object
            self.object_history[new_id] = [detection['bbox']]
            
            # Add tracking ID to detection
            detection['tracking_id'] = new_id
            
        # Clean up old objects periodically
        self.cleanup_old_objects()
            
        # Return filtered detections (only those with min_hits to avoid false positives)
        filtered_detections = []
        for det in detections:
            obj_id = det.get('tracking_id')
            if obj_id and self.tracked_objects[obj_id]['hits'] >= self.min_hits:
                # Mark this object as counted for statistics
                if obj_id not in self.counted_objects:
                    self.counted_objects[obj_id] = {
                        'class_name': det['class_name'],
                        'first_seen': time.time()
                    }
                filtered_detections.append(det)
                
        return filtered_detections
    
    def get_statistics(self):
        """Get statistics about counted objects"""
        # Count by class
        counts = {}
        for obj_id, obj_info in self.counted_objects.items():
            class_name = obj_info['class_name']
            if class_name not in counts:
                counts[class_name] = 0
            counts[class_name] += 1
            
        return {
            'total_objects': len(self.counted_objects),
            'counts_by_type': counts,
            'active_tracks': len(self.tracked_objects)
        }

# Create a global tracker instance for each camera
camera_trackers = {}

# --- Models & Data Classes ---

class DetectionRequest(BaseModel):
    """Request model for object detection endpoint."""
    image: str  # Base64 encoded JPEG image
    confidence: Optional[float] = 0.01  # Default confidence threshold (lowered for poor frames)
    max_det: Optional[int] = 100  # Maximum detections per image
    
class DetectionResult(BaseModel):
    """Individual detection result."""
    class_id: int
    class_name: str
    confidence: float
    bbox: List[float]  # [x1, y1, x2, y2] normalized coordinates

class DetectionResponse(BaseModel):
    """Response model for object detection endpoint."""
    detections: List[DetectionResult]
    inference_time: float
    total_time: float
    timestamp: float
    image_size: List[int]  # [height, width]

# --- Global variables ---

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("traffic-ai")

# Model will be loaded on first request (lazy loading)
model = None
model_path = "custom.pt"  # Use custom model
class_names = ["car", "accident"]  # Will be populated from model
traffic_classes = ['car', 'accident']  # Only track car and accident

# WebSocket connection to Node.js server 
ws_connection = None

# Load environment variables
load_dotenv()

# Determine environment
is_production = os.getenv("NODE_ENV") == "production"

# Configure WebSocket connection based on environment
if is_production:
    node_server_url = os.getenv("NODE_SERVER_URL_PRODUCTION", "wss://smart-road-system.onrender.com") + "/?type=ai"
else:
    node_server_url = os.getenv("NODE_SERVER_URL_LOCAL", "ws://localhost:3000") + "/?type=ai"

# For server port
port = int(os.getenv("PORT", 8000))

# --- Helper Functions ---

def get_model():
    """Lazy load the model only when needed."""
    global model, class_names
    if model is None:
        logger.info(f"Loading YOLO model from {model_path}")
        model = YOLO(model_path)
        class_names = model.names if hasattr(model, 'names') else []
        logger.info(f"Model loaded. Classes: {class_names}")
    return model

def decode_base64_image(image_string: str):
    """Decode base64 image to OpenCV format."""
    try:
        from base64 import b64decode
        import cv2
        import numpy as np
        img_bytes = b64decode(image_string)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            logger.error("Failed to decode image from base64 string.")
        return frame
    except Exception as e:
        logger.error(f"Exception in decode_base64_image: {e}")
        return None

async def process_image(image_data, confidence_threshold=0.95, camera_id=None):  
    import cv2
    import numpy as np
    import time
    from base64 import b64decode, b64encode
    start_time = time.time()
    model = get_model()
    
    # Get or create tracker for this camera
    global camera_trackers
    if camera_id not in camera_trackers:
        camera_trackers[camera_id] = ObjectTracker()
    tracker = camera_trackers[camera_id]
    
    # Perform detection with specified confidence
    
    # Decode base64 image
    try:
        img_bytes = b64decode(image_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        logger.error(f"Error decoding image: {e}")
        raise
    if frame is None:
        logger.error("Decoded frame is None. Invalid image data.")
        raise ValueError("Invalid image data")
    # Run detection
    try:
        class_indices = [class_names.index(cls) for cls in traffic_classes if cls in class_names]
        if class_indices:
            results = model(frame, conf=confidence_threshold, classes=class_indices, verbose=False)
        else:
            results = model(frame, conf=confidence_threshold, verbose=False)
    except Exception as e:
        logger.error(f"Error running YOLO model: {e}")
        raise
        
    # Process raw detections
    raw_detections = []
    for r in results:
        for box in r.boxes:
            class_id = int(box.cls[0])
            class_name = class_names[class_id] if class_id < len(class_names) else str(class_id)
            if class_name not in traffic_classes:
                continue
            conf = float(box.conf[0])
            x1, y1, x2, y2 = map(float, box.xyxy[0])
            h, w = frame.shape[:2]
            bbox = [x1, y1, x2, y2]  # Use absolute coordinates for tracking
            raw_detections.append({
                "class_id": class_id,
                "class_name": class_name,
                "confidence": conf,
                "bbox": bbox
            })
    
    # Update tracker with new detections
    frame_id = int(time.time() * 1000)  # Use timestamp as frame ID
    filtered_detections = tracker.update(raw_detections, frame_id, frame.shape)
    
    # Draw bounding boxes on frame
    for det in filtered_detections:
        x1, y1, x2, y2 = map(int, det["bbox"])
        class_name = det["class_name"]
        conf = det["confidence"]
        tracking_id = det.get("tracking_id", "?")
        
        # Draw bounding box
        color = (0, 255, 0) if class_name == 'car' else (0, 0, 255)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        
        # Draw label with tracking ID
        label = f"{class_name}-{tracking_id}: {conf:.2f}"
        cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    # Get statistics from tracker
    stats = tracker.get_statistics()
    
    # Normalize bounding boxes for output
    h, w = frame.shape[:2]
    for det in filtered_detections:
        x1, y1, x2, y2 = det["bbox"]
        det["bbox"] = [x1/w, y1/h, x2/w, y2/h]  # Normalize for output

    # Log unique object counts instead of per-frame counts
    logger.info(f"Camera {camera_id} - Unique objects: {stats}")

    # Encode annotated frame back to base64
    try:
        _, buffer = cv2.imencode('.jpg', frame)
        annotated_image = b64encode(buffer).decode('utf-8')
    except Exception as e:
        logger.error(f"Error encoding annotated image: {e}")
        annotated_image = None
    end_time = time.time()
    
    # Add traffic analysis results
    vehicle_count = stats['counts_by_type'].get('car', 0)
    accident_count = stats['counts_by_type'].get('accident', 0)
    
    # Determine traffic density based on vehicle count
    density = "low"
    if vehicle_count > 10:
        density = "high"
    elif vehicle_count > 5:
        density = "moderate"
        
    traffic_analysis = {
        "vehicle_count": vehicle_count,
        "accident_count": accident_count,
        "density": density,
        "counts_by_type": stats['counts_by_type']
    }

    return {
        "detections": filtered_detections,
        "inference_time": end_time - start_time,
        "total_time": end_time - start_time,
        "timestamp": end_time,
        "image_size": [frame.shape[0], frame.shape[1]],
        "annotated_image": annotated_image,
        "traffic_analysis": traffic_analysis
    }

async def send_to_node(data):
    """Send data to Node.js server via WebSocket"""
    global ws_connection
    import json
    if not ws_connection:
        logger.warning("No WebSocket connection to Node.js server. Cannot send data.")
        return
    try:
        await ws_connection.send(json.dumps(data))
        logger.info(f"Sent data to Node.js: {data.get('type', 'unknown')}")
    except Exception as e:
        logger.error(f"Error sending data to Node.js: {e}")

async def connect_to_node():
    """Establish WebSocket connection to Node.js server"""
    global ws_connection
    import websockets
    logger.info(f"Connecting to Node.js server at {node_server_url}...")
    try:
        ws_connection = await websockets.connect(node_server_url)
        logger.info("Connected to Node.js server successfully")
    except Exception as e:
        logger.error(f"Failed to connect to Node.js server: {e}")

async def listen_to_node():
    """Background task to listen for messages from Node.js server"""
    global ws_connection
    
    while True:
        if not ws_connection:
            try:
                await connect_to_node()
                if not ws_connection:
                    await asyncio.sleep(5)  # Wait before retry
                    continue
            except Exception as e:
                logger.error(f"Connection error: {e}")
                await asyncio.sleep(5)
                continue
        
        try:
            message = await ws_connection.recv()
            # Process message from Node.js
            await process_node_message(message)
        except websockets.exceptions.ConnectionClosed:
            logger.warning("WebSocket connection to Node.js closed")
            ws_connection = None
            await asyncio.sleep(5)  # Wait before retry
        except Exception as e:
            logger.error(f"Error in WebSocket communication: {e}")
            ws_connection = None
            await asyncio.sleep(5)  # Wait before retry

async def process_node_message(message):
    """Process incoming messages from Node.js"""
    try:
        # Check if this is binary data (likely a JPEG image)
        if isinstance(message, bytes):
            # Convert binary to base64 for processing
            base64_image = base64.b64encode(message).decode('utf-8')
            
            # Process as an image (using default camera ID if not known)
            result = await process_image(base64_image, 0.25, "unknown")
            
            # Send results back
            await send_to_node({
                "type": "detection_response",
                "camera_id": "unknown",
                "results": result
            })
            return
        
        # Try to parse as JSON if it's a string
        data = json.loads(message)
        
        # Check message type
        if data.get("type") == "detection_request":
            logger.info("Received detection request from Node.js")
            if "image" in data:
                # Process image for detection
                result = await process_image(data["image"], 
                                           data.get("confidence", 0.25), 
                                           data.get("camera_id"))
                # Send results back
                await send_to_node({
                    "type": "detection_response",
                    "camera_id": data.get("camera_id"),
                    "results": result
                })
        elif data.get("type") == "ping":
            # Respond to ping
            await send_to_node({"type": "pong", "timestamp": time.time()})
    except json.JSONDecodeError:
        # For non-JSON text data
        logger.warning(f"Received non-JSON text message from Node.js: {message[:50]}...")
    except Exception as e:
        logger.error(f"Error processing message from Node.js: {e}")

# Periodically clean up old trackers
async def cleanup_trackers():
    """Clean up old trackers that haven't been used in a while"""
    while True:
        await asyncio.sleep(300)  # Run every 5 minutes
        logger.info(f"Cleaning up trackers. Active cameras: {len(camera_trackers)}")
        
        for camera_id, tracker in list(camera_trackers.items()):
            tracker.cleanup_old_objects(force=True)
            
            # If no objects are being tracked, remove the tracker
            if len(tracker.tracked_objects) == 0:
                del camera_trackers[camera_id]
                logger.info(f"Removed inactive tracker for camera {camera_id}")

# --- Lifespan context manager for startup/shutdown events ---
@asynccontextmanager
async def lifespan(app):
    # Pre-load the model
    get_model()
    
    # Start background task to connect and listen to Node.js server
    asyncio.create_task(listen_to_node())
    
    # Start background task to clean up trackers
    asyncio.create_task(cleanup_trackers())
    
    yield
    
    # Clean up (if needed)
    global ws_connection
    if ws_connection:
        await ws_connection.close()

# --- Initialize FastAPI App ---
app = FastAPI(
    title="Traffic Detection API",
    description="API for real-time traffic detection using YOLOv8",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware to allow cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API Endpoints ---

@app.get("/")
def read_root():
    """Root endpoint to check if API is running."""
    return {"status": "online", "message": "Traffic Detection API is running"}

@app.post("/detect", response_model=DetectionResponse)
async def detect_objects(request: DetectionRequest):
    """
    Process an image for object detection and return bounding boxes
    and class information for detected objects.
    """
    start_time = time.time()
    
    try:
        # Process the image
        result = await process_image(request.image, request.confidence)
        
        # Convert to response model
        detection_results = [
            DetectionResult(
                class_id=det["class_id"],
                class_name=det["class_name"],
                confidence=det["confidence"],
                bbox=det["bbox"]
            )
            for det in result["detections"]
        ]
        
        return DetectionResponse(
            detections=detection_results,
            inference_time=result["inference_time"],
            total_time=time.time() - start_time,
            timestamp=start_time,
            image_size=result["image_size"]
        )
    
    except Exception as e:
        logger.error(f"Error during detection: {e}")
        raise HTTPException(status_code=500, detail=f"Detection error: {str(e)}")

@app.get("/health", status_code=200)
async def health_check():
    """Endpoint to check if the API is running."""
    get_model()  # Ensure model is loaded
    return {"status": "healthy", "model_loaded": model is not None}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Main WebSocket endpoint for real-time detection."""
    await websocket.accept()
    get_model()  # Pre-load the model on connection
    
    try:
        while True:
            message = await websocket.receive()
            
            # Handle both text (JSON) and bytes (image frame)
            if isinstance(message, dict) and message.get('type') == 'echo':
                await websocket.send_json({"response": "pong"})
                continue

            image_data = None
            if 'bytes' in message:
                image_data = message['bytes']
            elif 'text' in message:
                # Assuming text is base64 encoded image
                image_data = base64.b64decode(message['text'])
            
            if image_data:
                # Decode image
                nparr = np.frombuffer(image_data, np.uint8)
                image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                
                if image is not None:
                    # Perform detection
                    results = model(image, verbose=False)[0]  # Get first result
                    
                    # Filter detections for specified classes
                    detections = []
                    for r in results.boxes.data.tolist():
                        x1, y1, x2, y2, score, class_id = r
                        class_name = class_names[int(class_id)]
                        
                        if class_name in traffic_classes:
                            detections.append({
                                "class": class_name,
                                "confidence": score,
                                "bbox": [x1, y1, x2, y2]
                            })
                    
                    # Send results back to Node.js
                    await websocket.send_json({
                        "type": "detection-results",
                        "detections": detections
                    })

    except WebSocketDisconnect:
        logger.info("Client disconnected from WebSocket")
    except Exception as e:
        logger.error(f"WebSocket Error: {e}")


# --- Main execution ---

if __name__ == "__main__":
    # Get the model once at startup
    get_model()
    
    # Start the FastAPI server with environment-specific host and port
    host = "0.0.0.0"  # Always bind to all interfaces
    uvicorn.run(app, host=host, port=port)