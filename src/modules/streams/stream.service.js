import { Op } from 'sequelize';
import Device from '../divisions/device.model.js';
import DeviceLog from '../health/deviceLog.model.js';
import StreamSession from './streamSession.model.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';
import { logInfo, logWarn } from '../../utils/logger.js';

const WATCHER_ROLES = new Set(['SUPER_ADMIN', 'DIVISION_ADMIN', 'MONITOR']);
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** @type {Map<string, { viewerSocketId: string|null, deviceId: string, lastActivityAt: number }>} */
const sessionRegistry = new Map();

function now() {
  return new Date();
}

function canWatchStreams(user) {
  return WATCHER_ROLES.has(normalizeRole(user.role));
}

function canAccessDevice(user, device) {
  const role = normalizeRole(user.role);
  if (role === 'SUPER_ADMIN') return true;
  if (!user.division_id) return false;
  return user.division_id === device.division_id;
}

async function logStreamEvent(device, logType, message, details = null) {
  return DeviceLog.create({
    division_id: device.division_id,
    lobby_id: device.lobby_id,
    device_id: device.id,
    log_type: logType,
    message,
    details,
    created_at: now(),
  });
}

function toStreamResponse(session) {
  return {
    id: session.id,
    device_id: session.device_id,
    stream_type: session.stream_type,
    stream_name: session.stream_name || null,
    viewer_user_id: session.viewer_user_id,
    status: session.status,
    offer: session.offer,
    answer: session.answer,
    ice_candidates: session.ice_candidates,
    started_at: session.started_at,
    ended_at: session.ended_at,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function touchSessionActivity(sessionId) {
  const entry = sessionRegistry.get(sessionId);
  if (entry) entry.lastActivityAt = Date.now();
}

export function bindViewerSocket(sessionId, viewerSocketId) {
  const entry = sessionRegistry.get(sessionId);
  if (entry) {
    entry.viewerSocketId = viewerSocketId;
    entry.lastActivityAt = Date.now();
  }
}

export function getViewerSocketId(sessionId) {
  return sessionRegistry.get(sessionId)?.viewerSocketId || null;
}

export async function requestStream({
  user,
  deviceId,
  streamType,
  streamName = null,
  viewerSocketId = null,
  io = null,
}) {
  if (!canWatchStreams(user)) {
    return { forbidden: true };
  }

  const device = await Device.findByPk(deviceId);
  if (!device || device.device_type !== 'RASPBERRY') {
    return { notFound: true, message: 'Raspberry Pi agent not found' };
  }
  if (!device.is_active) {
    return { inactive: true, message: 'Agent is disabled' };
  }
  if (!canAccessDevice(user, device)) {
    return { forbidden: true };
  }

  const existingWhere = {
    device_id: deviceId,
    stream_type: streamType,
    status: { [Op.in]: ['REQUESTED', 'ACTIVE'] },
  };
  if (streamName) {
    existingWhere.stream_name = streamName;
  } else {
    existingWhere.stream_name = { [Op.or]: [null, ''] };
  }

  const existing = await StreamSession.findOne({ where: existingWhere });
  if (existing) {
    const scope = streamName
      ? `stream "${streamName}" on this device`
      : 'this device and type';
    return { conflict: true, message: `An active stream session already exists for ${scope}` };
  }

  const session = await StreamSession.create({
    device_id: deviceId,
    stream_type: streamType,
    stream_name: streamName || null,
    viewer_user_id: user.id,
    status: 'REQUESTED',
    ice_candidates: { viewer: [], agent: [] },
  });

  sessionRegistry.set(session.id, {
    viewerSocketId,
    deviceId,
    lastActivityAt: Date.now(),
  });

  await logStreamEvent(device, 'STREAM_REQUESTED', `Stream requested: ${streamType}`, {
    sessionId: session.id,
    streamType,
    streamName: streamName || null,
    viewerUserId: user.id,
  });

  if (io) {
    const startPayload = {
      sessionId: session.id,
      streamType,
      deviceId,
      timestamp: now().toISOString(),
    };
    // go2rtc stream name from monitoring API stream.name (Flutter CctvCameraEntity.streamName)
    if (streamName) {
      startPayload.streamName = streamName;
    }
    io.to(`device:${deviceId}`).emit('start-stream', startPayload);
  }

  return { session: toStreamResponse(session) };
}

/** Viewer offer stored; forward to Pi as agent-offer. */
export async function storeViewerOffer({ sessionId, offer, io = null }) {
  const session = await StreamSession.findByPk(sessionId);
  if (!session || session.status === 'CLOSED') {
    return { notFound: true };
  }

  const ice = session.ice_candidates || { viewer: [], agent: [] };
  await session.update({
    offer,
    ice_candidates: ice,
  });

  touchSessionActivity(sessionId);

  if (io) {
    io.to(`device:${session.device_id}`).emit('agent-offer', {
      sessionId,
      offer,
      streamType: session.stream_type,
      deviceId: session.device_id,
      timestamp: now().toISOString(),
    });
  }

  return { session: toStreamResponse(session) };
}

/** go2rtc answer from Pi stored; forward to viewer as viewer-answer. */
export async function applyAgentAnswer({ sessionId, answer, io = null }) {
  const session = await StreamSession.findByPk(sessionId);
  if (!session || session.status === 'CLOSED') {
    return { notFound: true };
  }

  const ice = session.ice_candidates || { viewer: [], agent: [] };
  await session.update({
    answer,
    status: 'ACTIVE',
    started_at: session.started_at || now(),
    ice_candidates: ice,
  });

  touchSessionActivity(sessionId);

  const device = await Device.findByPk(session.device_id);
  if (device) {
    await logStreamEvent(device, 'STREAM_STARTED', `Stream started: ${session.stream_type}`, {
      sessionId,
      streamType: session.stream_type,
    });
  }

  const viewerSocketId = getViewerSocketId(sessionId);
  if (io && viewerSocketId) {
    const viewerSocket = io.sockets.sockets.get(viewerSocketId);
    viewerSocket?.emit('viewer-answer', {
      sessionId,
      answer,
      streamType: session.stream_type,
      deviceId: session.device_id,
      timestamp: now().toISOString(),
    });
  }

  return { session: toStreamResponse(session) };
}

/** @deprecated Use storeViewerOffer — legacy agent-first naming. */
export async function activateStreamOffer({ sessionId, offer, io = null }) {
  return storeViewerOffer({ sessionId, offer, io });
}

/** @deprecated Use applyAgentAnswer — legacy viewer-answer naming. */
export async function applyStreamAnswer({ sessionId, answer, io = null }) {
  return applyAgentAnswer({ sessionId, answer, io });
}

export async function appendViewerIceCandidate({ sessionId, candidate, io = null }) {
  const session = await StreamSession.findByPk(sessionId);
  if (!session || session.status === 'CLOSED') {
    return { notFound: true };
  }

  const ice = session.ice_candidates || { viewer: [], agent: [] };
  ice.viewer = [...(ice.viewer || []), candidate];
  await session.update({ ice_candidates: ice });
  touchSessionActivity(sessionId);

  // Viewer → Backend → Pi
  if (io) {
    io.to(`device:${session.device_id}`).emit('agent-ice', {
      sessionId,
      candidate,
      timestamp: now().toISOString(),
    });
  }

  return { ok: true };
}

export async function appendAgentIceCandidate({ sessionId, candidate, io = null }) {
  const session = await StreamSession.findByPk(sessionId);
  if (!session || session.status === 'CLOSED') {
    return { notFound: true };
  }

  const ice = session.ice_candidates || { viewer: [], agent: [] };
  ice.agent = [...(ice.agent || []), candidate];
  await session.update({ ice_candidates: ice });
  touchSessionActivity(sessionId);

  // Pi → Backend → Viewer
  const viewerSocketId = getViewerSocketId(sessionId);
  if (io && viewerSocketId) {
    const viewerSocket = io.sockets.sockets.get(viewerSocketId);
    viewerSocket?.emit('viewer-ice', {
      sessionId,
      candidate,
      timestamp: now().toISOString(),
    });
  }

  return { ok: true };
}

export async function closeStreamSession({
  sessionId,
  reason = 'manual-close',
  io = null,
  logType = 'STREAM_STOPPED',
  failed = false,
}) {
  const session = await StreamSession.findByPk(sessionId);
  if (!session || session.status === 'CLOSED') {
    return null;
  }

  await session.update({
    status: 'CLOSED',
    ended_at: now(),
  });

  const viewerSocketId = getViewerSocketId(sessionId);
  sessionRegistry.delete(sessionId);

  const device = await Device.findByPk(session.device_id);
  if (device) {
    const type = failed ? 'STREAM_FAILED' : logType;
    await logStreamEvent(device, type, `Stream closed: ${reason}`, {
      sessionId,
      reason,
      streamType: session.stream_type,
    });
  }

  if (io) {
    const payload = {
      sessionId,
      reason,
      timestamp: now().toISOString(),
    };
    io.to(`device:${session.device_id}`).emit('stop-stream', payload);
    const viewerSocket = viewerSocketId ? io.sockets.sockets.get(viewerSocketId) : null;
    viewerSocket?.emit('stream-closed', payload);
  }

  return toStreamResponse(session);
}

export async function closeStreamsForViewer({ userId, socketId, io, reason = 'viewer-disconnect' }) {
  const sessions = await StreamSession.findAll({
    where: {
      viewer_user_id: userId,
      status: { [Op.in]: ['REQUESTED', 'ACTIVE'] },
    },
  });

  for (const session of sessions) {
    const entry = sessionRegistry.get(session.id);
    if (socketId && entry?.viewerSocketId && entry.viewerSocketId !== socketId) continue;
    await closeStreamSession({ sessionId: session.id, reason, io });
  }
}

export async function closeStreamsForDevice({ deviceId, io, reason = 'agent-disconnect' }) {
  const sessions = await StreamSession.findAll({
    where: {
      device_id: deviceId,
      status: { [Op.in]: ['REQUESTED', 'ACTIVE'] },
    },
  });

  for (const session of sessions) {
    await closeStreamSession({ sessionId: session.id, reason, io });
  }
}

export async function closeIdleStreams(io) {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [sessionId, entry] of sessionRegistry.entries()) {
    if (entry.lastActivityAt < cutoff) {
      logInfo('Stream', 'Closing idle stream session', { sessionId });
      await closeStreamSession({ sessionId, reason: 'idle-timeout', io });
    }
  }

  const staleSessions = await StreamSession.findAll({
    where: {
      status: { [Op.in]: ['REQUESTED', 'ACTIVE'] },
      updated_at: { [Op.lt]: new Date(cutoff) },
    },
  });
  for (const session of staleSessions) {
    if (!sessionRegistry.has(session.id)) {
      await closeStreamSession({ sessionId: session.id, reason: 'idle-timeout', io });
    }
  }
}

export async function getStreamSessionForUser(sessionId, user) {
  if (!canWatchStreams(user)) return { forbidden: true };

  const session = await StreamSession.findByPk(sessionId);
  if (!session) return null;

  const device = await Device.findByPk(session.device_id);
  if (!device || !canAccessDevice(user, device)) return { forbidden: true };

  const role = normalizeRole(user.role);
  if (role === 'MONITOR' && session.viewer_user_id !== user.id) {
    return { forbidden: true };
  }

  return { session: toStreamResponse(session) };
}

export async function listActiveStreamsForUser(user) {
  if (!canWatchStreams(user)) return { forbidden: true };

  const where = { status: { [Op.in]: ['REQUESTED', 'ACTIVE'] } };
  const role = normalizeRole(user.role);

  if (role === 'MONITOR') {
    where.viewer_user_id = user.id;
  } else if (role !== 'SUPER_ADMIN') {
    if (!user.division_id) return { sessions: [] };
    const devices = await Device.findAll({
      where: { division_id: user.division_id, device_type: 'RASPBERRY' },
      attributes: ['id'],
    });
    where.device_id = { [Op.in]: devices.map((d) => d.id) };
  }

  const sessions = await StreamSession.findAll({
    where,
    order: [['created_at', 'DESC']],
  });

  return { sessions: sessions.map(toStreamResponse) };
}

export async function deleteStreamSessionForUser(sessionId, user, io = null) {
  const result = await getStreamSessionForUser(sessionId, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };

  const closed = await closeStreamSession({ sessionId, reason: 'viewer-close', io });
  return { session: closed };
}

export function startStreamIdleCleanup(io) {
  const intervalMs = 60_000;
  setInterval(async () => {
    try {
      await closeIdleStreams(io);
    } catch (error) {
      logWarn('Stream', 'Idle cleanup failed', { error: error.message });
    }
  }, intervalMs);
  logInfo('Stream', 'Idle stream cleanup started', { idleTimeoutMs: IDLE_TIMEOUT_MS, intervalMs });
}

export { canWatchStreams, toStreamResponse };
