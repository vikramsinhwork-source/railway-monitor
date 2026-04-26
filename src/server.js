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
import healthRoutes from './modules/health/health.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import { startDeviceHealthScheduler } from './services/deviceHealth.scheduler.js';

const app = express();
const server = createServer(app);

// CORS: default allow all origins. Set CORS_ORIGIN or CORS_ORIGINS (comma-separated) to restrict.
const allowedOrigins = (() => {
  const raw = process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '';
  if (!raw.trim() || raw.trim() === '*') return true; // default: allow any origin
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
})();
const corsAllowAll = allowedOrigins === true;
initModels();

async function initDB() {
  try {
    await sequelize.authenticate();
    logInfo('DB', 'Sequelize authenticated');
    await sequelize.sync({ alter: true });
    logInfo('DB', 'Sequelize synced');
    await seedAdmin();
    await seedRoleDutyTemplates();
  } catch (err) {
    logError('DB', 'Init failed', { error: err.message });
    throw err;
  }
}

// Only Express manages CORS; do not set Access-Control-* in Nginx or manually
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());

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
app.use('/api/forms', formsRoutes);
app.use('/api/divisions', divisionRoutes);
app.use('/api/lobbies', lobbyRoutes);
app.use('/api/devices', deviceRoutes);
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
    origin: corsAllowAll ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Use authentication middleware for all connections
  // This ensures only authenticated clients can connect
  allowEIO3: true
});

// Apply authentication middleware to Socket.IO
io.use(authenticateSocket);
logInfo('Server', 'Authentication middleware applied to Socket.IO');

// Initialize socket event handlers
initializeSocket(io);
startDeviceHealthScheduler(io);
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
    corsOrigin: allowedOrigins === true ? '*' : allowedOrigins.join(','),
    healthCheck: `http://localhost:${PORT}/health`,
    apiDocs: `http://localhost:${PORT}/api-docs`
  });
    });
  })
  .catch((err) => {
    logError('Server', 'Startup failed', { error: err.message });
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
