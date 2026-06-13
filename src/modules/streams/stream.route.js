import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireMonitor } from '../../middleware/rbac.middleware.js';
import * as streamController from './stream.controller.js';

const router = express.Router();

router.post('/request', requireAuth, requireMonitor, streamController.request);
router.get('/active', requireAuth, requireMonitor, streamController.listActive);
router.get('/:sessionId', requireAuth, requireMonitor, streamController.getById);
router.delete('/:sessionId', requireAuth, requireMonitor, streamController.remove);

export default router;
