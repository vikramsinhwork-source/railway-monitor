import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import sequelize from './config/sequelize.js';
import { swaggerUiHandler, swaggerUiSetup } from './config/swagger.js';
import { authenticateSocket } from './auth/auth.middleware.js';
import { initializeSocket } from './socket/index.js';
import { seedAdmin } from './bootstrap/seedAdmin.js';
import { seedRoleDutyTemplates } from './bootstrap/seedRoleDutyTemplates.js';
import { logInfo, logWarn, logError } from './utils/logger.js';
import authRoutes from './auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import { initModels } from './models/index.js';
import formsRoutes from './modules/forms/forms.routes.js';
import divisionRoutes from './modules/divisions/division.route.js';
import lobbyRoutes from './modules/lobbies/lobby.route.js';
import deviceRoutes from './modules/devices/device.route.js';
import agentRoutes from './modules/agents/agent.route.js';
import monitoringRoutes from './modules/monitoring/monitoring.routes.js';
import streamRoutes from './modules/streams/stream.route.js';
import healthRoutes from './modules/health/health.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import { startDeviceHealthScheduler } from './services/deviceHealth.scheduler.js';
import { startStreamIdleCleanup } from './modules/streams/stream.service.js';
import { ensureCollection } from './services/rekognitionFace.js';
import faceRoutes from './modules/face/face.routes.js';

function formatDbInitError(err) {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof AggregateError && err.errors?.length) {
    const parts = err.errors.map((e) => e?.message || String(e)).filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  const chain = [err.message, err.parent?.message, err.original?.message].filter(
    (m) => typeof m === 'string' && m.trim()
  );
  if (chain.length) return [...new Set(chain)].join(' | ');
  if (err.name) return err.code ? `${err.name} (${err.code})` : err.name;
  return 'Unknown database error';
}

function assertDatabaseEnv() {
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER'];
  const missing = required.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `Database env not configured: missing or empty ${missing.join(', ')}. Copy .env.example to .env and set PostgreSQL variables.`
    );
  }
  if (process.env.DB_PASSWORD === undefined) {
    throw new Error(
      'Database env not configured: DB_PASSWORD is unset. Add DB_PASSWORD to .env (use DB_PASSWORD= for an empty password).'
    );
  }
}

const app = express();
const server = createServer(app);

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};
initModels();

async function initDB() {
  try {
    assertDatabaseEnv();
    await sequelize.authenticate();
    logInfo('DB', 'Sequelize authenticated');
    await ensureCollection();
    await sequelize.sync({ alter: true });
    logInfo('DB', 'Sequelize synced');
    await seedAdmin();
    await seedRoleDutyTemplates();
  } catch (err) {
    logError('DB', 'Init failed', { error: formatDbInitError(err) });
    throw err;
  }
}

// Only Express manages CORS; do not set Access-Control-* in Nginx or manually
app.use(cors(corsOptions));
app.options('*', cors());

app.use(express.json());

app.get('/webrtc-test', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>RailWatch WebRTC Test</title>
  <style>
    body { font-family: sans-serif; background: #111; color: #fff; padding: 20px; }
    video { width: 640px; height: 480px; background: #000; border: 2px solid #333; }
    button { padding: 10px 20px; margin: 5px; cursor: pointer; font-size: 16px; }
    #status { margin: 10px 0; padding: 10px; background: #222; border-radius: 4px; white-space: pre-wrap; font-family: monospace; font-size: 13px; }
    select { padding: 8px; font-size: 16px; margin: 5px; }
    #stats { margin-top: 12px; padding: 10px; background: #1a1a1a; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 280px; overflow: auto; }
  </style>
</head>
<body>
  <h2>🎥 RailWatch WebRTC Test</h2>
  <p style="color:#888;font-size:14px">Open DevTools console for full media diagnostics.</p>

  <div>
    <select id="camera">
      <option value="camera1">Camera 1</option>
      <option value="camera2">Camera 2</option>
      <option value="camera3">Camera 3</option>
      <option value="camera4">Camera 4</option>
      <option value="camera5">Camera 5</option>
    </select>
    <button onclick="connect()">▶ Connect</button>
    <button onclick="disconnect()">⏹ Disconnect</button>
  </div>

  <div id="status">Status: idle</div>
  <video id="video" autoplay playsinline muted></video>
  <div id="stats">Stats: (connect to start)</div>

  <script>
    const DEVICE_ID = 'b6ee0d2b-a66c-416f-b266-ad372f42ebae';
    const TEST_TOKEN = 'webrtc-test-token';
    let pc = null;
    let statsTimer = null;
    let lastStats = { bytesReceived: 0, framesDecoded: 0, currentTime: 0 };

    function setStatus(msg, color='#fff') {
      const el = document.getElementById('status');
      el.textContent = 'Status: ' + msg;
      el.style.color = color;
      console.log('[webrtc]', msg);
    }

    function setStats(msg) {
      document.getElementById('stats').textContent = msg;
    }

    function sdpCodecSummary(sdp) {
      if (!sdp) return '(no sdp)';
      const codecs = [];
      sdp.split(/\\r\\n|\\n/).forEach(function(line) {
        var m = line.match(/^a=rtpmap:(\\d+) (H264|VP8|VP9|AV1|H265|HEVC)/i);
        if (m) codecs.push(m[2] + '/' + m[1]);
        var f = line.match(/^a=fmtp:(\\d+) .*profile-level-id=([0-9a-fA-F]+)/);
        if (f) codecs.push('profile-level-id=' + f[2] + '@' + f[1]);
      });
      return codecs.length ? codecs.join(', ') : '(no video codecs parsed)';
    }

    function logVideoElementState(label) {
      var v = document.getElementById('video');
      console.log('[webrtc][video][' + label + ']', {
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        readyState: v.readyState,
        currentTime: v.currentTime,
        paused: v.paused,
        muted: v.muted,
        hasSrcObject: !!v.srcObject,
        trackCount: v.srcObject ? v.srcObject.getVideoTracks().length : 0,
      });
    }

    async function logReceiverCodecs() {
      if (!pc) return;
      try {
        var receivers = pc.getReceivers();
        for (var i = 0; i < receivers.length; i++) {
          var r = receivers[i];
          if (r.track && r.track.kind === 'video') {
            var params = r.getParameters ? r.getParameters() : null;
            console.log('[webrtc][receiver]', {
              trackId: r.track.id,
              readyState: r.track.readyState,
              muted: r.track.muted,
              codecs: params && params.codecs ? params.codecs : '(n/a)',
            });
          }
        }
      } catch (e) {
        console.warn('[webrtc] getReceivers failed', e);
      }
    }

    function startStatsLoop() {
      stopStatsLoop();
      statsTimer = setInterval(async function() {
        if (!pc) return;
        var v = document.getElementById('video');
        var lines = [];
        lines.push('ICE: ' + pc.iceConnectionState + ' | conn: ' + pc.connectionState);
        lines.push('video: ' + v.videoWidth + 'x' + v.videoHeight + ' readyState=' + v.readyState + ' t=' + v.currentTime.toFixed(2));

        var timeDelta = v.currentTime - lastStats.currentTime;
        var timeStuck = pc.iceConnectionState === 'connected' && timeDelta < 0.01;
        if (timeStuck) lines.push('⚠ currentTime not advancing — decoder may be stuck');

        try {
          var report = await pc.getStats();
          report.forEach(function(stat) {
            if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
              var bytesDelta = (stat.bytesReceived || 0) - lastStats.bytesReceived;
              var framesDelta = (stat.framesDecoded || 0) - lastStats.framesDecoded;
              lines.push('inbound-rtp: bytes=' + stat.bytesReceived + ' (+' + bytesDelta + '/2s)');
              lines.push('  framesDecoded=' + (stat.framesDecoded ?? 'n/a') + ' (+' + framesDelta + '/2s) dropped=' + (stat.framesDropped ?? 'n/a'));
              lines.push('  keyFrames=' + (stat.keyFramesDecoded ?? 'n/a') + ' jitter=' + (stat.jitter ?? 'n/a'));
              lines.push('  pli=' + (stat.pliCount ?? 'n/a') + ' fir=' + (stat.firCount ?? 'n/a') + ' nack=' + (stat.nackCount ?? 'n/a'));
              if (bytesDelta > 0 && framesDelta === 0) {
                lines.push('⚠ bytes increasing but framesDecoded flat → likely codec/bitstream issue');
              }
              if (bytesDelta === 0 && pc.iceConnectionState === 'connected') {
                lines.push('⚠ ICE connected but no RTP bytes — media path blocked');
              }
              if (framesDelta > 0 && (v.videoWidth === 0 || v.videoHeight === 0)) {
                lines.push('⚠ frames decoded but video element has no dimensions');
              }
              lastStats.bytesReceived = stat.bytesReceived || 0;
              lastStats.framesDecoded = stat.framesDecoded || 0;
            }
          });
        } catch (e) {
          lines.push('getStats error: ' + e.message);
        }

        lastStats.currentTime = v.currentTime;
        setStats(lines.join('\\n'));
        console.log('[webrtc][stats]', lines.join(' | '));
      }, 2000);
    }

    function stopStatsLoop() {
      if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
      lastStats = { bytesReceived: 0, framesDecoded: 0, currentTime: 0 };
    }

    async function connect() {
      disconnect();
      var camera = document.getElementById('camera').value;
      setStatus('Fetching ICE config...', '#ffd700');

      var iceRes = await fetch('/api/monitoring/ice-config');
      var iceData = await iceRes.json();
      var iceServers = iceData.data.ice_servers;
      setStatus('Creating peer connection...', '#ffd700');

      pc = new RTCPeerConnection({ iceServers: iceServers, sdpSemantics: 'unified-plan' });
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.oniceconnectionstatechange = function() {
        setStatus('ICE: ' + pc.iceConnectionState, pc.iceConnectionState === 'connected' ? '#00ff00' : '#ffd700');
        if (pc.iceConnectionState === 'connected') {
          logVideoElementState('ice-connected');
          logReceiverCodecs();
        }
      };

      pc.onconnectionstatechange = function() {
        console.log('[webrtc] connectionState:', pc.connectionState);
      };

      pc.ontrack = function(e) {
        console.log('[webrtc][ontrack]', {
          kind: e.track.kind,
          id: e.track.id,
          readyState: e.track.readyState,
          muted: e.track.muted,
          streamIds: e.streams.map(function(s) { return s.id; }),
        });
        e.track.onmute = function() { console.warn('[webrtc] track muted', e.track.id); };
        e.track.onunmute = function() { console.log('[webrtc] track unmuted', e.track.id); logVideoElementState('track-unmuted'); };
        var stream = e.streams[0] || new MediaStream([e.track]);
        document.getElementById('video').srcObject = stream;
        var v = document.getElementById('video');
        v.play().catch(function(err) { console.warn('[webrtc] video.play()', err); });
        setStatus('Track received (' + e.track.kind + '), waiting for decode...', '#ffd700');
        startStatsLoop();
      };

      setStatus('Creating offer...', '#ffd700');
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[webrtc] local offer codecs:', sdpCodecSummary(pc.localDescription.sdp));

      await new Promise(function(resolve) {
        if (pc.iceGatheringState === 'complete') return resolve();
        pc.onicegatheringstatechange = function() {
          if (pc.iceGatheringState === 'complete') resolve();
        };
        setTimeout(resolve, 5000);
      });

      setStatus('Sending offer to Pi via Railway (may take ~20s on cold start)...', '#ffd700');
      var offerRes = await fetch(
        '/api/monitoring/devices/' + DEVICE_ID + '/streams/' + camera + '/webrtc/offer',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + TEST_TOKEN
          },
          body: JSON.stringify({
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp
          })
        }
      );

      if (!offerRes.ok) {
        var errText = await offerRes.text();
        setStatus('❌ Offer failed: ' + offerRes.status + ' ' + errText.slice(0, 120), '#ff4444');
        return;
      }

      var answer = await offerRes.json();
      if (!answer.success || answer.data?.error) {
        setStatus('❌ Pi/go2rtc error: ' + (answer.data?.error || answer.message || 'unknown'), '#ff4444');
        return;
      }
      if (!answer.data?.sdp) {
        setStatus('❌ Empty SDP answer from Pi/go2rtc', '#ff4444');
        return;
      }

      console.log('[webrtc] remote answer type:', answer.data.type);
      console.log('[webrtc] remote answer preview:', answer.data.sdp.slice(0, 200));
      console.log('[webrtc] remote answer codecs:', sdpCodecSummary(answer.data.sdp));

      setStatus('Got answer, setRemoteDescription...', '#ffd700');
      await pc.setRemoteDescription({
        type: answer.data.type || 'answer',
        sdp: answer.data.sdp
      });
      logReceiverCodecs();
      setStatus('Waiting for video (check stats panel)...', '#ffd700');
    }

    function disconnect() {
      stopStatsLoop();
      if (pc) { pc.close(); pc = null; }
      document.getElementById('video').srcObject = null;
      setStats('Stats: (disconnected)');
      setStatus('Disconnected', '#888');
    }
  </script>
</body>
</html>`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  logInfo('Server', 'Health check requested', { ip: req.ip });
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'kiosk-monitor-signaling-server'
  });
});

// Swagger UI
app.use('/api-docs', swaggerUiHandler, swaggerUiSetup);
logInfo('Server', 'Swagger UI at /api-docs');

// Authentication API routes (application login + legacy)
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/face', faceRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/divisions', divisionRoutes);
app.use('/api/lobbies', lobbyRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/streams', streamRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/analytics', analyticsRoutes);
logInfo('Server', 'Auth and user routes registered', {
  auth: ['/api/auth/login', '/api/auth/signup', '/api/auth/device-token', '/api/auth/register', '/api/auth/users'],
  users: [
    '/api/users',
    '/api/users/me',
    '/api/users/me (PATCH)',
    '/api/users/me/avatar',
    '/api/users/me/face/status',
    '/api/users/me/face/enroll',
    '/api/face/recognize',
    '/api/users/:id',
    '/api/users/:id/avatar',
    '/api/users/:id/deactivate',
  ],
  forms: [
    '/api/forms/questions',
    '/api/forms/questions/:id',
    '/api/forms/today',
    '/api/forms/submissions/today',
    '/api/forms/submissions/me',
    '/api/forms/submissions/me/latest',
    '/api/forms/analytics/summary',
    '/api/forms/analytics/export/preview',
    '/api/forms/analytics/export',
    '/api/forms/analytics/users',
    '/api/forms/analytics/users/:userId/history',
  ],
  divisions: [
    '/api/divisions',
    '/api/divisions/:id',
  ],
  lobbies: [
    '/api/lobbies',
    '/api/lobbies/:id',
  ],
  devices: [
    '/api/devices',
    '/api/devices/:id',
  ],
  health: [
    '/api/health/summary',
    '/api/health/divisions',
    '/api/health/lobbies/:id',
    '/api/health/devices/:id/logs',
    '/api/health/devices/:id/recover',
  ],
  analytics: [
    '/api/analytics/summary',
    '/api/analytics/sla',
    '/api/analytics/divisions',
    '/api/analytics/lobbies/:id',
    '/api/analytics/devices/:id',
    '/api/analytics/incidents',
    '/api/analytics/autoheal',
  ],
});

/**
 * Socket.IO Configuration
 * 
 * Architecture Note: This backend is VIEW-ONLY and does NOT process
 * video streams. It only handles:
 * - WebRTC signaling (offer, answer, ice-candidate forwarding)
 * - Crew event broadcasting (sign-on/sign-off)
 * 
 * All video data flows directly between clients via WebRTC peer connections.
 * This server never touches video streams.
 */
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
  // Use authentication middleware for all connections
  // This ensures only authenticated clients can connect
  allowEIO3: true
});

// Apply authentication middleware to Socket.IO
io.use(authenticateSocket);
logInfo('Server', 'Authentication middleware applied to Socket.IO');

// Initialize socket event handlers
app.set('io', io);
initializeSocket(io);
startDeviceHealthScheduler(io);
startStreamIdleCleanup(io);
logInfo('Server', 'Socket event handlers initialized');

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║   KIOSK-MONITOR Signaling Server (Hardened)               ║
║   Port: ${PORT}                                                  ║
║                                                           ║
║   Architecture: VIEW-ONLY                                 ║
║   • WebRTC signaling only                                ║
║   • Crew event broadcasting                              ║
║   • NO video stream processing                           ║
║                                                           ║
║   Security Features:                                      ║
║   • Session ownership validation                         ║
║   • Explicit session lifecycle                           ║
║   • Standardized error handling                          ║
║   • Heartbeat / keep-alive                               ║
║   • Rate limiting                                        ║
║   • Clean disconnect handling                            ║
╚═══════════════════════════════════════════════════════════╝
  `);
  logInfo('Server', 'Server started successfully', {
    port: PORT,
    corsOrigin: corsOptions.origin,
    healthCheck: `http://localhost:${PORT}/health`,
    apiDocs: `http://localhost:${PORT}/api-docs`
  });
    });
  })
  .catch((err) => {
    logError('Server', 'Startup failed', { error: formatDbInitError(err) });
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  logInfo('Server', 'SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logInfo('Server', 'Server closed successfully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logInfo('Server', 'SIGINT received, shutting down gracefully...');
  server.close(() => {
    logInfo('Server', 'Server closed successfully');
    process.exit(0);
  });
});

// Log unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  logError('Server', 'Unhandled promise rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logError('Server', 'Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});
