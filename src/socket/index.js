/**
 * Socket.IO Event Handlers
 * 
 * Hardened, production-ready Socket.IO event handling with:
 * - Centralized state management
 * - Explicit session lifecycle
 * - WebRTC signaling validation
 * - Standardized error handling
 * - Rate limiting
 * - Heartbeat/keep-alive
 * - Clean disconnect handling
 * 
 * Architecture Note: This backend is VIEW-ONLY and does NOT process
 * video streams. It only forwards WebRTC signaling messages between
 * clients and broadcasts crew events to MONITOR clients.
 */

import {
  ROLES
} from '../auth/auth.middleware.js';
import {
  broadcastCrewSignOn,
  broadcastCrewSignOff,
  validateCrewEventPayload
} from '../events/crew.events.js';
import {
  emitError,
  validateOrError,
  ERROR_CODES
} from '../errors/socket.error.js';
import * as kiosksState from '../state/kiosks.state.js';
import * as monitorsState from '../state/monitors.state.js';
import * as sessionsState from '../state/sessions.state.js';
import * as userSessionsState from '../state/user-sessions.state.js';
import {
  checkRateLimit,
  resetAllRateLimits
} from '../utils/rate.limiter.js';
import {
  processHeartbeatPing,
  removeHeartbeat,
  startHeartbeatChecker
} from '../utils/heartbeat.js';
import {
  buildPresenceRole,
  cacheDisconnectForReconnect,
  claimNextDeviceCommand,
  completeDeviceCommand,
  enqueueDeviceCommand,
  endMonitoringSession,
  endSessionsByMonitorUser,
  getRealtimeConfig,
  getRealtimeMetrics,
  markSocketPresenceOffline,
  startMonitoringSession,
  startRealtimePresenceChecker,
  touchSocketHeartbeat,
  tryRestoreRecentSessions,
  upsertSocketPresence,
} from './realtime.manager.js';
import {
  logInfo,
  logWarn,
  logError,
  logDebug
} from '../utils/logger.js';

/**
 * In-memory session/call state is keyed by device UUID (Phase 4) or legacy kiosk id.
 * App JWT kiosk sockets use `user_id` as clientId but register under payload.deviceId.
 */
function resolveMonitoringTargetId(data, role, clientId, socketId) {
  const fromPayload = data?.kioskId ?? data?.deviceId;
  if (role === ROLES.MONITOR) return fromPayload ?? null;
  return fromPayload ?? kiosksState.getKioskBySocketId(socketId)?.kioskId ?? clientId;
}

function kioskSocketOwnsSession(session, socketId) {
  if (!session?.kioskId) return false;
  return kiosksState.getKiosk(session.kioskId)?.socketId === socketId;
}

function resolveWebRtcSessionKioskId(data, senderRole, clientId, targetId, socketId) {
  if (senderRole === ROLES.KIOSK) {
    return data?.kioskId ?? data?.deviceId ?? kiosksState.getKioskBySocketId(socketId)?.kioskId ?? clientId;
  }
  return data?.kioskId ?? data?.deviceId ?? targetId;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Initialize Socket.IO connection handling
 * 
 * @param {Object} io - Socket.IO server instance
 */
export const initializeSocket = (io) => {
  // Global error handler for unhandled errors
  // This ensures all errors are logged and don't crash the server
  process.on('unhandledRejection', (reason, promise) => {
    logError('Server', 'Unhandled promise rejection', {
      reason: reason?.message || String(reason),
      stack: reason?.stack,
      promise: String(promise)
    });
  });

  process.on('uncaughtException', (error) => {
    logError('Server', 'Uncaught exception', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    // Don't exit - let the server continue running
  });

  // Start periodic heartbeat timeout checking
  startHeartbeatChecker(io);
  startRealtimePresenceChecker(io);

  // Session timeout disabled: monitoring sessions stay active until admin stops,
  // kiosk goes offline, or monitor/kiosk disconnects. No automatic idle timeout.
  logInfo('Session', 'Session timeout disabled - sessions stay active until explicit stop or disconnect');

  io.on('connection', (socket) => {
    const {
      role,
      clientId,
      userId,
      user: appUser
    } = socket.data;

    /** Only KIOSK can share; if app JWT, must be USER role (ADMIN must not share). Legacy token has no appUser. */
    const canKioskShare = () => {
      if (role !== ROLES.KIOSK) return false;
      if (!appUser) return true;
      return appUser.role === 'USER';
    };

    // Handle duplicate login: if user already has active session, disconnect old one
    // NOTE: Multiple MONITOR connections are allowed (multiple admins can monitor simultaneously)
    // Only KIOSK/USER connections enforce single session
    if (userId && appUser && role === ROLES.KIOSK) {
      const previousSocketId = userSessionsState.registerUserSession(userId, socket.id);
      
      if (previousSocketId && previousSocketId !== socket.id) {
        const previousSocket = io.sockets.sockets.get(previousSocketId);
        if (previousSocket) {
          logInfo('Socket', 'Disconnecting previous session due to new login', {
            userId,
            previousSocketId,
            newSocketId: socket.id,
            clientId
          });
          
          // Notify old socket that it's being logged out
          previousSocket.emit('forced-logout', {
            reason: 'duplicate-login',
            message: 'You have been logged out because you logged in from another device/session',
            timestamp: new Date().toISOString()
          });
          
          // Transfer kiosk to new socket instead of removing (so kiosk stays "online" for monitors)
          const transferred = kiosksState.updateKioskSocketId(clientId, socket.id);
          if (transferred) {
            logInfo('Socket', 'Kiosk transferred to new socket (duplicate login)', {
              clientId,
              newSocketId: socket.id,
              previousSocketId
            });
            // Do NOT emit kiosk-offline - kiosk is still online, just with new socket
          } else {
            // Kiosk was not in state (e.g. old socket had not registered yet); new socket will register
            kiosksState.removeKiosk(clientId);
          }
          
          // Disconnect old socket (its disconnect handler will skip kiosk removal if socketId was transferred)
          previousSocket.disconnect(true);
        }
      }
    }
    // MONITOR role: Skip duplicate login handling - allow multiple monitor connections
    // Monitors are tracked by socket.id in monitorsState, so multiple connections are supported

    logInfo('Socket', 'Client connected', {
      clientId,
      role,
      socketId: socket.id,
      transport: socket.conn.transport.name,
      userId: userId || 'none'
    });

    // Join role-specific room for targeted broadcasts
    if (role === ROLES.MONITOR) {
      socket.join('monitors');
      logInfo('Socket', 'Monitor joined monitors room', {
        clientId,
        socketId: socket.id
      });
    } else if (role === ROLES.KIOSK) {
      socket.join('kiosks');
      logInfo('Socket', 'Kiosk joined kiosks room', {
        clientId,
        socketId: socket.id
      });
    }

    /**
     * Register KIOSK client
     * Emits kiosk-online event to all MONITOR clients
     */
    socket.on('register-kiosk', async (payload = {}) => {
      logInfo('Socket', 'Register kiosk request received', {
        clientId,
        socketId: socket.id,
        payload
      });

      // Guard: Only KIOSK role can register as kiosk
      if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE,
          'Unauthorized: Only KIOSK clients can register as kiosk')) {
        logWarn('Socket', 'Register kiosk failed: Invalid role', { clientId, role });
        return;
      }
      // Guard: App USER must be logged in to share; ADMIN must not share
      if (!validateOrError(socket, canKioskShare(), ERROR_CODES.AUTH_INVALID_ROLE,
          'Unauthorized: Only logged-in USER can register as kiosk')) {
        logWarn('Socket', 'Register kiosk failed: Not allowed for this role', { clientId });
        return;
      }

      try {
        const kioskId = payload.deviceId || payload.kioskId || clientId;
        const kioskUserId = appUser ? appUser.userId : null;
        const kioskName = appUser?.name ?? null;
        const kioskData = kiosksState.registerKiosk(kioskId, socket.id, kioskUserId, kioskName);
        socket.join(`device:${kioskId}`);

        if (appUser?.userId) {
          await upsertSocketPresence({
            userId: appUser.userId,
            socketId: socket.id,
            role: buildPresenceRole({
              socketRole: role,
              appRole: appUser?.role,
            }),
            divisionId: appUser?.division_id || null,
            lobbyId: payload.lobby_id || null,
          });
        }

        // Notify all monitors that this kiosk is online (include name for admin UI)
        io.to('monitors').emit('kiosk-online', {
          kioskId,
          name: kioskData.name ?? kioskId,
          timestamp: new Date().toISOString()
        });
        io.to('monitors').emit('device-online', {
          deviceId: kioskId,
          timestamp: new Date().toISOString(),
        });

        socket.emit('kiosk-registered', {
          kioskId,
          name: kioskData.name ?? kioskId,
          timestamp: new Date().toISOString()
        });

        logInfo('Socket', 'Kiosk registered successfully', {
          clientId: kioskId,
          socketId: socket.id,
          registeredAt: kioskData.registeredAt
        });
      } catch (error) {
        logError('Socket', 'Failed to register kiosk', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to register kiosk', {
          error: error.message,
          operation: 'register-kiosk'
        });
      }
    });

    /**
     * Register MONITOR client
     */
    socket.on('register-monitor', async (payload = {}) => {
      logInfo('Socket', 'Register monitor request received', {
        clientId,
        socketId: socket.id,
        payload
      });

      // Guard: Only MONITOR role can register as monitor
      if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.AUTH_INVALID_ROLE,
          'Unauthorized: Only MONITOR clients can register as monitor')) {
        logWarn('Socket', 'Register monitor failed: Invalid role', {
          clientId,
          role
        });
        return;
      }

      try {
        // Register monitor in state
        // Use socket.id as unique identifier to support multiple monitors with same credentials
        const monitorData = monitorsState.registerMonitor(`${clientId}_${socket.id}`, socket.id);
        if (appUser?.userId) {
          await upsertSocketPresence({
            userId: appUser.userId,
            socketId: socket.id,
            role: buildPresenceRole({
              socketRole: role,
              appRole: appUser?.role,
            }),
            divisionId: appUser?.division_id || null,
            lobbyId: payload.lobby_id || null,
          });
        }

        const restoredSessions = appUser
          ? await tryRestoreRecentSessions({
            user: appUser,
            socket,
            clientId,
            io,
          })
          : [];

        // Send list of online kiosks (include name for admin UI; fallback to kioskId for legacy)
        const onlineKiosks = kiosksState.getAllKiosks()
          .filter(kiosk => kiosk.status === 'online')
          .map(kiosk => ({
            kioskId: kiosk.kioskId,
            name: kiosk.name ?? kiosk.kioskId,
            connectedAt: kiosk.registeredAt.toISOString()
          }));

        socket.emit('monitor-registered', {
          monitorId: clientId, // Return clientId for compatibility, but store with socket.id
          onlineKiosks,
          restoredSessions: restoredSessions.map((s) => ({
            sessionId: s.id,
            deviceId: s.device_id,
            status: s.status,
          })),
          timestamp: new Date().toISOString()
        });

        logInfo('Socket', 'Monitor registered successfully', {
          clientId,
          socketId: socket.id,
          registeredAt: monitorData.registeredAt,
          onlineKiosksCount: onlineKiosks.length
        });
      } catch (error) {
        logError('Socket', 'Failed to register monitor', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to register monitor', {
          error: error.message,
          operation: 'register-monitor'
        });
      }
    });

    /**
     * Start Monitoring Session
     * Only MONITOR can start monitoring
     * Only one MONITOR per KIOSK at a time
     */
    socket.on('start-monitoring', (data) => {
      const {
        kioskId
      } = data || {};
      const deviceId = data?.deviceId || kioskId;

      logInfo('Session', 'Start monitoring request received', {
        monitorId: clientId,
        kioskId: deviceId,
        socketId: socket.id
      });

      if (appUser?.userId) {
        (async () => {
        // Guard: Only MONITOR role can start monitoring
        if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
            'Unauthorized: Only MONITOR clients can start monitoring')) {
          logWarn('Session', 'Start monitoring failed: Invalid role', {
            clientId,
            role,
            deviceId
          });
          return;
        }

        if (!validateOrError(socket, deviceId, ERROR_CODES.INVALID_REQUEST,
            'Invalid request: deviceId (or kioskId) is required')) {
          return;
        }

        try {
          if (!isUuid(deviceId)) {
            const kioskOnline = kiosksState.isKioskOnline(deviceId);
            if (!validateOrError(socket, kioskOnline, ERROR_CODES.SESSION_KIOSK_OFFLINE,
                `Kiosk ${deviceId} is not online`)) {
              return;
            }
            if (sessionsState.hasActiveSession(deviceId)) {
              const existingSession = sessionsState.getSession(deviceId);
              if (existingSession.monitorSocketId !== socket.id) {
                emitError(socket, ERROR_CODES.SESSION_ALREADY_EXISTS,
                  `Kiosk ${deviceId} is already being monitored by another monitor`, {
                    existingMonitorId: existingSession.monitorId,
                  });
                return;
              }
              sessionsState.updateSessionActivity(deviceId);
            } else {
              const kiosk = kiosksState.getKiosk(deviceId);
              const kioskUserId = kiosk?.userId ?? null;
              sessionsState.createSession(deviceId, clientId, socket.id, kioskUserId);
            }
            socket.emit('monitoring-started', {
              kioskId: deviceId,
              deviceId,
              sessionId: deviceId,
              timestamp: new Date().toISOString(),
              compatibilityMode: 'legacy-non-uuid',
            });
            io.to('monitors').emit('session-status', {
              deviceId,
              status: 'ACTIVE',
              sessionId: deviceId,
              compatibilityMode: 'legacy-non-uuid',
              timestamp: new Date().toISOString(),
            });
            return;
          }

          const result = await startMonitoringSession({
            deviceId,
            monitorUserId: userId,
            monitorSocketId: socket.id,
            monitorClientId: clientId,
            user: appUser || { userId, role: 'MONITOR', division_id: null },
          });

          if (!result.ok) {
            emitError(socket, result.code, result.message);
            return;
          }

          sessionsState.updateSessionActivity(deviceId);
          socket.emit('monitoring-started', {
            kioskId: deviceId,
            deviceId,
            sessionId: result.dbSession.id,
            startedAt: result.dbSession.started_at,
            timestamp: new Date().toISOString(),
          });
          io.to('monitors').emit('session-status', {
            deviceId,
            status: 'ACTIVE',
            sessionId: result.dbSession.id,
            timestamp: new Date().toISOString(),
          });
          io.to('monitors').emit('device-online', {
            deviceId,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logError('Session', 'Phase 4 start-monitoring failed', {
            clientId,
            deviceId,
            error: error.message,
          });
          emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to start monitoring session', {
            operation: 'start-monitoring',
            deviceId,
          });
        }
        })();
        return;
      }

      // Guard: Only MONITOR role can start monitoring
      if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
          'Unauthorized: Only MONITOR clients can start monitoring')) {
        logWarn('Session', 'Start monitoring failed: Invalid role', {
          clientId,
          role,
          kioskId
        });
        return;
      }

      // Guard: kioskId is required
      if (!validateOrError(socket, kioskId, ERROR_CODES.INVALID_REQUEST,
          'Invalid request: kioskId is required')) {
        logWarn('Session', 'Start monitoring failed: Missing kioskId', {
          clientId
        });
        return;
      }

      // Guard: Kiosk must be registered and online
      if (!validateOrError(socket, kiosksState.isKioskOnline(kioskId), ERROR_CODES.SESSION_KIOSK_OFFLINE,
          `Kiosk ${kioskId} is not online`)) {
        logWarn('Session', 'Start monitoring failed: Kiosk offline', {
          clientId,
          kioskId
        });
        return;
      }

      // Guard: Check if session already exists for this kiosk
      if (sessionsState.hasActiveSession(kioskId)) {
        const existingSession = sessionsState.getSession(kioskId);
        // Only allow if this monitor already owns the session
        if (existingSession.monitorSocketId !== socket.id) {
          logWarn('Session', 'Start monitoring failed: Session already exists', {
            clientId,
            kioskId,
            existingMonitorId: existingSession.monitorId
          });
          emitError(socket, ERROR_CODES.SESSION_ALREADY_EXISTS,
            `Kiosk ${kioskId} is already being monitored by another monitor`, {
              existingMonitorId: existingSession.monitorId
            });
          return;
        }
        // If monitor already owns session, just update activity
        sessionsState.updateSessionActivity(kioskId);
        socket.emit('monitoring-started', {
          kioskId,
          sessionId: kioskId, // Using kioskId as session identifier
          timestamp: new Date().toISOString()
        });
        logInfo('Session', 'Monitoring session activity updated', {
          monitorId: clientId,
          kioskId
        });
        return;
      }

      try {
        const kiosk = kiosksState.getKiosk(kioskId);
        const kioskUserId = kiosk?.userId ?? null;
        const session = sessionsState.createSession(kioskId, clientId, socket.id, kioskUserId);

        socket.emit('monitoring-started', {
          kioskId,
          sessionId: kioskId,
          startedAt: session.startedAt.toISOString(),
          timestamp: new Date().toISOString()
        });

        logInfo('Session', 'Monitoring session started', {
          monitorId: clientId,
          kioskId,
          sessionId: kioskId,
          startedAt: session.startedAt
        });
      } catch (error) {
        logError('Session', 'Failed to start monitoring session', {
          monitorId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          kioskId,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.SESSION_NOT_AUTHORIZED, error.message, {
          operation: 'start-monitoring',
          kioskId
        });
      }
    });

    /**
     * Stop Monitoring Session
     * Only MONITOR can stop monitoring
     * Only the monitor that owns the session can stop it
     */
    socket.on('stop-monitoring', (data) => {
      const {
        kioskId
      } = data || {};
      const deviceId = data?.deviceId || kioskId;

      logInfo('Session', 'Stop monitoring request received', {
        monitorId: clientId,
        kioskId: deviceId,
        socketId: socket.id
      });

      if (appUser?.userId) {
        (async () => {
        if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
            'Unauthorized: Only MONITOR clients can stop monitoring')) {
          return;
        }
        if (!validateOrError(socket, deviceId, ERROR_CODES.INVALID_REQUEST,
            'Invalid request: deviceId (or kioskId) is required')) {
          return;
        }

        const session = sessionsState.getSession(deviceId);
        if (!validateOrError(socket, session, ERROR_CODES.SESSION_NOT_FOUND,
            `No active session found for device ${deviceId}`)) {
          return;
        }
        if (!validateOrError(socket, session.monitorSocketId === socket.id, ERROR_CODES.SESSION_NOT_AUTHORIZED,
            'Unauthorized: You do not own this monitoring session')) {
          return;
        }

        try {
          const ended = await endMonitoringSession({
            deviceId,
            actorUserId: userId,
            status: 'ENDED',
            disconnectReason: 'monitor-stop',
          });
          if (!ended.ok) {
            emitError(socket, ended.code, ended.message);
            return;
          }

          socket.emit('monitoring-stopped', {
            kioskId: deviceId,
            deviceId,
            timestamp: new Date().toISOString(),
          });
          io.to('monitors').emit('session-status', {
            deviceId,
            status: 'ENDED',
            reason: 'monitor-stop',
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logError('Session', 'Phase 4 stop-monitoring failed', {
            clientId,
            deviceId,
            error: error.message,
          });
          emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to stop monitoring', {
            operation: 'stop-monitoring',
            deviceId,
          });
        }
        })();
        return;
      }

      // Guard: Only MONITOR role can stop monitoring
      if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
          'Unauthorized: Only MONITOR clients can stop monitoring')) {
        logWarn('Session', 'Stop monitoring failed: Invalid role', {
          clientId,
          role,
          kioskId
        });
        return;
      }

      // Guard: kioskId is required
      if (!validateOrError(socket, kioskId, ERROR_CODES.INVALID_REQUEST,
          'Invalid request: kioskId is required')) {
        logWarn('Session', 'Stop monitoring failed: Missing kioskId', {
          clientId
        });
        return;
      }

      // Guard: Session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId), ERROR_CODES.SESSION_NOT_FOUND,
          `No active session found for kiosk ${kioskId}`)) {
        logWarn('Session', 'Stop monitoring failed: Session not found', {
          clientId,
          kioskId
        });
        return;
      }

      // Guard: Monitor must own the session
      if (!validateOrError(socket, sessionsState.validateSessionOwnership(kioskId, socket.id),
          ERROR_CODES.SESSION_NOT_AUTHORIZED,
          'Unauthorized: You do not own this monitoring session')) {
        logWarn('Session', 'Stop monitoring failed: Session ownership invalid', {
          clientId,
          kioskId,
          socketId: socket.id
        });
        return;
      }

      try {
        // End session
        const endedSession = sessionsState.endSession(kioskId);

        socket.emit('monitoring-stopped', {
          kioskId,
          timestamp: new Date().toISOString()
        });

        logInfo('Session', 'Monitoring session stopped', {
          monitorId: clientId,
          kioskId,
          startedAt: endedSession.startedAt,
          endedAt: endedSession.endedAt
        });
      } catch (error) {
        logError('Session', 'Failed to stop monitoring session', {
          monitorId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          kioskId,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to stop monitoring', {
          error: error.message,
          operation: 'stop-monitoring',
          kioskId
        });
      }
    });

    /**
     * Force Stop Monitoring Session
     * Allowed roles: SUPER_ADMIN, DIVISION_ADMIN (app roles mapped to socket MONITOR)
     */
    socket.on('force-stop-monitoring', (data) => {
      const deviceId = data?.deviceId || data?.kioskId;

      (async () => {
        if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
            'Unauthorized: Only monitor-class roles can force stop')) {
          return;
        }
        if (!validateOrError(socket, deviceId, ERROR_CODES.INVALID_REQUEST,
            'Invalid request: deviceId (or kioskId) is required')) {
          return;
        }
        if (!validateOrError(socket, appUser && (appUser.role === 'SUPER_ADMIN' || appUser.role === 'DIVISION_ADMIN'),
            ERROR_CODES.SESSION_NOT_AUTHORIZED, 'Only SUPER_ADMIN or DIVISION_ADMIN can force stop')) {
          return;
        }

        try {
          const ended = await endMonitoringSession({
            deviceId,
            actorUserId: userId,
            status: 'FORCED',
            disconnectReason: 'force-stop-monitoring',
            force: true,
          });
          if (!ended.ok) {
            emitError(socket, ended.code, ended.message);
            return;
          }

          io.to('monitors').emit('session-status', {
            deviceId,
            status: 'FORCED',
            reason: 'force-stop-monitoring',
            timestamp: new Date().toISOString(),
          });
          socket.emit('monitoring-stopped', {
            deviceId,
            kioskId: deviceId,
            forced: true,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logError('Session', 'Force stop monitoring failed', {
            clientId,
            userId,
            deviceId,
            error: error.message,
          });
          emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to force stop monitoring', {
            operation: 'force-stop-monitoring',
            deviceId,
          });
        }
      })();
    });

    socket.on('session-status', (data) => {
      const deviceId = data?.deviceId || data?.kioskId;
      if (!deviceId) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, 'deviceId (or kioskId) is required');
        return;
      }
      const active = sessionsState.getSession(deviceId);
      socket.emit('session-status', {
        deviceId,
        status: active ? 'ACTIVE' : 'ENDED',
        session: active || null,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('enqueue-device-command', (data) => {
      const deviceId = data?.deviceId || data?.kioskId;
      const command = data?.command;
      const payload = data?.payload || null;

      (async () => {
        if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
            'Only monitor-class roles can enqueue commands')) {
          return;
        }
        if (!validateOrError(socket, deviceId && command, ERROR_CODES.INVALID_REQUEST,
            'deviceId and command are required')) {
          return;
        }

        const result = await enqueueDeviceCommand({
          deviceId,
          command,
          payload,
          requestedBy: userId || null,
        });
        if (!result.ok) {
          emitError(socket, result.code, result.message, { deviceId, command });
          return;
        }
        socket.emit('device-command-queued', {
          queueId: result.command.id,
          deviceId,
          command: result.command.command,
          status: result.command.status,
          timestamp: new Date().toISOString(),
        });
        io.to(`device:${deviceId}`).emit('device-command-available', {
          deviceId,
          queueId: result.command.id,
          command: result.command.command,
          timestamp: new Date().toISOString(),
        });
      })();
    });

    socket.on('fetch-device-command', (data) => {
      const deviceId = data?.deviceId || data?.kioskId || clientId;
      (async () => {
        if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.OPERATION_NOT_ALLOWED,
            'Only kiosk clients can fetch commands')) {
          return;
        }
        if (!validateOrError(socket, deviceId, ERROR_CODES.INVALID_REQUEST,
            'deviceId is required')) {
          return;
        }
        const command = await claimNextDeviceCommand(deviceId);
        socket.emit('device-command', {
          deviceId,
          command: command ? {
            queueId: command.id,
            command: command.command,
            payload: command.payload,
            requestedAt: command.requested_at,
          } : null,
          timestamp: new Date().toISOString(),
        });
      })();
    });

    socket.on('complete-device-command', (data) => {
      const queueId = data?.queueId;
      const success = !!data?.success;
      const errorMessage = data?.errorMessage || null;
      const deviceId = data?.deviceId || data?.kioskId || null;

      (async () => {
        if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.OPERATION_NOT_ALLOWED,
            'Only kiosk clients can complete commands')) {
          return;
        }
        if (!validateOrError(socket, queueId, ERROR_CODES.INVALID_REQUEST,
            'queueId is required')) {
          return;
        }
        const completed = await completeDeviceCommand({
          commandId: queueId,
          success,
          errorMessage,
        });
        if (!completed) {
          emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, 'Command queue item not found', { queueId });
          return;
        }
        io.to('monitors').emit('device-command-status', {
          queueId: completed.id,
          deviceId: deviceId || completed.device_id,
          status: completed.status,
          errorMessage: completed.error_message || null,
          timestamp: new Date().toISOString(),
        });
      })();
    });

    socket.on('realtime-metrics', () => {
      socket.emit('realtime-metrics', {
        metrics: getRealtimeMetrics(),
        config: getRealtimeConfig(),
        timestamp: new Date().toISOString(),
      });
    });

    /**
     * WebRTC Signaling: Forward offer
     * 
     * Validates:
     * - Both sender and receiver are registered
     * - An active session exists
     * - Sender belongs to the session
     * - KIOSK ↔ MONITOR pairing is correct
     */
    socket.on('offer', (data) => {
      const {
        targetId,
        offer
      } = data || {};

      logDebug('WebRTC', 'Offer received', {
        fromId: clientId,
        targetId,
        role
      });

      // Guard: Required fields
      if (!validateOrError(socket, targetId && offer, ERROR_CODES.SIGNALING_MISSING_DATA,
          'Invalid offer: targetId and offer are required')) {
        logError('WebRTC', 'Offer failed: Missing required fields', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          targetId: !!targetId,
          offer: !!offer
        });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'offer');
      if (!rateLimit.allowed) {
        logWarn('WebRTC', 'Offer rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
          `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} offers per minute`, {
            resetAt: rateLimit.resetAt.toISOString()
          });
        return;
      }

      // Determine sender and receiver roles
      const senderRole = role;
      
      // Determine kioskId for session validation
      const kioskId = resolveWebRtcSessionKioskId(data, senderRole, clientId, targetId, socket.id);
      
      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${kioskId}`)) {
        return;
      }
      
      // Get session to find the correct monitor/kiosk socket
      const session = sessionsState.getSession(kioskId);
      
      // Determine target socket based on sender role
      let targetSocketId;
      let targetRole;
      
      if (senderRole === ROLES.KIOSK) {
        // Kiosk sending to Monitor - use monitorSocketId from session
        targetSocketId = session.monitorSocketId;
        targetRole = ROLES.MONITOR;
        
        // Guard: Validate kiosk owns the session
        if (!validateOrError(socket, kioskSocketOwnsSession(session, socket.id),
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      } else {
        // Monitor sending to Kiosk - use kiosk socketId
        const targetKiosk = kiosksState.getKiosk(targetId);
        if (!targetKiosk) {
          logError('WebRTC', 'Target kiosk not found for signaling', {
            clientId: clientId || 'unknown',
            userId: userId || null,
            role: role || 'unknown',
            socketId: socket.id,
            targetId,
            kioskId
          });
          emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target kiosk not found: ${targetId}`, {
            targetId,
            kioskId
          });
          return;
        }
        targetSocketId = targetKiosk.socketId;
        targetRole = ROLES.KIOSK;
        
        // Guard: Validate monitor owns the session
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: You do not own the monitoring session for this kiosk')) {
          return;
        }
      }

      // Guard: Must be KIOSK ↔ MONITOR pairing
      if (!validateOrError(socket,
          (senderRole === ROLES.KIOSK && targetRole === ROLES.MONITOR) ||
          (senderRole === ROLES.MONITOR && targetRole === ROLES.KIOSK),
          ERROR_CODES.SIGNALING_INVALID_PAIRING,
          'Invalid pairing: Offers can only be sent between KIOSK and MONITOR')) {
        return;
      }

      // Update session activity
      sessionsState.updateSessionActivity(kioskId);

      // Forward offer to target client
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('offer', {
          fromId: clientId,
          offer
        });
        logInfo('WebRTC', 'Offer forwarded successfully', {
          fromId: clientId,
          toId: targetId,
          kioskId,
          targetSocketId,
          senderRole,
          targetRole
        });
      } else {
        logError('WebRTC', 'Offer failed: Target socket not found', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          targetId,
          targetSocketId,
          kioskId,
          sessionMonitorSocketId: session.monitorSocketId,
          sessionKioskId: session.kioskId,
          senderRole,
          targetRole
        });
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target socket not found: ${targetId}`, {
          operation: 'offer',
          targetId,
          kioskId,
          targetSocketId
        });
      }
    });

    /**
     * WebRTC Signaling: Forward answer
     * 
     * Validates:
     * - Both sender and receiver are registered
     * - An active session exists
     * - Sender belongs to the session
     * - KIOSK ↔ MONITOR pairing is correct
     */
    socket.on('answer', (data) => {
      const {
        targetId,
        answer
      } = data || {};

      logDebug('WebRTC', 'Answer received', {
        fromId: clientId,
        targetId,
        role
      });

      // Guard: Required fields
      if (!validateOrError(socket, targetId && answer, ERROR_CODES.SIGNALING_MISSING_DATA,
          'Invalid answer: targetId and answer are required')) {
        logError('WebRTC', 'Answer failed: Missing required fields', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          targetId: !!targetId,
          answer: !!answer
        });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'answer');
      if (!rateLimit.allowed) {
        logWarn('WebRTC', 'Answer rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
          `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} answers per minute`, {
            resetAt: rateLimit.resetAt.toISOString()
          });
        return;
      }

      // Determine sender and receiver roles
      const senderRole = role;
      
      // Determine kioskId for session validation
      const kioskId = resolveWebRtcSessionKioskId(data, senderRole, clientId, targetId, socket.id);
      
      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${kioskId}`)) {
        return;
      }
      
      // Get session to find the correct monitor/kiosk socket
      const session = sessionsState.getSession(kioskId);
      
      // Determine target socket based on sender role
      let targetSocketId;
      let targetRole;
      
      if (senderRole === ROLES.KIOSK) {
        // Kiosk sending to Monitor - use monitorSocketId from session
        targetSocketId = session.monitorSocketId;
        targetRole = ROLES.MONITOR;
        
        // Guard: Validate kiosk owns the session
        if (!validateOrError(socket, kioskSocketOwnsSession(session, socket.id),
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      } else {
        // Monitor sending to Kiosk - use kiosk socketId
        const targetKiosk = kiosksState.getKiosk(targetId);
        if (!targetKiosk) {
          logError('WebRTC', 'Target kiosk not found for signaling', {
            clientId: clientId || 'unknown',
            userId: userId || null,
            role: role || 'unknown',
            socketId: socket.id,
            targetId,
            kioskId
          });
          emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target kiosk not found: ${targetId}`, {
            targetId,
            kioskId
          });
          return;
        }
        targetSocketId = targetKiosk.socketId;
        targetRole = ROLES.KIOSK;
        
        // Guard: Validate monitor owns the session
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: You do not own the monitoring session for this kiosk')) {
          return;
        }
      }

      // Guard: Must be KIOSK ↔ MONITOR pairing
      if (!validateOrError(socket,
          (senderRole === ROLES.KIOSK && targetRole === ROLES.MONITOR) ||
          (senderRole === ROLES.MONITOR && targetRole === ROLES.KIOSK),
          ERROR_CODES.SIGNALING_INVALID_PAIRING,
          'Invalid pairing: Answers can only be sent between KIOSK and MONITOR')) {
        return;
      }

      // Update session activity
      sessionsState.updateSessionActivity(kioskId);

      // Forward answer to target client
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('answer', {
          fromId: clientId,
          answer
        });
        logInfo('WebRTC', 'Answer forwarded successfully', {
          fromId: clientId,
          toId: targetId,
          kioskId
        });
      } else {
        logError('WebRTC', 'Answer failed: Target socket not found', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          targetId,
          targetSocketId,
          kioskId,
          senderRole,
          targetRole
        });
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target socket not found: ${targetId}`, {
          operation: 'answer',
          targetId,
          kioskId,
          targetSocketId
        });
      }
    });

    /**
     * WebRTC Signaling: Forward ICE candidate
     * 
     * Validates:
     * - Both sender and receiver are registered
     * - An active session exists
     * - Sender belongs to the session
     * - KIOSK ↔ MONITOR pairing is correct
     */
    socket.on('ice-candidate', (data) => {
      const {
        targetId,
        candidate
      } = data || {};

      logDebug('WebRTC', 'ICE candidate received', {
        fromId: clientId,
        targetId,
        role
      });

      // Guard: Required fields
      if (!validateOrError(socket, targetId && candidate, ERROR_CODES.SIGNALING_MISSING_DATA,
          'Invalid ice-candidate: targetId and candidate are required')) {
        logError('WebRTC', 'ICE candidate failed: Missing required fields', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          targetId: !!targetId,
          candidate: !!candidate
        });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'ice-candidate');
      if (!rateLimit.allowed) {
        logWarn('WebRTC', 'ICE candidate rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
          `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} ICE candidates per minute`, {
            resetAt: rateLimit.resetAt.toISOString()
          });
        return;
      }

      // Determine sender and receiver roles
      const senderRole = role;
      
      // Determine kioskId for session validation
      const kioskId = resolveWebRtcSessionKioskId(data, senderRole, clientId, targetId, socket.id);
      
      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${kioskId}`)) {
        return;
      }
      
      // Get session to find the correct monitor/kiosk socket
      const session = sessionsState.getSession(kioskId);
      
      // Determine target socket based on sender role
      let targetSocketId;
      let targetRole;
      
      if (senderRole === ROLES.KIOSK) {
        // Kiosk sending to Monitor - use monitorSocketId from session
        targetSocketId = session.monitorSocketId;
        targetRole = ROLES.MONITOR;
        
        // Guard: Validate kiosk owns the session
        if (!validateOrError(socket, kioskSocketOwnsSession(session, socket.id),
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      } else {
        // Monitor sending to Kiosk - use kiosk socketId
        const targetKiosk = kiosksState.getKiosk(targetId);
        if (!targetKiosk) {
          logError('WebRTC', 'Target kiosk not found for signaling', {
            clientId: clientId || 'unknown',
            userId: userId || null,
            role: role || 'unknown',
            socketId: socket.id,
            targetId,
            kioskId
          });
          emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target kiosk not found: ${targetId}`, {
            targetId,
            kioskId
          });
          return;
        }
        targetSocketId = targetKiosk.socketId;
        targetRole = ROLES.KIOSK;
        
        // Guard: Validate monitor owns the session
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: You do not own the monitoring session for this kiosk')) {
          return;
        }
      }

      // Guard: Must be KIOSK ↔ MONITOR pairing
      if (!validateOrError(socket,
          (senderRole === ROLES.KIOSK && targetRole === ROLES.MONITOR) ||
          (senderRole === ROLES.MONITOR && targetRole === ROLES.KIOSK),
          ERROR_CODES.SIGNALING_INVALID_PAIRING,
          'Invalid pairing: ICE candidates can only be sent between KIOSK and MONITOR')) {
        return;
      }

      // Update session activity
      sessionsState.updateSessionActivity(kioskId);

      // Forward ICE candidate to target client
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        // Log candidate type for debugging (host/srflx/relay)
        const candidateStr = typeof candidate === 'string' ? candidate : JSON.stringify(candidate);
        const candidateType = candidateStr.includes('typ relay') ? 'relay' :
                             candidateStr.includes('typ srflx') ? 'srflx' :
                             candidateStr.includes('typ host') ? 'host' : 'unknown';
        
        targetSocket.emit('ice-candidate', {
          fromId: clientId,
          candidate
        });
        logInfo('WebRTC', 'ICE candidate forwarded', {
          fromId: clientId,
          toId: targetId,
          kioskId,
          candidateType,
          hasRelay: candidateType === 'relay'
        });
      } else {
        logError('WebRTC', 'ICE candidate failed: Target socket not found', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          targetId,
          targetSocketId,
          kioskId,
          senderRole,
          targetRole
        });
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target socket not found: ${targetId}`, {
          operation: 'ice-candidate',
          targetId,
          kioskId,
          targetSocketId
        });
      }
    });

    /**
     * Heartbeat Ping
     * KIOSK clients send heartbeat to keep connection alive
     */
    const handleHeartbeat = async () => {
      logDebug('Heartbeat', 'Heartbeat ping received', {
        clientId
      });

      // Guard: Only KIOSK/MONITOR role can send heartbeat
      if (!validateOrError(socket, role === ROLES.KIOSK || role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
          'Unauthorized: Invalid role for heartbeat')) {
        logWarn('Heartbeat', 'Heartbeat ping failed: Invalid role', {
          clientId,
          role
        });
        return;
      }

      try {
        // Process heartbeat for kiosk legacy tracker
        const result = role === ROLES.KIOSK ? processHeartbeatPing(clientId) : {
          valid: true,
          timestamp: new Date().toISOString(),
        };

        if (result.valid) {
          // Update last seen timestamp
          if (role === ROLES.KIOSK) {
            kiosksState.updateLastSeen(clientId);
          }
          await touchSocketHeartbeat({
            socketId: socket.id,
            userId,
          });

          // Respond with pong
          socket.emit('heartbeat-pong', {
            timestamp: result.timestamp
          });

          logDebug('Heartbeat', 'Heartbeat pong sent', {
            clientId,
            timestamp: result.timestamp
          });
        }
      } catch (error) {
        logError('Heartbeat', 'Failed to process heartbeat', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process heartbeat', {
          error: error.message,
          operation: 'heartbeat-ping'
        });
      }
    };
    socket.on('heartbeat-ping', handleHeartbeat);
    socket.on('heartbeat', handleHeartbeat);

    /**
     * Crew Sign-On Event
     * Only KIOSK clients can emit crew sign-on events
     * Events are broadcast to all MONITOR clients
     */
    socket.on('crew-sign-on', (payload) => {
      logInfo('CrewEvent', 'Crew sign-on event received', {
        clientId,
        employeeId: payload?.employeeId,
        name: payload?.name
      });

      // Guard: Only KIOSK role can emit crew events
      if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.CREW_EVENT_UNAUTHORIZED,
          'Unauthorized: Only KIOSK clients can emit crew sign-on events')) {
        logWarn('CrewEvent', 'Crew sign-on failed: Invalid role', {
          clientId,
          role
        });
        return;
      }

      // Guard: Kiosk must be registered
      if (!validateOrError(socket, kiosksState.getKiosk(clientId), ERROR_CODES.CLIENT_NOT_REGISTERED,
          'Kiosk not registered')) {
        logWarn('CrewEvent', 'Crew sign-on failed: Kiosk not registered', {
          clientId
        });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'crew-sign-on');
      if (!rateLimit.allowed) {
        logWarn('CrewEvent', 'Crew sign-on rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
          `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} sign-ons per minute`, {
            resetAt: rateLimit.resetAt.toISOString()
          });
        return;
      }

      // Validate payload
      const validation = validateCrewEventPayload(payload);
      if (!validation.isValid) {
        logWarn('CrewEvent', 'Crew sign-on failed: Invalid payload', {
          clientId,
          errors: validation.errors
        });
        emitError(socket, ERROR_CODES.CREW_EVENT_INVALID_PAYLOAD,
          'Invalid payload', {
            errors: validation.errors
          });
        return;
      }

      // Ensure kioskId matches the authenticated client (security: override client-provided kioskId)
      const eventPayload = {
        ...payload,
        kioskId: clientId
      };

      // Broadcast to all MONITOR clients
      broadcastCrewSignOn(io, eventPayload);

      // Acknowledge receipt
      socket.emit('crew-sign-on-ack', {
        employeeId: payload.employeeId,
        timestamp: new Date().toISOString()
      });

      logInfo('CrewEvent', 'Crew sign-on acknowledged', {
        clientId,
        employeeId: payload.employeeId
      });
    });

    /**
     * Crew Sign-Off Event
     * Only KIOSK clients can emit crew sign-off events
     * Events are broadcast to all MONITOR clients
     */
    socket.on('crew-sign-off', (payload) => {
      logInfo('CrewEvent', 'Crew sign-off event received', {
        clientId,
        employeeId: payload?.employeeId,
        name: payload?.name
      });

      // Guard: Only KIOSK role can emit crew events
      if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.CREW_EVENT_UNAUTHORIZED,
          'Unauthorized: Only KIOSK clients can emit crew sign-off events')) {
        logWarn('CrewEvent', 'Crew sign-off failed: Invalid role', {
          clientId,
          role
        });
        return;
      }

      // Guard: Kiosk must be registered
      if (!validateOrError(socket, kiosksState.getKiosk(clientId), ERROR_CODES.CLIENT_NOT_REGISTERED,
          'Kiosk not registered')) {
        logWarn('CrewEvent', 'Crew sign-off failed: Kiosk not registered', {
          clientId
        });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'crew-sign-off');
      if (!rateLimit.allowed) {
        logWarn('CrewEvent', 'Crew sign-off rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
          `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} sign-offs per minute`, {
            resetAt: rateLimit.resetAt.toISOString()
          });
        return;
      }

      // Validate payload
      const validation = validateCrewEventPayload(payload);
      if (!validation.isValid) {
        logWarn('CrewEvent', 'Crew sign-off failed: Invalid payload', {
          clientId,
          errors: validation.errors
        });
        emitError(socket, ERROR_CODES.CREW_EVENT_INVALID_PAYLOAD,
          'Invalid payload', {
            errors: validation.errors
          });
        return;
      }

      // Ensure kioskId matches the authenticated client (security: override client-provided kioskId)
      const eventPayload = {
        ...payload,
        kioskId: clientId
      };

      // Broadcast to all MONITOR clients
      broadcastCrewSignOff(io, eventPayload);

      // Acknowledge receipt
      socket.emit('crew-sign-off-ack', {
        employeeId: payload.employeeId,
        timestamp: new Date().toISOString()
      });

      logInfo('CrewEvent', 'Crew sign-off acknowledged', {
        clientId,
        employeeId: payload.employeeId
      });
    });

    /**
     * Call Control: Request Call
     * Either MONITOR or KIOSK can request a call
     * Requires active monitoring session
     */
    socket.on('call-request', (data) => {
      const {
        kioskId
      } = data || {};

      logInfo('Call', 'Call request received', {
        fromId: clientId,
        role,
        kioskId,
        socketId: socket.id
      });

      const targetKioskId = resolveMonitoringTargetId(data, role, clientId, socket.id);

      if (!targetKioskId) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, 'kioskId is required');
        return;
      }
      if (role === ROLES.KIOSK && !validateOrError(socket, canKioskShare(), ERROR_CODES.AUTH_INVALID_ROLE,
          'Unauthorized: Only logged-in USER can request call')) {
        return;
      }

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(targetKioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${targetKioskId}`)) {
        return;
      }

      const session = sessionsState.getSession(targetKioskId);

      // Guard: Validate session ownership/participation
      if (role === ROLES.MONITOR) {
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SESSION_NOT_AUTHORIZED,
            'Unauthorized: You do not own this monitoring session')) {
          return;
        }
      } else if (role === ROLES.KIOSK) {
        if (!validateOrError(socket, kioskSocketOwnsSession(session, socket.id),
            ERROR_CODES.SESSION_NOT_AUTHORIZED,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      }

      // Guard: Check if call is already in progress
      const callState = sessionsState.getCallState(targetKioskId);
      if (callState?.callState === 'connecting' || callState?.callState === 'connected') {
        emitError(socket, ERROR_CODES.CALL_ALREADY_IN_PROGRESS,
          'A call is already in progress for this session');
        return;
      }

      try {
        // Update call state
        const initiatedBy = role === ROLES.MONITOR ? 'monitor' : 'kiosk';
        sessionsState.updateCallState(targetKioskId, 'connecting', initiatedBy);

        // Determine target
        const targetSocketId = role === ROLES.MONITOR ?
          kiosksState.getKiosk(targetKioskId)?.socketId :
          session.monitorSocketId;

        logDebug('Call', 'Target socket lookup', {
          role,
          targetKioskId,
          targetSocketId,
          kioskExists: !!kiosksState.getKiosk(targetKioskId)
        });

        if (targetSocketId) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit('call-request', {
              fromId: clientId,
              fromRole: role,
              kioskId: targetKioskId,
              timestamp: new Date().toISOString()
            });

            socket.emit('call-request-sent', {
              kioskId: targetKioskId,
              timestamp: new Date().toISOString()
            });

            logInfo('Call', 'Call request forwarded', {
              fromId: clientId,
              toId: role === ROLES.MONITOR ? targetKioskId : session.monitorId,
              kioskId: targetKioskId
            });
          } else {
            logError('Call', 'Target socket not found for call request', {
              clientId: clientId || 'unknown',
              userId: userId || null,
              role: role || 'unknown',
              socketId: socket.id,
              targetKioskId,
              targetSocketId: session?.monitorSocketId || 'unknown'
            });
            emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, 'Target socket not found', {
              operation: 'call-request',
              kioskId: targetKioskId
            });
          }
        } else {
          logError('Call', 'Target not found for call request', {
            clientId: clientId || 'unknown',
            userId: userId || null,
            role: role || 'unknown',
            socketId: socket.id,
            targetKioskId
          });
          emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, 'Target not found', {
            operation: 'call-request',
            kioskId: targetKioskId
          });
        }
      } catch (error) {
        logError('Call', 'Failed to process call request', {
          clientId,
          userId: userId || null,
          role,
          socketId: socket.id,
          kioskId: targetKioskId,
          error: error.message,
          stack: error.stack
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process call request', {
          error: error.message,
          operation: 'call-request'
        });
      }
    });

    /**
     * Call Control: Accept Call
     * The other party accepts the call request
     */
    socket.on('call-accept', (data) => {
      const {
        kioskId
      } = data || {};

      logInfo('Call', 'Call accept received', {
        fromId: clientId,
        role,
        kioskId,
        socketId: socket.id
      });

      const targetKioskId = resolveMonitoringTargetId(data, role, clientId, socket.id);

      if (!targetKioskId) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, 'kioskId is required');
        return;
      }

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(targetKioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${targetKioskId}`)) {
        return;
      }

      const session = sessionsState.getSession(targetKioskId);
      const callState = sessionsState.getCallState(targetKioskId);

      // Guard: Call must be in connecting state
      if (callState?.callState !== 'connecting') {
        emitError(socket, ERROR_CODES.CALL_INVALID_STATE,
          'Call is not in connecting state');
        return;
      }

      // Guard: Only the other party can accept
      const canAccept = (role === ROLES.MONITOR && callState.callInitiatedBy === 'kiosk') ||
        (role === ROLES.KIOSK && callState.callInitiatedBy === 'monitor');

      if (!validateOrError(socket, canAccept,
          ERROR_CODES.CALL_NOT_INITIATED,
          'You cannot accept a call you initiated')) {
        return;
      }

      try {
        // Update call state to connected
        sessionsState.updateCallState(targetKioskId, 'connected');

        // Notify both parties
        const targetSocketId = role === ROLES.MONITOR ?
          kiosksState.getKiosk(targetKioskId)?.socketId :
          session.monitorSocketId;

        if (targetSocketId) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit('call-accepted', {
              fromId: clientId,
              kioskId: targetKioskId,
              timestamp: new Date().toISOString()
            });

            socket.emit('call-accept-confirmed', {
              kioskId: targetKioskId,
              timestamp: new Date().toISOString()
            });

            logInfo('Call', 'Call accepted', {
              kioskId: targetKioskId,
              acceptedBy: clientId
            });
          }
        }
      } catch (error) {
        logError('Call', 'Failed to accept call', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          kioskId: targetKioskId,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to accept call', {
          error: error.message,
          operation: 'call-accept',
          kioskId: targetKioskId
        });
      }
    });

    /**
     * Call Control: Reject Call
     * The other party rejects the call request
     */
    socket.on('call-reject', (data) => {
      const {
        kioskId
      } = data || {};

      logInfo('Call', 'Call reject received', {
        fromId: clientId,
        role,
        kioskId,
        socketId: socket.id
      });

      const targetKioskId = resolveMonitoringTargetId(data, role, clientId, socket.id);

      if (!targetKioskId) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, 'kioskId is required');
        return;
      }

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(targetKioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${targetKioskId}`)) {
        return;
      }

      const session = sessionsState.getSession(targetKioskId);
      const callState = sessionsState.getCallState(targetKioskId);

      // Guard: Call must be in connecting state
      if (callState?.callState !== 'connecting') {
        emitError(socket, ERROR_CODES.CALL_INVALID_STATE,
          'Call is not in connecting state');
        return;
      }

      try {
        // Reset call state to idle
        sessionsState.updateCallState(targetKioskId, 'idle');

        // Notify the initiator
        const targetSocketId = role === ROLES.MONITOR ?
          kiosksState.getKiosk(targetKioskId)?.socketId :
          session.monitorSocketId;

        if (targetSocketId) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit('call-rejected', {
              fromId: clientId,
              kioskId: targetKioskId,
              timestamp: new Date().toISOString()
            });

            socket.emit('call-reject-confirmed', {
              kioskId: targetKioskId,
              timestamp: new Date().toISOString()
            });

            logInfo('Call', 'Call rejected', {
              kioskId: targetKioskId,
              rejectedBy: clientId
            });
          }
        }
      } catch (error) {
        logError('Call', 'Failed to reject call', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          kioskId: targetKioskId,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to reject call', {
          error: error.message,
          operation: 'call-reject',
          kioskId: targetKioskId
        });
      }
    });

    /**
     * Call Control: End Call
     * Either party can end an active call
     */
    socket.on('call-end', (data) => {
      const {
        kioskId
      } = data || {};

      logInfo('Call', 'Call end received', {
        fromId: clientId,
        role,
        kioskId,
        socketId: socket.id
      });

      const targetKioskId = resolveMonitoringTargetId(data, role, clientId, socket.id);

      if (!targetKioskId) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, 'kioskId is required');
        return;
      }

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(targetKioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${targetKioskId}`)) {
        return;
      }

      const session = sessionsState.getSession(targetKioskId);
      const callState = sessionsState.getCallState(targetKioskId);

      // Guard: Call must be connected
      if (callState?.callState !== 'connected') {
        emitError(socket, ERROR_CODES.CALL_INVALID_STATE,
          'No active call to end');
        return;
      }

      try {
        // Update call state to ended
        sessionsState.updateCallState(targetKioskId, 'ended');

        // Notify the other party
        const targetSocketId = role === ROLES.MONITOR ?
          kiosksState.getKiosk(targetKioskId)?.socketId :
          session.monitorSocketId;

        if (targetSocketId) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit('call-ended', {
              fromId: clientId,
              kioskId: targetKioskId,
              timestamp: new Date().toISOString()
            });

            socket.emit('call-end-confirmed', {
              kioskId: targetKioskId,
              timestamp: new Date().toISOString()
            });

            logInfo('Call', 'Call ended', {
              kioskId: targetKioskId,
              endedBy: clientId
            });
          }
        }

        // Reset call state to idle after a short delay
        setTimeout(() => {
          sessionsState.updateCallState(targetKioskId, 'idle');
        }, 1000);
      } catch (error) {
        logError('Call', 'Failed to end call', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          kioskId: targetKioskId,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to end call', {
          error: error.message,
          operation: 'call-end',
          kioskId: targetKioskId
        });
      }
    });

    /**
     * Media Control: Toggle Video
     * Either party can toggle their video on/off
     */
    socket.on('toggle-video', (data) => {
      const {
        kioskId,
        enabled
      } = data || {};

      logInfo('Media', 'Toggle video received', {
        fromId: clientId,
        role,
        kioskId,
        enabled,
        socketId: socket.id
      });

      const targetKioskId = resolveMonitoringTargetId(data, role, clientId, socket.id);

      if (!targetKioskId || enabled === undefined) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, 'kioskId and enabled are required');
        return;
      }
      if (role === ROLES.KIOSK && !validateOrError(socket, canKioskShare(), ERROR_CODES.AUTH_INVALID_ROLE,
          'Unauthorized: Only logged-in USER can toggle video')) {
        return;
      }

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(targetKioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${targetKioskId}`)) {
        return;
      }

      const session = sessionsState.getSession(targetKioskId);

      // Guard: Validate session ownership/participation
      if (role === ROLES.MONITOR) {
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SESSION_NOT_AUTHORIZED,
            'Unauthorized: You do not own this monitoring session')) {
          return;
        }
      } else if (role === ROLES.KIOSK) {
        if (!validateOrError(socket, kioskSocketOwnsSession(session, socket.id),
            ERROR_CODES.SESSION_NOT_AUTHORIZED,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      }

      try {
        // Update media state
        const roleKey = role === ROLES.MONITOR ? 'monitor' : 'kiosk';
        sessionsState.updateMediaState(targetKioskId, roleKey, {
          videoEnabled: enabled
        });

        // Notify the other party
        const targetSocketId = role === ROLES.MONITOR ?
          kiosksState.getKiosk(targetKioskId)?.socketId :
          session.monitorSocketId;

        if (targetSocketId) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit('video-toggled', {
              fromId: clientId,
              kioskId: targetKioskId,
              enabled,
              timestamp: new Date().toISOString()
            });

            socket.emit('video-toggle-confirmed', {
              kioskId: targetKioskId,
              enabled,
              timestamp: new Date().toISOString()
            });

            logInfo('Media', 'Video toggled', {
              kioskId: targetKioskId,
              role: roleKey,
              enabled
            });
          }
        }
      } catch (error) {
        logError('Media', 'Failed to toggle video', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          kioskId: targetKioskId,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to toggle video', {
          error: error.message,
          operation: 'toggle-video',
          kioskId: targetKioskId
        });
      }
    });

    /**
     * Media Control: Toggle Audio (Mute/Unmute)
     * Either party can toggle their audio on/off
     */
    socket.on('toggle-audio', (data) => {
      const {
        kioskId,
        enabled
      } = data || {};

      logInfo('Media', 'Toggle audio received', {
        fromId: clientId,
        role,
        kioskId,
        enabled,
        socketId: socket.id
      });

      const targetKioskId = resolveMonitoringTargetId(data, role, clientId, socket.id);

      if (!targetKioskId || enabled === undefined) {
        emitError(socket, ERROR_CODES.INVALID_REQUEST, 'kioskId and enabled are required');
        return;
      }
      if (role === ROLES.KIOSK && !validateOrError(socket, canKioskShare(), ERROR_CODES.AUTH_INVALID_ROLE,
          'Unauthorized: Only logged-in USER can toggle audio')) {
        return;
      }

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(targetKioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${targetKioskId}`)) {
        return;
      }

      const session = sessionsState.getSession(targetKioskId);

      // Guard: Validate session ownership/participation
      if (role === ROLES.MONITOR) {
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SESSION_NOT_AUTHORIZED,
            'Unauthorized: You do not own this monitoring session')) {
          return;
        }
      } else if (role === ROLES.KIOSK) {
        if (!validateOrError(socket, kioskSocketOwnsSession(session, socket.id),
            ERROR_CODES.SESSION_NOT_AUTHORIZED,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      }

      try {
        // Update media state
        const roleKey = role === ROLES.MONITOR ? 'monitor' : 'kiosk';
        sessionsState.updateMediaState(targetKioskId, roleKey, {
          audioEnabled: enabled
        });

        // Notify the other party
        const targetSocketId = role === ROLES.MONITOR ?
          kiosksState.getKiosk(targetKioskId)?.socketId :
          session.monitorSocketId;

        if (targetSocketId) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit('audio-toggled', {
              fromId: clientId,
              kioskId: targetKioskId,
              enabled,
              timestamp: new Date().toISOString()
            });

            socket.emit('audio-toggle-confirmed', {
              kioskId: targetKioskId,
              enabled,
              timestamp: new Date().toISOString()
            });

            logInfo('Media', 'Audio toggled', {
              kioskId: targetKioskId,
              role: roleKey,
              enabled
            });
          }
        }
      } catch (error) {
        logError('Media', 'Failed to toggle audio', {
          clientId: clientId || 'unknown',
          userId: userId || null,
          role: role || 'unknown',
          socketId: socket.id,
          kioskId: targetKioskId,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to toggle audio', {
          error: error.message,
          operation: 'toggle-audio',
          kioskId: targetKioskId
        });
      }
    });

    /**
     * Handle client disconnect
     * 
     * Clean disconnect handling:
     * - Remove client from state
     * - End active sessions
     * - Notify relevant clients
     * - Release all references
     * - Clean up rate limits
     * - Clean up user session tracking
     */
    socket.on('disconnect', async (reason) => {
      // Clean up user session tracking
      if (userId && appUser) {
        userSessionsState.removeUserSession(userId, socket.id);
      }

      logInfo('Socket', 'Client disconnected', {
        clientId,
        role,
        socketId: socket.id,
        reason
      });

      try {
        const offlineReason = reason === 'ping timeout'
          ? 'TIMEOUT'
          : reason === 'transport close'
            ? 'NETWORK_LOST'
            : reason === 'server shutting down'
              ? 'SERVER_RESTART'
              : 'MANUAL_DISCONNECT';

        await markSocketPresenceOffline({
          socketId: socket.id,
          userId,
          reason: offlineReason,
        });

        if (role === ROLES.KIOSK) {
          // Remove heartbeat tracking for this connection
          removeHeartbeat(clientId);
          logInfo('Socket', 'Heartbeat tracking removed', {
            clientId
          });

          const currentKiosk = kiosksState.getKiosk(clientId);
          const kioskName = currentKiosk?.name ?? clientId;
          // Only treat as "this socket's kiosk" if kiosk is still tied to this socket (not transferred on duplicate login)
          const thisSocketOwnsKiosk = currentKiosk && currentKiosk.socketId === socket.id;

          if (thisSocketOwnsKiosk) {
            kiosksState.markOffline(clientId);
          }

          // End any active sessions for this kiosk (only relevant when this socket owned the kiosk)
          const endedSession = thisSocketOwnsKiosk ? sessionsState.endSessionByKiosk(clientId) : null;
          if (thisSocketOwnsKiosk && endedSession) {
            await endMonitoringSession({
              deviceId: clientId,
              actorUserId: userId,
              status: 'TIMEOUT',
              disconnectReason: 'kiosk-disconnect',
            });
          }

          if (thisSocketOwnsKiosk) {
            // Notify monitors of kiosk going offline (include name for admin UI)
            io.to('monitors').emit('kiosk-offline', {
              kioskId: clientId,
              name: kioskName,
              timestamp: new Date().toISOString(),
              reason: 'disconnect'
            });
            logInfo('Socket', 'Kiosk offline notification sent to monitors', {
              clientId
            });

            // Notify monitors of session end if session existed
            if (endedSession) {
              io.to('monitors').emit('session-ended', {
                kioskId: clientId,
                monitorId: endedSession.monitorId,
                reason: 'kiosk-disconnect',
                timestamp: new Date().toISOString()
              });
              logInfo('Socket', 'Session ended notification sent (kiosk disconnect)', {
                clientId,
                monitorId: endedSession.monitorId,
                kioskId: clientId
              });
            }

            // Remove kiosk from state
            kiosksState.removeKiosk(clientId);
            logInfo('Socket', 'Kiosk removed from state', {
              clientId
            });
          } else {
            logInfo('Socket', 'Kiosk not removed (transferred to new socket or already removed)', {
              clientId,
              socketId: socket.id,
              currentKioskSocketId: currentKiosk?.socketId ?? 'none'
            });
          }

        } else if (role === ROLES.MONITOR) {
          // End all active sessions owned by this monitor (one monitor can have multiple kiosk sessions)
          const endedSessions = sessionsState.endSessionByMonitorSocket(socket.id);
          await cacheDisconnectForReconnect({
            userId,
            sessions: endedSessions.map((s) => ({
              division_id: null,
              lobby_id: null,
              device_id: s.kioskId,
            })),
          });
          await endSessionsByMonitorUser({
            monitorUserId: userId,
            status: 'TIMEOUT',
            disconnectReason: 'monitor-disconnect',
          });
          for (const endedSession of endedSessions) {
            io.to('monitors').emit('session-ended', {
              kioskId: endedSession.kioskId,
              monitorId: clientId,
              reason: 'monitor-disconnect',
              timestamp: new Date().toISOString()
            });
            io.to('monitors').emit('session-status', {
              deviceId: endedSession.kioskId,
              status: 'TIMEOUT',
              reason: 'monitor-disconnect',
              timestamp: new Date().toISOString()
            });
            logInfo('Socket', 'Session ended notification sent (monitor disconnect)', {
              clientId,
              kioskId: endedSession.kioskId
            });
          }

          // Remove monitor from state (find by socket.id since monitorId = clientId_socketId)
          const monitor = monitorsState.getMonitorBySocketId(socket.id);
          if (monitor) {
            monitorsState.removeMonitor(monitor.monitorId);
            logInfo('Socket', 'Monitor removed from state', {
              clientId,
              monitorId: monitor.monitorId,
              socketId: socket.id
            });
          }
        }

        // Clean up rate limits
        resetAllRateLimits(clientId);
        logInfo('Socket', 'Rate limits reset', {
          clientId
        });

        logInfo('Socket', 'Disconnect cleanup completed', {
          clientId,
          role
        });
      } catch (error) {
        logError('Socket', 'Error during disconnect cleanup', {
          clientId,
          role,
          socketId: socket.id,
          error: error.message,
          stack: error.stack
        });
        // Try to emit error to client if socket is still connected
        if (socket.connected) {
          emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Error during disconnect cleanup', {
            error: error.message
          });
        }
      }
    });

    /**
     * Handle socket errors
     * Never crash the server
     * Emit all errors to the connected client
     */
    socket.on('error', (error) => {
      logError('Socket', 'Socket error occurred', {
        clientId: clientId || 'unknown',
        userId: userId || null,
        role: role || 'unknown',
        socketId: socket.id,
        error: error.message,
        stack: error.stack,
        errorName: error.name,
        errorCode: error.code
      });
      
      // Emit error to the connected client
      emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Socket error occurred', {
        error: error.message,
        errorName: error.name,
        errorCode: error.code
      });
    });
  });
};