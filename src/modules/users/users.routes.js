/**
 * User management routes.
 * POST /api/users, GET /api/users, GET /api/users/:id, PATCH /api/users/:id,
 * PATCH /api/users/:id/deactivate, GET /api/users/me.
 */

import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.middleware.js';
import * as usersController from './users.controller.js';

const router = express.Router();

router.post('/', requireAuth, requireAdmin, usersController.createUser);
router.get('/', requireAuth, requireAdmin, usersController.listUsers);
router.get('/me', requireAuth, usersController.me);
router.get('/:id', requireAuth, requireAdmin, usersController.getUserById);
router.patch('/:id/deactivate', requireAuth, requireAdmin, usersController.deactivateUser);
router.patch('/:id', requireAuth, requireAdmin, usersController.updateUser);

export default router;
