import { Op } from 'sequelize';
import MonitoringSession from '../modules/realtime/monitoringSession.model.js';
import SessionObserver from '../modules/observer/sessionObserver.model.js';
import Device from '../modules/divisions/device.model.js';
import Division from '../modules/divisions/division.model.js';
import Lobby from '../modules/divisions/lobby.model.js';
import User from '../modules/users/user.model.js';
import * as activeSessionsState from '../state/active-sessions.state.js';
import * as sessionsState from '../state/sessions.state.js';
import { validateObserverJoin } from './observer-permission.service.js';
import { logMonitoringAudit } from './monitoring-audit.service.js';
import {
  OBSERVER_AUDIT_ACTIONS,
  OBSERVER_CONFIG,
} from '../constants/observer.constants.js';
import { logInfo, logWarn } from '../utils/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Register active session when MONITOR starts monitoring (additive).
 */
export async function onMonitoringSessionStarted({
  kioskId,
  kioskSocketId = null,
  kioskUserId = null,
  monitorUserId,
  monitorSocketId,
  monitorClientId,
  dbSession = null,
}) {
  const sessionId = dbSession?.id || kioskId;

  let divisionId = dbSession?.division_id || null;
  let lobbyId = dbSession?.lobby_id || null;

  if (isUuid(kioskId) && !divisionId) {
    const device = await Device.findByPk(kioskId, {
      attributes: ['id', 'division_id', 'lobby_id'],
    });
    if (device) {
      divisionId = device.division_id;
      lobbyId = device.lobby_id;
    }
  }

  return activeSessionsState.registerActiveSession({
    sessionId,
    divisionId,
    lobbyId,
    kioskId,
    kioskUserId,
    kioskSocketId,
    monitorUserId,
    monitorSocketId,
    monitorClientId,
    dbSessionId: dbSession?.id || null,
  });
}

/**
 * Close active session registry entry.
 */
export function onMonitoringSessionEnded(kioskId, reason = null) {
  const byKiosk = activeSessionsState.closeActiveSessionByKioskId(kioskId, reason);
  if (byKiosk) return byKiosk;
  return null;
}

/**
 * @param {Object} user - app user from socket
 * @param {string|null} divisionFilter - for DIVISION_ADMIN
 */
export async function listActiveSessionsForUser(user, divisionFilter = null) {
  const inMemory = activeSessionsState.listActiveSessions({
    divisionId: divisionFilter,
  });

  const enriched = await Promise.all(
    inMemory.map(async (s) => enrichSessionDashboardRow(s))
  );

  return enriched;
}

async function enrichSessionDashboardRow(session) {
  let divisionName = null;
  let lobbyName = null;
  let kioskName = session.kiosk_id;
  let monitorName = session.monitor_user_id;

  if (session.division_id) {
    const div = await Division.findByPk(session.division_id, { attributes: ['id', 'name'] });
    divisionName = div?.name || null;
  }
  if (session.lobby_id) {
    const lobby = await Lobby.findByPk(session.lobby_id, { attributes: ['id', 'name'] });
    lobbyName = lobby?.name || null;
  }
  if (isUuid(session.kiosk_id)) {
    const device = await Device.findByPk(session.kiosk_id, {
      attributes: ['id', 'device_name', 'serial_number'],
    });
    kioskName = device?.device_name || device?.serial_number || session.kiosk_id;
  }
  if (session.monitor_user_id) {
    const monitor = await User.findByPk(session.monitor_user_id, {
      attributes: ['id', 'user_id', 'name'],
    });
    monitorName = monitor?.name || monitor?.user_id || session.monitor_user_id;
  }

  return {
    session_id: session.session_id,
    division_id: session.division_id,
    division: divisionName,
    lobby_id: session.lobby_id,
    lobby: lobbyName,
    kiosk: kioskName,
    kiosk_id: session.kiosk_id,
    monitor: monitorName,
    monitor_user_id: session.monitor_user_id,
    start_time: session.started_at,
    observer_count: session.observer_count,
    status: session.status,
    observers: session.observers,
  };
}

/**
 * @returns {Promise<{ ok: boolean, code?: string, message?: string, session?: Object, observer?: Object }>}
 */
export async function joinAsObserver({
  user,
  sessionId,
  observerSocketId,
  observerClientId,
  ipAddress = null,
  deviceInfo = null,
}) {
  let active = activeSessionsState.getActiveSessionById(sessionId);
  if (!active) {
    const dbSession = await MonitoringSession.findOne({
      where: { id: sessionId, status: 'ACTIVE' },
    });
    if (dbSession && sessionsState.hasActiveSession(dbSession.device_id)) {
      active = activeSessionsState.getActiveSessionByKioskId(dbSession.device_id);
    }
  }

  if (!active) {
    const mem = activeSessionsState.getActiveSessionByKioskId(sessionId);
    if (mem) active = mem;
  }

  if (!active || active.status !== 'ACTIVE') {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Active session not found' };
  }

  if (!sessionsState.hasActiveSession(active.kiosk_id)) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Underlying monitor session is not active' };
  }

  const permission = await validateObserverJoin({
    user,
    session: active,
    ipAddress,
    deviceInfo,
  });

  if (!permission.allowed) {
    return { ok: false, code: 'SESSION_NOT_AUTHORIZED', message: permission.reason };
  }

  const activeObservers = active.observers?.filter((o) => !o.left_at)?.length
    ?? activeSessionsState.getActiveSessionById(active.session_id)?.observers?.filter((o) => !o.left_at)?.length
    ?? 0;

  if (activeObservers >= OBSERVER_CONFIG.MAX_OBSERVERS_PER_SESSION) {
    return { ok: false, code: 'OPERATION_NOT_ALLOWED', message: 'Maximum observers reached for session' };
  }

  const observerEntry = activeSessionsState.addObserverToSession(active.session_id, {
    observer_user_id: user.userId,
    observer_role: user.role,
    observer_socket_id: observerSocketId,
    observer_client_id: observerClientId || user.userId,
  });

  let dbObserver = null;
  if (active.db_session_id) {
    dbObserver = await SessionObserver.create({
      session_id: active.db_session_id,
      observer_user_id: user.userId,
      observer_role: user.role,
      observer_socket_id: observerSocketId,
      joined_at: new Date(),
    });
  }

  await logMonitoringAudit({
    observerUserId: user.userId,
    observerRole: user.role,
    sessionId: active.db_session_id || active.session_id,
    divisionId: active.division_id,
    lobbyId: active.lobby_id,
    action: OBSERVER_AUDIT_ACTIONS.JOIN,
    result: 'SUCCESS',
    ipAddress,
    deviceInfo,
    joinedAt: observerEntry.joined_at,
  });

  logInfo('Observer', 'Joined session', {
    sessionId: active.session_id,
    observerUserId: user.userId,
    role: user.role,
  });

  return {
    ok: true,
    session: active,
    observer: observerEntry,
    dbObserver,
  };
}

/**
 * @returns {Promise<{ ok: boolean, session?: Object, observer?: Object }>}
 */
export async function leaveObserver({
  user,
  sessionId,
  ipAddress = null,
  deviceInfo = null,
}) {
  const active = activeSessionsState.getActiveSessionById(sessionId)
    || activeSessionsState.getActiveSessionByKioskId(sessionId);

  if (!active) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Session not found' };
  }

  const removed = activeSessionsState.removeObserverFromSession(
    active.session_id,
    user.userId
  );

  if (!removed) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Observer not on session' };
  }

  if (active.db_session_id) {
    await SessionObserver.update(
      { left_at: new Date() },
      {
        where: {
          session_id: active.db_session_id,
          observer_user_id: user.userId,
          left_at: null,
        },
      }
    );
  }

  await logMonitoringAudit({
    observerUserId: user.userId,
    observerRole: user.role,
    sessionId: active.db_session_id || active.session_id,
    divisionId: active.division_id,
    lobbyId: active.lobby_id,
    action: OBSERVER_AUDIT_ACTIONS.LEAVE,
    result: 'SUCCESS',
    ipAddress,
    deviceInfo,
    joinedAt: removed.joined_at,
    leftAt: removed.left_at,
  });

  return { ok: true, session: active, observer: removed };
}

export async function disconnectAllObserversForSession(sessionId, io, reason = 'session-ended') {
  const active = activeSessionsState.getActiveSessionById(sessionId)
    || activeSessionsState.getActiveSessionByKioskId(sessionId);

  if (!active) return [];

  const notified = [];
  for (const obs of active.observers) {
    if (obs.left_at) continue;
    obs.left_at = new Date();
    if (obs.observer_socket_id && io) {
      const sock = io.sockets.sockets.get(obs.observer_socket_id);
      if (sock) {
        sock.data.isObserver = false;
        sock.emit('session-ended', {
          sessionId: active.session_id,
          kioskId: active.kiosk_id,
          reason,
          timestamp: new Date().toISOString(),
        });
      }
    }
    notified.push(obs);
  }

  if (active.db_session_id) {
    await SessionObserver.update(
      { left_at: new Date() },
      { where: { session_id: active.db_session_id, left_at: null } }
    );
  }

  activeSessionsState.closeActiveSession(active.session_id, reason);
  return notified;
}

export async function cleanupStaleObservers(io) {
  const stale = activeSessionsState.getStaleObservers(OBSERVER_CONFIG.STALE_OBSERVER_MS);
  for (const { session, observer } of stale) {
    await leaveObserver({
      user: { userId: observer.observer_user_id, role: observer.observer_role },
      sessionId: session.session_id,
    });
    if (io && observer.observer_socket_id) {
      const sock = io.sockets.sockets.get(observer.observer_socket_id);
      sock?.emit('observer-left', {
        sessionId: session.session_id,
        observerUserId: observer.observer_user_id,
        reason: 'stale-timeout',
        timestamp: new Date().toISOString(),
      });
    }
  }
  return stale.length;
}

export function resolveSessionForSignaling(kioskId) {
  return activeSessionsState.getActiveSessionByKioskId(kioskId)
    || (sessionsState.hasActiveSession(kioskId) ? {
      session_id: kioskId,
      kiosk_id: kioskId,
      ...sessionsState.getSession(kioskId),
    } : null);
}

export {
  activeSessionsState,
  isUuid,
};
