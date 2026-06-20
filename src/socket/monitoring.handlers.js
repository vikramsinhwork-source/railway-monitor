import { ROLES } from '../auth/auth.middleware.js';
import { emitError, validateOrError, ERROR_CODES } from '../errors/socket.error.js';
import { checkRateLimit } from '../utils/rate.limiter.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import {
  handleDeviceOnline,
  handleDeviceStreamStatus,
  recordHeartbeat,
  storeScreenshot,
} from '../modules/monitoring/monitoring.service.js';
import {
  validateDeviceOnlinePayload,
  validateHeartbeatPayload,
  validateStreamStatusPayload,
  validateCommandResultPayload,
} from '../modules/monitoring/monitoring.validator.js';
import { processAgentCommandResult, handleAgentOffline } from '../modules/agents/agent.service.js';

const RECONNECT_WINDOW_MS = 5000;
const reconnectGuard = new Map();

function isReconnectStorm(deviceId) {
  const now = Date.now();
  const last = reconnectGuard.get(deviceId) || 0;
  if (now - last < RECONNECT_WINDOW_MS) {
    return true;
  }
  reconnectGuard.set(deviceId, now);
  return false;
}

function checkDeviceRateLimit(socket, eventType) {
  const clientId = socket.data?.agentDeviceId || socket.data?.clientId || socket.id;
  const limit = checkRateLimit(clientId, eventType, 120);
  if (!limit.allowed) {
    emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED, `Rate limit exceeded for ${eventType}`, {
      resetAt: limit.resetAt?.toISOString(),
    });
    return false;
  }
  return true;
}

async function handleCommandResult(io, socket, payload, operation) {
  const validation = validateCommandResultPayload(payload);
  if (!validation.isValid) {
    emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], { operation });
    return;
  }

  try {
    const result = await processAgentCommandResult(validation.value);
    if (!result.ok) {
      emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, result.message, {
        operation,
        commandId: validation.value.commandId,
      });
      return;
    }

    io.to('monitors').emit('device-command-status', {
      queueId: result.command.id,
      deviceId: result.command.device_id,
      status: result.command.status,
      success: validation.value.success,
      message: validation.value.message,
      timestamp: validation.value.timestamp || new Date().toISOString(),
    });

    socket.emit('device:command-result-ack', {
      commandId: validation.value.commandId,
      status: result.command.status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logError('Monitoring', `${operation} failed`, { error: error.message });
    emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process command result', { operation });
  }
}

/**
 * Register device:* socket events for Raspberry Pi monitoring agents.
 * Only KIOSK role can emit; MONITOR role can send commands via REST/admin.
 */
export function registerMonitoringHandlers(io, socket) {
  const { role, clientId } = socket.data;
  let registeredDeviceId = null;

  socket.on('device:online', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only KIOSK devices can emit device:online')) {
      return;
    }
    if (!checkDeviceRateLimit(socket, 'device:online')) return;

    const validation = validateDeviceOnlinePayload({
      ...payload,
      deviceId: payload?.deviceId || clientId,
    });
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], { operation: 'device:online' });
      return;
    }

    if (isReconnectStorm(validation.value.deviceId)) {
      logWarn('Monitoring', 'Reconnect storm suppressed', { deviceId: validation.value.deviceId });
      socket.emit('device:online-ack', {
        deviceId: validation.value.deviceId,
        suppressed: true,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const result = await handleDeviceOnline({
        deviceId: validation.value.deviceId,
        payload: validation.value,
        socketId: socket.id,
      });

      if (!result.ok) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message, { operation: 'device:online' });
        return;
      }

      registeredDeviceId = validation.value.deviceId;
      socket.data.agentDeviceId = registeredDeviceId;
      socket.data.monitoringRegistered = true;
      socket.join(`device:${registeredDeviceId}`);

      io.to('monitors').emit('device-online', {
        deviceId: registeredDeviceId,
        deviceType: 'RASPBERRY',
        timestamp: new Date().toISOString(),
      });

      socket.emit('device:online-ack', {
        deviceId: registeredDeviceId,
        status: 'ONLINE',
        timestamp: new Date().toISOString(),
      });

      logInfo('Monitoring', 'device:online processed', { deviceId: registeredDeviceId });
    } catch (error) {
      logError('Monitoring', 'device:online failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process device:online', {
        operation: 'device:online',
      });
    }
  });


  socket.on('device:heartbeat', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only KIOSK devices can emit device:heartbeat')) {
      return;
    }
    if (!checkDeviceRateLimit(socket, 'device:heartbeat')) return;

    const deviceId = payload?.deviceId || registeredDeviceId || socket.data.agentDeviceId || clientId;
    const validation = validateHeartbeatPayload({ ...payload, deviceId });
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], { operation: 'device:heartbeat' });
      return;
    }

    try {
      const result = await recordHeartbeat(validation.value.deviceId, validation.value.metrics, socket.id);
      if (!result.ok) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message, { operation: 'device:heartbeat' });
        return;
      }

      io.to('monitors').emit('agent-health-updated', {
        deviceId: validation.value.deviceId,
        health: validation.value.metrics,
        timestamp: new Date().toISOString(),
      });

      socket.emit('device:heartbeat-ack', {
        deviceId: validation.value.deviceId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Monitoring', 'device:heartbeat failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process device:heartbeat', {
        operation: 'device:heartbeat',
      });
    }
  });

  socket.on('device:stream-status', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only KIOSK devices can emit device:stream-status')) {
      return;
    }
    if (!checkDeviceRateLimit(socket, 'device:stream-status')) return;

    const deviceId = payload?.deviceId || registeredDeviceId || socket.data.agentDeviceId || clientId;
    const validation = validateStreamStatusPayload({ ...payload, deviceId });
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], { operation: 'device:stream-status' });
      return;
    }

    try {
      const result = await handleDeviceStreamStatus(
        validation.value.deviceId,
        validation.value.streamPayload
      );
      if (!result.ok) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message, { operation: 'device:stream-status' });
        return;
      }

      io.to('monitors').emit('device-stream-status', {
        deviceId: validation.value.deviceId,
        streamStatus: result.device.stream_status,
        go2rtcStatus: result.device.go2rtc_status,
        timestamp: new Date().toISOString(),
      });

      socket.emit('device:stream-status-ack', {
        deviceId: validation.value.deviceId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Monitoring', 'device:stream-status failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process device:stream-status', {
        operation: 'device:stream-status',
      });
    }
  });

  socket.on('device:screenshot', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only KIOSK devices can emit device:screenshot')) {
      return;
    }
    if (!checkDeviceRateLimit(socket, 'device:screenshot')) return;

    const deviceId = payload?.deviceId || registeredDeviceId || socket.data.agentDeviceId || clientId;
    const screenType = payload?.screenType || payload?.screen_type;
    const imageBase64 = payload?.imageBase64 || payload?.data;

    if (!deviceId || !screenType || !imageBase64) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, 'deviceId, screenType, and imageBase64 are required', {
        operation: 'device:screenshot',
      });
      return;
    }

    try {
      const buffer = Buffer.from(imageBase64, 'base64');
      const result = await storeScreenshot({
        deviceId,
        screenType,
        buffer,
        mimeType: payload?.mimeType || 'image/png',
        meta: { via: 'socket' },
      });

      if (!result.ok) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message, { operation: 'device:screenshot' });
        return;
      }

      io.to('monitors').emit('device-screenshot-ready', {
        deviceId,
        screenshot: result.screenshot,
        timestamp: new Date().toISOString(),
      });

      socket.emit('device:screenshot-ack', {
        deviceId,
        screenshotId: result.screenshot.id,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Monitoring', 'device:screenshot failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process device:screenshot', {
        operation: 'device:screenshot',
      });
    }
  });

  socket.on('device:command-result', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only KIOSK devices can emit device:command-result')) {
      return;
    }
    if (!checkDeviceRateLimit(socket, 'device:command-result')) return;
    await handleCommandResult(io, socket, payload, 'device:command-result');
  });

  return {
    getRegisteredDeviceId: () => registeredDeviceId || socket.data.agentDeviceId || null,
    handleDisconnect: async (reason) => {
      const deviceId = registeredDeviceId || socket.data.agentDeviceId;
      if (!deviceId || !socket.data.monitoringRegistered) return;

      try {
        const device = await handleAgentOffline({ deviceId, socketId: socket.id, reason });
        if (device) {
          io.to('monitors').emit('device-offline', {
            deviceId,
            deviceType: 'RASPBERRY',
            reason,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        logWarn('Monitoring', 'Disconnect cleanup failed', { deviceId, error: error.message });
      }
    },
  };
}
