// src/modules/face/face.routes.js
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireMonitor } from '../../middleware/rbac.middleware.js';
import { recognizeFaceFromFrame } from '../users/users.controller.js';
import { avatarUploadSingle, handleAvatarUploadError } from '../users/avatarUpload.middleware.js';

const router = Router();

/**
 * POST /api/face/recognize
 * Used by monitor clients to identify a person from a camera frame.
 * Requires MONITOR role or above.
 */
router.post(
  '/recognize',
  requireAuth,
  requireMonitor,
  avatarUploadSingle,
  handleAvatarUploadError,
  recognizeFaceFromFrame
);

export default router;
