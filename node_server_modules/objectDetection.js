// objectDetection.js
import { isProduction } from './config.js';
export const objectDetection = {
  enabled: true,
  apiEndpoint: isProduction 
    ? 'wss://smart-road-system.onrender.com/ai-ws' 
    : `ws://localhost:${process.env.PYTHON_API_PORT || 8000}/ws`,
  httpApiEndpoint: isProduction 
    ? 'https://smart-road-system.onrender.com/detect'
    : `http://localhost:${process.env.PYTHON_API_PORT || 8000}/detect`,
  confidenceThreshold: 0.45,
  detectionInterval: 200,
  lastDetectionTime: new Map(),
  detectionResults: new Map(),
  processingCount: 0,
  maxConcurrent: 2,
  errorCount: 0,
  maxErrors: 10,
  pythonProcess: null,
  trafficStatus: new Map(),
  detectionLog: new Map(),
  rateLimit: {
    maxRequestsPerMinute: 300,
    requestCounter: 0,
    lastResetTime: Date.now(),
  }
};
