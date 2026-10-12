import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 180 },
  phone: { type: String, trim: true, maxlength: 40, default: '' },
  field: { type: String, required: true, trim: true, maxlength: 120 },
  batch: { type: String, trim: true, maxlength: 120, default: '' },
  status: { type: String, enum: ['Active', 'Completed', 'On hold'], default: 'Active' },
  enrollmentDate: { type: String, default: '' },
  lmsUsername: { type: String, trim: true, maxlength: 120, default: '' },
  lmsPassword: { type: String, trim: true, maxlength: 120, default: '' },
  meetDisplayName: { type: String, trim: true, maxlength: 120, default: '' },
  notes: { type: String, maxlength: 3000, default: '' },
}, { timestamps: true, versionKey: false });

studentSchema.index({ email: 1 }, { unique: true });
studentSchema.index({ name: 1, field: 1 });
studentSchema.index({ batch: 1 });
studentSchema.index({ lmsUsername: 1 });
studentSchema.index({ createdAt: -1 });

export default mongoose.model('Student', studentSchema);
