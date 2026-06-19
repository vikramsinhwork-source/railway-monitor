import { ROLES } from '../auth/auth.middleware.js';
import { emitError, validateOrError, ERROR_CODES } from '../errors/socket.error.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import StreamSession from '../modules/streams/streamSession.model.js';
import {
  appendAgentIceCandidate,
  appendViewerIceCandidate,
  applyAgentAnswer,
  bindViewerSocket,
  closeStreamSession,
  closeStreamsForDevice,
  closeStreamsForViewer,
  requestStream,
  storeViewerOffer,
} from '../modules/streams/stream.service.js';
import {
  validateAgentAnswer,
  validateAgentIce,
  validateStreamRequest,
  validateStreamSessionId,
  validateViewerIce,
  validateViewerOffer,
} from '../modules/streams/stream.validator.js';

/**
 * Register live stream WebRTC signaling handlers.
 * Video flows Pi ↔ Flutter; backend forwards signaling only.
 *
 * Correct go2rtc WHEP flow:
 *   viewer-offer → agent-offer → agent-answer → viewer-answer
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
        streamName: validation.value.streamName,
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
        streamName: validation.value.streamName,
        timestamp: new Date().toISOString(),
      });

      logInfo('Stream', 'Stream requested via socket', {
        sessionId: result.session.id,
        deviceId: validation.value.deviceId,
        streamName: validation.value.streamName,
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
    if (session?.answer && session.status !== 'CLOSED') {
      socket.emit('viewer-answer', {
        sessionId: session.id,
        answer: session.answer,
        streamType: session.stream_type,
        deviceId: session.device_id,
        timestamp: new Date().toISOString(),
      });
    } else if (session?.offer && session.status !== 'CLOSED') {
      io.to(`device:${session.device_id}`).emit('agent-offer', {
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

  socket.on('viewer-offer', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only viewers can send viewer offers')) {
      return;
    }

    const validation = validateViewerOffer(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'viewer-offer',
      });
      return;
    }

    try {
      const result = await storeViewerOffer({
        sessionId: validation.value.sessionId,
        offer: validation.value.offer,
        io,
      });
      if (result.notFound) {
        emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, 'Stream session not found');
        return;
      }

      socket.emit('viewer-offer-ack', {
        sessionId: validation.value.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Stream', 'viewer-offer failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process viewer offer');
    }
  });

  socket.on('agent-answer', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only agent clients can send agent answers')) {
      return;
    }

    const validation = validateAgentAnswer(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'agent-answer',
      });
      return;
    }

    try {
      const result = await applyAgentAnswer({
        sessionId: validation.value.sessionId,
        answer: validation.value.answer,
        io,
      });
      if (result.notFound) {
        emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, 'Stream session not found');
        return;
      }

      socket.emit('agent-answer-ack', {
        sessionId: validation.value.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError('Stream', 'agent-answer failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process agent answer');
    }
  });

  socket.on('viewer-ice', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only viewers can send viewer ICE candidates')) {
      return;
    }

    const validation = validateViewerIce(payload);
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
      logError('Stream', 'viewer-ice failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to forward ICE candidate');
    }
  });

  socket.on('stream-error', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only agents can report stream errors')) {
      return;
    }

    const validation = validateStreamSessionId(payload);
    if (!validation.isValid) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, validation.errors[0], {
        operation: 'stream-error',
      });
      return;
    }

    const errorMessage = payload?.error || payload?.message || 'Agent stream error';
    logWarn('Stream', 'Agent reported stream error', {
      sessionId: validation.value.sessionId,
      error: errorMessage,
    });

    try {
      await closeStreamSession({
        sessionId: validation.value.sessionId,
        reason: errorMessage,
        io,
        failed: true,
      });
    } catch (error) {
      logError('Stream', 'stream-error cleanup failed', { error: error.message });
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process stream error');
    }
  });

  socket.on('agent-ice', async (payload = {}) => {
    if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
        'Unauthorized: Only agents can send agent ICE candidates')) {
      return;
    }

    const validation = validateAgentIce(payload);
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
      logError('Stream', 'agent-ice failed', { error: error.message });
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
