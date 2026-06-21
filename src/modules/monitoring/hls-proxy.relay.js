const DEFAULT_HLS_SOCKET_TIMEOUT_MS = Number(process.env.HLS_PROXY_SOCKET_TIMEOUT_MS || 15000);
const MAX_BODY_BYTES = Number(process.env.HLS_PROXY_MAX_BODY_BYTES || 8388608);

export { DEFAULT_HLS_SOCKET_TIMEOUT_MS, MAX_BODY_BYTES };

export function buildMediaMtxHlsPath(streamName, relativePath) {
  const stream = encodeURIComponent(String(streamName || '').trim());
  const rel = String(relativePath || 'index.m3u8')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return rel ? `${stream}/${rel}` : stream;
}

/**
 * Rewrite relative segment lines in an HLS manifest to backend proxy URLs.
 */
export function rewriteHlsManifest(text, { piDeviceId, streamName, apiPrefix = '' }) {
  if (typeof text !== 'string' || !text.includes('#EXTM3U')) {
    return text;
  }

  const base = `${String(apiPrefix).replace(/\/$/, '')}/api/monitoring/devices/${encodeURIComponent(piDeviceId)}/streams/${encodeURIComponent(streamName)}/hls/`;

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      if (/^https?:\/\//i.test(trimmed)) {
        try {
          const url = new URL(trimmed);
          const name = url.pathname.split('/').filter(Boolean).pop();
          if (!name) return line;
          return `${base}${name.split('/').map(encodeURIComponent).join('/')}`;
        } catch {
          return line;
        }
      }
      return `${base}${trimmed.split('/').map(encodeURIComponent).join('/')}`;
    })
    .join('\n');
}

export function fetchHlsFromAgent(
  io,
  deviceId,
  streamName,
  relativePath,
  timeoutMs = DEFAULT_HLS_SOCKET_TIMEOUT_MS
) {
  if (!io) {
    const err = new Error('Socket.IO unavailable');
    err.code = 'IO_UNAVAILABLE';
    return Promise.reject(err);
  }

  const mediamtxPath = buildMediaMtxHlsPath(streamName, relativePath);

  return new Promise((resolve, reject) => {
    io.to(`device:${deviceId}`)
      .timeout(timeoutMs)
      .emit('device:hls-fetch', { deviceId, streamName, path: mediamtxPath }, (err, responses) => {
        if (err) {
          const socketErr = new Error('Pi agent did not respond to HLS fetch');
          socketErr.code = 'SOCKET_TIMEOUT';
          socketErr.cause = err;
          return reject(socketErr);
        }

        const payload = responses?.find((item) => item?.bodyBase64 && !item?.error) || responses?.[0];
        if (payload?.error) {
          const relayErr = new Error(payload.error);
          relayErr.code = 'SOCKET_RELAY_ERROR';
          relayErr.statusCode = payload.statusCode || 502;
          return reject(relayErr);
        }
        if (!payload?.bodyBase64) {
          const invalidErr = new Error('Pi agent returned empty HLS payload');
          invalidErr.code = 'INVALID_SOCKET_PAYLOAD';
          return reject(invalidErr);
        }

        const body = Buffer.from(payload.bodyBase64, 'base64');
        if (body.length > MAX_BODY_BYTES) {
          const tooLarge = new Error('HLS segment exceeds size limit');
          tooLarge.code = 'PAYLOAD_TOO_LARGE';
          return reject(tooLarge);
        }

        return resolve({
          contentType: payload.contentType || 'application/octet-stream',
          body,
          statusCode: payload.statusCode || 200,
        });
      });
  });
}
