import jwt from 'jsonwebtoken';
import Device from '../divisions/device.model.js';
import StreamCamera from './streamCamera.model.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';
import { isPiMonitoringAgent } from '../devices/device.service.js';

const WATCHER_ROLES = new Set(['SUPER_ADMIN', 'DIVISION_ADMIN', 'MONITOR']);
const EDGE_TOKEN_TTL_SEC = Number(process.env.EDGE_WEBRTC_TOKEN_TTL_SEC || 3600);
const EDGE_TOKEN_SECRET = process.env.EDGE_WEBRTC_JWT_SECRET || process.env.JWT_SECRET || null;

export function buildLegacyCameraId(piDeviceId, mediamtxPath) {
  return `${piDeviceId}_${mediamtxPath}`;
}

export function parseLegacyCameraId(id) {
  if (!id || typeof id !== 'string') return null;
  const match = id.match(/^([0-9a-f-]{36})_(.+)$/i);
  if (!match) return null;
  return { piDeviceId: match[1], mediamtxPath: match[2] };
}

/** @returns {'direct' | 'edge'} */
export function getWebrtcPlaybackMode(env = process.env) {
  const mode = String(env.PI_WEBRTC_PLAYBACK_MODE || 'direct').trim().toLowerCase();
  return mode === 'edge' ? 'edge' : 'direct';
}

export function buildDirectPiWebrtcUrl(pi, mediamtxPath, env = process.env) {
  const ip = pi?.ip_address?.trim?.() || String(pi?.ip_address || '').trim();
  if (!ip) return null;
  const scheme = env.MEDIAMTX_WEBRTC_SCHEME || 'http';
  const port = env.MEDIAMTX_WEBRTC_PORT || '8889';
  return `${scheme}://${ip}:${port}/${encodeURIComponent(mediamtxPath)}`;
}

export function buildEdgeWebrtcUrl(mediamtxPath, env = process.env) {
  const base = (env.EDGE_WEBRTC_BASE_URL || 'https://edge.railwatch.in/webrtc').replace(/\/$/, '');
  return `${base}/${encodeURIComponent(mediamtxPath)}`;
}

export function resolveWebrtcPlayUrl(pi, mediamtxPath, env = process.env) {
  if (getWebrtcPlaybackMode(env) === 'edge') {
    return buildEdgeWebrtcUrl(mediamtxPath, env);
  }
  return buildDirectPiWebrtcUrl(pi, mediamtxPath, env);
}

function inferCameraLabel(pathName) {
  const camMatch = pathName.match(/^camera(\d+)$/i);
  if (camMatch) return `Camera ${camMatch[1]}`;
  return pathName;
}

export async function syncCamerasForPiDevice(device, paths = [], streamEntries = []) {
  if (!device || !isPiMonitoringAgent(device)) return [];

  const pathSet = new Set(
    (Array.isArray(paths) ? paths : [])
      .map((p) => String(p).trim())
      .filter(Boolean)
  );

  for (const entry of streamEntries) {
    if (entry?.name) pathSet.add(String(entry.name).trim());
  }

  const synced = [];
  for (const mediamtxPath of pathSet) {
    const streamMeta = streamEntries.find((s) => s.name === mediamtxPath);
    const [camera] = await StreamCamera.findOrCreate({
      where: { pi_device_id: device.id, mediamtx_path: mediamtxPath },
      defaults: {
        division_id: device.division_id,
        lobby_id: device.lobby_id,
        name: inferCameraLabel(mediamtxPath),
        is_active: true,
        meta: { source: streamMeta?.source || null },
      },
    });

    await camera.update({
      division_id: device.division_id,
      lobby_id: device.lobby_id,
      is_active: true,
      meta: {
        ...(camera.meta || {}),
        source: streamMeta?.source || camera.meta?.source || null,
        lastSyncedAt: new Date().toISOString(),
      },
    });
    synced.push(camera);
  }

  return synced;
}

function canWatchCameras(user) {
  return WATCHER_ROLES.has(normalizeRole(user.role));
}

function canAccessCamera(user, camera) {
  const role = normalizeRole(user.role);
  if (role === 'SUPER_ADMIN') return true;
  if (!user.division_id) return false;
  return user.division_id === camera.division_id;
}

export async function resolveCameraById(cameraId) {
  const byPk = await StreamCamera.findByPk(cameraId);
  if (byPk) return byPk;

  const legacy = parseLegacyCameraId(cameraId);
  if (!legacy) return null;

  return StreamCamera.findOne({
    where: {
      pi_device_id: legacy.piDeviceId,
      mediamtx_path: legacy.mediamtxPath,
      is_active: true,
    },
  });
}

function maybeSignEdgeToken(camera, user) {
  if (getWebrtcPlaybackMode() !== 'edge') return null;
  if (!EDGE_TOKEN_SECRET) return null;
  const expiresAt = new Date(Date.now() + EDGE_TOKEN_TTL_SEC * 1000);
  const token = jwt.sign(
    {
      sub: user.id,
      cameraId: camera.id,
      piDeviceId: camera.pi_device_id,
      mediamtxPath: camera.mediamtx_path,
    },
    EDGE_TOKEN_SECRET,
    { expiresIn: EDGE_TOKEN_TTL_SEC }
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function buildWebrtcPlayUrl(cameraId, user) {
  if (!canWatchCameras(user)) {
    return { forbidden: true };
  }

  const camera = await resolveCameraById(cameraId);
  if (!camera || !camera.is_active) {
    return { notFound: true };
  }

  if (!canAccessCamera(user, camera)) {
    return { forbidden: true };
  }

  const pi = await Device.findByPk(camera.pi_device_id);
  if (!pi || !pi.is_active) {
    return { notFound: true, message: 'Pi agent not found or inactive' };
  }

  const url = resolveWebrtcPlayUrl(pi, camera.mediamtx_path);
  if (!url) {
    return {
      notFound: true,
      message: 'Pi IP address not registered',
    };
  }

  const signed = maybeSignEdgeToken(camera, user);
  const piIp = pi.ip_address?.trim?.() || String(pi.ip_address || '').trim() || null;

  return {
    camera: {
      id: camera.id,
      legacyId: buildLegacyCameraId(camera.pi_device_id, camera.mediamtx_path),
      name: camera.name,
      mediamtxPath: camera.mediamtx_path,
      piDeviceId: camera.pi_device_id,
      piIp,
      lobbyId: camera.lobby_id,
    },
    url,
    token: signed?.token || null,
    expiresAt: signed?.expiresAt || null,
  };
}

export async function listCamerasForUser(user, { lobbyId = null } = {}) {
  if (!canWatchCameras(user)) return { forbidden: true };

  const where = { is_active: true };
  const role = normalizeRole(user.role);

  if (lobbyId) where.lobby_id = lobbyId;
  if (role !== 'SUPER_ADMIN' && user.division_id) {
    where.division_id = user.division_id;
  } else if (role !== 'SUPER_ADMIN' && !user.division_id) {
    return { cameras: [] };
  }

  const cameras = await StreamCamera.findAll({
    where,
    order: [['name', 'ASC']],
  });

  return {
    cameras: cameras.map((c) => ({
      id: c.id,
      legacyId: buildLegacyCameraId(c.pi_device_id, c.mediamtx_path),
      name: c.name,
      mediamtxPath: c.mediamtx_path,
      piDeviceId: c.pi_device_id,
      lobbyId: c.lobby_id,
      location: c.location,
    })),
  };
}
