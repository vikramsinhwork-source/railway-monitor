import jwt from 'jsonwebtoken';
import { sendError } from '../../utils/apiResponse.js';
import Device from '../divisions/device.model.js';
import StreamCamera from '../cameras/streamCamera.model.js';
import { getMonitoringDeviceForUser } from './monitoring.service.js';
import {
  isAgentOnline,
  isPrivateIp,
  proxyOfferViaSocket,
} from './webrtc-offer.relay.js';

const STREAM_TOKEN_TTL_SEC = Number(process.env.STREAM_TOKEN_TTL_SEC || 600);

function getJwtSecret() {
  return process.env.JWT_SECRET || null;
}

const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: ['turn:turn.railwaymonitor.in:3478'],
    username: process.env.TURN_USERNAME || 'turnuser',
    credential: process.env.TURN_PASSWORD || 'turnpassword',
  },
];

function ensureAccessResult(result, res) {
  if (!result) {
    sendError(res, 'Device not found', 404);
    return false;
  }
  if (result.forbidden) {
    sendError(res, 'Forbidden', 403);
    return false;
  }
  if (result.notAgent) {
    sendError(res, 'Not a Raspberry Pi monitoring device', 400);
    return false;
  }
  return true;
}

function issueStreamToken({ userId, piDeviceId, mediamtxPath, cameraId }) {
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const expiresAt = new Date(Date.now() + STREAM_TOKEN_TTL_SEC * 1000);
  const token = jwt.sign(
    {
      sub: userId,
      piDeviceId,
      mediamtxPath,
      cameraId: cameraId || null,
      typ: 'stream',
    },
    jwtSecret,
    { expiresIn: STREAM_TOKEN_TTL_SEC }
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function proxyWebrtcOffer(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  const { type, sdp } = req.body || {};
  if (type !== 'offer' || typeof sdp !== 'string' || !sdp.trim()) {
    return sendError(res, 'Body must contain { type: "offer", sdp: string }', 400);
  }

  if (!req.user) {
    return sendError(res, 'Authentication required', 401);
  }

  const access = await getMonitoringDeviceForUser(req.params.id, req.user);
  if (!ensureAccessResult(access, res)) return;

  const device = await Device.findByPk(req.params.id);
  if (!device) return sendError(res, 'Device not found', 404);

  const streamName = req.params.streamName;
  const agentOnline = await isAgentOnline(device.id);
  if (!agentOnline) {
    return sendError(res, 'Device is not connected (offline)', 503);
  }

  if (!isPrivateIp(device.ip_address)) {
    return sendError(res, 'WebRTC socket relay requires a private Pi IP address', 503);
  }

  let answer;
  try {
    const io = req.app?.get?.('io');
    answer = await proxyOfferViaSocket(io, device.id, streamName, sdp);
  } catch (err) {
    if (err?.code === 'SOCKET_TIMEOUT' || err?.name === 'AbortError') {
      return sendError(res, 'Pi agent did not respond in time', 504);
    }
    if (err?.code === 'SOCKET_RELAY_ERROR') {
      return sendError(res, err.message, 502);
    }
    return sendError(res, `Failed to relay WebRTC offer: ${err?.message || 'unknown error'}`, 502);
  }

  const camera = await StreamCamera.findOne({
    where: {
      pi_device_id: device.id,
      mediamtx_path: streamName,
      is_active: true,
    },
  });

  let streamToken;
  try {
    streamToken = issueStreamToken({
      userId: req.user.id,
      piDeviceId: device.id,
      mediamtxPath: streamName,
      cameraId: camera?.id || null,
    });
  } catch (err) {
    return sendError(res, err.message, 500);
  }

  return res.json({
    success: true,
    data: {
      type: answer.type,
      sdp: answer.sdp,
      ice_servers: DEFAULT_ICE_SERVERS,
      stream_token: streamToken.token,
      stream_token_expires_at: streamToken.expiresAt,
    },
  });
}
