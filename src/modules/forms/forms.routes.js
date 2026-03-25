import express from 'express';
import { requireAuth, requireAdmin, requireUser } from '../../middleware/auth.middleware.js';
import * as formsController from './forms.controller.js';

const router = express.Router();

router.post('/questions', requireAuth, requireAdmin, formsController.createQuestion);
router.get('/questions', requireAuth, requireAdmin, formsController.listQuestions);
router.get('/questions/:id', requireAuth, requireAdmin, formsController.getQuestionById);
router.patch('/questions/:id', requireAuth, requireAdmin, formsController.updateQuestion);
router.delete('/questions/:id', requireAuth, requireAdmin, formsController.deleteQuestion);
router.get('/analytics/users', requireAuth, requireAdmin, formsController.listUsersSubmissionAnalytics);
router.get('/analytics/users/:userId/history', requireAuth, requireAdmin, formsController.getUserSubmissionHistory);
router.get('/today', requireAuth, requireUser, formsController.getTodayQuestions);
router.post('/submissions/today', requireAuth, requireUser, formsController.submitTodayAnswers);
router.get('/submissions/me/latest', requireAuth, requireUser, formsController.getMyLatestSubmission);

export default router;
