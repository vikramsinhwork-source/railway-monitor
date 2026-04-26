import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireDivisionAdmin, requireMonitor } from '../../middleware/rbac.middleware.js';
import * as lobbyController from './lobby.controller.js';

const router = express.Router();

router.get('/', requireAuth, requireMonitor, lobbyController.list);
router.get('/:id', requireAuth, requireMonitor, lobbyController.getById);
router.post('/', requireAuth, requireDivisionAdmin, lobbyController.create);
router.patch('/:id', requireAuth, requireDivisionAdmin, lobbyController.patch);
router.delete('/:id', requireAuth, requireDivisionAdmin, lobbyController.remove);

export default router;
