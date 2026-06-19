import SocketPresence from '../realtime/socketPresence.model.js';

const DEFAULT_PER_HOST_TIMEOUT_MS = Number(process.env.GO2RTC_FETCH_TIMEOUT_MS || 4000);
const DEFAULT_SOCKET_TIMEOUT_MS = Number(process.env.GO2RTC_SOCKET_TIMEOUT_MS || 45000);

const PRIVATE_IP_REGEX = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/;

export function isPrivateIp(ip) {
  return typeof ip === 'string' && PRIVATE_IP_REGEX.test(ip);
}

export function resolveGo2rtcHosts(device) {
  const hosts = [];
  const envHost = process.env.GO2RTC_HOST?.trim();
  if (envHost) hosts.push(envHost);
  if (isPrivateIp(device?.ip_address)) hosts.push('127.0.0.1');
  if (device?.ip_address) hosts.push(device.ip_address);
  return [...new Set(hosts)];
}

export async function isAgentOnline(deviceId) {
  const count = await SocketPresence.count({
    where: { device_id: deviceId, is_online: true },
  });
  return count > 0;
}

export async function fetchGo2rtcOfferAnswer(host, port, streamName, sdp, timeoutMs = DEFAULT_PER_HOST_TIMEOUT_MS) {
  const go2rtcUrl = `http://${host}:${port}/api/webrtc?src=${encodeURIComponent(streamName)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(go2rtcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'offer', sdp }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(`go2rtc HTTP ${response.status}${errorText ? `: ${errorText}` : ''}`);
      err.code = 'GO2RTC_HTTP_ERROR';
      err.status = response.status;
      throw err;
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function proxyOfferViaSocket(io, deviceId, streamName, sdp, timeoutMs = DEFAULT_SOCKET_TIMEOUT_MS) {
  if (!io) {
    const err = new Error('Socket.IO unavailable');
    err.code = 'IO_UNAVAILABLE';
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    io.to(`device:${deviceId}`)
      .timeout(timeoutMs)
      .emit(
        'device:webrtc-offer',
        { deviceId, streamName, type: 'offer', sdp },
        (err, responses) => {
          if (err) {
            const socketErr = new Error('Pi agent did not answer WebRTC offer via socket');
            socketErr.code = 'SOCKET_TIMEOUT';
            socketErr.cause = err;
            return reject(socketErr);
          }

          const answer = responses?.find((item) => item?.sdp && !item?.error) || responses?.[0];
          if (answer?.error) {
            const relayErr = new Error(answer.error);
            relayErr.code = 'SOCKET_RELAY_ERROR';
            return reject(relayErr);
          }
          if (!answer?.sdp || answer?.type !== 'answer') {
            const invalidErr = new Error('Pi agent returned invalid WebRTC answer');
            invalidErr.code = 'INVALID_SOCKET_ANSWER';
            return reject(invalidErr);
          }

          return resolve(answer);
        }
      );
  });
}
