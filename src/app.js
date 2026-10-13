import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import mongoose from 'mongoose';
import Student from './models/Student.js';
import TrainingSession from './models/TrainingSession.js';
import Placement from './models/Placement.js';
import Batch from './models/Batch.js';
import crudFactory from './routes/crudFactory.js';
import sessionRoutes from './routes/sessions.js';
import attendanceRoutes from './routes/attendance.js';
import integrationRoutes from './routes/integrations.js';
import authRoutes from './routes/auth.js';
import quizRoomRoutes from './routes/quizRooms.js';
import Attendance from './models/Attendance.js';
import { asyncHandler, serialize } from './utils.js';

const app = express();
app.disable('x-powered-by');
const rawOrigins = (process.env.CLIENT_ORIGIN || '*').split(',').map((val) => val.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      rawOrigins.includes('*') ||
      rawOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.endsWith('.onrender.com') ||
      origin.includes('localhost')
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: false,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Reactive Workspace Cache Versioning: guarantees instantaneous 304s on polling and immediate invalidation on mutations
let workspaceVersion = Date.now();
let cachedWorkspacePayload = null;
let cachedWorkspaceVersion = null;

export function bumpWorkspaceVersion() {
  workspaceVersion = Date.now();
  cachedWorkspacePayload = null;
  cachedWorkspaceVersion = null;
}

app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        bumpWorkspaceVersion();
      }
    });
  }
  next();
});

// High-Signal Senior Developer Logger: Silences repetitive 304 polling spam, highlights mutations and slow queries
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - start;
    const { statusCode } = res;
    // Suppress noisy 304 (Not Modified / cached polling hits) and health checks
    if (statusCode === 304 || req.path === '/api/health') return;

    // Suppress fast successful polling GET requests to keep terminal clean and readable
    if (req.method === 'GET' && statusCode < 400 && elapsed < 150 && process.env.VERBOSE_LOGS !== 'true') {
      return;
    }

    const methodPad = req.method.padEnd(6);
    let tag = '✨ [API]';
    if (statusCode >= 500) tag = '❌ [SERVER ERROR]';
    else if (statusCode >= 400) tag = '⚠️ [CLIENT ERROR]';
    else if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) tag = '⚡ [MUTATION]';
    else if (elapsed > 200) tag = '🐢 [SLOW QUERY]';

    console.log(`${tag} ${methodPad} ${req.originalUrl || req.url} ${statusCode} - ${elapsed}ms`);
  });
  next();
});

// High-Performance two-way synchronization between Batches and Student Directory
async function syncBatchToStudents(batchDoc) {
  if (!batchDoc || !batchDoc.rows || !Array.isArray(batchDoc.rows) || !batchDoc.rows.length) return;
  const rows = batchDoc.rows.filter((r) => r && String(r.name || '').trim());
  if (!rows.length) return;

  const validIds = [];
  const emails = [];
  const lmsUsers = [];

  rows.forEach((r) => {
    if (r.id && mongoose.isValidObjectId(r.id)) validIds.push(new mongoose.Types.ObjectId(r.id));
    if (r.email) emails.push(String(r.email).trim().toLowerCase());
    if (r.lmsUsername) lmsUsers.push(String(r.lmsUsername).trim());
  });

  // Pre-fetch all candidates in 1 single fast query
  const queryConditions = [{ batch: batchDoc.name }];
  if (validIds.length) queryConditions.push({ _id: { $in: validIds } });
  if (emails.length) queryConditions.push({ email: { $in: emails } });
  if (lmsUsers.length) queryConditions.push({ lmsUsername: { $in: lmsUsers } });

  let existingStudents = [];
  try {
    existingStudents = await Student.find({ $or: queryConditions }).lean();
  } catch (err) {
    console.warn('Sync student pre-fetch warning:', err.message);
  }

  const existingById = new Map();
  const existingByEmail = new Map();
  const existingByLms = new Map();
  const existingByName = new Map();

  existingStudents.forEach((s) => {
    existingById.set(String(s._id), s);
    if (s.email) existingByEmail.set(s.email.toLowerCase(), s);
    if (s.lmsUsername) existingByLms.set(s.lmsUsername, s);
    existingByName.set(`${s.name.toLowerCase()}_${(s.batch || '').toLowerCase()}`, s);
  });

  const operations = [];

  rows.forEach((row, i) => {
    const rowName = String(row.name || '').trim();
    const rowEmail = String(row.email || '').trim();
    const rowLmsUsername = String(row.lmsUsername || '').trim();
    const rowPhone = String(row.phone || '').trim();

    const existing =
      (row.id && existingById.get(String(row.id))) ||
      (rowEmail && existingByEmail.get(rowEmail.toLowerCase())) ||
      (rowLmsUsername && existingByLms.get(rowLmsUsername)) ||
      existingByName.get(`${rowName.toLowerCase()}_${(batchDoc.name || '').toLowerCase()}`);

    const email = rowEmail
      ? rowEmail.toLowerCase()
      : `${rowName.toLowerCase().replace(/[^a-z0-9]/g, '.')}.${Date.now().toString(36)}_${i}@example.org`;

    const lmsUsername = rowLmsUsername
      ? rowLmsUsername
      : `ANU_${rowName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)}`;

    const payload = {
      name: rowName,
      email,
      phone: rowPhone,
      field: batchDoc.field || 'General Training',
      batch: batchDoc.name,
      status: row.status || 'Active',
      lmsUsername,
      lmsPassword: String(row.lmsPassword || 'Anudip@2026'),
      enrollmentDate: row.enrollmentDate || batchDoc.startDate || new Date().toISOString().slice(0, 10),
    };

    if (existing) {
      operations.push({
        updateOne: {
          filter: { _id: existing._id },
          update: { $set: payload },
        },
      });
    } else {
      operations.push({
        insertOne: {
          document: payload,
        },
      });
    }
  });

  if (operations.length) {
    try {
      await Student.bulkWrite(operations, { ordered: false });
    } catch (err) {
      console.warn('Batch bulkWrite student sync partial notice:', err.message);
    }
  }
}

async function syncStudentToBatch(studentDoc) {
  if (!studentDoc || !studentDoc.batch) return;
  const batch = await Batch.findOne({
    $or: [{ name: studentDoc.batch }, { code: studentDoc.batch }],
  }).select('_id rows');
  if (!batch) return;

  const rows = Array.isArray(batch.rows) ? [...batch.rows] : [];
  const sId = String(studentDoc._id);
  const sEmail = (studentDoc.email || '').toLowerCase();
  const sLms = (studentDoc.lmsUsername || '').toLowerCase();

  const rowIndex = rows.findIndex((r) => {
    if (!r) return false;
    return (
      (r.id && String(r.id) === sId) ||
      (sEmail && r.email && String(r.email).toLowerCase() === sEmail) ||
      (sLms && r.lmsUsername && String(r.lmsUsername).toLowerCase() === sLms)
    );
  });

  const rowData = {
    id: sId,
    name: studentDoc.name,
    email: studentDoc.email,
    lmsUsername: studentDoc.lmsUsername,
    lmsPassword: studentDoc.lmsPassword || 'Anudip@2026',
    phone: studentDoc.phone || '',
    status: studentDoc.status || 'Active',
  };

  if (rowIndex >= 0) {
    rows[rowIndex] = { ...rows[rowIndex], ...rowData };
  } else {
    rows.push(rowData);
  }

  await Batch.findByIdAndUpdate(batch._id, { rows });
}

app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.get('/api/health', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: {
      heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    },
    timestamp: new Date().toISOString(),
  });
});

// Unified High-Performance Workspace Endpoint: Fetch all active resources with instant conditional 304 caching
app.get('/api/workspace', asyncHandler(async (req, res) => {
  const currentEtag = `"ws_${workspaceVersion}"`;
  if (req.headers['if-none-match'] === currentEtag) {
    return res.status(304).end();
  }

  res.set('ETag', currentEtag);
  res.set('Cache-Control', 'private, no-cache');

  if (cachedWorkspacePayload && cachedWorkspaceVersion === workspaceVersion) {
    return res.json(cachedWorkspacePayload);
  }

  const [students, sessions, attendance, placements, batches] = await Promise.all([
    Student.find().sort({ createdAt: -1 }).limit(1000).lean(),
    TrainingSession.find().sort({ date: 1, startTime: 1 }).limit(1000).lean(),
    Attendance.find().sort({ date: -1, updatedAt: -1 }).limit(1000).lean(),
    Placement.find().sort({ updatedAt: -1 }).limit(1000).lean(),
    Batch.find().sort({ createdAt: -1 }).limit(500).lean(),
  ]);

  const payload = {
    students: students.map(serialize),
    sessions: sessions.map(serialize),
    attendance: attendance.map(serialize),
    placements: placements.map(serialize),
    batches: batches.map(serialize),
  };

  cachedWorkspacePayload = payload;
  cachedWorkspaceVersion = workspaceVersion;

  res.json(payload);
}));
app.use('/api/students', crudFactory(Student, {
  searchFields: ['name', 'email', 'field', 'batch', 'phone'],
  sort: { createdAt: -1 },
  onSave: async (studentDoc) => {
    await syncStudentToBatch(studentDoc);
  },
  onDelete: async (deleted) => {
    await Promise.all([
      Attendance.deleteMany({ studentId: deleted._id }),
      Placement.deleteMany({ studentId: deleted._id }),
      Batch.updateMany({ 'rows.email': deleted.email }, { $pull: { rows: { email: deleted.email } } }),
      Batch.updateMany({ 'rows.id': String(deleted._id) }, { $pull: { rows: { id: String(deleted._id) } } }),
    ]);
  },
}));
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/placements', crudFactory(Placement, {
  searchFields: ['company', 'role', 'location', 'status'],
  sort: { updatedAt: -1 },
  validateCreate: async (body) => { if (!mongoose.isValidObjectId(body.studentId) || !(await Student.exists({ _id: body.studentId }))) { const error = new Error('Select an existing student for this placement.'); error.status = 400; throw error; } },
  validateUpdate: async (body) => { if (body.studentId && (!mongoose.isValidObjectId(body.studentId) || !(await Student.exists({ _id: body.studentId })))) { const error = new Error('Select an existing student for this placement.'); error.status = 400; throw error; } },
}));
app.use('/api/batches', crudFactory(Batch, {
  searchFields: ['name', 'code', 'field', 'trainer'],
  sort: { createdAt: -1 },
  onSave: async (batchDoc) => {
    await syncBatchToStudents(batchDoc);
  },
}));
app.use('/api/integrations', integrationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/quiz-rooms', quizRoomRoutes);

app.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'NGO Training Hub API',
    uptime: `${Math.round(process.uptime())}s`,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/dashboard', asyncHandler(async (_req, res) => {
  const [students, sessions, batches, attendanceTotal, presentTotal, placementAgg] = await Promise.all([
    Student.countDocuments(),
    TrainingSession.countDocuments(),
    Batch.countDocuments(),
    Attendance.countDocuments(),
    Attendance.countDocuments({ status: { $in: ['Present', 'Late'] } }),
    Placement.aggregate([
      { $match: { status: 'Placed' } },
      {
        $group: {
          _id: null,
          placedCount: { $sum: 1 },
          totalPackage: { $sum: { $ifNull: ['$packageLpa', 0] } },
        },
      },
    ]),
  ]);

  const placedCount = placementAgg[0]?.placedCount || 0;
  const totalPackage = placementAgg[0]?.totalPackage || 0;

  res.json({
    students,
    sessions,
    batches,
    attendanceRecords: attendanceTotal,
    attendanceRate: attendanceTotal ? Math.round((presentTotal / attendanceTotal) * 100) : 0,
    placed: placedCount,
    averagePackageLpa: placedCount ? Number((totalPackage / placedCount).toFixed(2)) : 0,
  });
}));

app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code === 11000) return res.status(409).json({ message: 'A record with this unique value already exists.' });
  if (error instanceof mongoose.Error.ValidationError) return res.status(400).json({ message: error.message });
  const status = Number(error.status) || 500;
  res.status(status).json({ message: status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error.' : error.message || 'Internal server error.' });
});

export default app;
