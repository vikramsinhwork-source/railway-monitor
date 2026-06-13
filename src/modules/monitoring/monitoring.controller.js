import multer from 'multer';
import { checkRateLimit } from '../../utils/rate.limiter.js';
import { sendError } from '../../utils/apiResponse.js';
import * as monitoringService from './monitoring.service.js';
import {
  validateRegisterPayload,
  validateHeartbeatPayload,
  validateStreamStatusPayload,
  validateScreenshotUpload,
} from './monitoring.validator.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function rateLimitDevice(req, res, eventType) {
  const deviceId = req.deviceAuth?.deviceId || req.ip;
  const limit = checkRateLimit(deviceId, eventType, 120);
  if (!limit.allowed) {
    sendError(res, `Rate limit exceeded for ${eventType}`, 429);
    return false;
  }
  return true;
}

export async function register(req, res) {
  if (!rateLimitDevice(req, res, 'monitoring-register')) return;

  const validation = validateRegisterPayload(req.body);
  if (!validation.isValid) {
    return sendError(res, validation.errors[0], 400);
  }

  const authDeviceId = req.deviceAuth?.deviceId;
  if (authDeviceId && validation.value.deviceId && authDeviceId !== validation.value.deviceId) {
    return sendError(res, 'Forbidden: deviceId mismatch', 403);
  }

  const deviceId = validation.value.deviceId || authDeviceId;
  const result = await monitoringService.registerMonitoringDevice({
    ...validation.value,
    deviceId,
  });

  if (!result.ok) {
    return sendError(res, result.message, result.code === 'DEVICE_NOT_FOUND' ? 404 : 400);
  }

  return res.status(result.created ? 201 : 200).json({
    success: true,
    message: 'Device registered',
    data: { device: result.device },
  });
}

export async function heartbeat(req, res) {
  if (!rateLimitDevice(req, res, 'monitoring-heartbeat')) return;

  const validation = validateHeartbeatPayload({
    ...req.body,
    deviceId: req.body?.deviceId || req.deviceAuth?.deviceId,
  });
  if (!validation.isValid) {
    return sendError(res, validation.errors[0], 400);
  }

  const result = await monitoringService.recordHeartbeat(
    validation.value.deviceId,
    validation.value.metrics
  );

  if (!result.ok) {
    return sendError(res, result.message, 404);
  }

  return res.json({
    success: true,
    message: 'Heartbeat recorded',
    data: { device: result.device, heartbeatId: result.heartbeat.id },
  });
}

export async function streamStatus(req, res) {
  if (!rateLimitDevice(req, res, 'monitoring-stream-status')) return;

  const validation = validateStreamStatusPayload({
    ...req.body,
    deviceId: req.body?.deviceId || req.deviceAuth?.deviceId,
  });
  if (!validation.isValid) {
    return sendError(res, validation.errors[0], 400);
  }

  const result = await monitoringService.handleDeviceStreamStatus(
    validation.value.deviceId,
    validation.value.streamPayload
  );

  if (!result.ok) {
    return sendError(res, result.message, 404);
  }

  return res.json({
    success: true,
    message: 'Stream status updated',
    data: { device: result.device },
  });
}

export const screenshotUpload = [
  upload.single('screenshot'),
  async (req, res) => {
    if (!rateLimitDevice(req, res, 'monitoring-screenshot')) return;

    const validation = validateScreenshotUpload({
      ...req.body,
      deviceId: req.body?.deviceId || req.deviceAuth?.deviceId,
    });
    if (!validation.isValid) {
      return sendError(res, validation.errors[0], 400);
    }

    if (!req.file?.buffer?.length) {
      return sendError(res, 'screenshot file is required', 400);
    }

    const result = await monitoringService.storeScreenshot({
      deviceId: validation.value.deviceId,
      screenType: validation.value.screenType,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      meta: { originalName: req.file.originalname },
    });

    if (!result.ok) {
      return sendError(res, result.message, 404);
    }

    return res.status(201).json({
      success: true,
      message: 'Screenshot stored',
      data: result.screenshot,
    });
  },
];

export async function getStatus(req, res) {
  const status = await monitoringService.getDeviceStatus(req.params.id);
  if (!status) {
    return sendError(res, 'Device not found', 404);
  }
  return res.json({ success: true, data: { device: status } });
}

export async function listDevices(req, res) {
  const result = await monitoringService.listMonitoringDevicesForUser(req.user, req.query);
  return res.json({
    success: true,
    data: { devices: result.devices, count: result.count },
  });
}

export async function getDevice(req, res) {
  const result = await monitoringService.getMonitoringDeviceForUser(req.params.id, req.user);
  if (!result) return sendError(res, 'Device not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  return res.json({ success: true, data: { device: result.device } });
}

async function sendCommand(req, res, action) {
  const io = req.app.get('io');
  const result = await monitoringService.sendDeviceCommandForUser(
    req.user,
    req.params.id,
    action,
    req.body?.payload || null,
    io
  );

  if (!result) return sendError(res, 'Device not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  if (result.error) return sendError(res, result.error, 400);

  return res.json({
    success: true,
    message: `Command ${action} queued`,
    data: result,
  });
}

export const reboot = (req, res) => sendCommand(req, res, 'reboot');
export const restartGo2rtc = (req, res) => sendCommand(req, res, 'restart-go2rtc');
export const restartAgent = (req, res) => sendCommand(req, res, 'restart-agent');
export const update = (req, res) => sendCommand(req, res, 'update');
export const captureScreenshot = (req, res) => sendCommand(req, res, 'capture-screenshot');

export async function dashboard(req, res) {
  const data = await monitoringService.getMonitoringDashboard(req.user);
  return res.json({ success: true, data });
}

export async function listScreenshots(req, res) {
  const result = await monitoringService.listScreenshotsForUser(
    req.params.id,
    req.user,
    { limit: req.query.limit }
  );
  if (!result) return sendError(res, 'Device not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  return res.json({ success: true, data: result });
}

export async function getScreenshot(req, res) {
  const result = await monitoringService.getScreenshotForUser(req.params.screenshotId, req.user);
  if (!result) return sendError(res, 'Screenshot not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  if (result.expired) return sendError(res, 'Screenshot expired', 410);

  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${result.screenshot.id}.png"`);
  result.stream.on('error', () => {
    if (!res.headersSent) sendError(res, 'Screenshot file not found', 404);
  });
  result.stream.pipe(res);
}
