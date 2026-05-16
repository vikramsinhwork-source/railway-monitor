// src/modules/face/face.routes.js
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireMonitor } from '../../middleware/rbac.middleware.js';
import { recognizeFaceFromFrame } from '../users/users.controller.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * POST /api/face/recognize
 * Used by monitor clients to identify a person from a camera frame.
 * Requires MONITOR role or above.
 */
router.post('/recognize', requireAuth, requireMonitor, upload.single('image'), recognizeFaceFromFrame);

export default router;
