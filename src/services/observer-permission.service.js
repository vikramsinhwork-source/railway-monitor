import { ROLES, normalizeRole, isSuperAdminRole } from '../middleware/rbac.middleware.js';
import { OBSERVER_AUDIT_ACTIONS } from '../constants/observer.constants.js';
import { logMonitoringAudit } from './monitoring-audit.service.js';

/**
 * Roles allowed to join as silent observers.
 */
export const OBSERVER_ALLOWED_ROLES = new Set([
  ROLES.SUPER_ADMIN,
  ROLES.DIVISION_ADMIN,
  ROLES.MONITOR,
]);

/**
 * Roles explicitly denied observer mode.
 */
export const OBSERVER_DENIED_ROLES = new Set([
  ROLES.USER,
]);

/**
 * @param {Object} user - { role, division_id, userId }
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canJoinAsObserver(user) {
  if (!user?.role) {
    return { allowed: false, reason: 'Authentication required' };
  }

  const role = normalizeRole(user.role);

  if (OBSERVER_DENIED_ROLES.has(role)) {
    return { allowed: false, reason: `${role} cannot use observer mode` };
  }

  if (!OBSERVER_ALLOWED_ROLES.has(role)) {
    return { allowed: false, reason: 'Observer mode not permitted for this role' };
  }

  return { allowed: true };
}

/**
 * @param {Object} user
 * @param {Object} session - { division_id }
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canObserveSession(user, session) {
  const base = canJoinAsObserver(user);
  if (!base.allowed) return base;

  const role = normalizeRole(user.role);

  if (isSuperAdminRole(role)) {
    return { allowed: true };
  }

  if (role === ROLES.DIVISION_ADMIN) {
    if (!user.division_id) {
      return { allowed: false, reason: 'Division admin has no division scope' };
    }
    if (!session?.division_id || user.division_id !== session.division_id) {
      return { allowed: false, reason: 'Cross-division observer access denied' };
    }
    return { allowed: true };
  }

  if (role === ROLES.MONITOR) {
    if (user.division_id && session?.division_id && user.division_id !== session.division_id) {
      return { allowed: false, reason: 'Cross-division observer access denied' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Observer access denied' };
}

/**
 * @param {Object} params
 * @param {Object} params.user
 * @param {Object} params.session
 * @param {string} [params.ipAddress]
 * @param {Object} [params.deviceInfo]
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function validateObserverJoin({ user, session, ipAddress = null, deviceInfo = null }) {
  const result = canObserveSession(user, session);

  if (!result.allowed) {
    await logMonitoringAudit({
      observerUserId: user?.userId || null,
      observerRole: user?.role || null,
      sessionId: session?.session_id || session?.id || null,
      divisionId: session?.division_id || null,
      lobbyId: session?.lobby_id || null,
      action: OBSERVER_AUDIT_ACTIONS.DENIED,
      result: 'DENIED',
      ipAddress,
      deviceInfo,
      details: { reason: result.reason },
    });
  }

  return result;
}

/**
 * Observer signaling must be receive-only (no media publish).
 * @param {Object} data - signaling payload
 * @returns {boolean}
 */
export function isRecvOnlySignaling(data) {
  if (data?.mediaIntent === 'recvonly') return true;
  if (data?.signalingMode === 'observer' && data?.recvOnly === true) return true;
  return false;
}
