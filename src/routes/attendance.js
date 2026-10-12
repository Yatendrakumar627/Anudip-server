import { Router } from 'express';
import mongoose from 'mongoose';
import Attendance from '../models/Attendance.js';
import Student from '../models/Student.js';
import TrainingSession from '../models/TrainingSession.js';
import { asyncHandler, serialize } from '../utils.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.studentId && mongoose.isValidObjectId(req.query.studentId)) query.studentId = req.query.studentId;
  if (req.query.sessionId && mongoose.isValidObjectId(req.query.sessionId)) query.sessionId = req.query.sessionId;
  if (req.query.date) query.date = req.query.date;
  if (req.query.status) query.status = req.query.status;
  const rows = await Attendance.find(query).sort({ date: -1, updatedAt: -1 }).limit(1000).lean();
  res.json(rows.map(serialize));
}));

router.post('/upsert', asyncHandler(async (req, res) => {
  const { studentId, sessionId } = req.body;
  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(sessionId)) return res.status(400).json({ message: 'A valid student and session are required.' });
  const [student, session] = await Promise.all([Student.exists({ _id: studentId }), TrainingSession.findById(sessionId).lean()]);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  if (!session) return res.status(404).json({ message: 'Training session not found.' });
  const payload = { ...req.body, date: req.body.date || session.date };
  const saved = await Attendance.findOneAndUpdate({ studentId, sessionId }, payload, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  res.status(200).json(serialize(saved));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { studentId, sessionId } = req.body;
  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(sessionId)) return res.status(400).json({ message: 'A valid student and session are required.' });
  const [student, session] = await Promise.all([Student.exists({ _id: studentId }), TrainingSession.findById(sessionId).lean()]);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  if (!session) return res.status(404).json({ message: 'Training session not found.' });
  const created = await Attendance.create({ ...req.body, date: req.body.date || session.date });
  res.status(201).json(serialize(created));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
  const record = await Attendance.findById(req.params.id);
  if (!record) return res.status(404).json({ message: 'Attendance record not found.' });
  res.json(serialize(record));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
  if (req.body.studentId || req.body.sessionId) {
    const studentId = req.body.studentId;
    const sessionId = req.body.sessionId;
    if (studentId && (!mongoose.isValidObjectId(studentId) || !(await Student.exists({ _id: studentId })))) return res.status(404).json({ message: 'Student not found.' });
    if (sessionId && (!mongoose.isValidObjectId(sessionId) || !(await TrainingSession.exists({ _id: sessionId })))) return res.status(404).json({ message: 'Training session not found.' });
  }
  const record = await Attendance.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!record) return res.status(404).json({ message: 'Attendance record not found.' });
  res.json(serialize(record));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
  const record = await Attendance.findByIdAndDelete(req.params.id);
  if (!record) return res.status(404).json({ message: 'Attendance record not found.' });
  res.json({ success: true, id: req.params.id });
}));

export default router;
