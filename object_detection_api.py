"""
Object Detection API using FastAPI and YOLOv8
This module provides a lightweight API for real-time object detection
using the Ultralytics YOLOv8 model and FastAPI framework.
"""

import base64
import io
import json
import os
import time
from typing import Dict, List, Optional, Union

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
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

class TrainingRequest(BaseModel):
    """Request model for model training endpoint."""
    epochs: int = 10
    batch_size: int = 16
    dataset_path: Optional[str] = "datasets/traffic"  # Path to dataset
    model_name: Optional[str] = "yolov8n.pt"  # Base model to fine-tune

class TrainingStatus(BaseModel):
    """Response model for training status."""
    status: str  # 'running', 'completed', 'error'
    current_epoch: Optional[int] = None
    total_epochs: Optional[int] = None
    progress: Optional[float] = None  # 0-1
    metrics: Optional[Dict] = None
    message: Optional[str] = None
    timestamp: float

# --- Initialize FastAPI App ---

app = FastAPI(
    title="Object Detection API",
    description="API for real-time object detection using YOLOv8",
    version="1.0.0"
)

# Add CORS middleware to allow cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Model Initialization ---

# Model will be loaded on first request (lazy loading)
model = None
model_path = "yolov8n.pt"  # Default model - smallest version for faster inference
class_names = []  # Will be populated from model

# Training status tracking
training_status = {
    "active": False,
    "task": None,
    "start_time": None,
    "current_epoch": 0,
    "total_epochs": 0,
    "stop_requested": False
}

def get_model():
    """Lazy load the model only when needed."""
    global model, class_names
    if model is None:
        try:
            model = YOLO(model_path)
            # Get class names from model
            class_names = model.names
            print(f"Model loaded successfully with {len(class_names)} classes")
        except Exception as e:
            print(f"Error loading model: {e}")
            raise HTTPException(status_code=500, detail=f"Model loading error: {str(e)}")
    return model

# --- Helper Functions ---

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

def run_training(request: TrainingRequest):
    """Background task to run model training."""
    global model, model_path, training_status
    
    try:
        # Set training status
        training_status["active"] = True
        training_status["start_time"] = time.time()
        training_status["current_epoch"] = 0
        training_status["total_epochs"] = request.epochs
        training_status["stop_requested"] = False
        
        # Ensure dataset directory exists
        os.makedirs(request.dataset_path, exist_ok=True)
        
        # Check if we have training data
        if not os.path.exists(os.path.join(request.dataset_path, "train")):
            raise ValueError(f"Training dataset not found at {request.dataset_path}/train")
            
        # Load model for training
        train_model = YOLO(request.model_name)
        
        # Start training
        results = train_model.train(
            data=os.path.join(request.dataset_path, "data.yaml"),
            epochs=request.epochs,
            batch=request.batch_size,
            imgsz=640,
            save=True,
            verbose=True,
            patience=10,  # Early stopping patience
            device='0' if torch.cuda.is_available() else 'cpu',
            callbacks=[TrainingCallback()]
        )
        
        # Training complete - update model if successful
        if not training_status["stop_requested"]:
            # Get the best model path
            best_model_path = os.path.join(train_model.trainer.save_dir, "weights/best.pt")
            if os.path.exists(best_model_path):
                # Save a timestamped copy
                timestamp = time.strftime("%Y%m%d-%H%M%S")
                save_path = f"models/yolov8_trained_{timestamp}.pt"
                os.makedirs(os.path.dirname(save_path), exist_ok=True)
                
                # Copy the model
                import shutil
                shutil.copy(best_model_path, save_path)
                
                # Update model path and reload model
                model_path = save_path
                model = None  # Force reload on next detection
                get_model()  # Load the new model
        
        # Update training status
        training_status["active"] = False
        training_status["current_epoch"] = request.epochs
        
    except Exception as e:
        # Handle training errors
        print(f"Training error: {e}")
        training_status["active"] = False
        training_status["message"] = str(e)
    finally:
        training_status["stop_requested"] = False

# Training callback to update training progress
class TrainingCallback:
    def __init__(self):
        pass
        
    def on_epoch_end(self, trainer):
        global training_status
        
        if training_status["stop_requested"]:
            trainer.epoch = trainer.epochs  # Force stop training
            trainer.stop = True
        
        # Update epoch info
        training_status["current_epoch"] = trainer.epoch + 1

# --- API Endpoints ---

@app.get("/")
def read_root():
    """Root endpoint to check if API is running."""
    return {"status": "online", "message": "Object Detection API is running"}

@app.post("/detect", response_model=DetectionResponse)
async def detect_objects(request: DetectionRequest):
    """
    Process an image for object detection and return bounding boxes
    and class information for detected objects.
    """
    start_time = time.time()
    
    try:
        # Decode the base64 image
        image = decode_base64_image(request.image)
        
        # Get image dimensions
        height, width = image.shape[:2]
        
        # Ensure model is loaded
        model = get_model()
        
        # Run inference
        inference_start = time.time()
        results = model.predict(
            source=image,
            conf=request.confidence,
            max_det=request.max_det,
            verbose=False
        )[0]  # Get first result
        inference_time = time.time() - inference_start
        
        # Process results
        detections = []
        
        if hasattr(results, 'boxes'):
            for box in results.boxes:
                # Get box coordinates (convert to list for JSON serialization)
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                
                # Normalize coordinates
                x1, x2 = x1 / width, x2 / width
                y1, y2 = y1 / height, y2 / height
                
                # Get class ID and confidence
                class_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                class_name = class_names[class_id]
                
                detections.append(
                    DetectionResult(
                        class_id=class_id,
                        class_name=class_name,
                        confidence=conf,
                        bbox=[x1, y1, x2, y2]
                    )
                )
        
        total_time = time.time() - start_time
        
        return DetectionResponse(
            detections=detections,
            inference_time=inference_time,
            total_time=total_time,
            timestamp=start_time,
            image_size=[height, width]
        )
    
    except Exception as e:
        print(f"Error during detection: {e}")
        raise HTTPException(status_code=500, detail=f"Detection error: {str(e)}")

@app.get("/health")
def health_check():
    """Health check endpoint to verify API status."""
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "version": "1.0.0"
    }

@app.post("/train")
async def train_model(request: TrainingRequest, background_tasks: BackgroundTasks):
    """Start model training in the background."""
    if training_status["active"]:
        raise HTTPException(status_code=400, detail="Training already in progress")
    
    # Start training in background
    background_tasks.add_task(run_training, request)
    
    return {
        "status": "started",
        "message": "Training started in the background",
        "config": {
            "epochs": request.epochs,
            "batch_size": request.batch_size,
            "dataset_path": request.dataset_path
        }
    }

@app.get("/train/status")
def get_training_status():
    """Get the current status of model training."""
    status_msg = "running" if training_status["active"] else "idle"
    if training_status["active"] and training_status["stop_requested"]:
        status_msg = "stopping"
    
    current_epoch = training_status["current_epoch"]
    total_epochs = training_status["total_epochs"]
    
    # Calculate progress
    progress = 0.0
    if total_epochs > 0:
        progress = min(1.0, current_epoch / total_epochs)
    
    return TrainingStatus(
        status=status_msg,
        current_epoch=current_epoch,
        total_epochs=total_epochs,
        progress=progress,
        message=training_status.get("message", None),
        timestamp=time.time()
    )

@app.post("/train/stop")
def stop_training():
    """Stop ongoing training."""
    if not training_status["active"]:
        return {"status": "not_running", "message": "No active training to stop"}
    
    training_status["stop_requested"] = True
    return {"status": "stopping", "message": "Stopping training..."}

# Import torch here for training
import torch

# --- Run the API ---

if __name__ == "__main__":
    # Start the server with optimized settings
    uvicorn.run(
        "object_detection_api:app", 
        host="0.0.0.0",
        port=8000,
        workers=1,  # Use more workers depending on your CPU/GPU
        log_level="info"
    )