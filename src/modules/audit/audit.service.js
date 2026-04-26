import AuditLog from './auditLog.model.js';
import { logWarn } from '../../utils/logger.js';

export async function createAuditLog({
  userId = null,
  action,
  entityType,
  entityId,
  oldData = null,
  newData = null,
}) {
  try {
    if (!action || !entityType || !entityId) {
      return null;
    }

    return await AuditLog.create({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_data: oldData,
      new_data: newData,
      created_at: new Date(),
    });
  } catch (error) {
    logWarn('Audit', 'Failed to write audit log', {
      action,
      entityType,
      entityId,
      error: error.message,
    });
    return null;
  }
}
