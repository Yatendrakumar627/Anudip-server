import mongoose from 'mongoose';

const columnSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, default: 'text' },
  width: { type: Number, default: 160 },
  required: { type: Boolean, default: false },
  options: { type: [String], default: [] },
  hidden: { type: Boolean, default: false },
  hiddenOnLms: { type: Boolean, default: false },
}, { _id: false });

const batchSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 180 },
  code: { type: String, trim: true, maxlength: 120, default: '' },
  field: { type: String, trim: true, maxlength: 120, default: 'General Training' },
  trainer: { type: String, trim: true, maxlength: 120, default: '' },
  timing: { type: String, trim: true, maxlength: 120, default: '' },
  meetLink: { type: String, trim: true, maxlength: 1000, default: '' },
  status: { type: String, enum: ['Active', 'Upcoming', 'Completed', 'Archived'], default: 'Active' },
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' },
  description: { type: String, maxlength: 3000, default: '' },
  columns: {
    type: [columnSchema],
    default: [
      { key: 'name', label: 'Student Name', type: 'text', width: 200, required: true },
      { key: 'email', label: 'Email', type: 'email', width: 220 },
      { key: 'lmsUsername', label: 'User Name', type: 'text', width: 150 },
      { key: 'lmsPassword', label: 'Password', type: 'text', width: 140 },
    ],
  },
  rows: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true, versionKey: false });

batchSchema.index({ name: 1 });
batchSchema.index({ name: 1, field: 1 });
batchSchema.index({ code: 1 });
batchSchema.index({ createdAt: -1 });

export default mongoose.model('Batch', batchSchema);
