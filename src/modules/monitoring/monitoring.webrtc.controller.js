import { sendError } from '../../utils/apiResponse.js';
import Device from '../divisions/device.model.js';
import { getMonitoringDeviceForUser } from './monitoring.service.js';
import {
  fetchGo2rtcOfferAnswer,
  isAgentOnline,
  isPrivateIp,
  proxyOfferViaSocket,
  resolveGo2rtcHosts,
} from './webrtc-offer.relay.js';

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

function debugLog(hypothesisId, location, message, data, runId = 'pre-fix') {
  // #region agent log
  fetch('http://127.0.0.1:7677/ingest/7e62b965-3dd0-48bc-a578-afaf818fbf71', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f00c1e' },
    body: JSON.stringify({
      sessionId: 'f00c1e',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export async function proxyWebrtcOffer(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  const startedAt = Date.now();
  const { type, sdp } = req.body || {};
  debugLog('H5', 'monitoring.webrtc.controller.js:proxyWebrtcOffer:entry', 'offer proxy entry', {
    deviceId: req.params.id,
    streamName: req.params.streamName,
    hasUser: !!req.user,
    offerType: type,
    sdpLen: typeof sdp === 'string' ? sdp.length : 0,
  });

  if (type !== 'offer' || typeof sdp !== 'string' || !sdp.trim()) {
    return sendError(res, 'Body must contain { type: "offer", sdp: string }', 400);
  }

  if (req.user) {
    const access = await getMonitoringDeviceForUser(req.params.id, req.user);
    if (!ensureAccessResult(access, res)) return;
  }

  const device = await Device.findByPk(req.params.id);
  if (!device) return sendError(res, 'Device not found', 404);
  if (!device.ip_address) {
    debugLog('H5', 'monitoring.webrtc.controller.js:proxyWebrtcOffer:no-ip', 'device missing ip_address', {
      deviceId: req.params.id,
      elapsedMs: Date.now() - startedAt,
    });
    return sendError(res, 'Pi IP address not known', 503);
  }

  const port = DEFAULT_GO2RTC_PORT;
  const hosts = resolveGo2rtcHosts(device);
  const agentOnline = await isAgentOnline(device.id);
  debugLog('H1', 'monitoring.webrtc.controller.js:proxyWebrtcOffer:resolve-hosts', 'resolved go2rtc hosts', {
    deviceId: device.id,
    streamName: req.params.streamName,
    piIp: device.ip_address,
    isPrivateIp: isPrivateIp(device.ip_address),
    hosts,
    agentOnline,
    go2rtcPort: port,
  }, 'post-fix');

  let lastError = null;
  for (const host of hosts) {
    const hostStartedAt = Date.now();
    try {
      const answer = await fetchGo2rtcOfferAnswer(host, port, req.params.streamName, sdp);
      debugLog('H2', 'monitoring.webrtc.controller.js:proxyWebrtcOffer:http-success', 'go2rtc answered via HTTP', {
        deviceId: device.id,
        streamName: req.params.streamName,
        host,
        elapsedMs: Date.now() - hostStartedAt,
        totalElapsedMs: Date.now() - startedAt,
      }, 'post-fix');
      return res.json({
        success: true,
        data: {
          type: answer.type,
          sdp: answer.sdp,
          ice_servers: DEFAULT_ICE_SERVERS,
        },
      });
    } catch (err) {
      lastError = err;
      debugLog('H1', 'monitoring.webrtc.controller.js:proxyWebrtcOffer:http-fail', 'go2rtc HTTP attempt failed', {
        deviceId: device.id,
        streamName: req.params.streamName,
        host,
        errName: err?.name,
        errCode: err?.code,
        errMessage: err?.message,
        elapsedMs: Date.now() - hostStartedAt,
      }, 'post-fix');
    }
  }

  if (agentOnline) {
    try {
      const io = req.app?.get?.('io');
      const answer = await proxyOfferViaSocket(io, device.id, req.params.streamName, sdp);
      debugLog('H3', 'monitoring.webrtc.controller.js:proxyWebrtcOffer:socket-success', 'go2rtc answered via socket relay', {
        deviceId: device.id,
        streamName: req.params.streamName,
        totalElapsedMs: Date.now() - startedAt,
      }, 'post-fix');
      return res.json({
        success: true,
        data: {
          type: answer.type,
          sdp: answer.sdp,
          ice_servers: DEFAULT_ICE_SERVERS,
        },
      });
    } catch (err) {
      lastError = err;
      debugLog('H3', 'monitoring.webrtc.controller.js:proxyWebrtcOffer:socket-fail', 'socket relay failed', {
        deviceId: device.id,
        streamName: req.params.streamName,
        errName: err?.name,
        errCode: err?.code,
        errMessage: err?.message,
        totalElapsedMs: Date.now() - startedAt,
      }, 'post-fix');
    }
  }

  debugLog('H1', 'monitoring.webrtc.controller.js:proxyWebrtcOffer:exhausted', 'all go2rtc paths failed', {
    deviceId: device.id,
    streamName: req.params.streamName,
    hosts,
    agentOnline,
    errName: lastError?.name,
    errCode: lastError?.code,
    errMessage: lastError?.message,
    elapsedMs: Date.now() - startedAt,
  }, 'post-fix');

  if (lastError?.name === 'AbortError' || lastError?.code === 'SOCKET_TIMEOUT') {
    return sendError(res, 'Pi go2rtc did not respond in time', 504);
  }
  if (lastError?.code === 'GO2RTC_HTTP_ERROR') {
    return sendError(res, `Pi go2rtc returned ${lastError.status}: ${lastError.message}`, 502);
  }
  return sendError(res, `Failed to reach Pi go2rtc: ${lastError?.message || 'unknown error'}`, 502);
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
