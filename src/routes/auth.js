import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// Dynamic salt for token signing
const TOKEN_SALT = process.env.AUTH_SALT || 'anudip-workspace-secure-salt-2026';

// Dynamic resolver for current admin password from environment
export function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || 'anudip@admin';
}

// Hash helper using standard SHA-256
export function hashPassword(plainText) {
  return crypto.createHash('sha256').update(`${plainText}::${TOKEN_SALT}`).digest('hex');
}

// Generate signed session token with EXACT 15-minute expiry
function generateAdminToken(expiresAt) {
  const payload = `admin::${expiresAt}`;
  const signature = crypto.createHmac('sha256', TOKEN_SALT).update(payload).digest('hex');
  return Buffer.from(`${payload}::${signature}`).toString('base64');
}

// Verify token validity and 15-minute expiry
export function verifyAdminToken(token) {
  if (!token) return { valid: false, reason: 'missing_token' };
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [user, expiresAtStr, signature] = decoded.split('::');
    if (user !== 'admin') return { valid: false, reason: 'invalid_user' };

    const expiresAt = Number(expiresAtStr);
    if (!expiresAt) return { valid: false, reason: 'invalid_expiry' };

    // Strict 15-minute expiration check
    if (Date.now() > expiresAt) {
      return { valid: false, reason: 'expired', expiresAt };
    }

    const expectedSignature = crypto.createHmac('sha256', TOKEN_SALT).update(`admin::${expiresAt}`).digest('hex');
    if (signature !== expectedSignature) {
      return { valid: false, reason: 'invalid_signature' };
    }

    return {
      valid: true,
      expiresAt,
      remainingSeconds: Math.max(0, Math.round((expiresAt - Date.now()) / 1000)),
    };
  } catch {
    return { valid: false, reason: 'malformed_token' };
  }
}

// POST /api/auth/verify-admin - Verify Admin Password with 15-Minute Session Issuance
router.post('/verify-admin', (req, res) => {
  const { password, passwordHash } = req.body || {};

  if (!password && !passwordHash) {
    return res.status(400).json({ success: false, message: 'Password is required' });
  }

  const currentAdminPassword = getAdminPassword();
  const expectedHash = hashPassword(currentAdminPassword);

  const isMatch = password
    ? hashPassword(password) === expectedHash
    : passwordHash === expectedHash;

  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Invalid administrator password. Please try again.',
    });
  }

  // Exact 15-minute expiration window (15 * 60 * 1000 ms)
  const SESSION_DURATION_MS = 15 * 60 * 1000;
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const token = generateAdminToken(expiresAt);

  return res.json({
    success: true,
    token,
    role: 'admin',
    adminName: 'LMS Administrator',
    loginTime: Date.now(),
    expiresAt,
    expiresInMinutes: 15,
  });
});

// GET /api/auth/status - Check if current session token is still within 15-minute window
router.get('/status', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const verification = verifyAdminToken(token);

  if (!verification.valid) {
    return res.status(401).json({
      authenticated: false,
      role: 'guest',
      reason: verification.reason,
      message: verification.reason === 'expired'
        ? 'Administrator session expired after 15 minutes. Please re-enter your password.'
        : 'Invalid or missing administrator token.',
    });
  }

  return res.json({
    authenticated: true,
    role: 'admin',
    expiresAt: verification.expiresAt,
    remainingSeconds: verification.remainingSeconds,
  });
});

export default router;
