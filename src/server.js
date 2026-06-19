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
    #status { margin: 10px 0; padding: 10px; background: #222; border-radius: 4px; }
    select { padding: 8px; font-size: 16px; margin: 5px; }
  </style>
</head>
<body>
  <h2>🎥 RailWatch WebRTC Test</h2>
  
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

  <script>
    const DEVICE_ID = 'b6ee0d2b-a66c-416f-b266-ad372f42ebae';
    const TEST_TOKEN = 'webrtc-test-token';
    let pc = null;

    function setStatus(msg, color='#fff') {
      const el = document.getElementById('status');
      el.textContent = 'Status: ' + msg;
      el.style.color = color;
      console.log('[webrtc]', msg);
    }

    async function connect() {
      disconnect();
      const camera = document.getElementById('camera').value;
      setStatus('Fetching ICE config...', '#ffd700');

      // Step 1: Get ICE/TURN config
      const iceRes = await fetch('/api/monitoring/ice-config');
      const iceData = await iceRes.json();
      const iceServers = iceData.data.ice_servers;
      setStatus('Creating peer connection...', '#ffd700');

      // Step 2: Create WebRTC peer connection
      pc = new RTCPeerConnection({ iceServers, sdpSemantics: 'unified-plan' });
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.oniceconnectionstatechange = () => {
        setStatus('ICE: ' + pc.iceConnectionState,
          pc.iceConnectionState === 'connected' ? '#00ff00' : '#ffd700');
      };

      pc.ontrack = (e) => {
        setStatus('✅ Video connected!', '#00ff00');
        document.getElementById('video').srcObject = e.streams[0];
      };

      // Step 3: Create offer
      setStatus('Creating offer...', '#ffd700');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering
      await new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') return resolve();
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') resolve();
        };
        setTimeout(resolve, 3000);
      });

      // Step 4: Send offer to Railway → Pi → go2rtc
      setStatus('Sending offer to Pi via Railway...', '#ffd700');
      const offerRes = await fetch(
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
        setStatus('❌ Offer failed: ' + offerRes.status, '#ff4444');
        return;
      }

      const answer = await offerRes.json();
      if (!answer.success || answer.data?.error) {
        setStatus('❌ Pi/go2rtc error: ' + (answer.data?.error || answer.message || 'unknown'), '#ff4444');
        return;
      }
      if (!answer.data?.sdp) {
        setStatus('❌ Empty SDP answer from Pi/go2rtc', '#ff4444');
        return;
      }
      setStatus('Got answer, connecting...', '#ffd700');

      // Step 5: Set answer
      await pc.setRemoteDescription({
        type: answer.data.type,
        sdp: answer.data.sdp
      });

      setStatus('Waiting for video...', '#ffd700');
    }

    function disconnect() {
      if (pc) { pc.close(); pc = null; }
      document.getElementById('video').srcObject = null;
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
