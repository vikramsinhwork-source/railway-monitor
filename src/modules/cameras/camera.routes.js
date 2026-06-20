import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireMonitor } from '../../middleware/rbac.middleware.js';
import * as cameraController from './camera.controller.js';

const router = express.Router();

router.get('/', requireAuth, requireMonitor, cameraController.listCameras);
router.get('/:id/webrtc-url', requireAuth, requireMonitor, cameraController.getWebrtcUrl);

export default router;
