import express from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireMonitor } from '../../middleware/rbac.middleware.js';
import { requireDeviceAuth, requireOwnDevice } from './monitoring.middleware.js';
import * as monitoringController from './monitoring.controller.js';
import { proxyWebrtcOffer, getWebrtcConfig, getIceConfig } from './monitoring.webrtc.controller.js';

const router = express.Router();

function requireAuthHeaderOrQuery(req, res, next) {
  const token = req.query.token || req.query.access_token;
  if (token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${token}`;
  }
  return requireAuth(req, res, next);
}

// Device agent endpoints (JWT device token)
router.post('/devices/register', requireDeviceAuth, monitoringController.register);
router.post('/devices/heartbeat', requireDeviceAuth, requireOwnDevice, monitoringController.heartbeat);
router.post('/devices/stream-status', requireDeviceAuth, requireOwnDevice, monitoringController.streamStatus);
router.post('/devices/screenshot', requireDeviceAuth, requireOwnDevice, ...monitoringController.screenshotUpload);
router.post(
  '/devices/:id/streams/:streamName/frame',
  requireDeviceAuth,
  requireOwnDevice,
  ...monitoringController.streamFrameUpload
);

router.get('/ice-config', requireAuth, requireMonitor, getIceConfig);

// WebRTC signaling — Flutter sends offer, Railway proxies to Pi, video goes direct
router.get('/devices/:id/webrtc/config', requireAuth, requireMonitor, getWebrtcConfig);
router.options('/devices/:id/streams/:streamName/webrtc/offer', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.sendStatus(200);
});
router.post('/devices/:id/streams/:streamName/webrtc/offer', requireAuth, requireMonitor, proxyWebrtcOffer);

// Admin / monitor endpoints
router.get('/lobby-streams', requireAuth, requireMonitor, monitoringController.divisionLobbyStreams);
router.get('/lobbies/:lobbyId/streams', requireAuth, requireMonitor, monitoringController.lobbyStreams);
router.get('/viewer', monitoringController.viewer);
router.get('/devices/:id/streams/:streamName/frame', requireAuth, requireMonitor, monitoringController.getStreamFrame);
router.get('/devices/:id/streams/:streamName/live.mjpeg', requireAuthHeaderOrQuery, requireMonitor, monitoringController.getStreamLiveMjpeg);
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
