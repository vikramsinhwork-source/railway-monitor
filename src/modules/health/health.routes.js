import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireDivisionAdmin, requireMonitor } from '../../middleware/rbac.middleware.js';
import * as healthController from './health.controller.js';

const router = express.Router();

router.get('/summary', requireAuth, requireMonitor, healthController.summary);
router.get('/divisions', requireAuth, requireMonitor, healthController.divisions);
router.get('/lobbies/:id', requireAuth, requireMonitor, healthController.lobby);
router.get('/devices/:id/logs', requireAuth, requireMonitor, healthController.deviceLogs);
router.post('/devices/:id/recover', requireAuth, requireDivisionAdmin, healthController.recover);

export default router;
