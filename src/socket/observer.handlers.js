/**
 * Observer monitoring socket event handlers.
 */

import { ROLES } from '../auth/auth.middleware.js';
import { ERROR_CODES } from '../errors/socket.error.js';
import { emitError, validateOrError } from '../errors/socket.error.js';
import { OBSERVER_SOCKET_EVENTS } from '../constants/observer.constants.js';
import { isSuperAdminRole, normalizeRole, ROLES as APP_ROLES } from '../middleware/rbac.middleware.js';
import {
  joinAsObserver,
  leaveObserver,
  listActiveSessionsForUser,
  onMonitoringSessionStarted,
  onMonitoringSessionEnded,
  disconnectAllObserversForSession,
  cleanupStaleObservers,
} from '../services/session.service.js';
import { canJoinAsObserver } from '../services/observer-permission.service.js';
import { checkRateLimit } from '../utils/rate.limiter.js';
import * as kiosksState from '../state/kiosks.state.js';
import * as activeSessionsState from '../state/active-sessions.state.js';
import { logInfo, logWarn } from '../utils/logger.js';

/**
 * Emit session-created to admin dashboards (observers only).
 */
export function emitSessionCreated(io, sessionPayload) {
  io.to('observers').emit(OBSERVER_SOCKET_EVENTS.SESSION_CREATED, sessionPayload);
  io.to('monitors').emit(OBSERVER_SOCKET_EVENTS.SESSION_CREATED, sessionPayload);
}

/**
 * Emit session-ended for observer registry.
 */
export function emitSessionEnded(io, sessionPayload) {
  io.to('observers').emit(OBSERVER_SOCKET_EVENTS.SESSION_ENDED, sessionPayload);
}

/**
 * Hook when monitor session starts — register active session registry.
 */
export async function handleMonitoringStartedRegistry({
  kioskId,
  kioskSocketId,
  kioskUserId,
  monitorUserId,
  monitorSocketId,
  monitorClientId,
  dbSession,
  io,
}) {
  const kiosk = kiosksState.getKiosk(kioskId);
  const record = await onMonitoringSessionStarted({
    kioskId,
    kioskSocketId: kioskSocketId || kiosk?.socketId || null,
    kioskUserId: kioskUserId || kiosk?.userId || null,
    monitorUserId,
    monitorSocketId,
    monitorClientId,
    dbSession,
  });

  emitSessionCreated(io, {
    session_id: record.session_id,
    division_id: record.division_id,
    lobby_id: record.lobby_id,
    kiosk_id: record.kiosk_id,
    monitor_user_id: record.monitor_user_id,
    status: record.status,
    started_at: record.started_at,
    timestamp: new Date().toISOString(),
  });

  return record;
}

/**
 * Hook when monitor session ends.
 */
export async function handleMonitoringEndedRegistry({ kioskId, io, reason }) {
  await disconnectAllObserversForSession(kioskId, io, reason);
  const closed = onMonitoringSessionEnded(kioskId, reason);
  if (closed) {
    emitSessionEnded(io, {
      session_id: closed.session_id,
      kiosk_id: closed.kiosk_id,
      reason,
      timestamp: new Date().toISOString(),
    });

    const kiosk = kiosksState.getKiosk(kioskId);
    if (kiosk?.socketId) {
      const kioskSocket = io.sockets.sockets.get(kiosk.socketId);
      kioskSocket?.emit(OBSERVER_SOCKET_EVENTS.OBSERVER_LEFT, {
        sessionId: closed.session_id,
        reason: 'session-ended',
        all: true,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

/**
 * Register observer-specific socket events on a connection.
 */
export function registerObserverHandlers(io, socket) {
  const { role, clientId, userId, user: appUser } = socket.data;

  const appRole = appUser?.role ? normalizeRole(appUser.role) : null;
  const isAdminObserverRole =
    appRole && (isSuperAdminRole(appRole) || appRole === APP_ROLES.DIVISION_ADMIN);

  if (role === ROLES.MONITOR && isAdminObserverRole) {
    socket.join('observers');
  }

  socket.on(OBSERVER_SOCKET_EVENTS.GET_ACTIVE_SESSIONS, async (data, ack) => {
    const respond = (payload) => {
      socket.emit(OBSERVER_SOCKET_EVENTS.ACTIVE_SESSIONS, payload);
      if (typeof ack === 'function') ack(payload);
    };

    if (!appUser) {
      emitError(socket, ERROR_CODES.AUTH_REQUIRED, 'App authentication required');
      respond({ sessions: [], error: 'auth_required' });
      return;
    }

    const perm = canJoinAsObserver(appUser);
    if (!perm.allowed) {
      emitError(socket, ERROR_CODES.OPERATION_NOT_ALLOWED, perm.reason);
      respond({ sessions: [], error: perm.reason });
      return;
    }

    const divisionFilter =
      appRole === APP_ROLES.DIVISION_ADMIN ? appUser.division_id : null;

    const sessions = await listActiveSessionsForUser(appUser, divisionFilter);
    respond({
      sessions,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on(OBSERVER_SOCKET_EVENTS.JOIN_AS_OBSERVER, async (data, ack) => {
    const { sessionId, deviceInfo } = data || {};
    const ipAddress = socket.handshake?.address || null;

    const rateLimit = checkRateLimit(clientId, 'join-as-observer');
    if (!rateLimit.allowed) {
      emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Observer join rate limit exceeded');
      return;
    }

    if (!validateOrError(socket, appUser, ERROR_CODES.AUTH_REQUIRED, 'App JWT required for observer mode')) {
      return;
    }

    if (!validateOrError(socket, sessionId, ERROR_CODES.INVALID_REQUEST, 'sessionId is required')) {
      return;
    }

    if (appRole === APP_ROLES.MONITOR) {
      emitError(socket, ERROR_CODES.OPERATION_NOT_ALLOWED, 'MONITOR role cannot join as observer');
      return;
    }

    const result = await joinAsObserver({
      user: appUser,
      sessionId,
      observerSocketId: socket.id,
      observerClientId: clientId,
      ipAddress,
      deviceInfo: deviceInfo || { userAgent: socket.handshake?.headers?.['user-agent'] },
    });

    if (!result.ok) {
      emitError(socket, result.code || ERROR_CODES.SESSION_NOT_AUTHORIZED, result.message);
      if (typeof ack === 'function') ack({ ok: false, message: result.message });
      return;
    }

    socket.data.isObserver = true;
    socket.data.observerSessionId = result.session.session_id;

    const kiosk = kiosksState.getKiosk(result.session.kiosk_id);
    if (kiosk?.socketId) {
      const kioskSocket = io.sockets.sockets.get(kiosk.socketId);
      kioskSocket?.emit(OBSERVER_SOCKET_EVENTS.OBSERVER_JOINED, {
        sessionId: result.session.session_id,
        observerUserId: appUser.userId,
        observerClientId: clientId,
        observerRole: appUser.role,
        timestamp: new Date().toISOString(),
      });
    }

    io.to('observers').emit(OBSERVER_SOCKET_EVENTS.OBSERVER_JOINED, {
      sessionId: result.session.session_id,
      observerUserId: appUser.userId,
      observerRole: appUser.role,
      timestamp: new Date().toISOString(),
    });

    socket.emit(OBSERVER_SOCKET_EVENTS.OBSERVER_JOINED, {
      sessionId: result.session.session_id,
      kioskId: result.session.kiosk_id,
      signalingMode: 'observer',
      timestamp: new Date().toISOString(),
    });

    logInfo('Observer', 'JOIN_AS_OBSERVER success', {
      sessionId: result.session.session_id,
      observerUserId: appUser.userId,
    });

    if (typeof ack === 'function') {
      ack({
        ok: true,
        sessionId: result.session.session_id,
        kioskId: result.session.kiosk_id,
      });
    }
  });

  socket.on(OBSERVER_SOCKET_EVENTS.LEAVE_OBSERVER, async (data, ack) => {
    const { sessionId } = data || {};
    const ipAddress = socket.handshake?.address || null;

    if (!appUser || !sessionId) {
      emitError(socket, ERROR_CODES.INVALID_REQUEST, 'sessionId required');
      return;
    }

    const result = await leaveObserver({
      user: appUser,
      sessionId,
      ipAddress,
      deviceInfo: { userAgent: socket.handshake?.headers?.['user-agent'] },
    });

    if (!result.ok) {
      emitError(socket, result.code || ERROR_CODES.SESSION_NOT_FOUND, result.message);
      return;
    }

    socket.data.isObserver = false;
    socket.data.observerSessionId = null;

    const kiosk = kiosksState.getKiosk(result.session.kiosk_id);
    if (kiosk?.socketId) {
      io.sockets.sockets.get(kiosk.socketId)?.emit(OBSERVER_SOCKET_EVENTS.OBSERVER_LEFT, {
        sessionId: result.session.session_id,
        observerUserId: appUser.userId,
        timestamp: new Date().toISOString(),
      });
    }

    io.to('observers').emit(OBSERVER_SOCKET_EVENTS.OBSERVER_LEFT, {
      sessionId: result.session.session_id,
      observerUserId: appUser.userId,
      timestamp: new Date().toISOString(),
    });

    if (typeof ack === 'function') ack({ ok: true });
  });
}

/**
 * Cleanup observer state on disconnect.
 */
export async function handleObserverDisconnect(io, socket) {
  const { user: appUser, userId } = socket.data;
  if (!socket.data?.isObserver || !appUser) {
    const removed = activeSessionsState.removeObserversBySocket(socket.id);
    for (const { session, observer } of removed) {
      await leaveObserver({
        user: { userId: observer.observer_user_id, role: observer.observer_role },
        sessionId: session.session_id,
      });
      io.to('observers').emit(OBSERVER_SOCKET_EVENTS.OBSERVER_LEFT, {
        sessionId: session.session_id,
        observerUserId: observer.observer_user_id,
        reason: 'disconnect',
        timestamp: new Date().toISOString(),
      });
    }
    return removed.length;
  }

  const sessionId = socket.data.observerSessionId;
  if (sessionId) {
    await leaveObserver({ user: appUser, sessionId });
    io.to('observers').emit(OBSERVER_SOCKET_EVENTS.OBSERVER_LEFT, {
      sessionId,
      observerUserId: userId,
      reason: 'disconnect',
      timestamp: new Date().toISOString(),
    });
  }
  return 1;
}

let staleCleanupInterval = null;

export function startObserverStaleCleanup(io) {
  if (staleCleanupInterval) return;
  staleCleanupInterval = setInterval(() => {
    cleanupStaleObservers(io).catch((err) => {
      logWarn('Observer', 'Stale cleanup failed', { error: err.message });
    });
  }, 60000);
}
