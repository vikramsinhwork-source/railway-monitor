import { ROLES } from '../auth/auth.middleware.js';
import { emitError, validateOrError, ERROR_CODES } from '../errors/socket.error.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import {
  handleAgentOffline,
  processAgentCommandResult,
  processAgentHeartbeat,
  processAgentStatusUpdate,
  registerAgent,
} from '../modules/agents/agent.service.js';
import {
  validateAgentCommandResult,
  validateAgentHeartbeat,
  validateAgentStatusUpdate,
  validateRegisterAgent,
} from '../modules/agents/agent.validator.js';

/**
 * Register Raspberry Pi agent socket event handlers.
 */
export function registerAgentHandlers(io, socket) {
  const { role, clientId } = socket.data;
  let registeredDeviceId = null;

  socket.on('register-agent', async (payload = {}) => {
    logInfo('Agent', 'Register agent request received', {
      clientId,
      socketId: socket.id,
      payload,
    });

    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only KIOSK/agent clients can register as agent')) {
      return;
    }

    const validation = validateRegisterAgent(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'register-agent',
      });
      return;
    }

    try {
      const result = await registerAgent({
        ...validation.value,
        socketId: socket.id,
      });

      if (!result.ok) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message, {
          operation: 'register-agent',
          code: result.code,
        });
        return;
      }

      registeredDeviceId = validation.value.deviceId;
      socket.data.agentDeviceId = registeredDeviceId;
      socket.join(`device:${registeredDeviceId}`);

      io.to('monitors').emit('device-online', {
        deviceId: registeredDeviceId,
        deviceType: 'RASPBERRY',
        timestamp: new Date().toISOString(),
      });

      socket.emit('agent-registered', {
        deviceId: registeredDeviceId,
        status: 'ONLINE',
        timestamp: new Date().toISOString(),
      });

      logInfo('Agent', 'Agent registered successfully', {
        deviceId: registeredDeviceId,
        socketId: socket.id,
      });
    } catch (error) {
      logError('Agent', 'Failed to register agent', {
        clientId,
        error: error.message,
      });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to register agent', {
        operation: 'register-agent',
      });
    }
  });

  socket.on('agent-heartbeat', async (payload = {}) => {
    const deviceId = payload?.deviceId || registeredDeviceId || socket.data.agentDeviceId;
    if (!deviceId) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, 'deviceId is required', {
        operation: 'agent-heartbeat',
      });
      return;
    }

    const validation = validateAgentHeartbeat(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'agent-heartbeat',
      });
      return;
    }

    try {
      const result = await processAgentHeartbeat(deviceId, validation.value, socket.id);
      if (!result.ok) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message, {
          operation: 'agent-heartbeat',
        });
        return;
      }

      io.to('monitors').emit('agent-health-updated', {
        deviceId,
        health: {
          cpu: validation.value.cpu,
          memory: validation.value.memory,
          disk: validation.value.disk,
          temperature: validation.value.temperature,
          uptime: validation.value.uptime,
          kioskOnline: validation.value.kioskOnline,
          cctvOnline: validation.value.cctvOnline,
          vncOnline: validation.value.vncOnline,
        },
        timestamp: new Date().toISOString(),
      });

      socket.emit('agent-heartbeat-ack', {
        deviceId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Agent', 'Failed to process agent heartbeat', {
        deviceId,
        error: error.message,
      });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process heartbeat', {
        operation: 'agent-heartbeat',
      });
    }
  });

  socket.on('agent-status-update', async (payload = {}) => {
    const deviceId = payload?.deviceId || registeredDeviceId || socket.data.agentDeviceId;
    if (!deviceId) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, 'deviceId is required', {
        operation: 'agent-status-update',
      });
      return;
    }

    const validation = validateAgentStatusUpdate(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'agent-status-update',
      });
      return;
    }

    try {
      const result = await processAgentStatusUpdate(deviceId, validation.value);
      if (!result.ok) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message, {
          operation: 'agent-status-update',
        });
        return;
      }

      io.to('monitors').emit('device-status-updated', {
        deviceId,
        status: validation.value,
        timestamp: new Date().toISOString(),
      });

      socket.emit('agent-status-update-ack', {
        deviceId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Agent', 'Failed to process agent status update', {
        deviceId,
        error: error.message,
      });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process status update', {
        operation: 'agent-status-update',
      });
    }
  });

  socket.on('agent-command-result', async (payload = {}) => {
    const validation = validateAgentCommandResult(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'agent-command-result',
      });
      return;
    }

    try {
      const result = await processAgentCommandResult(validation.value);
      if (!result.ok) {
        emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, result.message, {
          operation: 'agent-command-result',
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
        data: validation.value.data,
        timestamp: new Date().toISOString(),
      });

      socket.emit('agent-command-result-ack', {
        commandId: validation.value.commandId,
        status: result.command.status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Agent', 'Failed to process agent command result', {
        commandId: payload?.commandId,
        error: error.message,
      });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process command result', {
        operation: 'agent-command-result',
      });
    }
  });

  return {
    getRegisteredDeviceId: () => registeredDeviceId || socket.data.agentDeviceId || null,
    handleDisconnect: async (reason) => {
      const deviceId = registeredDeviceId || socket.data.agentDeviceId;
      if (!deviceId) return;

      try {
        const device = await handleAgentOffline({
          deviceId,
          socketId: socket.id,
          reason,
        });
        if (device) {
          io.to('monitors').emit('device-offline', {
            deviceId,
            deviceType: 'RASPBERRY',
            reason,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        logWarn('Agent', 'Failed agent disconnect cleanup', {
          deviceId,
          error: error.message,
        });
      }
    },
  };
}
