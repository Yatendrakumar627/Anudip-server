import { Router } from 'express';
import mongoose from 'mongoose';
import TrainingSession from '../models/TrainingSession.js';
import Attendance from '../models/Attendance.js';
import { asyncHandler, serialize } from '../utils.js';
import { syncConferenceAttendance } from '../services/googleMeet.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.field) query.field = req.query.field;
  const rows = await TrainingSession.find(query).sort({ date: 1, startTime: 1 }).limit(1000).lean();
  res.json(rows.map(serialize));
}));

router.post('/', asyncHandler(async (req, res) => {
  const created = await TrainingSession.create(req.body);
  res.status(201).json(serialize(created));
}));

router.post('/:id/sync-meet', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid session ID.' });
  const session = await TrainingSession.findById(req.params.id);
  if (!session) return res.status(404).json({ message: 'Training session not found.' });
  const result = await syncConferenceAttendance(session);
  res.json(result);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
  const session = await TrainingSession.findById(req.params.id);
  if (!session) return res.status(404).json({ message: 'Training session not found.' });
  res.json(serialize(session));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
  const session = await TrainingSession.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!session) return res.status(404).json({ message: 'Training session not found.' });
  res.json(serialize(session));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
  const deleted = await TrainingSession.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ message: 'Training session not found.' });
  await Attendance.deleteMany({ sessionId: deleted._id });
  res.json({ success: true, id: req.params.id });
}));

export default router;
