import express from 'express';
import { requireAuth, requireUser } from '../../middleware/auth.middleware.js';
import { requireDivisionAdmin } from '../../middleware/rbac.middleware.js';
import * as formsController from './forms.controller.js';

const router = express.Router();

router.post('/templates', requireAuth, requireDivisionAdmin, formsController.createTemplate);
router.get('/templates', requireAuth, requireDivisionAdmin, formsController.listTemplates);
router.patch('/templates/:id/publish', requireAuth, requireDivisionAdmin, formsController.publishTemplate);
router.post('/templates/:templateId/questions', requireAuth, requireDivisionAdmin, formsController.createTemplateQuestion);
router.get('/templates/:templateId/questions', requireAuth, requireDivisionAdmin, formsController.listTemplateQuestions);
router.patch('/templates/:templateId/questions/:questionId', requireAuth, requireDivisionAdmin, formsController.updateTemplateQuestion);
router.delete('/templates/:templateId/questions/:questionId', requireAuth, requireDivisionAdmin, formsController.deleteTemplateQuestion);

router.post('/questions', requireAuth, requireDivisionAdmin, formsController.createQuestion);
router.get('/questions', requireAuth, requireDivisionAdmin, formsController.listQuestions);
router.get('/questions/:id', requireAuth, requireDivisionAdmin, formsController.getQuestionById);
router.patch('/questions/:id', requireAuth, requireDivisionAdmin, formsController.updateQuestion);
router.delete('/questions/:id', requireAuth, requireDivisionAdmin, formsController.deleteQuestion);
router.get('/analytics/summary', requireAuth, requireDivisionAdmin, formsController.getSubmissionAnalyticsSummary);
router.get('/analytics/export/preview', requireAuth, requireDivisionAdmin, formsController.previewSubmissionAnalyticsExport);
router.get('/analytics/export', requireAuth, requireDivisionAdmin, formsController.exportSubmissionAnalyticsXlsx);
router.get('/analytics/users', requireAuth, requireDivisionAdmin, formsController.listUsersSubmissionAnalytics);
router.get('/analytics/users/:userId/history', requireAuth, requireDivisionAdmin, formsController.getUserSubmissionHistory);
router.get('/today', requireAuth, requireUser, formsController.getTodayQuestions);
router.post('/submissions/today', requireAuth, requireUser, formsController.submitTodayAnswers);
router.get('/submissions/me/latest', requireAuth, requireUser, formsController.getMyLatestSubmission);
router.get('/submissions/me', requireAuth, requireUser, formsController.getMySubmissionHistory);

export default router;
