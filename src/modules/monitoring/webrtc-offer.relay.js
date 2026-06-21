import SocketPresence from '../realtime/socketPresence.model.js';
import Device from '../divisions/device.model.js';

const DEFAULT_SOCKET_TIMEOUT_MS = Number(process.env.MEDIAMTX_SOCKET_TIMEOUT_MS || 45000);
const AGENT_ONLINE_GRACE_MS = Number(process.env.AGENT_ONLINE_GRACE_MS || 120000);

const PRIVATE_IP_REGEX = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/;

export function isPrivateIp(ip) {
  return typeof ip === 'string' && PRIVATE_IP_REGEX.test(ip);
}

export async function isAgentOnline(deviceId) {
  const count = await SocketPresence.count({
    where: { device_id: deviceId, is_online: true },
  });
  if (count > 0) return true;

  const device = await Device.findByPk(deviceId, {
    attributes: ['status', 'last_seen_at'],
  });
  if (!device || device.status !== 'ONLINE') return false;
  if (!device.last_seen_at) return false;
  const ageMs = Date.now() - new Date(device.last_seen_at).getTime();
  return ageMs >= 0 && ageMs <= AGENT_ONLINE_GRACE_MS;
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
