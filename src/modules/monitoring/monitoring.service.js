import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import { Op } from 'sequelize';
import { parseMediaMtxPathsPayload } from './mediamtx.parser.js';
import { syncCamerasForPiDevice } from '../cameras/camera.service.js';
import Device from '../divisions/device.model.js';
import DeviceLog from '../health/deviceLog.model.js';
import DeviceHeartbeat from './deviceHeartbeat.model.js';
import DeviceScreenshot from './deviceScreenshot.model.js';
import { createAuditLog } from '../audit/audit.service.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';
import { listMonitoringAgentDevices, getDeviceByIdForUser, isPiMonitoringAgent } from '../devices/device.service.js';
import {
  enqueueDeviceCommand,
  upsertAgentSocketPresence,
  touchAgentHeartbeat,
} from '../../socket/realtime.manager.js';
import Lobby from '../divisions/lobby.model.js';
import { logWarn } from '../../utils/logger.js';

const SCREENSHOT_DIR = process.env.MONITORING_SCREENSHOT_DIR
  || path.join(process.cwd(), 'uploads', 'monitoring-screenshots');
const STREAM_FRAME_DIR = process.env.MONITORING_STREAM_FRAME_DIR
  || path.join(process.cwd(), 'uploads', 'monitoring-stream-frames');
const SCREENSHOT_TTL_HOURS = Number(process.env.MONITORING_SCREENSHOT_TTL_HOURS || 72);

const DEVICE_COMMAND_MAP = {
  reboot: 'REBOOT_PI',
  'restart-mediamtx': 'RESTART_GO2RTC',
  'restart-go2rtc': 'RESTART_GO2RTC',
  'restart-agent': 'RESTART_AGENT',
  update: 'UPDATE_AGENT',
  'capture-screenshot': 'TAKE_SCREENSHOT',
};

const SOCKET_EVENT_MAP = {
  reboot: 'device:reboot',
  'restart-mediamtx': 'device:restart-mediamtx',
  'restart-go2rtc': 'device:restart-mediamtx',
  'restart-agent': 'device:restart-agent',
  update: 'device:update',
  'capture-screenshot': 'device:capture-screenshot',
};

// #region agent log
function debugLog(hypothesisId, location, message, data = {}, runId = 'run1') {
  fetch('http://127.0.0.1:7515/ingest/ab84a119-a91c-4713-881e-a8c644fb3969', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '2b0af4',
    },
    body: JSON.stringify({
      sessionId: '2b0af4',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

function toMonitoringDeviceResponse(device) {
  return {
    id: device.id,
    division_id: device.division_id,
    lobby_id: device.lobby_id,
    device_type: device.device_type,
    device_name: device.device_name,
    serial_number: device.serial_number,
    ip_address: device.ip_address,
    status: device.status,
    online: device.status === 'ONLINE',
    is_active: device.is_active,
    last_seen: device.last_seen_at,
    last_seen_at: device.last_seen_at,
    stream_status: device.stream_status,
    go2rtc_status: device.go2rtc_status,
    agent_version: device.agent_version || device.firmware_version,
    last_screenshot_at: device.last_screenshot_at || null,
    health_status: device.health_status,
    meta: device.meta,
    created_at: device.created_at,
    updated_at: device.updated_at,
  };
}

async function logMonitoringEvent(device, logType, message, details = null) {
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

async function findDeviceByIdentifier({ deviceId, serialNumber, deviceName }) {
  if (deviceId) {
    const byId = await Device.findByPk(deviceId);
    if (byId) return byId;
  }
  if (serialNumber) {
    const bySerial = await Device.findOne({ where: { serial_number: serialNumber } });
    if (bySerial) return bySerial;
  }
  if (deviceName) {
    const byName = await Device.findOne({ where: { device_name: deviceName } });
    if (byName) return byName;
  }
  return null;
}

export async function registerMonitoringDevice(payload) {
  const {
    deviceId,
    divisionId,
    lobbyId,
    deviceName,
    serialNumber,
    hostname,
    ipAddress,
    agentVersion,
    deviceType = 'RASPBERRY',
    mediamtxPaths,
  } = payload;

  let device = await findDeviceByIdentifier({ deviceId, serialNumber, deviceName: deviceName || deviceId });

  if (!device) {
    if (!divisionId || !lobbyId || !deviceName) {
      return {
        ok: false,
        code: 'DEVICE_NOT_FOUND',
        message: 'Device not found. Provide divisionId, lobbyId, and deviceName to create.',
      };
    }
    device = await Device.create({
      division_id: divisionId,
      lobby_id: lobbyId,
      device_type: deviceType,
      device_name: deviceName,
      serial_number: serialNumber || null,
      ip_address: ipAddress || null,
      agent_version: agentVersion || null,
      status: 'ONLINE',
      last_seen_at: new Date(),
      health_status: 'ONLINE',
      meta: {
        agent: { hostname, registeredAt: new Date().toISOString() },
        mediamtxPaths: mediamtxPaths || [],
      },
    });
    await logMonitoringEvent(device, 'MONITORING_REGISTERED', `Device created: ${deviceName}`, payload);
    await syncCamerasForPiDevice(device, mediamtxPaths || []);
    return { ok: true, created: true, device: toMonitoringDeviceResponse(device) };
  }

  const meta = {
    ...(device.meta || {}),
    agent: {
      ...(device.meta?.agent || {}),
      hostname: hostname || device.meta?.agent?.hostname,
      registeredAt: new Date().toISOString(),
    },
    mediamtxPaths: mediamtxPaths || device.meta?.mediamtxPaths || [],
  };
  await device.update({
    status: 'ONLINE',
    last_seen_at: new Date(),
    health_status: 'ONLINE',
    ip_address: ipAddress || device.ip_address,
    agent_version: agentVersion || device.agent_version,
    serial_number: serialNumber || device.serial_number,
    meta,
  });
  await logMonitoringEvent(device, 'MONITORING_REGISTERED', `Device registered: ${device.device_name}`, payload);
  await syncCamerasForPiDevice(device, mediamtxPaths || device.meta?.mediamtxPaths || []);

  return { ok: true, created: false, device: toMonitoringDeviceResponse(device) };
}

export async function recordHeartbeat(deviceId, metrics = {}, socketId = null) {
  const device = await Device.findByPk(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }

  if (socketId) {
    try {
      await touchAgentHeartbeat({ deviceId, socketId });
    } catch (error) {
      logWarn('Monitoring', 'Heartbeat presence touch failed', { deviceId, error: error.message });
    }
  }

  await device.update({
    last_seen_at: new Date(),
    status: 'ONLINE',
    health_status: 'ONLINE',
    ip_address: metrics.ipAddress || device.ip_address,
    agent_version: metrics.agentVersion || device.agent_version,
  });

  const heartbeat = await DeviceHeartbeat.create({
    device_id: device.id,
    received_at: new Date(),
    payload: metrics,
  });

  return { ok: true, device: toMonitoringDeviceResponse(device), heartbeat };
}

function enrichStreamPayload(streamPayload) {
  if (!streamPayload || typeof streamPayload !== 'object') {
    return streamPayload;
  }

  const rawMediaMtx = streamPayload.mediamtx?.raw || streamPayload.raw;
  if (rawMediaMtx && typeof rawMediaMtx === 'object' && !Array.isArray(rawMediaMtx)) {
    const parsed = parseMediaMtxPathsPayload(rawMediaMtx);
    return {
      ...streamPayload,
      streams: parsed.streams,
      mediamtx: {
        ...(streamPayload.mediamtx || {}),
        ...parsed,
        fetchedAt: streamPayload.mediamtx?.fetchedAt || new Date().toISOString(),
      },
    };
  }

  if (Array.isArray(streamPayload.streams)) {
    return {
      ...streamPayload,
      streams: streamPayload.streams.map((stream) => ({
        producerCount: stream.producerCount ?? stream.producers ?? 0,
        consumerCount: stream.consumerCount ?? stream.consumers ?? 0,
        codec: stream.codec ?? stream.codecs?.[0] ?? null,
        fps: stream.fps ?? null,
        ...stream,
      })),
    };
  }

  return streamPayload;
}

export async function updateStreamStatus(deviceId, streamStatus) {
  return handleDeviceStreamStatus(deviceId, streamStatus);
}

export async function updateGo2rtcStatus(deviceId, go2rtcStatus) {
  const device = await Device.findByPk(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }

  await device.update({
    go2rtc_status: go2rtcStatus,
    last_seen_at: new Date(),
  });

  return { ok: true, device: toMonitoringDeviceResponse(device) };
}

export async function getDeviceStatus(deviceId) {
  const device = await Device.findByPk(deviceId);
  if (!device) return null;

  const lastHeartbeat = await DeviceHeartbeat.findOne({
    where: { device_id: deviceId },
    order: [['received_at', 'DESC']],
  });

  return {
    ...toMonitoringDeviceResponse(device),
    last_heartbeat: lastHeartbeat?.received_at || device.last_seen_at,
    last_heartbeat_payload: lastHeartbeat?.payload || null,
  };
}

export async function storeScreenshot({ deviceId, screenType, buffer, mimeType, meta = {} }) {
  const device = await Device.findByPk(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const ext = mimeType?.includes('png') ? 'png' : 'jpg';
  const filename = `${deviceId}-${screenType}-${Date.now()}.${ext}`;
  const storagePath = path.join(SCREENSHOT_DIR, filename);
  await fs.writeFile(storagePath, buffer);

  const capturedAt = new Date();
  const expiresAt = new Date(capturedAt.getTime() + SCREENSHOT_TTL_HOURS * 60 * 60 * 1000);

  const screenshot = await DeviceScreenshot.create({
    device_id: deviceId,
    screen_type: screenType,
    storage_path: storagePath,
    mime_type: mimeType || `image/${ext}`,
    size_bytes: buffer.length,
    captured_at: capturedAt,
    expires_at: expiresAt,
    meta,
  });

  await device.update({ last_screenshot_at: capturedAt });

  await logMonitoringEvent(device, 'SCREENSHOT_UPLOADED', `Screenshot uploaded: ${screenType}`, {
    screenshotId: screenshot.id,
    screenType,
    sizeBytes: buffer.length,
  });

  return {
    ok: true,
    screenshot: {
      id: screenshot.id,
      device_id: deviceId,
      screen_type: screenType,
      mime_type: screenshot.mime_type,
      size_bytes: screenshot.size_bytes,
      captured_at: screenshot.captured_at,
      expires_at: screenshot.expires_at,
    },
  };
}

export async function listMonitoringDevicesForUser(user, filters = {}) {
  const result = await listMonitoringAgentDevices(user, filters);
  return {
    devices: result.rows.map(toMonitoringDeviceResponse),
    count: result.count,
  };
}

export async function getMonitoringDeviceForUser(id, user) {
  const result = await getDeviceByIdForUser(id, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };
  if (!isPiMonitoringAgent(result.device)) return { notAgent: true };
  return { device: await getDeviceStatus(id) };
}

export async function sendDeviceCommandForUser(user, deviceId, action, payload = null, io = null) {
  const result = await getMonitoringDeviceForUser(deviceId, user);
  if (!result) return null;
  if (result.forbidden) return { forbidden: true };
  if (result.notAgent) return { notAgent: true };

  const role = normalizeRole(user.role);
  if (role === 'USER') return { forbidden: true };

  const normalizedAction = String(action || '').toLowerCase();
  const command = DEVICE_COMMAND_MAP[normalizedAction];
  const socketEvent = SOCKET_EVENT_MAP[normalizedAction];

  if (!command || !socketEvent) {
    return { error: 'Unsupported command action' };
  }

  const queued = await enqueueDeviceCommand({
    deviceId,
    command,
    payload,
    requestedBy: user.id,
  });

  if (!queued.ok) {
    return { error: queued.message || 'Failed to enqueue command' };
  }

  if (io) {
    io.to(`device:${deviceId}`).emit(socketEvent, {
      deviceId,
      commandId: queued.command.id,
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  const device = await Device.findByPk(deviceId);
  if (device) {
    await createAuditLog({
      userId: user.id,
      action: 'MONITORING_DEVICE_COMMAND',
      entityType: 'device_command',
      entityId: queued.command.id,
      oldData: null,
      newData: { action: normalizedAction, command, payload },
    });
    await logMonitoringEvent(device, 'COMMAND_SENT', `Command sent: ${normalizedAction}`, {
      commandId: queued.command.id,
      action: normalizedAction,
    });
  }

  return {
    commandId: queued.command.id,
    action: normalizedAction,
    socketEvent,
    status: queued.command.status,
  };
}

export async function getMonitoringDashboard(user) {
  const { devices, count } = await listMonitoringDevicesForUser(user);
  const online = devices.filter((d) => d.online || d.status === 'ONLINE');
  const offline = devices.filter((d) => !d.online && d.status !== 'ONLINE');

  let streamFailures = 0;
  let activeStreams = 0;

  for (const device of devices) {
    const streams = device.stream_status?.streams || device.go2rtc_status?.streams || [];
    if (Array.isArray(streams)) {
      for (const stream of streams) {
        if (stream.online === false || stream.status === 'offline') streamFailures += 1;
        if (stream.online === true || stream.status === 'online') activeStreams += 1;
      }
    } else if (device.go2rtc_status?.summary) {
      streamFailures += device.go2rtc_status.summary.offline || 0;
      activeStreams += device.go2rtc_status.summary.online || 0;
    }
  }

  const lastHeartbeatRow = await DeviceHeartbeat.findOne({
    where: devices.length ? { device_id: { [Op.in]: devices.map((d) => d.id) } } : undefined,
    order: [['received_at', 'DESC']],
  });

  return {
    total_devices: count,
    online_devices: online.length,
    offline_devices: offline.length,
    stream_failures: streamFailures,
    active_streams: activeStreams,
    last_heartbeat: lastHeartbeatRow?.received_at || null,
    devices_summary: devices.map((d) => ({
      id: d.id,
      device_name: d.device_name,
      status: d.status,
      last_seen: d.last_seen_at,
    })),
  };
}

export async function handleDeviceOnline({ deviceId, payload, socketId }) {
  const device = await Device.findByPk(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }

  try {
    await upsertAgentSocketPresence({
      deviceId,
      socketId,
      divisionId: device.division_id,
      lobbyId: device.lobby_id,
    });
  } catch (error) {
    logWarn('Monitoring', 'Presence upsert failed on device:online', { deviceId, error: error.message });
  }

  await device.update({
    status: 'ONLINE',
    last_seen_at: new Date(),
    health_status: 'ONLINE',
    ip_address: payload?.ipAddress || device.ip_address,
    agent_version: payload?.agentVersion || device.agent_version,
    meta: {
      ...(device.meta || {}),
      mediamtxPaths: payload?.mediamtxPaths || device.meta?.mediamtxPaths || [],
    },
  });

  if (payload?.mediamtxPaths?.length) {
    await syncCamerasForPiDevice(device, payload.mediamtxPaths);
  }

  await logMonitoringEvent(device, 'DEVICE_ONLINE', 'Device came online via socket', payload);
  return { ok: true, device: toMonitoringDeviceResponse(device) };
}

export async function handleDeviceStreamStatus(deviceId, streamPayload) {
  const enriched = enrichStreamPayload(streamPayload);
  const streamStatus = enriched?.streams ? enriched : { streams: enriched };
  const mediamtxStatus = enriched?.mediamtx || enriched;

  const device = await Device.findByPk(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }

  await device.update({
    stream_status: streamStatus,
    go2rtc_status: mediamtxStatus,
    last_seen_at: new Date(),
    status: 'ONLINE',
  });

  await syncCamerasForPiDevice(
    device,
    device.meta?.mediamtxPaths || mediamtxStatus?.paths || [],
    enriched?.streams || streamStatus?.streams || []
  );

  await logMonitoringEvent(device, 'STREAM_STATUS_UPDATE', 'Stream status updated', enriched);
  return { ok: true, device: toMonitoringDeviceResponse(device) };
}

function toScreenshotResponse(screenshot) {
  return {
    id: screenshot.id,
    device_id: screenshot.device_id,
    screen_type: screenshot.screen_type,
    mime_type: screenshot.mime_type,
    size_bytes: screenshot.size_bytes,
    captured_at: screenshot.captured_at,
    expires_at: screenshot.expires_at,
    meta: screenshot.meta,
  };
}

export async function listScreenshotsForUser(deviceId, user, { limit = 50 } = {}) {
  const access = await getMonitoringDeviceForUser(deviceId, user);
  if (!access) return null;
  if (access.forbidden) return { forbidden: true };
  if (access.notAgent) return { notAgent: true };

  const rows = await DeviceScreenshot.findAll({
    where: { device_id: deviceId },
    order: [['captured_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
  });

  return {
    deviceId,
    screenshots: rows.map(toScreenshotResponse),
    count: rows.length,
  };
}

export async function getScreenshotForUser(screenshotId, user) {
  const screenshot = await DeviceScreenshot.findByPk(screenshotId);
  if (!screenshot) return null;

  const access = await getMonitoringDeviceForUser(screenshot.device_id, user);
  if (!access) return null;
  if (access.forbidden) return { forbidden: true };
  if (access.notAgent) return { notAgent: true };

  if (screenshot.expires_at && new Date(screenshot.expires_at) < new Date()) {
    return { expired: true };
  }

  return {
    screenshot: toScreenshotResponse(screenshot),
    storagePath: screenshot.storage_path,
    mimeType: screenshot.mime_type || 'image/png',
    stream: createReadStream(screenshot.storage_path),
  };
}

function safeStreamFileName(streamName) {
  return String(streamName || 'stream').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function streamFramePath(deviceId, streamName, ext = 'jpg') {
  return path.join(STREAM_FRAME_DIR, deviceId, `${safeStreamFileName(streamName)}.${ext}`);
}

function buildFrameUrl(baseUrl, deviceId, streamName) {
  if (!baseUrl || !deviceId || !streamName) return null;
  return `${baseUrl.replace(/\/$/, '')}/api/monitoring/devices/${deviceId}/streams/${encodeURIComponent(streamName)}/frame`;
}

function buildLiveMjpegUrl(baseUrl, deviceId, streamName) {
  if (!baseUrl || !deviceId || !streamName) return null;
  return `${baseUrl.replace(/\/$/, '')}/api/monitoring/devices/${deviceId}/streams/${encodeURIComponent(streamName)}/live.mjpeg`;
}

function inferStreamMeta(streamName, lobbyDevices = []) {
  const key = String(streamName || '').toLowerCase();
  const kioskMatch = key.match(/^kiosk(\d+)$/);
  if (kioskMatch) {
    const label = `Kiosk ${kioskMatch[1]}`;
    const linked = lobbyDevices.find((d) => d.device_name === label);
    return { label, stream_type: 'kiosk', linked_device_id: linked?.id || null, linked_device_name: linked?.device_name || label };
  }
  const camMatch = key.match(/^(camera|cctv)(\d+)$/i);
  if (camMatch) {
    const label = `Camera ${camMatch[2]}`;
    const linked = lobbyDevices.find((d) => d.device_name === label);
    return { label, stream_type: 'cctv', linked_device_id: linked?.id || null, linked_device_name: linked?.device_name || label };
  }
  const nvrMatch = key.match(/^nvr(\d*)$/i);
  if (nvrMatch) {
    return { label: nvrMatch[1] ? `NVR ${nvrMatch[1]}` : 'NVR', stream_type: 'nvr', linked_device_id: null, linked_device_name: null };
  }
  return { label: streamName, stream_type: 'stream', linked_device_id: null, linked_device_name: null };
}

function extractMediaMtxStreams(device) {
  const streams = device?.stream_status?.streams
    || device?.stream_status?.mediamtx?.streams
    || device?.go2rtc_status?.streams
    || [];
  return Array.isArray(streams) ? streams : [];
}

function deriveFrameFreshness(frameUpdatedAt) {
  if (!frameUpdatedAt) {
    return { frame_age_ms: null, frame_freshness: 'missing' };
  }
  const ageMs = Date.now() - new Date(frameUpdatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { frame_age_ms: null, frame_freshness: 'unknown' };
  }
  if (ageMs < 2500) return { frame_age_ms: ageMs, frame_freshness: 'fresh' };
  if (ageMs < 10000) return { frame_age_ms: ageMs, frame_freshness: 'lagging' };
  return { frame_age_ms: ageMs, frame_freshness: 'stale' };
}

async function findPiAgentsInLobby(lobbyId) {
  const devices = await Device.findAll({
    where: { lobby_id: lobbyId, is_active: true },
    order: [['updated_at', 'DESC']],
  });
  return devices.filter((d) => isPiMonitoringAgent(d));
}

async function buildLobbyStreamsPayload(lobby, user, baseUrl) {
  const lobbyDevices = await Device.findAll({
    where: { lobby_id: lobby.id, is_active: true },
    order: [['device_name', 'ASC']],
  });

  const piAgents = lobbyDevices.filter((d) => isPiMonitoringAgent(d));
  const piAgent = piAgents[0] || null;

  if (!piAgent) {
    return {
      pi_device_id: null,
      pi_online: false,
      streams: [],
      summary: { total: 0, online: 0, offline: 0 },
    };
  }

  const mediamtxStreams = extractMediaMtxStreams(piAgent);
  const streams = mediamtxStreams.map((stream) => {
    const meta = inferStreamMeta(stream.name, lobbyDevices);
    const frameMeta = piAgent.meta?.stream_frames?.[stream.name];
    const freshness = deriveFrameFreshness(frameMeta?.updated_at || null);
    return {
      name: stream.name,
      label: meta.label,
      stream_type: meta.stream_type,
      online: stream.online === true || stream.status === 'online',
      status: stream.status || (stream.online ? 'online' : 'offline'),
      source: stream.source || null,
      codec: stream.codec || null,
      fps: stream.fps ?? null,
      linked_device_id: meta.linked_device_id,
      linked_device_name: meta.linked_device_name,
      frame_url: buildFrameUrl(baseUrl, piAgent.id, stream.name),
      live_mjpeg_url: buildLiveMjpegUrl(baseUrl, piAgent.id, stream.name),
      frame_updated_at: frameMeta?.updated_at || null,
      frame_age_ms: freshness.frame_age_ms,
      frame_freshness: freshness.frame_freshness,
      pi_device_id: piAgent.id,
      pi_ip: piAgent.ip_address || null,
    };
  });

  const online = streams.filter((s) => s.online).length;
  return {
    pi_device_id: piAgent.id,
    pi_device_name: piAgent.device_name,
    pi_online: piAgent.status === 'ONLINE',
    pi_ip: piAgent.ip_address,
    streams,
    summary: {
      total: streams.length,
      online,
      offline: streams.length - online,
    },
  };
}

export async function storeStreamFrame({ deviceId, streamName, buffer, mimeType }) {
  const device = await Device.findByPk(deviceId);
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }

  const ext = mimeType?.includes('png') ? 'png' : 'jpg';
  const storagePath = streamFramePath(deviceId, streamName, ext);
  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await fs.writeFile(storagePath, buffer);

  const updatedAt = new Date().toISOString();
  const meta = {
    ...(device.meta || {}),
    stream_frames: {
      ...(device.meta?.stream_frames || {}),
      [streamName]: {
        updated_at: updatedAt,
        storage_path: storagePath,
        mime_type: mimeType || `image/${ext}`,
        size_bytes: buffer.length,
      },
    },
  };

  await device.update({
    meta,
    last_seen_at: new Date(),
    status: 'ONLINE',
  });
  // #region agent log
  debugLog('H2', 'monitoring.service.js:storeStreamFrame', 'Stored stream frame on backend', {
    deviceId,
    streamName,
    sizeBytes: buffer.length,
    mimeType: mimeType || `image/${ext}`,
    storagePath,
    updatedAt,
  });
  // #endregion

  return {
    ok: true,
    deviceId,
    streamName,
    updated_at: updatedAt,
    size_bytes: buffer.length,
  };
}

export async function getStreamFrameForUser(deviceId, streamName, user) {
  const access = await getMonitoringDeviceForUser(deviceId, user);
  if (!access) return null;
  if (access.forbidden) return { forbidden: true };
  if (access.notAgent) return { notAgent: true };

  const device = await Device.findByPk(deviceId);
  const frameMeta = device?.meta?.stream_frames?.[streamName];
  const storagePath = frameMeta?.storage_path || streamFramePath(deviceId, streamName);

  let exists = true;
  let fileMtimeMs = null;
  try {
    const stat = await fs.stat(storagePath);
    fileMtimeMs = stat.mtimeMs;
  } catch {
    exists = false;
  }
  // #region agent log
  debugLog('H3', 'monitoring.service.js:getStreamFrameForUser', 'Resolved stream frame path for request', {
    deviceId,
    streamName,
    exists,
    storagePath,
    metaUpdatedAt: frameMeta?.updated_at || null,
    fileMtimeMs,
  });
  // #endregion

  return {
    mimeType: frameMeta?.mime_type || 'image/jpeg',
    storagePath,
    stream: exists ? createReadStream(storagePath) : null,
    updated_at: frameMeta?.updated_at || null,
    notFound: !exists,
  };
}

const MJPEG_BOUNDARY = '--railwatchframe';

export async function streamLiveMjpegForUser(deviceId, streamName, user, res) {
  const access = await getMonitoringDeviceForUser(deviceId, user);
  if (!access) return { notFound: true };
  if (access.forbidden) return { forbidden: true };
  if (access.notAgent) return { notAgent: true };

  const device = await Device.findByPk(deviceId);
  const frameMeta = device?.meta?.stream_frames?.[streamName];
  const storagePath = frameMeta?.storage_path || streamFramePath(deviceId, streamName);

  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    Pragma: 'no-cache',
  });

  let closed = false;
  res.on('close', () => { closed = true; });

  let lastMtimeMs = 0;
  const pollMs = Number(process.env.MONITORING_MJPEG_POLL_MS || 200);

  while (!closed) {
    try {
      const stat = await fs.stat(storagePath);
      // Only push a new part when the frame file actually changed.
      if (stat.mtimeMs !== lastMtimeMs) {
        const buffer = await fs.readFile(storagePath);
        if (buffer.length > 0) {
          lastMtimeMs = stat.mtimeMs;
          res.write(`${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${buffer.length}\r\n\r\n`);
          res.write(buffer);
          res.write('\r\n');
        }
      }
    } catch {
      // wait for Pi to upload first frame
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return { ok: true };
}

export async function getLobbyStreamsForUser(lobbyId, user, { baseUrl } = {}) {
  const lobby = await Lobby.findByPk(lobbyId);
  if (!lobby) return null;

  const role = normalizeRole(user.role);
  if (role !== 'SUPER_ADMIN') {
    if (!user.division_id || user.division_id !== lobby.division_id) {
      return { forbidden: true };
    }
  }

  const payload = await buildLobbyStreamsPayload(lobby, user, baseUrl);
  return {
    lobby_id: lobby.id,
    lobby_name: lobby.name,
    station_name: lobby.station_name,
    division_id: lobby.division_id,
    ...payload,
  };
}

export async function getDivisionLobbyStreamsForUser(user, { baseUrl } = {}) {
  const role = normalizeRole(user.role);
  if (role === 'USER') return { forbidden: true };

  let divisionId = user.division_id;
  if (role === 'SUPER_ADMIN' && !divisionId) {
    const firstPi = await Device.findOne({
      where: { agent_version: { [Op.ne]: null } },
      order: [['updated_at', 'DESC']],
    });
    divisionId = firstPi?.division_id || null;
  }
  if (!divisionId) return { forbidden: true };

  const lobbies = await Lobby.findAll({
    where: { division_id: divisionId, status: true },
    order: [['name', 'ASC']],
  });

  const lobbyResults = [];
  for (const lobby of lobbies) {
    const payload = await buildLobbyStreamsPayload(lobby, user, baseUrl);
    lobbyResults.push({
      lobby_id: lobby.id,
      lobby_name: lobby.name,
      station_name: lobby.station_name,
      ...payload,
    });
  }

  let totalStreams = 0;
  let onlineStreams = 0;
  for (const lobby of lobbyResults) {
    totalStreams += lobby.summary?.total || 0;
    onlineStreams += lobby.summary?.online || 0;
  }

  return {
    division_id: divisionId,
    lobbies: lobbyResults,
    summary: {
      lobby_count: lobbyResults.length,
      total_streams: totalStreams,
      online_streams: onlineStreams,
      offline_streams: totalStreams - onlineStreams,
    },
  };
}

export { toMonitoringDeviceResponse, DEVICE_COMMAND_MAP, SOCKET_EVENT_MAP, enrichStreamPayload };
