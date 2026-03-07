import { ERROR_CODES } from './error.codes.js';
import { logError, logWarn } from '../utils/logger.js';

/**
 * Standardized Socket Error Handler
 * 
 * Provides structured error responses for Socket.IO events.
 * All errors follow a consistent format and never crash the server.
 */

/**
 * Create a structured error response
 * 
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {Object} details - Optional additional error details
 * @returns {Object} Structured error object
 */
export const createError = (code, message, details = {}) => {
  // Ensure code and message are always strings (never null/undefined)
  const errorObj = {
    code: String(code || 'UNKNOWN_ERROR'),
    message: String(message || 'An error occurred'),
    timestamp: new Date().toISOString(),
  };
  
  // Safely merge details (ensure no null values break the structure)
  if (details && typeof details === 'object') {
    Object.keys(details).forEach(key => {
      const value = details[key];
      // Only include non-null, non-undefined values
      if (value !== null && value !== undefined) {
        errorObj[key] = value;
      }
    });
  }
  
  return errorObj;
};

/**
 * Emit error to socket and log it
 * 
 * @param {Object} socket - Socket.IO socket instance
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {Object} details - Optional additional error details
 */
export const emitError = (socket, code, message, details = {}) => {
  const error = createError(code, message, details);
  
  // Enhanced logging with full context for debugging
  logError('Error', 'Socket error emitted to Flutter client', {
    code,
    message,
    clientId: socket.data?.clientId || 'unknown',
    userId: socket.data?.userId || null,
    role: socket.data?.role || 'unknown',
    socketId: socket.id,
    timestamp: error.timestamp,
    ...details
  });
  
  // Emit error to Flutter client
  // Flutter apps should listen for 'error' event on socket
  socket.emit('error', error);
  
  return error;
};

/**
 * Validate and emit error if validation fails
 * 
 * @param {Object} socket - Socket.IO socket instance
 * @param {boolean} isValid - Whether validation passed
 * @param {string} code - Error code if validation fails
 * @param {string} message - Error message if validation fails
 * @param {Object} details - Optional additional error details
 * @returns {boolean} True if valid, false if error was emitted
 */
export const validateOrError = (socket, isValid, code, message, details = {}) => {
  if (!isValid) {
    // Enhanced logging for validation failures
    logWarn('Validation', 'Validation failed', {
      code,
      message,
      clientId: socket.data?.clientId || 'unknown',
      userId: socket.data?.userId || null,
      role: socket.data?.role || 'unknown',
      socketId: socket.id,
      ...details
    });
    
    emitError(socket, code, message, details);
    return false;
  }
  return true;
};

export { ERROR_CODES };
