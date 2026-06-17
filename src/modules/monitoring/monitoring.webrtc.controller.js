import { v4 as uuidv4 } from 'uuid';
import { sendError } from '../../utils/apiResponse.js';
import Device from '../divisions/device.model.js';
import { getMonitoringDeviceForUser } from './monitoring.service.js';

const DEFAULT_GO2RTC_PORT = Number(process.env.GO2RTC_PORT || 1984);
const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

const pendingOffers = new Map();

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

export async function proxyWebrtcOffer(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  const { type, sdp } = req.body || {};
  if (type !== 'offer' || typeof sdp !== 'string' || !sdp.trim()) {
    return sendError(res, 'Body must contain { type: "offer", sdp: string }', 400);
  }

  if (req.user) {
    const access = await getMonitoringDeviceForUser(req.params.id, req.user);
    if (!ensureAccessResult(access, res)) return;
  }

  const device = await Device.findByPk(req.params.id);
  if (!device) return sendError(res, 'Device not found', 404);

  const deviceId = req.params.id;
  const streamName = req.params.streamName;
  const requestId = uuidv4();

  const io = req.app.get('io');
  const room = `device:${deviceId}`;

  const roomSockets = await io.in(room).fetchSockets();
  if (roomSockets.length === 0) {
    return sendError(res, 'Device is not connected (offline)', 503);
  }

  const answerPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingOffers.delete(requestId);
      reject(new Error('Pi did not respond in time'));
    }, 10000);
    pendingOffers.set(requestId, { resolve, reject, timeout });
  });

  io.to(room).emit('webrtc:offer', {
    requestId,
    streamName,
    type: 'offer',
    sdp,
  });

  try {
    const answer = await answerPromise;
    return res.json({
      success: true,
      data: {
        type: answer.type,
        sdp: answer.sdp,
        ice_servers: DEFAULT_ICE_SERVERS,
      },
    });
  } catch (err) {
    return sendError(res, err.message, 504);
  }
}

export function handleWebrtcAnswer(payload) {
  const { requestId, type, sdp, error } = payload || {};
  const pending = pendingOffers.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingOffers.delete(requestId);
  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve({ type, sdp });
  }
}

export async function getIceConfig(req, res) {
  return res.json({
    success: true,
    data: {
      ice_servers: [
        {
          urls: ['stun:stun.l.google.com:19302'],
        },
        {
          urls: ['turn:turn.railwaymonitor.in:3478'],
          username: process.env.TURN_USERNAME || 'turnuser',
          credential: process.env.TURN_PASSWORD || 'turnpassword',
        },
      ],
    },
  });
}

export async function getWebrtcConfig(req, res) {
  const access = await getMonitoringDeviceForUser(req.params.id, req.user);
  if (!ensureAccessResult(access, res)) return;

  const device = await Device.findByPk(req.params.id);
  if (!device) return sendError(res, 'Device not found', 404);

  const port = DEFAULT_GO2RTC_PORT;
  const piIp = device.ip_address || null;

  return res.json({
    success: true,
    data: {
      device_id: req.params.id,
      pi_ip: piIp,
      go2rtc_port: port,
      local_go2rtc_url: piIp ? `http://${piIp}:${port}` : null,
      proxy_offer_base_url: `/api/monitoring/devices/${req.params.id}/streams`,
      ice_servers: DEFAULT_ICE_SERVERS,
    },
  });
}
