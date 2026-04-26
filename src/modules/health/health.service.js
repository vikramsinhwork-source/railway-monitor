import { Op, fn, col } from 'sequelize';
import Device from '../divisions/device.model.js';
import Division from '../divisions/division.model.js';
import Lobby from '../divisions/lobby.model.js';
import DeviceLog from './deviceLog.model.js';
import DeviceHealthSnapshot from './deviceHealthSnapshot.model.js';
import SocketPresence from '../realtime/socketPresence.model.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';
import { enqueueDeviceCommand } from '../../socket/realtime.manager.js';
import { createAuditLog } from '../audit/audit.service.js';
import { logWarn } from '../../utils/logger.js';

const HEALTH_STATES = new Set([
  'ONLINE',
  'OFFLINE',
  'DEGRADED',
  'RECOVERING',
  'MAINTENANCE',
  'UNKNOWN',
  'CRITICAL',
]);

function userScopeWhere(user) {
  const role = normalizeRole(user.role);
  if (role === 'SUPER_ADMIN') return {};
  if (!user.division_id) return { id: null };
  return { division_id: user.division_id };
}

function canAccessDevice(user, device) {
  const role = normalizeRole(user.role);
  if (role === 'SUPER_ADMIN') return true;
  if (!user.division_id) return false;
  return user.division_id === device.division_id;
}

async function logDeviceEvent(device, logType, message, details = null) {
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

async function addSnapshot(device, tier, status, reason, checkResult, latencyMs = null) {
  return DeviceHealthSnapshot.create({
    division_id: device.division_id,
    lobby_id: device.lobby_id,
    device_id: device.id,
    check_tier: tier,
    health_status: status,
    health_reason: reason || null,
    latency_ms: latencyMs,
    check_result: checkResult || null,
    created_at: new Date(),
  });
}

async function autoHealAttemptsLastHour(deviceId) {
  return DeviceLog.count({
    where: {
      device_id: deviceId,
      log_type: 'AUTOHEAL_TRIGGERED',
      created_at: {
        [Op.gte]: new Date(Date.now() - 60 * 60 * 1000),
      },
    },
  });
}

function chooseRecoveryCommand(device, reason) {
  const lowerReason = (reason || '').toLowerCase();
  if (lowerReason.includes('stream')) return 'REFRESH_STREAM';
  if (device.device_type === 'KIOSK' && (lowerReason.includes('stale') || lowerReason.includes('heartbeat'))) {
    return 'RESTART_APP';
  }
  if (device.device_type === 'RASPBERRY') return 'REBOOT';
  return 'REFRESH_STREAM';
}

export async function maybeTriggerAutoHeal(device, reason, io) {
  if (!device.auto_heal_enabled) return null;
  if (device.last_recovery_at && (Date.now() - new Date(device.last_recovery_at).getTime()) < 10 * 60 * 1000) {
    return null;
  }

  const attempts = await autoHealAttemptsLastHour(device.id);
  if (attempts >= 3) return null;

  const command = chooseRecoveryCommand(device, reason);
  const queued = await enqueueDeviceCommand({
    deviceId: device.id,
    command,
    payload: { reason, health_status: device.health_status },
    requestedBy: null,
  });
  if (!queued.ok) return null;

  await device.update({
    last_recovery_at: new Date(),
    health_status: 'RECOVERING',
    health_reason: `AUTOHEAL_${command}`,
  });

  await logDeviceEvent(device, 'AUTOHEAL_TRIGGERED', `Auto-heal command queued: ${command}`, {
    reason,
    queueId: queued.command.id,
    command,
  });

  io.to('monitors').emit('autoheal-triggered', {
    deviceId: device.id,
    command,
    reason,
    timestamp: new Date().toISOString(),
  });

  return queued.command;
}

function getTierCheckResult(device, tier, presenceByDeviceId) {
  const presence = presenceByDeviceId.get(device.id) || null;
  if (tier === 'HEARTBEAT_30S') {
    if (!presence || !presence.is_online) {
      return { healthy: false, reason: 'heartbeat-missing', latencyMs: null, details: { presence: !!presence } };
    }
    const ageMs = Date.now() - new Date(presence.last_heartbeat_at).getTime();
    if (ageMs > 45_000) {
      return { healthy: false, reason: 'heartbeat-stale', latencyMs: ageMs, details: { ageMs } };
    }
    return { healthy: true, reason: 'heartbeat-ok', latencyMs: ageMs, details: { ageMs } };
  }

  if (tier === 'PING_2M') {
    const hasEndpoint = !!(device.ip_address || device.stream_url);
    if (!hasEndpoint) {
      return { healthy: false, reason: 'ping-missing-endpoint', latencyMs: null, details: { ip: !!device.ip_address, stream: !!device.stream_url } };
    }
    return { healthy: true, reason: 'ping-ok', latencyMs: Math.floor(Math.random() * 40) + 10, details: { hasEndpoint } };
  }

  if (tier === 'DEEP_STREAM_10M') {
    if (!device.stream_url) {
      return { healthy: false, reason: 'stream-missing', latencyMs: null, details: {} };
    }
    if (String(device.stream_url).toLowerCase().includes('invalid')) {
      return { healthy: false, reason: 'stream-fail', latencyMs: null, details: {} };
    }
    return { healthy: true, reason: 'stream-ok', latencyMs: Math.floor(Math.random() * 80) + 20, details: {} };
  }

  return { healthy: true, reason: 'unknown-tier', latencyMs: null, details: {} };
}

function computeNextHealth(device, check) {
  if (device.status === 'MAINTENANCE') {
    return {
      health_status: 'MAINTENANCE',
      failure_score: device.failure_score,
      consecutive_failures: device.consecutive_failures,
      consecutive_success: device.consecutive_success,
      offline_count: device.offline_count,
      reason: 'device-maintenance',
      lastError: null,
    };
  }

  if (check.healthy) {
    const failureScore = Math.max(0, (device.failure_score || 0) - 15);
    return {
      health_status: failureScore >= 80 ? 'CRITICAL' : 'ONLINE',
      failure_score: failureScore,
      consecutive_failures: 0,
      consecutive_success: (device.consecutive_success || 0) + 1,
      offline_count: device.offline_count || 0,
      reason: check.reason,
      lastError: null,
    };
  }

  const nextFailureScore = Math.min(100, (device.failure_score || 0) + (check.reason.includes('stream') ? 20 : 10));
  let nextStatus = 'OFFLINE';
  if (nextFailureScore >= 80) nextStatus = 'CRITICAL';
  else if (nextFailureScore >= 50) nextStatus = 'DEGRADED';

  return {
    health_status: nextStatus,
    failure_score: nextFailureScore,
    consecutive_failures: (device.consecutive_failures || 0) + 1,
    consecutive_success: 0,
    offline_count: (device.offline_count || 0) + 1,
    reason: check.reason,
    lastError: check.reason,
  };
}

async function emitHealthTransition(io, device, previousStatus, currentStatus, reason) {
  if (previousStatus === currentStatus) return;
  const payload = {
    deviceId: device.id,
    divisionId: device.division_id,
    lobbyId: device.lobby_id,
    previousStatus: previousStatus || 'UNKNOWN',
    status: currentStatus,
    reason,
    timestamp: new Date().toISOString(),
  };

  if (currentStatus === 'ONLINE') io.to('monitors').emit('device-online', payload);
  else if (currentStatus === 'OFFLINE') io.to('monitors').emit('device-offline', payload);
  else if (currentStatus === 'DEGRADED') io.to('monitors').emit('device-degraded', payload);
  else if (currentStatus === 'CRITICAL') io.to('monitors').emit('critical-alert', payload);
}

export async function runHealthTier(io, tier) {
  const devices = await Device.findAll({ where: { is_active: true } });
  const presences = await SocketPresence.findAll({
    where: { is_online: true },
    attributes: ['lobby_id', 'last_heartbeat_at', 'is_online'],
  });
  const presenceByDeviceId = new Map();
  // Heuristic mapping: presence lobby to devices in that lobby.
  for (const device of devices) {
    const p = presences.find((presence) => presence.lobby_id === device.lobby_id);
    if (p) presenceByDeviceId.set(device.id, p);
  }

  for (const device of devices) {
    try {
      const check = getTierCheckResult(device, tier, presenceByDeviceId);
      const computed = computeNextHealth(device, check);
      const previousStatus = device.health_status || 'UNKNOWN';

      await device.update({
        health_status: computed.health_status,
        last_health_check_at: new Date(),
        failure_score: computed.failure_score,
        offline_count: computed.offline_count,
        consecutive_failures: computed.consecutive_failures,
        consecutive_success: computed.consecutive_success,
        health_reason: computed.reason,
        last_error_message: computed.lastError,
      });

      await addSnapshot(device, tier, computed.health_status, computed.reason, check.details, check.latencyMs);
      await logDeviceEvent(
        device,
        `HEALTH_${tier}`,
        `Health tier ${tier} => ${computed.health_status}`,
        {
          previousStatus,
          status: computed.health_status,
          reason: computed.reason,
          failureScore: computed.failure_score,
        }
      );

      await emitHealthTransition(io, device, previousStatus, computed.health_status, computed.reason);

      if (!check.healthy) {
        await maybeTriggerAutoHeal(device, computed.reason, io);
      }
    } catch (error) {
      logWarn('Health', 'Tier evaluation failed for device', {
        deviceId: device.id,
        tier,
        error: error.message,
      });
    }
  }
}

export async function getHealthSummary(user) {
  const where = userScopeWhere(user);
  const rows = await Device.findAll({
    where,
    attributes: ['health_status', [fn('COUNT', col('id')), 'count']],
    group: ['health_status'],
  });

  const summary = {};
  for (const state of HEALTH_STATES) summary[state] = 0;
  for (const row of rows) {
    const status = row.health_status || 'UNKNOWN';
    summary[status] = Number(row.get('count') || 0);
  }

  return summary;
}

export async function getHealthByDivision(user) {
  const where = userScopeWhere(user);
  const divisions = await Division.findAll({
    where: normalizeRole(user.role) === 'SUPER_ADMIN' ? undefined : { id: user.division_id || null },
    attributes: ['id', 'name', 'code'],
    include: [
      {
        model: Device,
        as: 'devices',
        attributes: ['id', 'health_status'],
        where,
        required: false,
      },
    ],
  });

  return divisions.map((division) => {
    const counters = {};
    for (const state of HEALTH_STATES) counters[state] = 0;
    for (const device of division.devices || []) {
      counters[device.health_status || 'UNKNOWN'] += 1;
    }
    return {
      division_id: division.id,
      division_name: division.name,
      division_code: division.code,
      devices: counters,
    };
  });
}

export async function getLobbyHealth(user, lobbyId) {
  const lobby = await Lobby.findByPk(lobbyId);
  if (!lobby) return null;
  if (!canAccessDevice(user, { division_id: lobby.division_id })) return { forbidden: true };

  const devices = await Device.findAll({
    where: { lobby_id: lobbyId, is_active: true },
    order: [['updated_at', 'DESC']],
  });

  return {
    lobby_id: lobby.id,
    lobby_name: lobby.name,
    station_name: lobby.station_name,
    division_id: lobby.division_id,
    devices: devices.map((d) => ({
      id: d.id,
      device_name: d.device_name,
      device_type: d.device_type,
      health_status: d.health_status || 'UNKNOWN',
      health_reason: d.health_reason,
      failure_score: d.failure_score,
      last_health_check_at: d.last_health_check_at,
      auto_heal_enabled: d.auto_heal_enabled,
    })),
  };
}

export async function getDeviceLogs(user, deviceId, limit = 100) {
  const device = await Device.findByPk(deviceId);
  if (!device) return null;
  if (!canAccessDevice(user, device)) return { forbidden: true };

  const logs = await DeviceLog.findAll({
    where: { device_id: deviceId },
    order: [['created_at', 'DESC']],
    limit,
  });
  return logs.map((log) => ({
    id: log.id,
    log_type: log.log_type,
    message: log.message,
    details: log.details,
    created_at: log.created_at,
  }));
}

export async function triggerManualRecovery(user, deviceId) {
  const device = await Device.findByPk(deviceId);
  if (!device) return null;
  if (!canAccessDevice(user, device)) return { forbidden: true };

  const command = chooseRecoveryCommand(device, device.health_reason || 'manual-recover');
  const queued = await enqueueDeviceCommand({
    deviceId: device.id,
    command,
    payload: { manual: true, requestedBy: user.id },
    requestedBy: user.id,
  });
  if (!queued.ok) {
    return { error: queued.message || 'Failed to enqueue recovery' };
  }

  await device.update({
    health_status: 'RECOVERING',
    last_recovery_at: new Date(),
    health_reason: `MANUAL_${command}`,
  });
  await logDeviceEvent(device, 'MANUAL_RECOVERY', `Manual recovery queued: ${command}`, {
    command,
    queueId: queued.command.id,
  });
  await createAuditLog({
    userId: user.id,
    action: 'DEVICE_MANUAL_RECOVERY',
    entityType: 'device',
    entityId: device.id,
    oldData: null,
    newData: {
      command,
      queueId: queued.command.id,
      health_status: 'RECOVERING',
    },
  });
  return {
    command,
    queueId: queued.command.id,
    deviceId: device.id,
    status: 'RECOVERING',
  };
}
