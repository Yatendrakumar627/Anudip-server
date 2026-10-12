import mongoose from 'mongoose';

const placementSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  company: { type: String, required: true, trim: true, maxlength: 180 },
  role: { type: String, required: true, trim: true, maxlength: 180 },
  location: { type: String, trim: true, default: '', maxlength: 180 },
  packageLpa: { type: Number, min: 0, default: null },
  status: { type: String, enum: ['Not started', 'Shortlisted', 'Interviewing', 'Placed', 'Not looking'], default: 'Not started' },
  placedAt: { type: String, default: '' },
  offerLetterUrl: { type: String, trim: true, default: '', maxlength: 1000 },
  notes: { type: String, maxlength: 3000, default: '' },
}, { timestamps: true, versionKey: false });

placementSchema.index({ studentId: 1, status: 1 });
placementSchema.index({ status: 1 });
placementSchema.index({ updatedAt: -1 });

export default mongoose.model('Placement', placementSchema);
