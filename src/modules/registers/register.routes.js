import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireDivisionAdmin } from '../../middleware/rbac.middleware.js';
import * as registerController from './register.controller.js';

const router = express.Router();

router.post('/', requireAuth, requireDivisionAdmin, registerController.create);
router.get('/', requireAuth, requireDivisionAdmin, registerController.list);
router.get('/:id', requireAuth, requireDivisionAdmin, registerController.getById);
router.patch('/:id', requireAuth, requireDivisionAdmin, registerController.patch);
router.delete('/:id', requireAuth, requireDivisionAdmin, registerController.remove);

router.get('/:id/questions', requireAuth, requireDivisionAdmin, registerController.listQuestions);
router.put('/:id/questions', requireAuth, requireDivisionAdmin, registerController.replaceQuestions);

router.get('/:id/entries', requireAuth, requireDivisionAdmin, registerController.listEntries);
router.get(
  '/:id/analytics/summary',
  requireAuth,
  requireDivisionAdmin,
  registerController.analyticsSummary
);
router.get(
  '/:id/export/preview',
  requireAuth,
  requireDivisionAdmin,
  registerController.exportPreview
);
router.get('/:id/export', requireAuth, requireDivisionAdmin, registerController.exportXlsx);

export default router;
