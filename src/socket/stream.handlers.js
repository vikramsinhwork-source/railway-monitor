import { ROLES } from '../auth/auth.middleware.js';
import { emitError, validateOrError, ERROR_CODES } from '../errors/socket.error.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import StreamSession from '../modules/streams/streamSession.model.js';
import {
  activateStreamOffer,
  appendAgentIceCandidate,
  appendViewerIceCandidate,
  applyStreamAnswer,
  bindViewerSocket,
  closeStreamSession,
  closeStreamsForDevice,
  closeStreamsForViewer,
  requestStream,
} from '../modules/streams/stream.service.js';
import {
  validateIceCandidate,
  validateStreamAnswer,
  validateStreamOffer,
  validateStreamRequest,
  validateStreamSessionId,
} from '../modules/streams/stream.validator.js';

/**
 * Register live stream WebRTC signaling handlers.
 * Video flows directly Pi ↔ Flutter; backend forwards signaling only.
 */
export function registerStreamHandlers(io, socket) {
  const { role, userId, user: appUser } = socket.data;

  socket.on('request-stream', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only monitor-class roles can request streams')) {
      return;
    }
    if (!appUser?.userId) {
      emitError(socket, ERROR_CODES.AUTH_INVALID_ROLE, 'Application user context required');
      return;
    }

    const validation = validateStreamRequest(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'request-stream',
      });
      return;
    }

    try {
      const result = await requestStream({
        user: { id: appUser.userId, role: appUser.role, division_id: appUser.division_id },
        deviceId: validation.value.deviceId,
        streamType: validation.value.streamType,
        viewerSocketId: socket.id,
        io,
      });

      if (result.forbidden) {
        emitError(socket, ERROR_CODES.OPERATION_NOT_ALLOWED, 'Forbidden');
        return;
      }
      if (result.notFound) {
        emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, result.message || 'Agent not found');
        return;
      }
      if (result.inactive) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message || 'Agent disabled');
        return;
      }
      if (result.conflict) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, result.message);
        return;
      }

      socket.join(`stream:${result.session.id}`);

      socket.emit('stream-requested', {
        sessionId: result.session.id,
        deviceId: validation.value.deviceId,
        streamType: validation.value.streamType,
        timestamp: new Date().toISOString(),
      });

      logInfo('Stream', 'Stream requested via socket', {
        sessionId: result.session.id,
        deviceId: validation.value.deviceId,
        viewerSocketId: socket.id,
      });
    } catch (error) {
      logError('Stream', 'request-stream failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to request stream');
    }
  });

  socket.on('join-stream-session', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only monitor-class roles can join stream sessions')) {
      return;
    }

    const validation = validateStreamSessionId(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0]);
      return;
    }

    bindViewerSocket(validation.value.sessionId, socket.id);
    socket.join(`stream:${validation.value.sessionId}`);

    const session = await StreamSession.findByPk(validation.value.sessionId);
    if (session?.offer && session.status !== 'CLOSED') {
      socket.emit('stream-offer', {
        sessionId: session.id,
        offer: session.offer,
        streamType: session.stream_type,
        deviceId: session.device_id,
        timestamp: new Date().toISOString(),
      });
    }

    socket.emit('stream-session-joined', {
      sessionId: validation.value.sessionId,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('stream-offer', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only agent clients can send stream offers')) {
      return;
    }

    const validation = validateStreamOffer(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'stream-offer',
      });
      return;
    }

    try {
      const result = await activateStreamOffer({
        sessionId: validation.value.sessionId,
        offer: validation.value.offer,
        io,
      });
      if (result.notFound) {
        emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, 'Stream session not found');
        return;
      }

      socket.emit('stream-offer-ack', {
        sessionId: validation.value.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Stream', 'stream-offer failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process stream offer');
    }
  });

  socket.on('stream-answer', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only viewers can send stream answers')) {
      return;
    }

    const validation = validateStreamAnswer(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'stream-answer',
      });
      return;
    }

    try {
      const result = await applyStreamAnswer({
        sessionId: validation.value.sessionId,
        answer: validation.value.answer,
        io,
      });
      if (result.notFound) {
        emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, 'Stream session not found');
        return;
      }

      socket.emit('stream-answer-ack', {
        sessionId: validation.value.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Stream', 'stream-answer failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process stream answer');
    }
  });

  socket.on('viewer-ice-candidate', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only viewers can send viewer ICE candidates')) {
      return;
    }

    const validation = validateIceCandidate(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0]);
      return;
    }

    try {
      const result = await appendViewerIceCandidate({
        sessionId: validation.value.sessionId,
        candidate: validation.value.candidate,
        io,
      });
      if (result.notFound) {
        emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, 'Stream session not found');
      }
    } catch (error) {
      logError('Stream', 'viewer-ice-candidate failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to forward ICE candidate');
    }
  });

  socket.on('agent-ice-candidate', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only agents can send agent ICE candidates')) {
      return;
    }

    const validation = validateIceCandidate(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0]);
      return;
    }

    try {
      const result = await appendAgentIceCandidate({
        sessionId: validation.value.sessionId,
        candidate: validation.value.candidate,
        io,
      });
      if (result.notFound) {
        emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, 'Stream session not found');
      }
    } catch (error) {
      logError('Stream', 'agent-ice-candidate failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to forward ICE candidate');
    }
  });

  return {
    handleDisconnect: async (reason) => {
      if (role === ROLES.MONITOR && appUser?.userId) {
        try {
          await closeStreamsForViewer({
            userId: appUser.userId,
            socketId: socket.id,
            io,
            reason: reason || 'viewer-disconnect',
          });
        } catch (error) {
          logWarn('Stream', 'Viewer disconnect stream cleanup failed', { error: error.message });
        }
      }

      if (role === ROLES.KIOSK && socket.data.agentDeviceId) {
        try {
          await closeStreamsForDevice({
            deviceId: socket.data.agentDeviceId,
            io,
            reason: reason || 'agent-disconnect',
          });
        } catch (error) {
          logWarn('Stream', 'Agent disconnect stream cleanup failed', { error: error.message });
        }
      }
    },
    closeSession: async (sessionId, closeReason) => {
      await closeStreamSession({ sessionId, reason: closeReason, io });
    },
  };
}
