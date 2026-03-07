/**
 * Structured Logging Utility
 * 
 * Provides consistent, structured logging throughout the application.
 * All logs include timestamps and context information.
 */

/**
 * Log levels
 */
export const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

/**
 * Format log message with timestamp and context
 * 
 * @param {string} level - Log level
 * @param {string} category - Log category (e.g., 'Auth', 'Socket', 'Session')
 * @param {string} message - Log message
 * @param {Object} context - Additional context data
 * @returns {string} Formatted log message
 */
const formatLog = (level, category, message, context = {}) => {
  const timestamp = new Date().toISOString();
  const contextStr = Object.keys(context).length > 0 
    ? ` | ${JSON.stringify(context)}` 
    : '';
  
  return `[${timestamp}] [${level}] [${category}] ${message}${contextStr}`;
};

/**
 * Log info message
 * 
 * @param {string} category - Log category
 * @param {string} message - Log message
 * @param {Object} context - Additional context
 */
export const logInfo = (category, message, context = {}) => {
  console.log(formatLog(LOG_LEVELS.INFO, category, message, context));
};

/**
 * Log warning message
 * 
 * @param {string} category - Log category
 * @param {string} message - Log message
 * @param {Object} context - Additional context
 */
export const logWarn = (category, message, context = {}) => {
  console.warn(formatLog(LOG_LEVELS.WARN, category, message, context));
};

/**
 * Log error message
 * 
 * @param {string} category - Log category
 * @param {string} message - Log message
 * @param {Object} context - Additional context
 */
export const logError = (category, message, context = {}) => {
  console.error(formatLog(LOG_LEVELS.ERROR, category, message, context));
};

/**
 * Log debug message
 * 
 * @param {string} category - Log category
 * @param {string} message - Log message
 * @param {Object} context - Additional context
 */
export const logDebug = (category, message, context = {}) => {
  if (process.env.DEBUG === 'true') {
    console.log(formatLog(LOG_LEVELS.DEBUG, category, message, context));
  }
};
