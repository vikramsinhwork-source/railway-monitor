import { Op } from 'sequelize';
import Device from '../modules/divisions/device.model.js';
import MonitoringSession from '../modules/realtime/monitoringSession.model.js';
import SocketPresence from '../modules/realtime/socketPresence.model.js';
import DeviceCommand from '../modules/realtime/deviceCommand.model.js';
import { createAuditLog } from '../modules/audit/audit.service.js';
import * as sessionsState from '../state/sessions.state.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import crypto from 'crypto';

const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 45000;
const RECONNECT_WINDOW_MS = 60000;

const reconnectCache = new Map();
const realtimeMetrics = {
  sessions_started: 0,
  sessions_failed_lock: 0,
  timeouts: 0,
  reconnect_restores: 0,
};

function now() {
  return new Date();
}

function mapUserRoleToPresenceRole(userRole, socketRole) {
  if (socketRole === 'KIOSK') return 'KIOSK';
  if (socketRole === 'MONITOR') {
    if (userRole === 'SUPER_ADMIN') return 'SUPER_ADMIN';
    if (userRole === 'DIVISION_ADMIN') return 'DIVISION_ADMIN';
    if (userRole === 'MONITOR') return 'MONITOR';
    return 'MONITOR';
  }
  return socketRole || userRole || 'UNKNOWN';
}

export async function upsertSocketPresence({ userId, socketId, role, divisionId = null, lobbyId = null }) {
  if (!userId || !socketId) return null;
  const existing = await SocketPresence.findOne({ where: { socket_id: socketId } });
  if (existing) {
    await existing.update({
      role,
      division_id: divisionId,
      lobby_id: lobbyId,
      last_heartbeat_at: now(),
      is_online: true,
    });
    return existing;
  }

  return SocketPresence.create({
    user_id: userId,
    socket_id: socketId,
    role,
    division_id: divisionId,
    lobby_id: lobbyId,
    last_heartbeat_at: now(),
    is_online: true,
  });
}

export async function markSocketPresenceOffline({ socketId, userId, reason = null }) {
  if (!socketId && !userId) return;
  const where = socketId ? { socket_id: socketId } : { user_id: userId, is_online: true };
  await SocketPresence.update(
    { is_online: false, offline_reason: reason, updated_at: now() },
    { where }
  );
}

export async function touchSocketHeartbeat({ socketId, userId }) {
  if (!socketId && !userId) return;
  const where = socketId ? { socket_id: socketId } : { user_id: userId, is_online: true };
  await SocketPresence.update(
    { last_heartbeat_at: now(), is_online: true },
    { where }
  );
}

async function validateMonitorLobbyAccess(user, device) {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  // Backward compatibility for legacy monitor tokens without division context.
  if (!user.division_id && user.role === 'MONITOR') return true;
  if (!user.division_id || user.division_id !== device.division_id) return false;
  if (user.role === 'DIVISION_ADMIN') return true;
  if (user.role === 'MONITOR') return true;
  return false;
}

export async function startMonitoringSession({
  deviceId,
  monitorUserId,
  monitorSocketId,
  monitorClientId,
  user,
}) {
  const isUuid = (value) =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  let resolvedDeviceId = deviceId;
  if (!isUuid(deviceId)) {
    const matchedByAlias = await Device.findOne({
      where: {
        [Op.or]: [
          { device_name: deviceId },
          { serial_number: deviceId },
        ],
      },
    });
    if (matchedByAlias?.id) {
      resolvedDeviceId = matchedByAlias.id;
    }
  }

  const device = await Device.findByPk(resolvedDeviceId);
  if (!device) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Device not found' };
  }
  if (!device.is_active) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Device is not active' };
  }

  const allowed = await validateMonitorLobbyAccess(user, device);
  if (!allowed) {
    return { ok: false, code: 'SESSION_NOT_AUTHORIZED', message: 'Division/lobby access denied for device' };
  }

  const existingDbSession = await MonitoringSession.findOne({
    where: { device_id: resolvedDeviceId, status: 'ACTIVE' },
    order: [['started_at', 'DESC']],
  });
  if (existingDbSession && existingDbSession.monitor_user_id !== monitorUserId) {
    realtimeMetrics.sessions_failed_lock += 1;
    return { ok: false, code: 'SESSION_ALREADY_EXISTS', message: 'Device is already monitored by another monitor' };
  }

  if (sessionsState.hasActiveSession(resolvedDeviceId)) {
    const existing = sessionsState.getSession(resolvedDeviceId);
    if (existing?.monitorSocketId !== monitorSocketId) {
      realtimeMetrics.sessions_failed_lock += 1;
      return { ok: false, code: 'SESSION_ALREADY_EXISTS', message: 'Device lock already acquired' };
    }
  } else {
    sessionsState.createSession(resolvedDeviceId, monitorClientId, monitorSocketId, null);
  }

  let dbSession = existingDbSession;
  if (!dbSession) {
    dbSession = await MonitoringSession.create({
      division_id: device.division_id,
      lobby_id: device.lobby_id,
      device_id: device.id,
      monitor_user_id: monitorUserId,
      started_at: now(),
      status: 'ACTIVE',
      access_token: crypto.randomUUID(),
      token_expires_at: new Date(Date.now() + 15 * 60 * 1000),
      meta: {
        monitor_socket_id: monitorSocketId,
        monitor_client_id: monitorClientId,
      },
    });
    await createAuditLog({
      userId: monitorUserId,
      action: 'SESSION_START',
      entityType: 'monitoring_session',
      entityId: dbSession.id,
      oldData: null,
      newData: dbSession.toJSON(),
    });
  }
  realtimeMetrics.sessions_started += 1;

  return {
    ok: true,
    device,
    dbSession,
  };
}

export async function endMonitoringSession({
  deviceId,
  actorUserId,
  status = 'ENDED',
  disconnectReason = null,
  force = false,
}) {
  const active = await MonitoringSession.findOne({
    where: { device_id: deviceId, status: 'ACTIVE' },
    order: [['started_at', 'DESC']],
  });
  if (!active) {
    sessionsState.endSession(deviceId);
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'No active session for device' };
  }

  const oldData = active.toJSON();
  await active.update({
    status,
    ended_at: now(),
    disconnect_reason: disconnectReason,
    meta: {
      ...(active.meta || {}),
      ended_by: actorUserId,
      forced: !!force,
    },
  });
  sessionsState.endSession(deviceId);

  await createAuditLog({
    userId: actorUserId,
    action: force ? 'SESSION_FORCE_STOP' : 'SESSION_STOP',
    entityType: 'monitoring_session',
    entityId: active.id,
    oldData,
    newData: active.toJSON(),
  });

  return { ok: true, dbSession: active };
}

export async function endSessionsByMonitorUser({
  monitorUserId,
  status = 'TIMEOUT',
  disconnectReason = 'monitor-disconnect',
}) {
  const sessions = await MonitoringSession.findAll({
    where: {
      monitor_user_id: monitorUserId,
      status: 'ACTIVE',
    },
  });
  const ended = [];

  for (const session of sessions) {
    const oldData = session.toJSON();
    await session.update({
      status,
      ended_at: now(),
      disconnect_reason: disconnectReason,
      meta: {
        ...(session.meta || {}),
        ended_by: monitorUserId,
      },
    });
    sessionsState.endSession(session.device_id);
    await createAuditLog({
      userId: monitorUserId,
      action: 'SESSION_TIMEOUT',
      entityType: 'monitoring_session',
      entityId: session.id,
      oldData,
      newData: session.toJSON(),
    });
    ended.push(session);
    realtimeMetrics.timeouts += 1;
  }
  return ended;
}

export async function cacheDisconnectForReconnect({ userId, sessions }) {
  if (!userId || !sessions?.length) return;
  reconnectCache.set(userId, {
    disconnectedAt: Date.now(),
    sessions: sessions.map((s) => ({
      division_id: s.division_id,
      lobby_id: s.lobby_id,
      device_id: s.device_id,
    })),
  });
}

export async function tryRestoreRecentSessions({ user, socket, clientId, io }) {
  const cached = reconnectCache.get(user.userId);
  if (!cached) return [];
  if (Date.now() - cached.disconnectedAt > RECONNECT_WINDOW_MS) {
    reconnectCache.delete(user.userId);
    return [];
  }

  const restored = [];
  for (const sessionCandidate of cached.sessions) {
    const existing = await MonitoringSession.findOne({
      where: { device_id: sessionCandidate.device_id, status: 'ACTIVE' },
    });
    if (existing) continue;

    const allowed = await validateMonitorLobbyAccess(user, {
      division_id: sessionCandidate.division_id,
      lobby_id: sessionCandidate.lobby_id,
    });
    if (!allowed) continue;

    try {
      if (!sessionsState.hasActiveSession(sessionCandidate.device_id)) {
        sessionsState.createSession(sessionCandidate.device_id, clientId, socket.id, null);
      }
      const dbSession = await MonitoringSession.create({
        division_id: sessionCandidate.division_id,
        lobby_id: sessionCandidate.lobby_id,
        device_id: sessionCandidate.device_id,
        monitor_user_id: user.userId,
        started_at: now(),
        status: 'ACTIVE',
        meta: {
          restored: true,
          restored_from_disconnect_at: new Date(cached.disconnectedAt).toISOString(),
          monitor_socket_id: socket.id,
        },
      });
      await createAuditLog({
        userId: user.userId,
        action: 'SESSION_RESTORE',
        entityType: 'monitoring_session',
        entityId: dbSession.id,
        oldData: null,
        newData: dbSession.toJSON(),
      });
      realtimeMetrics.reconnect_restores += 1;

      io.to('monitors').emit('session-status', {
        deviceId: sessionCandidate.device_id,
        status: 'ACTIVE',
        reason: 'reconnect-restore',
        timestamp: now().toISOString(),
      });
      restored.push(dbSession);
    } catch (error) {
      logWarn('Realtime', 'Session restore skipped', {
        userId: user.userId,
        deviceId: sessionCandidate.device_id,
        error: error.message,
      });
    }
  }

  reconnectCache.delete(user.userId);
  return restored;
}

export async function heartbeatTimeoutSweep(io) {
  const staleBefore = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
  const stalePresence = await SocketPresence.findAll({
    where: {
      is_online: true,
      last_heartbeat_at: { [Op.lt]: staleBefore },
    },
  });

  for (const presence of stalePresence) {
    await presence.update({ is_online: false });
    const ended = await endSessionsByMonitorUser({
      monitorUserId: presence.user_id,
      status: 'TIMEOUT',
      disconnectReason: 'heartbeat-timeout',
    });
    for (const session of ended) {
      io.to('monitors').emit('session-status', {
        deviceId: session.device_id,
        status: 'TIMEOUT',
        reason: 'heartbeat-timeout',
        timestamp: now().toISOString(),
      });
      io.to('monitors').emit('device-offline', {
        deviceId: session.device_id,
        reason: 'heartbeat-timeout',
        timestamp: now().toISOString(),
      });
      realtimeMetrics.timeouts += 1;
    }
  }
}

export function startRealtimePresenceChecker(io) {
  setInterval(async () => {
    try {
      await heartbeatTimeoutSweep(io);
    } catch (error) {
      logError('Realtime', 'Presence checker failed', { error: error.message });
    }
  }, HEARTBEAT_INTERVAL_MS);
  logInfo('Realtime', 'Presence checker started', {
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
  });
}

export function getRealtimeConfig() {
  return {
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
    reconnectWindowMs: RECONNECT_WINDOW_MS,
  };
}

export function getRealtimeMetrics() {
  return { ...realtimeMetrics };
}

export function buildPresenceRole({ socketRole, appRole }) {
  return mapUserRoleToPresenceRole(appRole, socketRole);
}

const ALLOWED_COMMANDS = new Set(['REBOOT', 'REFRESH_STREAM', 'OPEN_VNC', 'RESTART_APP']);

export async function enqueueDeviceCommand({ deviceId, command, payload = null, requestedBy }) {
  const normalizedCommand = String(command || '').toUpperCase();
  if (!ALLOWED_COMMANDS.has(normalizedCommand)) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'Unsupported command' };
  }
  const device = await Device.findByPk(deviceId);
  if (!device) return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Device not found' };

  const queued = await DeviceCommand.create({
    device_id: deviceId,
    command: normalizedCommand,
    payload,
    status: 'PENDING',
    requested_by: requestedBy || null,
    requested_at: now(),
  });
  await createAuditLog({
    userId: requestedBy || null,
    action: 'DEVICE_COMMAND_ENQUEUE',
    entityType: 'device_command',
    entityId: queued.id,
    oldData: null,
    newData: queued.toJSON(),
  });
  return { ok: true, command: queued };
}

export async function claimNextDeviceCommand(deviceId) {
  const command = await DeviceCommand.findOne({
    where: { device_id: deviceId, status: 'PENDING' },
    order: [['requested_at', 'ASC']],
  });
  if (!command) return null;
  await command.update({
    status: 'PROCESSING',
    processed_at: now(),
  });
  return command;
}

export async function completeDeviceCommand({ commandId, success, errorMessage = null }) {
  const command = await DeviceCommand.findByPk(commandId);
  if (!command) return null;
  const oldData = command.toJSON();
  await command.update({
    status: success ? 'COMPLETED' : 'FAILED',
    processed_at: now(),
    error_message: success ? null : (errorMessage || 'Unknown command failure'),
  });
  await createAuditLog({
    userId: command.requested_by || null,
    action: success ? 'DEVICE_COMMAND_COMPLETE' : 'DEVICE_COMMAND_FAILED',
    entityType: 'device_command',
    entityId: command.id,
    oldData,
    newData: command.toJSON(),
  });
  return command;
}
