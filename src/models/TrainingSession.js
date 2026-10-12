import mongoose from 'mongoose';

const trainingSessionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  field: { type: String, required: true, trim: true, maxlength: 120 },
  batch: { type: String, trim: true, maxlength: 120, default: '' },
  meetLink: { type: String, trim: true, required: true, maxlength: 1000 },
  conferenceRecordName: { type: String, trim: true, default: '', maxlength: 300 },
  trainer: { type: String, trim: true, default: '', maxlength: 120 },
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  status: { type: String, enum: ['Upcoming', 'Live', 'Completed', 'Cancelled'], default: 'Upcoming' },
  description: { type: String, maxlength: 3000, default: '' },
}, { timestamps: true, versionKey: false });

trainingSessionSchema.index({ date: 1, startTime: 1 });
trainingSessionSchema.index({ status: 1 });
trainingSessionSchema.index({ batch: 1 });

export default mongoose.model('TrainingSession', trainingSessionSchema);
