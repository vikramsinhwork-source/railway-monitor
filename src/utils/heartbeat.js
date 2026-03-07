/**
 * Heartbeat / Keep-Alive System
 * 
 * Monitors client connectivity and detects offline clients.
 * KIOSK clients send heartbeat-ping, backend responds with heartbeat-pong.
 * 
 * Architecture: Railway-grade reliability
 * - Automatic offline detection
 * - Session termination on timeout
 * - Configurable thresholds
 */

import { logInfo, logWarn, logDebug } from './logger.js';

import { getKiosk, markOffline as markKioskOffline, isKioskOnline } from '../state/kiosks.state.js';
import { endSessionByKiosk } from '../state/sessions.state.js';

// Heartbeat configuration (in milliseconds)
const HEARTBEAT_INTERVAL_MS = 30000;  // KIOSK should ping every 30 seconds
const HEARTBEAT_TIMEOUT_MS = 90000;   // Mark offline if no ping for 90 seconds

// Track last heartbeat per kiosk: Map<kioskId, lastHeartbeatTimestamp>
const heartbeatStore = new Map();

/**
 * Process heartbeat ping from KIOSK
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {Object} Response data
 */
export const processHeartbeatPing = (kioskId) => {
  if (!kioskId) {
    return { valid: false };
  }

  const now = Date.now();
  heartbeatStore.set(kioskId, now);

  return {
    valid: true,
    timestamp: new Date().toISOString()
  };
};

/**
 * Check for timed-out kiosks and mark them offline
 * 
 * @param {Object} io - Socket.IO server instance
 * @returns {Array} Array of kioskIds that were marked offline
 */
export const checkHeartbeatTimeouts = (io) => {
  const now = Date.now();
  const timedOutKiosks = [];

  for (const [kioskId, lastHeartbeat] of heartbeatStore.entries()) {
    const timeSinceLastHeartbeat = now - lastHeartbeat;

    if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      // Only mark offline if currently online (avoid duplicate notifications)
      if (isKioskOnline(kioskId)) {
        const kioskInfo = getKiosk(kioskId);
        const kioskName = kioskInfo?.name ?? kioskId;
        markKioskOffline(kioskId);
        
        // End any active sessions for this kiosk
        const endedSession = endSessionByKiosk(kioskId);
        
        // Notify monitors (include name for admin UI)
        io.to('monitors').emit('kiosk-offline', {
          kioskId,
          name: kioskName,
          timestamp: new Date().toISOString(),
          reason: 'heartbeat-timeout'
        });

        // Notify monitors of session end if session existed
        if (endedSession) {
          io.to('monitors').emit('session-ended', {
            kioskId,
            monitorId: endedSession.monitorId,
            reason: 'kiosk-timeout',
            timestamp: new Date().toISOString()
          });
        }

        timedOutKiosks.push(kioskId);
        logWarn('Heartbeat', 'Kiosk heartbeat timeout', {
          kioskId,
          timeSinceLastHeartbeat: Math.round(timeSinceLastHeartbeat / 1000),
          timeoutThreshold: Math.round(HEARTBEAT_TIMEOUT_MS / 1000)
        });
      }
    }
  }

  return timedOutKiosks;
};

/**
 * Remove heartbeat tracking for a kiosk
 * Called when kiosk disconnects
 * 
 * @param {string} kioskId - Kiosk identifier
 */
export const removeHeartbeat = (kioskId) => {
  if (kioskId) {
    heartbeatStore.delete(kioskId);
  }
};

/**
 * Get heartbeat interval configuration
 * 
 * @returns {number} Expected heartbeat interval in milliseconds
 */
export const getHeartbeatInterval = () => {
  return HEARTBEAT_INTERVAL_MS;
};

/**
 * Get heartbeat timeout configuration
 * 
 * @returns {number} Heartbeat timeout in milliseconds
 */
export const getHeartbeatTimeout = () => {
  return HEARTBEAT_TIMEOUT_MS;
};

/**
 * Start periodic heartbeat timeout checking
 * 
 * @param {Object} io - Socket.IO server instance
 * @param {number} intervalMs - Check interval in milliseconds (default: 30 seconds)
 */
export const startHeartbeatChecker = (io, intervalMs = 30000) => {
  setInterval(() => {
    checkHeartbeatTimeouts(io);
  }, intervalMs);

  logInfo('Heartbeat', 'Heartbeat checker started', {
    intervalMs,
    timeoutMs: HEARTBEAT_TIMEOUT_MS
  });
};
