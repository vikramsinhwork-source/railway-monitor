import { sendError } from '../../utils/apiResponse.js';
import Device from '../divisions/device.model.js';
import { getMonitoringDeviceForUser } from './monitoring.service.js';

const DEFAULT_GO2RTC_PORT = Number(process.env.GO2RTC_PORT || 1984);
const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
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

export async function proxyWebrtcOffer(req, res) {
  const { type, sdp } = req.body || {};
  if (type !== 'offer' || typeof sdp !== 'string' || !sdp.trim()) {
    return sendError(res, 'Body must contain { type: "offer", sdp: string }', 400);
  }

  const access = await getMonitoringDeviceForUser(req.params.id, req.user);
  if (!ensureAccessResult(access, res)) return;

  const device = await Device.findByPk(req.params.id);
  if (!device) return sendError(res, 'Device not found', 404);
  if (!device.ip_address) return sendError(res, 'Pi IP address not known', 503);

  const port = DEFAULT_GO2RTC_PORT;
  const go2rtcUrl = `http://${device.ip_address}:${port}/api/webrtc?src=${encodeURIComponent(req.params.streamName)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(go2rtcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'offer', sdp }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return sendError(
        res,
        `Pi go2rtc returned ${response.status}${errorText ? `: ${errorText}` : ''}`,
        502
      );
    }

    const answer = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    return res.json({
      success: true,
      data: {
        type: answer.type,
        sdp: answer.sdp,
        ice_servers: DEFAULT_ICE_SERVERS,
      },
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return sendError(res, 'Pi go2rtc did not respond in time', 504);
    }
    return sendError(res, `Failed to reach Pi go2rtc: ${err.message}`, 502);
  } finally {
    clearTimeout(timeout);
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
