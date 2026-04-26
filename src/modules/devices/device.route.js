import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireDivisionAdmin, requireMonitor } from '../../middleware/rbac.middleware.js';
import * as deviceController from './device.controller.js';

const router = express.Router();

router.get('/', requireAuth, requireMonitor, deviceController.list);
router.get('/:id', requireAuth, requireMonitor, deviceController.getById);
router.post('/', requireAuth, requireDivisionAdmin, deviceController.create);
router.patch('/:id', requireAuth, requireDivisionAdmin, deviceController.patch);
router.delete('/:id', requireAuth, requireDivisionAdmin, deviceController.remove);
router.patch('/:id/deactivate', requireAuth, requireDivisionAdmin, deviceController.deactivate);
router.patch('/:id/reactivate', requireAuth, requireDivisionAdmin, deviceController.reactivate);

export default router;
