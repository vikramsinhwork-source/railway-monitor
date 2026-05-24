/**
 * WebRTC signaling helpers for MONITOR, KIOSK, and OBSERVER modes.
 */

import { ROLES } from '../auth/auth.middleware.js';
import { ERROR_CODES } from '../errors/socket.error.js';
import { emitError, validateOrError } from '../errors/socket.error.js';
import * as kiosksState from '../state/kiosks.state.js';
import * as sessionsState from '../state/sessions.state.js';
import * as activeSessionsState from '../state/active-sessions.state.js';
import { SIGNALING_MODES } from '../constants/observer.constants.js';
import { isRecvOnlySignaling } from '../services/observer-permission.service.js';
import { logMonitoringAudit } from '../services/monitoring-audit.service.js';
import { OBSERVER_AUDIT_ACTIONS } from '../constants/observer.constants.js';
import { logInfo, logWarn, logError, logDebug } from '../utils/logger.js';

function kioskSocketOwnsSession(session, socketId) {
  if (!session?.kioskId && !session?.kiosk_id) return false;
  const kioskId = session.kioskId || session.kiosk_id;
  return kiosksState.getKiosk(kioskId)?.socketId === socketId;
}

function resolveKioskId(data, senderRole, clientId, targetId, socketId) {
  if (senderRole === ROLES.KIOSK) {
    return data?.kioskId ?? data?.deviceId ?? kiosksState.getKioskBySocketId(socketId)?.kioskId ?? clientId;
  }
  return data?.kioskId ?? data?.deviceId ?? targetId;
}

function isObserverSignaling(socket, data) {
  return socket.data?.isObserver === true || data?.signalingMode === SIGNALING_MODES.OBSERVER;
}

/**
 * Forward WebRTC signaling (offer, answer, ice-candidate).
 */
export function forwardWebRtcSignaling({
  io,
  socket,
  type,
  data,
  clientId,
  role,
  userId,
  appUser,
}) {
  const payloadKey = type;
  const payload = data?.[payloadKey];
  const { targetId } = data || {};
  const signalingMode = data?.signalingMode || (isObserverSignaling(socket, data) ? SIGNALING_MODES.OBSERVER : SIGNALING_MODES.MONITOR);

  logDebug('WebRTC', `${type} received`, { fromId: clientId, targetId, role, signalingMode });

  if (!validateOrError(socket, targetId && payload, ERROR_CODES.SIGNALING_MISSING_DATA,
    `Invalid ${type}: targetId and ${type} are required`)) {
    return { forwarded: false };
  }

  const senderRole = role;
  const kioskId = resolveKioskId(data, senderRole, clientId, targetId, socket.id);

  if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId),
    ERROR_CODES.SIGNALING_NO_SESSION,
    `No active monitoring session for kiosk ${kioskId}`)) {
    return { forwarded: false };
  }

  const memSession = sessionsState.getSession(kioskId);
  const activeSession = activeSessionsState.getActiveSessionByKioskId(kioskId);

  let targetSocketId;
  let targetRole;

  if (signalingMode === SIGNALING_MODES.OBSERVER) {
    if (!socket.data?.isObserver) {
      emitError(socket, ERROR_CODES.OPERATION_NOT_ALLOWED, 'Join as observer before observer signaling');
      return { forwarded: false };
    }

    if (type === 'offer' && !isRecvOnlySignaling(data)) {
      logMonitoringAudit({
        observerUserId: userId,
        observerRole: appUser?.role,
        sessionId: activeSession?.session_id,
        divisionId: activeSession?.division_id,
        lobbyId: activeSession?.lobby_id,
        action: OBSERVER_AUDIT_ACTIONS.MEDIA_REJECTED,
        result: 'DENIED',
        details: { type, reason: 'recvonly required' },
      });
      emitError(socket, ERROR_CODES.OPERATION_NOT_ALLOWED,
        'Observer must use recvonly signaling (no media publish)', { mediaIntent: 'recvonly' });
      socket.emit('observer-signaling-rejected', { reason: 'media-publish-not-allowed', type });
      return { forwarded: false };
    }

    if (senderRole === ROLES.MONITOR) {
      const obs = activeSession && activeSessionsState.isObserverOnSession(activeSession.session_id, socket.id);
      if (!validateOrError(socket, !!obs,
        ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
        'Unauthorized: not registered as observer on this session')) {
        return { forwarded: false };
      }

      const targetKiosk = kiosksState.getKiosk(kioskId);
      if (!targetKiosk) {
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target kiosk not found: ${kioskId}`);
        return { forwarded: false };
      }
      targetSocketId = targetKiosk.socketId;
      targetRole = ROLES.KIOSK;
      activeSessionsState.touchObserverActivity(activeSession.session_id, userId);
    } else if (senderRole === ROLES.KIOSK) {
      if (!validateOrError(socket, kioskSocketOwnsSession(memSession, socket.id),
        ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
        'Unauthorized: invalid kiosk for session')) {
        return { forwarded: false };
      }
      const observerClientId = targetId;
      const obs = activeSession?.observers?.find(
        (o) => !o.left_at && (o.observer_client_id === observerClientId || o.observer_user_id === observerClientId)
      );
      if (!obs?.observer_socket_id) {
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Observer not found: ${targetId}`);
        return { forwarded: false };
      }
      targetSocketId = obs.observer_socket_id;
      targetRole = ROLES.MONITOR;
    } else {
      emitError(socket, ERROR_CODES.SIGNALING_INVALID_PAIRING, 'Invalid observer signaling sender');
      return { forwarded: false };
    }
  } else {
    if (socket.data?.isObserver) {
      emitError(socket, ERROR_CODES.OPERATION_NOT_ALLOWED, 'Observer cannot use monitor signaling mode');
      return { forwarded: false };
    }

    if (senderRole === ROLES.KIOSK) {
      targetSocketId = memSession.monitorSocketId;
      targetRole = ROLES.MONITOR;
      if (!validateOrError(socket, kioskSocketOwnsSession(memSession, socket.id),
        ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
        'Unauthorized: invalid kiosk for this session')) {
        return { forwarded: false };
      }
    } else {
      const targetKiosk = kiosksState.getKiosk(targetId);
      if (!targetKiosk) {
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target kiosk not found: ${targetId}`);
        return { forwarded: false };
      }
      targetSocketId = targetKiosk.socketId;
      targetRole = ROLES.KIOSK;
      if (!validateOrError(socket, memSession.monitorSocketId === socket.id,
        ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
        'Unauthorized: you do not own the monitoring session')) {
        return { forwarded: false };
      }
    }

    const validPair =
      (senderRole === ROLES.KIOSK && targetRole === ROLES.MONITOR) ||
      (senderRole === ROLES.MONITOR && targetRole === ROLES.KIOSK);
    if (!validateOrError(socket, validPair, ERROR_CODES.SIGNALING_INVALID_PAIRING,
      `Invalid pairing for ${type}`)) {
      return { forwarded: false };
    }
  }

  sessionsState.updateSessionActivity(kioskId);

  const targetSocket = io.sockets.sockets.get(targetSocketId);
  if (targetSocket) {
    targetSocket.emit(type, {
      fromId: clientId,
      [payloadKey]: payload,
      signalingMode,
      kioskId,
      deviceId: kioskId,
    });
    logInfo('WebRTC', `${type} forwarded`, {
      fromId: clientId,
      toId: targetId,
      kioskId,
      signalingMode,
      targetSocketId,
    });
    return { forwarded: true, kioskId };
  }

  logError('WebRTC', `${type} target socket not found`, { targetId, targetSocketId, kioskId });
  emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target socket not found: ${targetId}`, {
    operation: type,
    kioskId,
  });
  return { forwarded: false };
}
