import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireDivisionAdmin, requireMonitor } from '../../middleware/rbac.middleware.js';
import * as agentController from './agent.controller.js';

const router = express.Router();

router.get('/', requireAuth, requireMonitor, agentController.list);
router.get('/:id', requireAuth, requireMonitor, agentController.getById);
router.get('/:id/health', requireAuth, requireMonitor, agentController.health);
router.get('/:id/logs', requireAuth, requireMonitor, agentController.logs);
router.post('/:id/command', requireAuth, requireMonitor, agentController.sendCommand);
router.patch('/:id/enable', requireAuth, requireDivisionAdmin, agentController.enable);
router.patch('/:id/disable', requireAuth, requireDivisionAdmin, agentController.disable);

export default router;
