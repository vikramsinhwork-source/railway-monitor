import Device from '../divisions/device.model.js';
import DeviceLog from '../health/deviceLog.model.js';
import DeviceHealthSnapshot from '../health/deviceHealthSnapshot.model.js';
import SocketPresence from '../realtime/socketPresence.model.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';
import { createAuditLog } from '../audit/audit.service.js';
import { logWarn } from '../../utils/logger.js';
import {
  completeDeviceCommand,
  enqueueDeviceCommand,
  markAgentPresenceOffline,
  touchAgentHeartbeat,
  upsertAgentSocketPresence,
} from '../../socket/realtime.manager.js';
import {
  disableDeviceForUser,
  getDeviceByIdForUser,
  isPiMonitoringAgent,
  listRaspberryDevices,
  reactivateDeviceForUser,
} from '../devices/device.service.js';
import { getAgentHealth, getDeviceLogs } from '../health/health.service.js';

async function logAgentEvent(device, logType, message, details = null) {
  return DeviceLog.create({
    division_id: device.division_id,
    lobby_id: device.lobby_id,
    device_id: device.id,
    log_type: logType,
    message,
    details,
    created_at: new Date(),
  });
}

async function getRaspberryDevice(deviceId) {
  const device = await Device.findByPk(deviceId);
  if (!isPiMonitoringAgent(device)) return null;
  return device;
}

function toAgentResponse(device) {
  return {
    id: device.id,
    division_id: device.division_id,
    lobby_id: device.lobby_id,
    device_type: device.device_type,
    device_name: device.device_name,
    serial_number: device.serial_number,
    status: device.status,
    is_active: device.is_active,
    meta: device.meta,
    last_seen_at: device.last_seen_at,
    health_status: device.health_status,
    firmware_version: device.firmware_version,
    ip_address: device.ip_address,
    created_at: device.created_at,
    updated_at: device.updated_at,
  };
}

export async function registerAgent({ deviceId, serialNumber, hostname, version, capabilities, socketId }) {
  const device = await getRaspberryDevice(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found or not a Raspberry Pi agent' };
  }
  if (!device.is_active) {
    return { ok: false, code: 'DEVICE_INACTIVE', message: 'Agent device is disabled' };
  }

  try {
    await upsertAgentSocketPresence({
      deviceId: device.id,
      socketId,
      divisionId: device.division_id,
      lobbyId: device.lobby_id,
    });
  } catch (error) {
    logWarn('Agent', 'Socket presence upsert failed; continuing agent registration', {
      deviceId: device.id,
      error: error.message,
    });
  }

  const meta = {
    ...(device.meta || {}),
    agent: {
      serialNumber,
      hostname,
      version,
      capabilities,
      registeredAt: new Date().toISOString(),
    },
  };

  await device.update({
    status: 'ONLINE',
    last_seen_at: new Date(),
    serial_number: serialNumber || device.serial_number,
    firmware_version: version || device.firmware_version,
    meta,
    health_status: 'ONLINE',
  });

  await logAgentEvent(device, 'AGENT_REGISTERED', `Agent registered: ${hostname}`, {
    serialNumber,
    hostname,
    version,
    capabilities,
  });

  return {
    ok: true,
    device: toAgentResponse(device),
  };
}

export async function handleAgentOffline({ deviceId, socketId, reason = 'disconnect' }) {
  const device = await getRaspberryDevice(deviceId);
  if (!device) return null;

  await markAgentPresenceOffline({ deviceId, socketId, reason });
  await device.update({ status: 'OFFLINE' });
  await logAgentEvent(device, 'AGENT_OFFLINE', `Agent went offline: ${reason}`, { reason });

  return device;
}

export async function processAgentHeartbeat(deviceId, metrics, socketId) {
  const device = await getRaspberryDevice(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found or not a Raspberry Pi agent' };
  }

  await touchAgentHeartbeat({ deviceId, socketId });
  await device.update({
    last_seen_at: new Date(),
    status: 'ONLINE',
    health_status: 'ONLINE',
  });

  const snapshot = await DeviceHealthSnapshot.create({
    division_id: device.division_id,
    lobby_id: device.lobby_id,
    device_id: device.id,
    check_tier: 'AGENT_HEARTBEAT',
    health_status: 'ONLINE',
    health_reason: 'agent-heartbeat',
    check_result: metrics,
    created_at: new Date(),
  });

  await logAgentEvent(device, 'HEARTBEAT_RECEIVED', 'Agent heartbeat received', metrics);

  return {
    ok: true,
    snapshot,
    device,
  };
}

export async function processAgentStatusUpdate(deviceId, statusPayload) {
  const device = await getRaspberryDevice(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found or not a Raspberry Pi agent' };
  }

  await device.update({ last_seen_at: new Date() });

  const log = await logAgentEvent(
    device,
    'AGENT_STATUS_UPDATE',
    'Agent status update received',
    statusPayload
  );

  return { ok: true, log, device };
}

export async function processAgentCommandResult({ commandId, success, message, data }) {
  const completed = await completeDeviceCommand({
    commandId,
    success,
    errorMessage: success ? null : (message || 'Command failed'),
  });
  if (!completed) {
    return { ok: false, code: 'COMMAND_NOT_FOUND', message: 'Command not found' };
  }

  const device = await Device.findByPk(completed.device_id);
  if (device) {
    const logType = success ? 'COMMAND_EXECUTED' : 'COMMAND_FAILED';
    await logAgentEvent(device, logType, message || (success ? 'Command executed' : 'Command failed'), {
      commandId,
      success,
      data,
      command: completed.command,
    });
  }

  return { ok: true, command: completed };
}

export async function listAgentsForUser(user, filters = {}) {
  const result = await listRaspberryDevices(user, filters);
  return {
    agents: result.rows,
    count: result.count,
  };
}

export async function getAgentByIdForUser(id, user) {
  const result = await getDeviceByIdForUser(id, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };
  if (!isPiMonitoringAgent(result.device)) return { notAgent: true };
  return { agent: result.device };
}

export async function getAgentHealthForUser(user, deviceId) {
  const result = await getAgentByIdForUser(deviceId, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };
  if (result.notAgent) return { notAgent: true };

  const health = await getAgentHealth(deviceId);
  return { health };
}

export async function getAgentLogsForUser(user, deviceId, limit = 100) {
  const result = await getAgentByIdForUser(deviceId, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };
  if (result.notAgent) return { notAgent: true };

  const logsResult = await getDeviceLogs(user, deviceId, limit);
  if (logsResult?.forbidden) return { forbidden: true };
  return { logs: logsResult };
}

export async function sendAgentCommandForUser(user, deviceId, command, payload = null) {
  const result = await getAgentByIdForUser(deviceId, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };
  if (result.notAgent) return { notAgent: true };
  if (!result.agent.is_active) return { inactive: true };

  const role = normalizeRole(user.role);
  if (role === 'USER') return { forbidden: true };

  const queued = await enqueueDeviceCommand({
    deviceId,
    command,
    payload,
    requestedBy: user.id,
  });
  if (!queued.ok) {
    return { error: queued.message || 'Failed to enqueue command' };
  }

  const device = await Device.findByPk(deviceId);
  if (device) {
    await logAgentEvent(device, 'COMMAND_QUEUED', `Command queued: ${command}`, {
      commandId: queued.command.id,
      command,
      payload,
    });
  }

  return {
    commandId: queued.command.id,
    command: queued.command.command,
    status: queued.command.status,
  };
}

export async function disableAgentForUser(id, user) {
  const result = await getAgentByIdForUser(id, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };
  if (result.notAgent) return { notAgent: true };

  const disabled = await disableDeviceForUser(id, user);
  if (!disabled) return null;
  if (disabled.forbidden) return { forbidden: true };

  const device = await Device.findByPk(id);
  if (device) {
    await logAgentEvent(device, 'AGENT_DISABLED', 'Agent disabled', { deviceId: id });
  }

  return { agent: disabled.device };
}

export async function enableAgentForUser(id, user) {
  const result = await getAgentByIdForUser(id, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };
  if (result.notAgent) return { notAgent: true };

  const enabled = await reactivateDeviceForUser(id, user);
  if (!enabled) return null;
  if (enabled.forbidden) return { forbidden: true };

  const device = await Device.findByPk(id);
  if (device) {
    await logAgentEvent(device, 'AGENT_ENABLED', 'Agent enabled', { deviceId: id });
  }

  return { agent: enabled.device };
}

export { toAgentResponse };
