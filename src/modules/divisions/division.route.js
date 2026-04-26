import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireMonitor, requireSuperAdmin } from '../../middleware/rbac.middleware.js';
import * as divisionController from './division.controller.js';

const router = express.Router();

router.get('/', requireAuth, requireMonitor, divisionController.list);
router.get('/:id', requireAuth, requireMonitor, divisionController.getById);
router.post('/', requireAuth, requireSuperAdmin, divisionController.create);
router.patch('/:id', requireAuth, requireSuperAdmin, divisionController.patch);

export default router;
