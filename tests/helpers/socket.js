import { io } from 'socket.io-client';
import { socketBaseUrl } from './env.js';

/**
 * @param {string} accessToken - REST JWT (Bearer optional)
 * @param {{ timeoutMs?: number }} [opts]
 */
export function connectSocket(accessToken, opts = {}) {
  const token = accessToken.startsWith('Bearer ') ? accessToken.slice(7) : accessToken;
  const url = socketBaseUrl();
  const timeoutMs = opts.timeoutMs ?? 8000;
  return io(url, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: timeoutMs,
  });
}

export function once(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.removeAllListeners(event);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

export async function disconnectQuietly(socket) {
  if (!socket || !socket.connected) return;
  await new Promise((resolve) => {
    socket.once('disconnect', resolve);
    socket.disconnect();
    setTimeout(resolve, 500);
  });
}
