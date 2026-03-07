/**
 * User Session Tracker
 * 
 * Tracks active socket connections per user (userId or user_id).
 * Used to detect duplicate logins and force logout old sessions.
 */

import { logInfo, logWarn } from '../utils/logger.js';

// Map<userId, socketId> - tracks which socket is currently active for each user
const userSessions = new Map();

/**
 * Register a user session (socket connection)
 * 
 * @param {string} userId - User's database ID (UUID) or user_id (string)
 * @param {string} socketId - Socket.IO socket ID
 * @returns {string|null} Previous socket ID if user was already connected, null otherwise
 */
export const registerUserSession = (userId, socketId) => {
  if (!userId || !socketId) {
    return null;
  }

  const previousSocketId = userSessions.get(userId) || null;
  
  if (previousSocketId && previousSocketId !== socketId) {
    logWarn('UserSession', 'User already has active session', {
      userId,
      previousSocketId,
      newSocketId: socketId
    });
  }

  userSessions.set(userId, socketId);
  
  logInfo('UserSession', 'User session registered', {
    userId,
    socketId,
    hadPreviousSession: !!previousSocketId
  });

  return previousSocketId;
};

/**
 * Remove a user session
 * 
 * @param {string} userId - User ID
 * @param {string} socketId - Socket ID (optional, for validation)
 * @returns {boolean} True if session was removed, false if not found
 */
export const removeUserSession = (userId, socketId = null) => {
  if (!userId) {
    return false;
  }

  const currentSocketId = userSessions.get(userId);
  
  // If socketId provided, only remove if it matches (prevent removing wrong session)
  if (socketId && currentSocketId !== socketId) {
    logWarn('UserSession', 'Session mismatch on remove', {
      userId,
      expectedSocketId: socketId,
      actualSocketId: currentSocketId
    });
    return false;
  }

  const existed = userSessions.delete(userId);
  
  if (existed) {
    logInfo('UserSession', 'User session removed', {
      userId,
      socketId: currentSocketId
    });
  }

  return existed;
};

/**
 * Get active socket ID for a user
 * 
 * @param {string} userId - User ID
 * @returns {string|null} Socket ID if user has active session, null otherwise
 */
export const getUserSession = (userId) => {
  if (!userId) {
    return null;
  }
  return userSessions.get(userId) || null;
};

/**
 * Check if user has an active session
 * 
 * @param {string} userId - User ID
 * @returns {boolean} True if user has active session
 */
export const hasActiveSession = (userId) => {
  return userSessions.has(userId);
};

/**
 * Get all active user sessions
 * 
 * @returns {Array<{userId: string, socketId: string}>} Array of active sessions
 */
export const getAllActiveSessions = () => {
  return Array.from(userSessions.entries()).map(([userId, socketId]) => ({
    userId,
    socketId
  }));
};
