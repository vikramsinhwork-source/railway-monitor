/**
 * Observer monitoring socket events and configuration.
 */

export const OBSERVER_SOCKET_EVENTS = {
  SESSION_CREATED: 'session-created',
  SESSION_ENDED: 'session-ended',
  JOIN_AS_OBSERVER: 'join-as-observer',
  LEAVE_OBSERVER: 'leave-observer',
  OBSERVER_JOINED: 'observer-joined',
  OBSERVER_LEFT: 'observer-left',
  GET_ACTIVE_SESSIONS: 'get-active-sessions',
  ACTIVE_SESSIONS: 'active-sessions',
  OBSERVER_SIGNALING_REJECTED: 'observer-signaling-rejected',
};

export const OBSERVER_AUDIT_ACTIONS = {
  JOIN: 'OBSERVER_JOIN',
  LEAVE: 'OBSERVER_LEAVE',
  DENIED: 'OBSERVER_ACCESS_DENIED',
  MEDIA_REJECTED: 'OBSERVER_MEDIA_PUBLISH_REJECTED',
};

export const OBSERVER_CONFIG = {
  MAX_OBSERVERS_PER_SESSION: parseInt(process.env.MAX_OBSERVERS_PER_SESSION || '10', 10),
  JOIN_RATE_LIMIT_PER_MINUTE: parseInt(process.env.OBSERVER_JOIN_RATE_LIMIT || '20', 10),
  STALE_OBSERVER_MS: parseInt(process.env.STALE_OBSERVER_MS || '120000', 10),
};

export const SIGNALING_MODES = {
  MONITOR: 'monitor',
  OBSERVER: 'observer',
};
