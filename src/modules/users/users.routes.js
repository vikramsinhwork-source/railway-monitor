/**
 * User management routes.
 * POST /api/users, GET /api/users, GET /api/users/me, PATCH /api/users/me,
 * POST /api/users/me/avatar, GET /api/users/me/face/status, POST /api/users/me/face/enroll,
 * GET /api/users/:id, PATCH /api/users/:id,
 * PATCH /api/users/:id/deactivate, POST /api/users/:id/avatar (admin).
 */

import express from 'express';
import { requireAuth, requireUser } from '../../middleware/auth.middleware.js';
import { requireDivisionAdmin } from '../../middleware/rbac.middleware.js';
import * as usersController from './users.controller.js';
import { avatarUploadSingle, handleAvatarUploadError } from './avatarUpload.middleware.js';

const router = express.Router();

router.post('/', requireAuth, requireDivisionAdmin, usersController.createUser);
router.get('/', requireAuth, requireDivisionAdmin, usersController.listUsers);
router.get('/me', requireAuth, usersController.me);
router.patch('/me', requireAuth, usersController.patchMe);
router.post(
  '/me/avatar',
  requireAuth,
  avatarUploadSingle,
  handleAvatarUploadError,
  usersController.uploadMyAvatar
);
router.get('/me/face/status', requireAuth, requireUser, usersController.getMyFaceStatus);
router.post(
  '/me/face/enroll',
  requireAuth,
  requireUser,
  avatarUploadSingle,
  handleAvatarUploadError,
  usersController.enrollMyFace
);
router.get('/:id', requireAuth, requireDivisionAdmin, usersController.getUserById);
router.patch('/:id/deactivate', requireAuth, requireDivisionAdmin, usersController.deactivateUser);
router.post(
  '/:id/avatar',
  requireAuth,
  requireDivisionAdmin,
  avatarUploadSingle,
  handleAvatarUploadError,
  usersController.uploadUserAvatar
);
router.patch('/:id', requireAuth, requireDivisionAdmin, usersController.updateUser);

export default router;
