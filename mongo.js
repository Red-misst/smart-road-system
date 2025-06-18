// MongoDB connection and session/detection models for Smart Road System
import { MongoClient, ObjectId } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'smart_road_system';

let client;
let db;

export async function connectMongo() {
  if (!client) {
    client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    await client.connect();
    db = client.db(DB_NAME);
  }
  return db;
}

export async function createSession({ duration, count }) {
  const db = await connectMongo();
  const session = {
    duration,
    count,
    startTime: new Date(),
    endTime: null,
    detections: [],
  };
  const result = await db.collection('sessions').insertOne(session);
  return result.insertedId;
}

export async function endSession(sessionId) {
  const db = await connectMongo();
  await db.collection('sessions').updateOne(
    { _id: new ObjectId(sessionId) },
    { $set: { endTime: new Date() } }
  );
}

export async function addDetectionToSession(sessionId, detection) {
  const db = await connectMongo();
  await db.collection('sessions').updateOne(
    { _id: new ObjectId(sessionId) },
    { $push: { detections: detection } }
  );
}

export async function getSessions() {
  const db = await connectMongo();
  return db.collection('sessions').find({}).sort({ startTime: -1 }).toArray();
}

export async function getSessionData(sessionId) {
  const db = await connectMongo();
  const session = await db.collection('sessions').findOne({ _id: new ObjectId(sessionId) });
  return session;
}
