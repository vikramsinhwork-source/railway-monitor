import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireMonitor } from '../../middleware/rbac.middleware.js';
import { requireDeviceAuth, requireOwnDevice } from './monitoring.middleware.js';
import * as monitoringController from './monitoring.controller.js';

const router = express.Router();

// Device agent endpoints (JWT device token)
router.post('/devices/register', requireDeviceAuth, monitoringController.register);
router.post('/devices/heartbeat', requireDeviceAuth, requireOwnDevice, monitoringController.heartbeat);
router.post('/devices/stream-status', requireDeviceAuth, requireOwnDevice, monitoringController.streamStatus);
router.post('/devices/screenshot', requireDeviceAuth, requireOwnDevice, ...monitoringController.screenshotUpload);

// Admin / monitor endpoints
router.get('/devices', requireAuth, requireMonitor, monitoringController.listDevices);
router.get('/dashboard', requireAuth, requireMonitor, monitoringController.dashboard);
router.get('/screenshots/:screenshotId', requireAuth, requireMonitor, monitoringController.getScreenshot);
router.get('/devices/:id/screenshots', requireAuth, requireMonitor, monitoringController.listScreenshots);
router.get('/devices/:id/status', requireAuth, requireMonitor, monitoringController.getStatus);
router.get('/devices/:id', requireAuth, requireMonitor, monitoringController.getDevice);
router.post('/devices/:id/reboot', requireAuth, requireMonitor, monitoringController.reboot);
router.post('/devices/:id/restart-go2rtc', requireAuth, requireMonitor, monitoringController.restartGo2rtc);
router.post('/devices/:id/restart-agent', requireAuth, requireMonitor, monitoringController.restartAgent);
router.post('/devices/:id/update', requireAuth, requireMonitor, monitoringController.update);
router.post('/devices/:id/capture-screenshot', requireAuth, requireMonitor, monitoringController.captureScreenshot);

export default router;
