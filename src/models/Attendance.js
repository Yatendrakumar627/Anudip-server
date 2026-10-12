import mongoose from 'mongoose';

const segmentSchema = new mongoose.Schema({
  joinedAt: { type: String, required: true },
  leftAt: { type: String, default: null, validate: { validator(value) { if (!value) return true; const joined = new Date(this.joinedAt).getTime(); const left = new Date(value).getTime(); return Number.isFinite(joined) && Number.isFinite(left) && left > joined; }, message: 'Leave time must be later than join time.' } },
}, { _id: false });

const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrainingSession', required: true, index: true },
  date: { type: String, required: true },
  status: { type: String, enum: ['Present', 'Late', 'Absent', 'Excused'], default: 'Present' },
  source: { type: String, enum: ['manual', 'manual_adjustment', 'google_me_csv', 'google_me_api'], default: 'manual' },
  segments: { type: [segmentSchema], default: [] },
  notes: { type: String, maxlength: 3000, default: '' },
}, { timestamps: true, versionKey: false });

attendanceSchema.index({ studentId: 1, sessionId: 1 }, { unique: true });
attendanceSchema.index({ date: -1, updatedAt: -1 });
attendanceSchema.index({ status: 1 });

export default mongoose.model('Attendance', attendanceSchema);
