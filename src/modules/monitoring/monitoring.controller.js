import multer from 'multer';
import { checkRateLimit } from '../../utils/rate.limiter.js';
import { sendError } from '../../utils/apiResponse.js';
import * as monitoringService from './monitoring.service.js';
import {
  validateRegisterPayload,
  validateHeartbeatPayload,
  validateStreamStatusPayload,
  validateScreenshotUpload,
} from './monitoring.validator.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function rateLimitDevice(req, res, eventType, perMinute = 120) {
  const deviceId = req.deviceAuth?.deviceId || req.ip;
  const limit = checkRateLimit(deviceId, eventType, perMinute);
  if (!limit.allowed) {
    sendError(res, `Rate limit exceeded for ${eventType}`, 429);
    return false;
  }
  return true;
}

// Live frame uploads run at sub-second intervals across many streams per Pi.
const STREAM_FRAME_RATE_LIMIT = Number(process.env.MONITORING_STREAM_FRAME_RATE_LIMIT || 3000);

export async function register(req, res) {
  if (!rateLimitDevice(req, res, 'monitoring-register')) return;

  const validation = validateRegisterPayload(req.body);
  if (!validation.isValid) {
    return sendError(res, validation.errors[0], 400);
  }

  const authDeviceId = req.deviceAuth?.deviceId;
  if (authDeviceId && validation.value.deviceId && authDeviceId !== validation.value.deviceId) {
    return sendError(res, 'Forbidden: deviceId mismatch', 403);
  }

  const deviceId = validation.value.deviceId || authDeviceId;
  const result = await monitoringService.registerMonitoringDevice({
    ...validation.value,
    deviceId,
  });

  if (!result.ok) {
    return sendError(res, result.message, result.code === 'DEVICE_NOT_FOUND' ? 404 : 400);
  }

  return res.status(result.created ? 201 : 200).json({
    success: true,
    message: 'Device registered',
    data: { device: result.device },
  });
}

export async function heartbeat(req, res) {
  if (!rateLimitDevice(req, res, 'monitoring-heartbeat')) return;

  const validation = validateHeartbeatPayload({
    ...req.body,
    deviceId: req.body?.deviceId || req.deviceAuth?.deviceId,
  });
  if (!validation.isValid) {
    return sendError(res, validation.errors[0], 400);
  }

  const result = await monitoringService.recordHeartbeat(
    validation.value.deviceId,
    validation.value.metrics
  );

  if (!result.ok) {
    return sendError(res, result.message, 404);
  }

  return res.json({
    success: true,
    message: 'Heartbeat recorded',
    data: { device: result.device, heartbeatId: result.heartbeat.id },
  });
}

export async function streamStatus(req, res) {
  if (!rateLimitDevice(req, res, 'monitoring-stream-status')) return;

  const validation = validateStreamStatusPayload({
    ...req.body,
    deviceId: req.body?.deviceId || req.deviceAuth?.deviceId,
  });
  if (!validation.isValid) {
    return sendError(res, validation.errors[0], 400);
  }

  const result = await monitoringService.handleDeviceStreamStatus(
    validation.value.deviceId,
    validation.value.streamPayload
  );

  if (!result.ok) {
    return sendError(res, result.message, 404);
  }

  return res.json({
    success: true,
    message: 'Stream status updated',
    data: { device: result.device },
  });
}

export const screenshotUpload = [
  upload.single('screenshot'),
  async (req, res) => {
    if (!rateLimitDevice(req, res, 'monitoring-screenshot')) return;

    const validation = validateScreenshotUpload({
      ...req.body,
      deviceId: req.body?.deviceId || req.deviceAuth?.deviceId,
    });
    if (!validation.isValid) {
      return sendError(res, validation.errors[0], 400);
    }

    if (!req.file?.buffer?.length) {
      return sendError(res, 'screenshot file is required', 400);
    }

    const result = await monitoringService.storeScreenshot({
      deviceId: validation.value.deviceId,
      screenType: validation.value.screenType,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      meta: { originalName: req.file.originalname },
    });

    if (!result.ok) {
      return sendError(res, result.message, 404);
    }

    return res.status(201).json({
      success: true,
      message: 'Screenshot stored',
      data: result.screenshot,
    });
  },
];

export async function getStatus(req, res) {
  const status = await monitoringService.getDeviceStatus(req.params.id);
  if (!status) {
    return sendError(res, 'Device not found', 404);
  }
  return res.json({ success: true, data: { device: status } });
}

export async function listDevices(req, res) {
  const result = await monitoringService.listMonitoringDevicesForUser(req.user, req.query);
  return res.json({
    success: true,
    data: { devices: result.devices, count: result.count },
  });
}

export async function getDevice(req, res) {
  const result = await monitoringService.getMonitoringDeviceForUser(req.params.id, req.user);
  if (!result) return sendError(res, 'Device not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  return res.json({ success: true, data: { device: result.device } });
}

async function sendCommand(req, res, action) {
  const io = req.app.get('io');
  const result = await monitoringService.sendDeviceCommandForUser(
    req.user,
    req.params.id,
    action,
    req.body?.payload || null,
    io
  );

  if (!result) return sendError(res, 'Device not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  if (result.error) return sendError(res, result.error, 400);

  return res.json({
    success: true,
    message: `Command ${action} queued`,
    data: result,
  });
}

export const reboot = (req, res) => sendCommand(req, res, 'reboot');
export const restartGo2rtc = (req, res) => sendCommand(req, res, 'restart-go2rtc');
export const restartAgent = (req, res) => sendCommand(req, res, 'restart-agent');
export const update = (req, res) => sendCommand(req, res, 'update');
export const captureScreenshot = (req, res) => sendCommand(req, res, 'capture-screenshot');

export async function dashboard(req, res) {
  const data = await monitoringService.getMonitoringDashboard(req.user);
  return res.json({ success: true, data });
}

export async function listScreenshots(req, res) {
  const result = await monitoringService.listScreenshotsForUser(
    req.params.id,
    req.user,
    { limit: req.query.limit }
  );
  if (!result) return sendError(res, 'Device not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  return res.json({ success: true, data: result });
}

export async function getScreenshot(req, res) {
  const result = await monitoringService.getScreenshotForUser(req.params.screenshotId, req.user);
  if (!result) return sendError(res, 'Screenshot not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  if (result.expired) return sendError(res, 'Screenshot expired', 410);

  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${result.screenshot.id}.png"`);
  result.stream.on('error', () => {
    if (!res.headersSent) sendError(res, 'Screenshot file not found', 404);
  });
  result.stream.pipe(res);
}

function requestBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

export const streamFrameUpload = [
  upload.single('frame'),
  async (req, res) => {
    if (!rateLimitDevice(req, res, 'monitoring-stream-frame', STREAM_FRAME_RATE_LIMIT)) return;

    const deviceId = req.params.id || req.deviceAuth?.deviceId;
    const streamName = req.params.streamName;
    if (!deviceId || !streamName) {
      return sendError(res, 'deviceId and streamName are required', 400);
    }
    if (req.deviceAuth?.deviceId && req.deviceAuth.deviceId !== deviceId) {
      return sendError(res, 'Forbidden: deviceId mismatch', 403);
    }
    if (!req.file?.buffer?.length) {
      return sendError(res, 'frame file is required', 400);
    }

    const result = await monitoringService.storeStreamFrame({
      deviceId,
      streamName,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || 'image/jpeg',
    });

    if (!result.ok) {
      return sendError(res, result.message, 404);
    }

    return res.status(201).json({
      success: true,
      message: 'Stream frame stored',
      data: result,
    });
  },
];

export async function getStreamFrame(req, res) {
  const result = await monitoringService.getStreamFrameForUser(
    req.params.id,
    req.params.streamName,
    req.user
  );
  if (!result) return sendError(res, 'Device not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  if (result.notFound || !result.stream) return sendError(res, 'Stream frame not found', 404);

  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  result.stream.on('error', () => {
    if (!res.headersSent) sendError(res, 'Stream frame file not found', 404);
  });
  result.stream.pipe(res);
}

export async function getStreamLiveMjpeg(req, res) {
  const result = await monitoringService.streamLiveMjpegForUser(
    req.params.id,
    req.params.streamName,
    req.user,
    res
  );
  if (!result) return sendError(res, 'Device not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notAgent) return sendError(res, 'Not a Raspberry Pi monitoring device', 400);
  if (result.notFound) return sendError(res, 'Stream frame not found', 404);
}

export async function lobbyStreams(req, res) {
  const result = await monitoringService.getLobbyStreamsForUser(
    req.params.lobbyId,
    req.user,
    { baseUrl: requestBaseUrl(req) }
  );
  if (!result) return sendError(res, 'Lobby not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  return res.json({ success: true, data: result });
}

export async function divisionLobbyStreams(req, res) {
  const result = await monitoringService.getDivisionLobbyStreamsForUser(
    req.user,
    { baseUrl: requestBaseUrl(req) }
  );
  if (!result) return sendError(res, 'Division not found', 404);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  return res.json({ success: true, data: result });
}

export function viewer(req, res) {
  const baseUrl = requestBaseUrl(req);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bhavnagar Lobby Streams</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    header { padding: 16px 20px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    input, button { padding: 8px 12px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; }
    button { background: #2563eb; border-color: #2563eb; cursor: pointer; }
    main { padding: 20px; }
    .lobby { margin-bottom: 28px; }
    .lobby h2 { margin: 0 0 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; overflow: hidden; }
    .card img { width: 100%; aspect-ratio: 16/10; object-fit: cover; background: #000; display: block; }
    .meta { padding: 12px; display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
    .online { background: #14532d; color: #bbf7d0; }
    .offline { background: #7f1d1d; color: #fecaca; }
    #status { color: #94a3b8; font-size: 14px; }
    .empty { color: #94a3b8; padding: 24px; }
  </style>
</head>
<body>
  <header>
    <strong>Lobby Stream Monitor</strong>
    <input id="user" placeholder="user_id" value="bhavnagar_monitor" />
    <input id="pass" type="password" placeholder="password" value="ChangeMe@123" />
    <button id="loginBtn">Login</button>
    <button id="refreshBtn">Refresh</button>
    <span id="status">Not logged in</span>
  </header>
  <main id="content"><div class="empty">Login to load lobby streams from Pi.</div></main>
  <script>
    const API = ${JSON.stringify(baseUrl)};
    let token = localStorage.getItem('monitor_token') || '';

    async function login() {
      const user_id = document.getElementById('user').value.trim();
      const password = document.getElementById('pass').value;
      const res = await fetch(API + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Login failed');
      token = data.accessToken;
      localStorage.setItem('monitor_token', token);
      document.getElementById('status').textContent = 'Logged in as ' + user_id;
      await loadStreams();
    }

    function cardHtml(stream) {
      const cls = stream.online ? 'online' : 'offline';
      const liveUrl = stream.live_mjpeg_url
        ? stream.live_mjpeg_url + '?token=' + encodeURIComponent(token)
        : null;
      const img = liveUrl
        ? '<img src="' + liveUrl + '" alt="' + stream.label + '" />'
        : (stream.frame_url
          ? '<img data-frame-url="' + stream.frame_url + '" alt="' + stream.label + '" />'
          : '<div class="empty">No frame yet</div>');
      return '<div class="card">' + img +
        '<div class="meta"><div><strong>' + stream.label + '</strong><br><small>' + stream.name + '</small></div>' +
        '<span class="badge ' + cls + '">' + (stream.online ? 'online' : 'offline') + '</span></div></div>';
    }

    async function loadFrameImages() {
      const imgs = document.querySelectorAll('img[data-frame-url]');
      await Promise.all([...imgs].map(async (img) => {
        try {
          const res = await fetch(img.dataset.frameUrl + '?t=' + Date.now(), {
            headers: { Authorization: 'Bearer ' + token },
          });
          if (!res.ok) return;
          const blob = await res.blob();
          img.src = URL.createObjectURL(blob);
        } catch (_) {}
      }));
    }

    async function loadStreams() {
      if (!token) return;
      document.getElementById('status').textContent = 'Loading...';
      const res = await fetch(API + '/api/monitoring/lobby-streams', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load streams');
      const root = document.getElementById('content');
      const lobbies = data.data.lobbies || [];
      if (!lobbies.length) {
        root.innerHTML = '<div class="empty">No lobbies found for your division.</div>';
        return;
      }
      root.innerHTML = lobbies.map((lobby) => {
        const streams = lobby.streams || [];
        const grid = streams.length
          ? '<div class="grid">' + streams.map(cardHtml).join('') + '</div>'
          : '<div class="empty">No Pi streams in this lobby yet.</div>';
        return '<section class="lobby"><h2>' + lobby.lobby_name + ' (' + (lobby.summary?.online || 0) + '/' + (lobby.summary?.total || 0) + ' online)</h2>' + grid + '</section>';
      }).join('');
      document.getElementById('status').textContent = 'Updated ' + new Date().toLocaleTimeString();
      await loadFrameImages();
    }

    document.getElementById('loginBtn').onclick = () => login().catch((e) => alert(e.message));
    document.getElementById('refreshBtn').onclick = () => loadStreams().catch((e) => alert(e.message));
    if (token) loadStreams().catch(() => {});
    setInterval(() => { if (token) loadStreams().catch(() => {}); }, 30000);
  </script>
</body>
</html>`);
}
