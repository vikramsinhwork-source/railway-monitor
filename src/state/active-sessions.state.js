/**
 * Active session registry with observer tracking (in-memory).
 * Complements sessions.state.js for MONITOR<->KIOSK lifecycle.
 */

import { logInfo, logDebug } from '../utils/logger.js';

/** @type {Map<string, Object>} sessionId -> enriched session */
const activeSessions = new Map();

/** @type {Map<string, string>} kioskId/deviceId -> sessionId */
const kioskToSessionId = new Map();

function cloneSession(session) {
  return {
    ...session,
    observers: session.observers ? [...session.observers] : [],
  };
}

/**
 * @param {Object} params
 */
export function registerActiveSession({
  sessionId,
  divisionId = null,
  lobbyId = null,
  kioskId,
  kioskUserId = null,
  kioskSocketId = null,
  monitorUserId,
  monitorSocketId,
  monitorClientId,
  dbSessionId = null,
}) {
  const record = {
    session_id: sessionId,
    division_id: divisionId,
    lobby_id: lobbyId,
    kiosk_id: kioskId,
    kiosk_user_id: kioskUserId,
    kiosk_socket_id: kioskSocketId,
    monitor_user_id: monitorUserId,
    monitor_socket_id: monitorSocketId,
    monitor_client_id: monitorClientId,
    db_session_id: dbSessionId,
    status: 'ACTIVE',
    started_at: new Date(),
    ended_at: null,
    observers: [],
  };

  activeSessions.set(sessionId, record);
  kioskToSessionId.set(kioskId, sessionId);

  logInfo('ActiveSession', 'Registered', { sessionId, kioskId, monitorUserId });
  return cloneSession(record);
}

export function getActiveSessionById(sessionId) {
  const s = activeSessions.get(sessionId);
  return s ? cloneSession(s) : null;
}

export function getActiveSessionByKioskId(kioskId) {
  const sessionId = kioskToSessionId.get(kioskId);
  if (!sessionId) return null;
  return getActiveSessionById(sessionId);
}

export function updateKioskSocket(sessionId, kioskSocketId) {
  const s = activeSessions.get(sessionId);
  if (!s) return false;
  s.kiosk_socket_id = kioskSocketId;
  return true;
}

export function addObserverToSession(sessionId, observer) {
  const s = activeSessions.get(sessionId);
  if (!s || s.status !== 'ACTIVE') return null;

  const existing = s.observers.find(
    (o) => o.observer_user_id === observer.observer_user_id && !o.left_at
  );
  if (existing) {
    existing.observer_socket_id = observer.observer_socket_id;
    return existing;
  }

  const entry = {
    observer_user_id: observer.observer_user_id,
    observer_role: observer.observer_role,
    observer_socket_id: observer.observer_socket_id,
    observer_client_id: observer.observer_client_id,
    joined_at: new Date(),
    left_at: null,
  };
  s.observers.push(entry);
  logDebug('ActiveSession', 'Observer added', { sessionId, observerUserId: observer.observer_user_id });
  return entry;
}

export function removeObserverFromSession(sessionId, observerUserId) {
  const s = activeSessions.get(sessionId);
  if (!s) return null;

  const obs = s.observers.find(
    (o) => o.observer_user_id === observerUserId && !o.left_at
  );
  if (!obs) return null;

  obs.left_at = new Date();
  logDebug('ActiveSession', 'Observer removed', { sessionId, observerUserId });
  return obs;
}

export function removeObserversBySocket(observerSocketId) {
  const removed = [];
  for (const session of activeSessions.values()) {
    if (session.status !== 'ACTIVE') continue;
    for (const obs of session.observers) {
      if (!obs.left_at && obs.observer_socket_id === observerSocketId) {
        obs.left_at = new Date();
        removed.push({ session, observer: obs });
      }
    }
  }
  return removed;
}

export function getObserverOnSession(sessionId, observerUserId) {
  const s = activeSessions.get(sessionId);
  if (!s) return null;
  return s.observers.find(
    (o) => o.observer_user_id === observerUserId && !o.left_at
  ) || null;
}

export function isObserverOnSession(sessionId, observerSocketId) {
  const s = activeSessions.get(sessionId);
  if (!s) return false;
  return s.observers.some(
    (o) => o.observer_socket_id === observerSocketId && !o.left_at
  );
}

export function closeActiveSession(sessionId, reason = null) {
  const s = activeSessions.get(sessionId);
  if (!s) return null;

  s.status = 'ENDED';
  s.ended_at = new Date();
  s.end_reason = reason;
  for (const obs of s.observers) {
    if (!obs.left_at) obs.left_at = new Date();
  }

  kioskToSessionId.delete(s.kiosk_id);
  activeSessions.delete(sessionId);

  logInfo('ActiveSession', 'Closed', { sessionId, reason });
  return cloneSession(s);
}

export function closeActiveSessionByKioskId(kioskId, reason = null) {
  const sessionId = kioskToSessionId.get(kioskId);
  if (!sessionId) return null;
  return closeActiveSession(sessionId, reason);
}

/**
 * @param {Object} [filter]
 * @param {string} [filter.divisionId] - restrict to division (DIVISION_ADMIN)
 */
export function listActiveSessions(filter = {}) {
  const { divisionId = null } = filter;
  return Array.from(activeSessions.values())
    .filter((s) => s.status === 'ACTIVE')
    .filter((s) => !divisionId || s.division_id === divisionId)
    .map((s) => ({
      session_id: s.session_id,
      division_id: s.division_id,
      lobby_id: s.lobby_id,
      kiosk_id: s.kiosk_id,
      kiosk_user_id: s.kiosk_user_id,
      monitor_user_id: s.monitor_user_id,
      monitor_client_id: s.monitor_client_id,
      status: s.status,
      started_at: s.started_at,
      observer_count: s.observers.filter((o) => !o.left_at).length,
      observers: s.observers.filter((o) => !o.left_at).map((o) => ({
        observer_user_id: o.observer_user_id,
        observer_role: o.observer_role,
        joined_at: o.joined_at,
      })),
    }));
}

export function getStaleObservers(maxIdleMs) {
  const stale = [];
  const cutoff = Date.now() - maxIdleMs;
  for (const session of activeSessions.values()) {
    for (const obs of session.observers) {
      if (!obs.left_at && obs.last_activity_at && obs.last_activity_at.getTime() < cutoff) {
        stale.push({ session, observer: obs });
      }
    }
  }
  return stale;
}

export function touchObserverActivity(sessionId, observerUserId) {
  const obs = getObserverOnSession(sessionId, observerUserId);
  if (obs) obs.last_activity_at = new Date();
}

export function clearAllActiveSessions() {
  activeSessions.clear();
  kioskToSessionId.clear();
}
