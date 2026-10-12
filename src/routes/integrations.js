import { Router } from 'express';
import { googleMeetConfigured } from '../services/googleMeet.js';

const router = Router();
router.get('/google/status', (_req, res) => {
  res.json({ configured: googleMeetConfigured(), provider: 'Google Meet REST API', mode: googleMeetConfigured() ? 'oauth-refresh-token' : 'not-configured' });
});
export default router;
