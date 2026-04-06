import express from 'express';
import { requireAuth, requireAdmin, requireUser } from '../../middleware/auth.middleware.js';
import * as formsController from './forms.controller.js';

const router = express.Router();

router.post('/templates', requireAuth, requireAdmin, formsController.createTemplate);
router.get('/templates', requireAuth, requireAdmin, formsController.listTemplates);
router.patch('/templates/:id/publish', requireAuth, requireAdmin, formsController.publishTemplate);
router.post('/templates/:templateId/questions', requireAuth, requireAdmin, formsController.createTemplateQuestion);
router.get('/templates/:templateId/questions', requireAuth, requireAdmin, formsController.listTemplateQuestions);
router.patch('/templates/:templateId/questions/:questionId', requireAuth, requireAdmin, formsController.updateTemplateQuestion);
router.delete('/templates/:templateId/questions/:questionId', requireAuth, requireAdmin, formsController.deleteTemplateQuestion);

router.post('/questions', requireAuth, requireAdmin, formsController.createQuestion);
router.get('/questions', requireAuth, requireAdmin, formsController.listQuestions);
router.get('/questions/:id', requireAuth, requireAdmin, formsController.getQuestionById);
router.patch('/questions/:id', requireAuth, requireAdmin, formsController.updateQuestion);
router.delete('/questions/:id', requireAuth, requireAdmin, formsController.deleteQuestion);
router.get('/analytics/summary', requireAuth, requireAdmin, formsController.getSubmissionAnalyticsSummary);
router.get('/analytics/export/preview', requireAuth, requireAdmin, formsController.previewSubmissionAnalyticsExport);
router.get('/analytics/export', requireAuth, requireAdmin, formsController.exportSubmissionAnalyticsXlsx);
router.get('/analytics/users', requireAuth, requireAdmin, formsController.listUsersSubmissionAnalytics);
router.get('/analytics/users/:userId/history', requireAuth, requireAdmin, formsController.getUserSubmissionHistory);
router.get('/today', requireAuth, requireUser, formsController.getTodayQuestions);
router.post('/submissions/today', requireAuth, requireUser, formsController.submitTodayAnswers);
router.get('/submissions/me/latest', requireAuth, requireUser, formsController.getMyLatestSubmission);
router.get('/submissions/me', requireAuth, requireUser, formsController.getMySubmissionHistory);

export default router;
