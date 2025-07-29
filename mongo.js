import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// MongoDB connection string - try multiple options
const uri = process.env.MONGO_URI || 
           process.env.MONGO_URL || 
           'mongodb://localhost:27017/smart-road-system';

// Define Mongoose schemas
const DetectionSchema = new mongoose.Schema({
  sessionId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Session',
    required: true
  },
  timestamp: { type: Date, default: Date.now },
  cameraId: String,
  detections: Array,
  carCount: Number,
  accidentCount: Number,
  inference_time: Number,
  total_time: Number,
  image_size: Array
});

const SessionSchema = new mongoose.Schema({
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date, default: null },
  duration: { type: Number, required: true },
  count: { type: Number, required: true },
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  smsCounters: { type: Map, of: Number, default: {} } // Add this line
});

// Create models
let Detection = null;
let Session = null;

// Fallback storage when MongoDB is unavailable
const fallbackStorage = {
  sessions: [],
  detections: {},
  fallbackMode: false
};

// Directory for local file storage fallback
const DATA_DIR = path.join(__dirname, 'data');

/**
 * Initialize fallback storage
 */
function initFallbackStorage() {
  console.log('Using fallback storage mode (memory + local files)');
  fallbackStorage.fallbackMode = true;
  
  // Create data directory if it doesn't exist
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (error) {
      console.error(`Failed to create data directory: ${error.message}`);
    }
  }

  // Try to load existing sessions from local file
  try {
    const sessionsFile = path.join(DATA_DIR, 'sessions.json');
    if (fs.existsSync(sessionsFile)) {
      fallbackStorage.sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
      console.log(`Loaded ${fallbackStorage.sessions.length} sessions from local storage`);
    }
  } catch (error) {
    console.error(`Failed to load sessions from local file: ${error.message}`);
  }
}

/**
 * Save sessions to local file
 */
function saveFallbackSessions() {
  if (!fallbackStorage.fallbackMode) return;
  
  try {
    const sessionsFile = path.join(DATA_DIR, 'sessions.json');
    fs.writeFileSync(sessionsFile, JSON.stringify(fallbackStorage.sessions, null, 2));
  } catch (error) {
    console.error(`Failed to save sessions to local file: ${error.message}`);
  }
}

/**
 * Connect to MongoDB using Mongoose
 * @returns {Promise<boolean>} True if connection was successful
 */
async function connectToMongo() {
  if (mongoose.connection.readyState === 1) {
    return true; // Already connected
  }
  
  try {
    console.log(`Connecting to MongoDB at: ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    
    // Configure Mongoose connection
    mongoose.set('strictQuery', false);
    
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000 // Fail fast if MongoDB is not available
    });
    
    console.log('Connected to MongoDB');
    
    // Initialize models once connected
    if (!Session) {
      Session = mongoose.model('Session', SessionSchema);
    }
    if (!Detection) {
      Detection = mongoose.model('Detection', DetectionSchema);
    }
    
    return true;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error.message);
    
    // Initialize fallback mode
    initFallbackStorage();
    
    return false;
  }
}

/**
 * Create a new session
 * @param {Object} sessionData - Session data (duration, count)
 * @returns {Promise<string>} - Session ID
 */
export async function createSession(sessionData) {
  try {
    const connected = await connectToMongo();
    
    if (connected) {
      // Create session using Mongoose
      const newSession = new Session({
        startTime: new Date(),
        endTime: null,
        duration: sessionData.duration,
        count: sessionData.count,
        status: 'active'
      });
      
      const savedSession = await newSession.save();
      return savedSession._id.toString();
    } else if (fallbackStorage.fallbackMode) {
      // Fallback: Create in-memory session
      const newSession = {
        _id: `fallback_${Date.now()}`,
        startTime: new Date(),
        endTime: null,
        duration: sessionData.duration,
        count: sessionData.count,
        status: 'active'
      };
      
      fallbackStorage.sessions.push(newSession);
      fallbackStorage.detections[newSession._id] = [];
      saveFallbackSessions();
      
      return newSession._id;
    }
  } catch (error) {
    console.error(`Error creating session: ${error.message}`);
    throw error;
  }
}

/**
 * End a session
 * @param {string} sessionId - Session ID
 */
export async function endSession(sessionId) {
  try {
    const connected = await connectToMongo();
    
    if (connected) {
      // Update session using Mongoose
      await Session.findByIdAndUpdate(sessionId, {
        endTime: new Date(),
        status: 'completed'
      });
    } else if (fallbackStorage.fallbackMode) {
      // Fallback: Update in-memory session
      const session = fallbackStorage.sessions.find(s => s._id === sessionId);
      if (session) {
        session.endTime = new Date();
        session.status = 'completed';
        saveFallbackSessions();
      }
    }
  } catch (error) {
    console.error(`Error ending session: ${error.message}`);
    throw error;
  }
}

/**
 * Add a detection to a session
 * @param {string} sessionId - Session ID
 * @param {Object} detectionData - Detection data
 */
export async function addDetectionToSession(sessionId, detectionData) {
  try {
    const connected = await connectToMongo();
    
    if (connected) {
      // Create detection using Mongoose
      const newDetection = new Detection({
        sessionId,
        ...detectionData
      });
      
      await newDetection.save();
    } else if (fallbackStorage.fallbackMode) {
      // Fallback: Add to in-memory detections
      if (!fallbackStorage.detections[sessionId]) {
        fallbackStorage.detections[sessionId] = [];
      }
      
      fallbackStorage.detections[sessionId].push({
        _id: `fallback_${Date.now()}`,
        sessionId,
        timestamp: new Date(),
        ...detectionData
      });
    }
  } catch (error) {
    console.error(`Error adding detection: ${error.message}`);
    throw error;
  }
}

/**
 * Get all sessions
 * @returns {Promise<Array>} - List of sessions
 */
export async function getSessions() {
  try {
    const connected = await connectToMongo();
    
    if (connected) {
      // Get sessions using Mongoose
      return await Session.find().sort({ startTime: -1 });
    } else if (fallbackStorage.fallbackMode) {
      // Fallback: Return in-memory sessions
      return fallbackStorage.sessions.sort((a, b) => 
        new Date(b.startTime) - new Date(a.startTime));
    }
    
    return [];
  } catch (error) {
    console.error(`Error getting sessions: ${error.message}`);
    return [];
  }
}

/**
 * Get session data
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} - Session data
 */
export async function getSessionData(sessionId) {
  try {
    const connected = await connectToMongo();
    
    if (connected) {
      // Get session using Mongoose
      return await Session.findById(sessionId);
    } else if (fallbackStorage.fallbackMode) {
      // Fallback: Return in-memory session
      return fallbackStorage.sessions.find(s => s._id === sessionId);
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting session data: ${error.message}`);
    return null;
  }
}

/**
 * Get detections for a session
 * @param {string} sessionId - Session ID
 * @param {number} limit - Maximum number of detections to return
 * @param {number} skip - Number of detections to skip
 * @returns {Promise<Array>} - List of detections
 */
export async function getSessionDetections(sessionId, limit = 100, skip = 0) {
  try {
    const connected = await connectToMongo();
    
    if (connected) {
      // Get detections using Mongoose
      return await Detection.find({ sessionId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(skip);
    } else if (fallbackStorage.fallbackMode) {
      // Fallback: Return in-memory detections
      const detections = fallbackStorage.detections[sessionId] || [];
      const sorted = detections.sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp));
      
      return sorted.slice(skip, skip + limit);
    }
    
    return [];
  } catch (error) {
    console.error(`Error getting session detections: ${error.message}`);
    return [];
  }
}

/**
 * Close MongoDB connection
 */
export async function closeMongo() {
  try {
    if (mongoose.connection.readyState !== 0) { // If not already closed
      await mongoose.connection.close();
      console.log('Disconnected from MongoDB');
    }
  } catch (error) {
    console.error(`Error closing MongoDB connection: ${error.message}`);
  }
}

// Handle application shutdown
process.on('SIGINT', async () => {
  await closeMongo();
  process.exit(0);
});
