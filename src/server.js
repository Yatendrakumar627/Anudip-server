import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
import { syncActiveMeetSessions, googleMeetConfigured } from './services/googleMeet.js';

const port = Number(process.env.PORT) || 4000;
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ngo_training_hub';

try {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 25,
    minPoolSize: 5,
    socketTimeoutMS: 45000,
  });
  console.log(`MongoDB connected to ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
  const server = app.listen(port, () => console.log(`NGO Training Hub API listening on http://localhost:${port}`));
  const meetSyncTimer = googleMeetConfigured() ? setInterval(() => { syncActiveMeetSessions().catch((error) => console.error('[meet-sync]', error.message)); }, 60_000) : null;
  meetSyncTimer?.unref();
  if (googleMeetConfigured()) console.log('Google Meet background sync enabled for sessions marked Live (60-second poll).');

  const shutdown = async (signal) => {
    console.log(`${signal} received. Closing server...`);
    if (meetSyncTimer) clearInterval(meetSyncTimer);
    server.close(async () => { await mongoose.disconnect(); process.exit(0); });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  console.error('Could not start the API:', error.message);
  process.exit(1);
}
