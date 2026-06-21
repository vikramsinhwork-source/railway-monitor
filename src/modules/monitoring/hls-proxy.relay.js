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

/** Split an HLS manifest resource line into path + query (e.g. video.m3u8?session=uuid). */
export function parseManifestResourceLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return { path: '', query: '' };

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return {
        path: url.pathname.split('/').filter(Boolean).pop() || '',
        query: url.search ? url.search.slice(1) : '',
      };
    } catch {
      return { path: trimmed, query: '' };
    }
  }

  const q = trimmed.indexOf('?');
  if (q >= 0) {
    return { path: trimmed.slice(0, q), query: trimmed.slice(q + 1) };
  }
  return { path: trimmed, query: '' };
}

/** Remove monitor auth params; keep MediaMTX params like session=. */
export function stripAuthFromQuery(query) {
  if (!query) return '';
  return query
    .split('&')
    .filter((part) => part && !part.startsWith('token=') && !part.startsWith('access_token='))
    .join('&');
}

export function buildProxyHlsUrl(base, pathPart, { mtxQuery = '', authToken = '' } = {}) {
  const encodedPath = String(pathPart || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');

  let url = `${base}${encodedPath}`;
  const params = new URLSearchParams(stripAuthFromQuery(mtxQuery));
  if (authToken) params.set('token', authToken);
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return url;
}

/**
 * Decode path segment from route params; split embedded ?session= if URL-encoded into path.
 */
export function parseRelativeHlsPath(rawPath, reqQuery = {}) {
  let decoded = String(rawPath || 'index.m3u8');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep raw
  }

  const parsed = parseManifestResourceLine(decoded);
  let mediamtxQuery = stripAuthFromQuery(parsed.query);

  if (reqQuery.session && !mediamtxQuery.includes('session=')) {
    const extra = new URLSearchParams(mediamtxQuery);
    extra.set('session', String(reqQuery.session));
    mediamtxQuery = extra.toString();
  }

  return {
    path: parsed.path || 'index.m3u8',
    mediamtxQuery,
  };
}

/**
 * Rewrite relative segment lines in an HLS manifest to backend proxy URLs.
 * Appends ?token= to every resource URL when authToken is provided.
 */
export function rewriteHlsManifest(text, { piDeviceId, streamName, apiPrefix = '', authToken = '' }) {
  if (typeof text !== 'string' || !text.includes('#EXTM3U')) {
    return text;
  }

  const base = `${String(apiPrefix).replace(/\/$/, '')}/api/monitoring/devices/${encodeURIComponent(piDeviceId)}/streams/${encodeURIComponent(streamName)}/hls/`;

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      const { path, query } = parseManifestResourceLine(trimmed);
      if (!path) return line;

      return buildProxyHlsUrl(base, path, {
        mtxQuery: query,
        authToken: authToken || '',
      });
    })
    .join('\n');
}

export function fetchHlsFromAgent(
  io,
  deviceId,
  streamName,
  relativePath,
  options = {}
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HLS_SOCKET_TIMEOUT_MS;
  const mediamtxQuery = options.mediamtxQuery || '';

  if (!io) {
    const err = new Error('Socket.IO unavailable');
    err.code = 'IO_UNAVAILABLE';
    return Promise.reject(err);
  }

  const mediamtxPath = buildMediaMtxHlsPath(streamName, relativePath);

  return new Promise((resolve, reject) => {
    io.to(`device:${deviceId}`)
      .timeout(timeoutMs)
      .emit(
        'device:hls-fetch',
        {
          deviceId,
          streamName,
          path: mediamtxPath,
          query: mediamtxQuery || undefined,
        },
        (err, responses) => {
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
        }
      );
  });
}
