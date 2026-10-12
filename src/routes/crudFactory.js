import { Router } from 'express';
import mongoose from 'mongoose';
import { asyncHandler, serialize } from '../utils.js';

export default function crudFactory(Model, { searchFields = [], sort = { createdAt: -1 }, validateCreate = null, validateUpdate = null, onSave = null, onDelete = null } = {}) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const query = {};
    if (req.query.q && searchFields.length) {
      const safe = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = searchFields.map((field) => ({ [field]: { $regex: safe, $options: 'i' } }));
    }
    if (req.query.status) query.status = req.query.status;
    if (req.query.field) query.field = req.query.field;
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
    const rows = await Model.find(query).sort(sort).limit(limit).lean();
    res.json(rows.map(serialize));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    if (validateCreate) await validateCreate(req.body);
    const created = await Model.create(req.body);
    if (onSave) await onSave(created, 'create');
    res.status(201).json(serialize(created));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
    const doc = await Model.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Record not found.' });
    res.json(serialize(doc));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
    if (validateUpdate) await validateUpdate(req.body);
    const updated = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: 'Record not found.' });
    if (onSave) await onSave(updated, 'update');
    res.json(serialize(updated));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid record ID.' });
    const deleted = await Model.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Record not found.' });
    if (onDelete) await onDelete(deleted);
    res.json({ success: true, id: req.params.id });
  }));

  return router;
}
