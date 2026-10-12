import { google } from 'googleapis';
import Student from '../models/Student.js';
import Attendance from '../models/Attendance.js';
import TrainingSession from '../models/TrainingSession.js';

const MEET_API = 'https://meet.googleapis.com/v2';
const SESSION_TIME_ZONE = process.env.SESSION_TIME_ZONE || 'Asia/Kolkata';

function dateKeyInTimeZone(value, timeZone = SESSION_TIME_ZONE) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${part.year}-${part.month}-${part.day}`;
}

function zonedLocalDateTime(dateValue, timeValue, timeZone = SESSION_TIME_ZONE) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  const [hour, minute, second = 0] = String(timeValue || '').split(':').map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = targetAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const part = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
    const wallClockAsUtc = Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute), Number(part.second));
    const nextGuess = targetAsUtc - (wallClockAsUtc - guess);
    if (nextGuess === guess) break;
    guess = nextGuess;
  }
  return new Date(guess);
}

export function googleMeetConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

function getOAuthClient() {
  if (!googleMeetConfigured()) {
    const error = new Error('Google Meet OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN on the server.');
    error.status = 503;
    throw error;
  }
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

async function getAccessToken() {
  const client = getOAuthClient();
  const result = await client.getAccessToken();
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('Google OAuth did not return an access token.');
  return token;
}

async function meetGet(path, token) {
  const response = await fetch(`${MEET_API}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Google Meet API returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function listAll(path, field, token) {
  const values = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ pageSize: '250' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await meetGet(`${path}?${query.toString()}`, token);
    values.push(...(page[field] || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return values;
}

function participantDisplayName(participant) {
  return participant?.signedinUser?.displayName
    || participant?.anonymousUser?.displayName
    || participant?.phoneUser?.displayName
    || participant?.displayName
    || '';
}

function sessionSourceSegment(session) {
  return { joinedAt: session.startTime, leftAt: session.endTime || null };
}

/**
 * Reads the actual Meet conference participant sessions and maps display names to
 * student profiles. The user must set a conference record resource name like
 * `conferenceRecords/abc123` on the training session before calling this service.
 * If none is stored, it can be resolved from the Meet link and session date.
 */
async function resolveConferenceRecord(trainingSession, token) {
  const stored = String(trainingSession.conferenceRecordName || '').trim();
  if (/^conferenceRecords\/[A-Za-z0-9_-]+$/.test(stored)) {
    try {
      const previous = await meetGet(stored, token);
      const startDay = dateKeyInTimeZone(previous.startTime);
      if (startDay === String(trainingSession.date || '').slice(0, 10) || !previous.endTime) return stored;
    } catch (error) {
      if (![400, 404].includes(error.status)) throw error;
    }
  }

  let meetingCode = '';
  try {
    const url = new URL(trainingSession.meetLink);
    meetingCode = url.pathname.match(/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})/i)?.[1]?.toLowerCase() || '';
  } catch { /* a missing or malformed link is handled below */ }
  if (!meetingCode) {
    const error = new Error('Add a Google Meet link with a meeting code to this session.');
    error.status = 400;
    throw error;
  }

  const query = new URLSearchParams({ filter: `space.meeting_code = "${meetingCode}"`, pageSize: '100' });
  const payload = await meetGet(`conferenceRecords?${query.toString()}`, token);
  const sessionDate = String(trainingSession.date || '').slice(0, 10);
  const records = (payload.conferenceRecords || []).filter((record) => {
    const startsOnSessionDate = dateKeyInTimeZone(record.startTime) === sessionDate;
    return startsOnSessionDate;
  }).sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
  const resolved = records.find((record) => !record.endTime) || records[0];
  if (!resolved?.name) {
    const error = new Error(`No Google Meet conference record found for ${meetingCode} on ${sessionDate}. Check that the meeting has started and that the authorised Google account can access it.`);
    error.status = 404;
    throw error;
  }
  trainingSession.conferenceRecordName = resolved.name;
  await trainingSession.save();
  return resolved.name;
}

/**
 * Reads the actual Meet conference participant sessions and maps display names to
 * student profiles. If the conference record has not been stored yet, the service
 * attempts to resolve it from the meeting code and session date.
 */
export async function syncConferenceAttendance(trainingSession) {
  const token = await getAccessToken();
  const conferenceRecordName = await resolveConferenceRecord(trainingSession, token);
  const participants = await listAll(`${conferenceRecordName}/participants`, 'participants', token);
  const students = await Student.find({}).lean();
  const normalize = (value) => String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const byName = new Map();
  for (const student of students) {
    for (const candidate of [student.meetDisplayName, student.name]) {
      const key = normalize(candidate);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, student);
      else if (byName.get(key) && String(byName.get(key)._id) !== String(student._id)) byName.set(key, null);
    }
  }

  const ambiguousNames = new Set();
  const importedByStudent = new Map();
  let unmatched = 0;
  for (const participant of participants) {
    const name = participantDisplayName(participant);
    const normalizedName = normalize(name);
    const student = byName.get(normalizedName);
    if (!student) { if (byName.has(normalizedName)) ambiguousNames.add(normalizedName); unmatched += 1; continue; }
    const sessions = await listAll(`${participant.name}/participantSessions`, 'participantSessions', token);
    const segments = sessions.map(sessionSourceSegment).filter((segment) => segment.joinedAt);
    const existing = importedByStudent.get(String(student._id)) || [];
    existing.push(...segments);
    importedByStudent.set(String(student._id), existing);
  }

  // A blank batch means this session is open to all enrolled learners; otherwise
  // only learners in that cohort are expected. Do not mark learners absent while
  // the session is still running, because they may join later.
  const roster = trainingSession.batch
    ? students.filter((student) => String(student.batch || '').trim() === String(trainingSession.batch).trim())
    : students;
  const now = new Date();
  const plannedEnd = trainingSession.date && trainingSession.endTime
    ? zonedLocalDateTime(trainingSession.date, trainingSession.endTime)
    : null;
  const sessionEnded = trainingSession.status === 'Completed'
    || (plannedEnd && !Number.isNaN(plannedEnd.getTime()) && plannedEnd.getTime() < now.getTime());
  let imported = 0;
  for (const student of roster) {
    const studentId = String(student._id);
    const segments = importedByStudent.get(studentId) || [];
    const current = await Attendance.findOne({ studentId, sessionId: trainingSession._id }).lean();

    // Preserve explicit operator edits and CSV imports. The Meet API may not expose
    // every participant due to display-name mismatch, organisation policy or delayed
    // processing; an empty API result must not erase trusted manual data.
    const isOperatorManaged = current && ['manual', 'manual_adjustment', 'google_me_csv'].includes(current.source);
    const hasAmbiguousAlias = [student.meetDisplayName, student.name].some((candidate) => ambiguousNames.has(normalize(candidate)));
    if (!segments.length && hasAmbiguousAlias) continue;
    if (!segments.length && !sessionEnded) continue;
    if (!segments.length && current && isOperatorManaged) continue;

    const update = {
      studentId,
      sessionId: trainingSession._id,
      date: trainingSession.date,
      status: segments.length ? 'Present' : 'Absent',
      source: 'google_me_api',
      segments,
      notes: current?.notes || '',
    };
    await Attendance.findOneAndUpdate({ studentId, sessionId: trainingSession._id }, update, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    imported += 1;
  }
  return { imported, unmatched, participants: participants.length, conferenceRecordName };
}

export async function syncActiveMeetSessions() {
  if (!googleMeetConfigured()) return { checked: 0, synced: 0 };
  const active = await TrainingSession.find({ status: 'Live' });
  let synced = 0;
  for (const session of active) {
    try {
      await syncConferenceAttendance(session);
      synced += 1;
    } catch (error) {
      // Sessions may be marked Live before Google has created the conference record.
      console.warn(`[meet-sync] ${session.title}: ${error.message}`);
    }
  }
  return { checked: active.length, synced };
}
