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

import cv2
import numpy as np
import uvicorn
import asyncio
import websockets
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ultralytics import YOLO

# --- Models & Data Classes ---

class DetectionRequest(BaseModel):
    """Request model for object detection endpoint."""
    image: str  # Base64 encoded JPEG image
    confidence: Optional[float] = 0.25  # Default confidence threshold
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

# Model will be loaded on first request (lazy loading)
model = None
model_path = "yolov8n.pt"  # Default model
class_names = []  # Will be populated from model
traffic_classes = ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'person']  # Traffic-related classes

# WebSocket connection to Node.js server
ws_connection = None
node_server_url = "ws://localhost:3000/ai"  # WebSocket URL for connecting to Node.js

# --- Helper Functions ---

def get_model():
    """Lazy load the model only when needed."""
    global model, class_names
    if model is None:
        try:
            print(f"Loading YOLOv8 model from {model_path}...")
            model = YOLO(model_path)
            # Get class names from model
            class_names = model.names
            print(f"Model loaded successfully with {len(class_names)} classes")
            print(f"Tracking traffic classes: {[c for c in traffic_classes if c in class_names.values()]}")
        except Exception as e:
            print(f"Error loading model: {e}")
            raise HTTPException(status_code=500, detail=f"Model loading error: {str(e)}")
    return model

def decode_base64_image(image_string: str):
    """Decode base64 image to OpenCV format."""
    try:
        # Check if the string starts with data URI scheme and remove it if present
        if image_string.startswith('data:image'):
            image_string = image_string.split(',')[1]
        
        # Decode base64 string
        image_data = base64.b64decode(image_string)
        
        # Convert to numpy array
        nparr = np.frombuffer(image_data, np.uint8)
        
        # Decode image
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise ValueError("Could not decode image")
            
        return image
    except Exception as e:
        print(f"Error decoding image: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")

async def connect_to_node():
    """Establish WebSocket connection to Node.js server"""
    global ws_connection
    try:
        print(f"Connecting to Node.js server at {node_server_url}...")
        ws_connection = await websockets.connect(node_server_url)
        print("Connected to Node.js server successfully")
        
        # Send initial handshake message
        await ws_connection.send(json.dumps({
            "type": "ai_connected",
            "message": "Traffic detection AI service connected"
        }))
        
        return True
    except Exception as e:
        print(f"Failed to connect to Node.js server: {e}")
        ws_connection = None
        return False

async def send_to_node(data):
    """Send data to Node.js server via WebSocket"""
    global ws_connection
    
    if not ws_connection:
        success = await connect_to_node()
        if not success:
            print("Could not send data - no connection to Node.js")
            return False
    
    try:
        if isinstance(data, dict):
            await ws_connection.send(json.dumps(data))
        else:
            await ws_connection.send(data)
        return True
    except Exception as e:
        print(f"Error sending data to Node.js: {e}")
        ws_connection = None  # Reset connection on error
        return False

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
                print(f"Connection error: {e}")
                await asyncio.sleep(5)
                continue
        
        try:
            message = await ws_connection.recv()
            # Process message from Node.js
            await process_node_message(message)
        except websockets.exceptions.ConnectionClosed:
            print("WebSocket connection to Node.js closed")
            ws_connection = None
            await asyncio.sleep(5)  # Wait before retry
        except Exception as e:
            print(f"Error in WebSocket communication: {e}")
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
            print("Received detection request from Node.js")
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
        print(f"Received non-JSON text message from Node.js: {message[:50]}...")
    except Exception as e:
        print(f"Error processing message from Node.js: {e}")

async def process_image(image_data, confidence_threshold=0.25, camera_id=None):
    """Process an image and return traffic detection results"""
    try:
        # Decode image
        image = decode_base64_image(image_data)
        
        # Get image dimensions
        height, width = image.shape[:2]
        
        # Ensure model is loaded
        model = get_model()
        
        # Run inference
        inference_start = time.time()
        results = model.predict(
            source=image,
            conf=confidence_threshold,
            max_det=100,
            verbose=False
        )[0]  # Get first result
        inference_time = time.time() - inference_start
        
        # Process results - focus on traffic classes
        detections = []
        traffic_count = {cls: 0 for cls in traffic_classes}
        
        if hasattr(results, 'boxes'):
            for box in results.boxes:
                # Get class ID and confidence
                class_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                class_name = class_names[class_id]
                
                # Only include traffic-related classes
                if class_name.lower() in traffic_classes:
                    # Get box coordinates and normalize
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    x1, x2 = x1 / width, x2 / width
                    y1, y2 = y1 / height, y2 / height
                    
                    traffic_count[class_name.lower()] = traffic_count.get(class_name.lower(), 0) + 1
                    
                    detections.append({
                        "class_id": class_id,
                        "class_name": class_name,
                        "confidence": conf,
                        "bbox": [x1, y1, x2, y2]
                    })
        
        # Calculate traffic density based on vehicle count
        vehicle_count = sum(traffic_count.get(cls, 0) for cls in ['car', 'truck', 'bus'])
        traffic_density = "low"
        if vehicle_count >= 10:
            traffic_density = "high"
        elif vehicle_count >= 5:
            traffic_density = "moderate"
        
        # Prepare response with traffic analysis
        response = {
            "detections": detections,
            "inference_time": inference_time,
            "total_time": time.time() - inference_start,
            "timestamp": time.time(),
            "image_size": [height, width],
            "traffic_analysis": {
                "density": traffic_density,
                "vehicle_count": vehicle_count,
                "counts_by_type": traffic_count,
                "camera_id": camera_id
            }
        }
        
        return response
        
    except Exception as e:
        print(f"Error processing image: {e}")
        return {
            "error": str(e),
            "detections": [],
            "timestamp": time.time()
        }

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
        print(f"Error during detection: {e}")
        raise HTTPException(status_code=500, detail=f"Detection error: {str(e)}")

@app.get("/health")
def health_check():
    """Health check endpoint to verify API status."""
    global model, ws_connection
    
    # Check if model is loaded
    model_loaded = model is not None
    
    # Check if we have class names
    classes_loaded = len(class_names) > 0
    
    # Check WebSocket connection status
    websocket_status = "connected" if ws_connection is not None else "disconnected"
    
    # Return comprehensive health information
    return {
        "status": "healthy" if model_loaded else "initializing",
        "model_loaded": model_loaded,
        "classes_loaded": classes_loaded,
        "class_count": len(class_names) if classes_loaded else 0,
        "traffic_classes": [c for c in traffic_classes if c in class_names.values()] if classes_loaded else [],
        "websocket_connected": ws_connection is not None,
        "websocket_status": websocket_status,
        "version": "1.0.0",
        "timestamp": time.time()
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time communication"""
    await websocket.accept()
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            
            try:
                # Parse as JSON
                message = json.loads(data)
                
                # Process based on message type
                if message.get("type") == "detection_request":
                    if "image" in message:
                        # Process for detection
                        result = await process_image(
                            message["image"],
                            message.get("confidence", 0.25),
                            message.get("camera_id")
                        )
                        
                        # Send back results
                        await websocket.send_json(result)
                
                elif message.get("type") == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": time.time()})
                
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON"})
            except Exception as e:
                await websocket.send_json({"error": str(e)})
                
    except WebSocketDisconnect:
        print("WebSocket client disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")

# --- Run the API ---

if __name__ == "__main__":
    uvicorn.run(
        "object_detection_api:app", 
        host="0.0.0.0",
        port=8000,
        workers=1,
        log_level="info"
    )