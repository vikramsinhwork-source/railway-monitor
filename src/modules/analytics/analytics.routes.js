import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireDivisionAdmin, requireMonitor } from '../../middleware/rbac.middleware.js';
import * as analyticsController from './analytics.controller.js';

const router = express.Router();

router.get('/summary', requireAuth, requireMonitor, analyticsController.summary);
router.get('/sla', requireAuth, requireMonitor, analyticsController.sla);
router.get('/divisions', requireAuth, requireDivisionAdmin, analyticsController.divisions);
router.get('/lobbies/:id', requireAuth, requireDivisionAdmin, analyticsController.lobby);
router.get('/devices/:id', requireAuth, requireDivisionAdmin, analyticsController.device);
router.get('/incidents', requireAuth, requireDivisionAdmin, analyticsController.incidents);
router.get('/autoheal', requireAuth, requireDivisionAdmin, analyticsController.autoheal);

export default router;
