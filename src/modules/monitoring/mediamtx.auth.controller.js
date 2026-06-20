import jwt from 'jsonwebtoken';

function getJwtSecret() {
  return process.env.JWT_SECRET || null;
}

function extractStreamToken(body = {}) {
  const direct = typeof body.token === 'string' ? body.token.trim() : '';
  if (direct) return direct;

  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (password) return password;

  const user = typeof body.user === 'string' ? body.user.trim() : '';
  if (user && user !== 'any') return user;

  const query = typeof body.query === 'string' ? body.query : '';
  if (query) {
    const params = new URLSearchParams(query);
    const jwtParam = params.get('jwt') || params.get('token');
    if (jwtParam) return jwtParam.trim();
  }

  return null;
}

function isLocalhostIp(ip) {
  if (typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  return trimmed === '127.0.0.1' || trimmed === '::1' || trimmed === 'localhost';
}

function isReadAction(action) {
  return action === 'read' || action === 'playback';
}

// publish: runOnDemand ffmpeg publishes transcoded RTSP to 127.0.0.1:$RTSP_PORT
const LOCALHOST_ALLOWED_ACTIONS = new Set(['read', 'playback', 'api', 'publish']);

export async function mediamtxAuth(req, res) {
  const body = req.body || {};
  const { path, action, protocol, ip } = body;

  if (isLocalhostIp(ip)) {
    if (LOCALHOST_ALLOWED_ACTIONS.has(action)) {
      return res.status(200).send('OK');
    }
    return res.status(403).send('Forbidden');
  }

  if (action === 'api') {
    return res.status(403).send('Forbidden');
  }

  if (protocol && protocol !== 'webrtc') {
    return res.status(403).send('Forbidden');
  }

  if (!isReadAction(action)) {
    return res.status(403).send('Forbidden');
  }

  const token = extractStreamToken(body);
  const jwtSecret = getJwtSecret();
  if (!token || !jwtSecret) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const claims = jwt.verify(token, jwtSecret);
    if (claims.typ !== 'stream') {
      return res.status(403).send('Forbidden');
    }
    if (path && claims.mediamtxPath && path !== claims.mediamtxPath) {
      return res.status(403).send('Forbidden');
    }
    return res.status(200).send('OK');
  } catch {
    return res.status(403).send('Forbidden');
  }
}
