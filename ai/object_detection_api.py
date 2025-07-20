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

async def process_image(image_data, confidence_threshold=0.01, camera_id=None):  
    import cv2
    import numpy as np
    import time
    from base64 import b64decode, b64encode
    start_time = time.time()
    model = get_model()
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
    detections = []
    for r in results:
        for box in r.boxes:
            class_id = int(box.cls[0])
            class_name = class_names[class_id] if class_id < len(class_names) else str(class_id)
            if class_name not in traffic_classes:
                continue
            conf = float(box.conf[0])
            x1, y1, x2, y2 = map(float, box.xyxy[0])
            h, w = frame.shape[:2]
            bbox = [x1 / w, y1 / h, x2 / w, y2 / h]
            detections.append({
                "class_id": class_id,
                "class_name": class_name,
                "confidence": conf,
                "bbox": bbox
            })
            # Draw bounding box
            color = (0, 255, 0) if class_name == 'car' else (0, 0, 255)
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
            label = f"{class_name}: {conf:.2f}"
            cv2.putText(frame, label, (int(x1), int(y1) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    # Log summary counts
    from collections import Counter
    counts = Counter([det['class_name'] for det in detections])
    logger.info(f"Detection counts: {dict(counts)}")

    # Encode annotated frame back to base64
    try:
        _, buffer = cv2.imencode('.jpg', frame)
        annotated_image = b64encode(buffer).decode('utf-8')
    except Exception as e:
        logger.error(f"Error encoding annotated image: {e}")
        annotated_image = None
    end_time = time.time()

    return {
        "detections": detections,
        "inference_time": end_time - start_time,
        "total_time": end_time - start_time,
        "timestamp": end_time,
        "image_size": [frame.shape[0], frame.shape[1]],
        "annotated_image": annotated_image
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

# --- Lifespan context manager for startup/shutdown events ---
@asynccontextmanager
async def lifespan(app):
    # Pre-load the model
    get_model()
    
    # Start background task to connect and listen to Node.js server
    asyncio.create_task(listen_to_node())
    
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