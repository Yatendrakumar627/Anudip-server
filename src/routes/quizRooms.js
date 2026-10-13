import express from 'express';
import QuizRoom from '../models/QuizRoom.js';
import { asyncHandler, serialize } from '../utils.js';

const router = express.Router();

const defaultSeedQuestions = [
  {
    id: 'q1',
    question: 'Which layer of the OSI model is responsible for end-to-end communication?',
    options: ['Data Link', 'Network', 'Transport', 'Session'],
    answer: 2,
    explanation: 'The Transport layer (Layer 4) handles end-to-end communication, ensuring complete data transfer between systems.',
    points: 1,
  },
  {
    id: 'q2',
    question: 'What does the HTTPS protocol use to secure communications?',
    options: ['HTTP/2', 'SSL/TLS', 'FTP', 'SMTP'],
    answer: 1,
    explanation: 'HTTPS uses SSL/TLS encryption to secure data transmitted between the browser and the server.',
    points: 1,
  },
  {
    id: 'q3',
    question: 'Which HTML element is used to create a navigation bar?',
    options: ['<nav>', '<header>', '<section>', '<footer>'],
    answer: 0,
    explanation: 'The <nav> element represents a section of navigation links in an HTML document.',
    points: 1,
  },
  {
    id: 'q4',
    question: 'In CSS, which property controls the spacing between elements?',
    options: ['padding', 'margin', 'border', 'gap'],
    answer: 1,
    explanation: 'The margin property creates space outside an element, while padding creates space inside.',
    points: 1,
  },
  {
    id: 'q5',
    question: 'Which of these is a JavaScript framework / library for user interfaces?',
    options: ['React', 'HTML', 'CSS', 'JSON'],
    answer: 0,
    explanation: 'React is an open-source JavaScript front-end library used for building interactive user interfaces.',
    points: 1,
  },
];

function generateRoomCode(prefix = 'ANUDIP') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${rand}`;
}

// Background cleanup of expired rooms every 5 minutes (non-blocking, zero request latency)
async function cleanupExpiredRooms() {
  try {
    await QuizRoom.deleteMany({ expiresAt: { $exists: true, $ne: null, $lte: new Date() } });
  } catch (err) {
    console.warn('Expired rooms cleanup error:', err.message);
  }
}
setInterval(cleanupExpiredRooms, 5 * 60 * 1000).unref();

// Ensure seed room runs once on boot, not on every HTTP request
let seedChecked = false;
async function ensureSeedRoom() {
  if (seedChecked) return;
  seedChecked = true;
  try {
    const count = await QuizRoom.countDocuments();
    if (count === 0) {
      await QuizRoom.create({
        title: 'Full Stack & Web Fundamentals Assessment',
        roomCode: 'WEB-101',
        description: 'Comprehensive assessment on OSI layers, HTTPS, HTML5, CSS layout, and JavaScript.',
        batch: 'General',
        timeLimitMinutes: 10,
        isActive: true,
        allowReview: true,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours auto-delete
        questions: defaultSeedQuestions,
        submissions: [
          {
            studentName: 'Rahul Sharma',
            studentEmail: 'rahul.s@example.com',
            score: 4,
            totalQuestions: 5,
            percentage: 80,
            answers: { q1: 2, q2: 1, q3: 0, q4: 0, q5: 0 },
            timeTakenSeconds: 185,
            submittedAt: new Date(Date.now() - 3600000 * 2),
          },
          {
            studentName: 'Priya Patel',
            studentEmail: 'priya.p@example.com',
            score: 5,
            totalQuestions: 5,
            percentage: 100,
            answers: { q1: 2, q2: 1, q3: 0, q4: 1, q5: 0 },
            timeTakenSeconds: 142,
            submittedAt: new Date(Date.now() - 3600000 * 5),
          },
        ],
      });
    }
  } catch (err) {
    console.warn('Seed room creation skipped:', err.message);
  }
}
ensureSeedRoom();

// 1. List all active quiz rooms (High-speed single indexed read, zero write-locks)
router.get('/', asyncHandler(async (_req, res) => {
  const rooms = await QuizRoom.find({
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } },
    ],
  }).sort({ createdAt: -1 }).lean();
  res.json(rooms.map(serialize));
}));

// 2. Student join view: fetch room by code (Single indexed read, instant response)
router.get('/code/:code', asyncHandler(async (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  const room = await QuizRoom.findOne({
    roomCode: code,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } },
    ],
  }).lean();

  if (!room) {
    return res.status(404).json({ message: `Quiz room with code "${code}" was not found or has expired after 48 hours.` });
  }

  // Safe student representation (does NOT expose correct answer index or explanation)
  const safeQuestions = (room.questions || []).map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
    points: q.points || 1,
  }));

  res.json({
    id: String(room._id),
    title: room.title,
    roomCode: room.roomCode,
    description: room.description || '',
    batch: room.batch || '',
    timeLimitMinutes: room.timeLimitMinutes || 0,
    isActive: Boolean(room.isActive),
    allowReview: Boolean(room.allowReview),
    expiresAt: room.expiresAt,
    totalQuestions: safeQuestions.length,
    questions: safeQuestions,
  });
}));

// 3. Admin view: single room with full question answers & submissions
router.get('/:id', asyncHandler(async (req, res) => {
  const room = await QuizRoom.findById(req.params.id).lean();
  if (!room) {
    return res.status(404).json({ message: 'Quiz room not found.' });
  }
  res.json(serialize(room));
}));

// 4. Admin: Create a new Quiz Room
router.post('/', asyncHandler(async (req, res) => {
  const { title, description, batch, timeLimitMinutes, isActive, allowReview, questions, roomCode } = req.body;
  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: 'Quiz room title is required.' });
  }

  let finalCode = (roomCode || '').trim().toUpperCase();
  if (!finalCode) {
    let attempts = 0;
    while (attempts < 5) {
      finalCode = generateRoomCode();
      const existing = await QuizRoom.exists({ roomCode: finalCode });
      if (!existing) break;
      attempts++;
    }
  } else {
    const existing = await QuizRoom.exists({ roomCode: finalCode });
    if (existing) {
      return res.status(409).json({ message: `Room code "${finalCode}" is already in use. Please pick another code.` });
    }
  }

  const formattedQuestions = Array.isArray(questions) && questions.length
    ? questions.map((q, idx) => ({
        id: q.id || `q_${Date.now()}_${idx}`,
        question: String(q.question || '').trim(),
        options: Array.isArray(q.options) ? q.options.map((opt) => String(opt).trim()) : [],
        answer: Number(q.answer) || 0,
        explanation: String(q.explanation || '').trim(),
        points: Number(q.points) || 1,
      }))
    : defaultSeedQuestions;

  const expiresHours = Number(req.body.expireHours) || 48; // Exactly 48 hours auto-delete
  const expiresAt = req.body.expiresAt
    ? new Date(req.body.expiresAt)
    : new Date(Date.now() + expiresHours * 60 * 60 * 1000);

  const newRoom = await QuizRoom.create({
    title: String(title).trim(),
    roomCode: finalCode,
    description: String(description || '').trim(),
    batch: String(batch || '').trim(),
    timeLimitMinutes: Number(timeLimitMinutes) || 0,
    isActive: isActive !== false,
    allowReview: allowReview !== false,
    questions: formattedQuestions,
    submissions: [],
    expiresAt,
  });

  res.status(201).json(serialize(newRoom));
}));

// 5. Admin: Update a Quiz Room
router.put('/:id', asyncHandler(async (req, res) => {
  const room = await QuizRoom.findById(req.params.id);
  if (!room) {
    return res.status(404).json({ message: 'Quiz room not found.' });
  }

  const { title, description, batch, timeLimitMinutes, isActive, allowReview, questions, roomCode, expiresAt } = req.body;

  if (title !== undefined) room.title = String(title).trim();
  if (description !== undefined) room.description = String(description).trim();
  if (batch !== undefined) room.batch = String(batch).trim();
  if (timeLimitMinutes !== undefined) room.timeLimitMinutes = Number(timeLimitMinutes) || 0;
  if (isActive !== undefined) room.isActive = Boolean(isActive);
  if (allowReview !== undefined) room.allowReview = Boolean(allowReview);
  if (expiresAt !== undefined) room.expiresAt = expiresAt ? new Date(expiresAt) : room.expiresAt;

  if (roomCode && roomCode.trim().toUpperCase() !== room.roomCode) {
    const newCode = roomCode.trim().toUpperCase();
    const existing = await QuizRoom.exists({ roomCode: newCode, _id: { $ne: room._id } });
    if (existing) {
      return res.status(409).json({ message: `Room code "${newCode}" is already in use by another room.` });
    }
    room.roomCode = newCode;
  }

  if (Array.isArray(questions)) {
    room.questions = questions.map((q, idx) => ({
      id: q.id || `q_${Date.now()}_${idx}`,
      question: String(q.question || '').trim(),
      options: Array.isArray(q.options) ? q.options.map((opt) => String(opt).trim()) : [],
      answer: Number(q.answer) || 0,
      explanation: String(q.explanation || '').trim(),
      points: Number(q.points) || 1,
    }));
  }

  await room.save();
  res.json(serialize(room));
}));

// 6. Admin: Delete a Quiz Room
router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await QuizRoom.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: 'Quiz room not found.' });
  }
  res.json({ message: 'Quiz room deleted successfully.', id: req.params.id });
}));

// 7. Student: Submit Quiz Answers
router.post('/code/:code/submit', asyncHandler(async (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  const room = await QuizRoom.findOne({ roomCode: code });
  if (!room) {
    return res.status(404).json({ message: `Quiz room "${code}" not found.` });
  }

  if (!room.isActive) {
    return res.status(403).json({ message: 'This quiz room is currently closed for submissions.' });
  }

  const { studentName, studentEmail, studentId, answers, timeTakenSeconds } = req.body;
  if (!studentName || !String(studentName).trim()) {
    return res.status(400).json({ message: 'Please provide your name before submitting.' });
  }

  // Calculate score securely on server
  let score = 0;
  const questions = room.questions || [];
  const studentAnswers = answers || {};

  questions.forEach((q) => {
    const studentAns = studentAnswers[q.id];
    if (studentAns !== undefined && studentAns !== null && Number(studentAns) === Number(q.answer)) {
      score += 1;
    }
  });

  const totalQuestions = questions.length;
  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

  const submission = {
    studentName: String(studentName).trim(),
    studentEmail: String(studentEmail || '').trim(),
    studentId: String(studentId || '').trim(),
    score,
    totalQuestions,
    percentage,
    answers: studentAnswers,
    timeTakenSeconds: Math.max(0, Number(timeTakenSeconds) || 0),
    submittedAt: new Date(),
  };

  room.submissions.unshift(submission);
  await room.save();

  // Return submission result and question review breakdown
  const isPassing = score >= Math.ceil(totalQuestions / 2);
  const breakdown = room.allowReview
    ? questions.map((q) => {
        const studentAns = studentAnswers[q.id];
        const isCorrect = studentAns !== undefined && studentAns !== null && Number(studentAns) === Number(q.answer);
        return {
          id: q.id,
          question: q.question,
          options: q.options,
          selectedAnswer: studentAns !== undefined && studentAns !== null ? Number(studentAns) : null,
          correctAnswer: q.answer,
          isCorrect,
          explanation: q.explanation || '',
        };
      })
    : null;

  res.status(201).json({
    success: true,
    score,
    totalQuestions,
    percentage,
    isPassing,
    submission: serialize(room.submissions[0]),
    breakdown,
  });
}));

// 8. Admin: Delete a specific student submission
router.delete('/:id/submissions/:submissionId', asyncHandler(async (req, res) => {
  const room = await QuizRoom.findById(req.params.id);
  if (!room) {
    return res.status(404).json({ message: 'Quiz room not found.' });
  }

  const initialCount = room.submissions.length;
  room.submissions = room.submissions.filter(
    (s) => String(s._id) !== req.params.submissionId && String(s.id) !== req.params.submissionId
  );

  if (room.submissions.length === initialCount) {
    return res.status(404).json({ message: 'Submission record not found.' });
  }

  await room.save();
  res.json({ message: 'Submission deleted successfully.', id: req.params.submissionId });
}));

// 9. Admin: Clear all submissions for a quiz room
router.delete('/:id/submissions', asyncHandler(async (req, res) => {
  const room = await QuizRoom.findById(req.params.id);
  if (!room) {
    return res.status(404).json({ message: 'Quiz room not found.' });
  }

  room.submissions = [];
  await room.save();
  res.json({ message: 'All student submissions cleared successfully.' });
}));

export default router;
