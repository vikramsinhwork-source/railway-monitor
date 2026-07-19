import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as publicFormController from './publicForm.controller.js';

const router = Router();

const publicReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    code: 'RATE_LIMITED',
  },
});

const publicSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many submission attempts. Please try again later.',
    code: 'RATE_LIMITED',
  },
});

router.get('/contexts', publicReadLimiter, publicFormController.listContexts);
router.get('/current', publicReadLimiter, publicFormController.getCurrentForm);
router.post('/submissions', publicSubmitLimiter, publicFormController.submitForm);

export default router;
