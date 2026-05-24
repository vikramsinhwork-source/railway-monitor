import MonitoringAuditLog from '../modules/observer/monitoringAuditLog.model.js';
import { logInfo } from '../utils/logger.js';

/**
 * @param {Object} params
 */
export async function logMonitoringAudit({
  observerUserId = null,
  observerRole = null,
  sessionId = null,
  divisionId = null,
  lobbyId = null,
  action,
  result = 'SUCCESS',
  ipAddress = null,
  deviceInfo = null,
  details = null,
  joinedAt = null,
  leftAt = null,
}) {
  try {
    const row = await MonitoringAuditLog.create({
      observer_user_id: observerUserId,
      observer_role: observerRole,
      session_id: sessionId,
      division_id: divisionId,
      lobby_id: lobbyId,
      action,
      result,
      ip_address: ipAddress,
      device_info: deviceInfo,
      details,
      joined_at: joinedAt,
      left_at: leftAt,
    });

    logInfo('ObserverAudit', action, {
      id: row.id,
      sessionId,
      observerUserId,
      result,
    });

    return row;
  } catch (error) {
    logInfo('ObserverAudit', 'Failed to write audit log', {
      action,
      error: error.message,
    });
    return null;
  }
}
