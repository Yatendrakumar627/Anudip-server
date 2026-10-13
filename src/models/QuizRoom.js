import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  question: { type: String, required: true, trim: true },
  options: [{ type: String, required: true, trim: true }],
  answer: { type: Number, required: true, default: 0 },
  explanation: { type: String, default: '' },
  points: { type: Number, default: 1 },
}, { _id: false });

const submissionSchema = new mongoose.Schema({
  studentName: { type: String, required: true, trim: true },
  studentEmail: { type: String, trim: true, default: '' },
  studentId: { type: String, trim: true, default: '' },
  score: { type: Number, required: true, default: 0 },
  totalQuestions: { type: Number, required: true, default: 0 },
  percentage: { type: Number, required: true, default: 0 },
  answers: { type: mongoose.Schema.Types.Mixed, default: {} },
  timeTakenSeconds: { type: Number, default: 0 },
  submittedAt: { type: Date, default: Date.now },
}, { timestamps: true });

const quizRoomSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  roomCode: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 50 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  batch: { type: String, trim: true, maxlength: 120, default: '' },
  timeLimitMinutes: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  allowReview: { type: Boolean, default: true },
  questions: { type: [questionSchema], default: [] },
  submissions: { type: [submissionSchema], default: [] },
  createdBy: { type: String, default: 'Admin' },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 48 * 60 * 60 * 1000), // Automatically expires after 48 hours
  },
}, {
  timestamps: true,
  versionKey: false,
});

quizRoomSchema.index({ roomCode: 1 }, { unique: true });
quizRoomSchema.index({ createdAt: -1 });
// MongoDB TTL index: automatically deletes document when current time >= expiresAt
quizRoomSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.QuizRoom || mongoose.model('QuizRoom', quizRoomSchema);
