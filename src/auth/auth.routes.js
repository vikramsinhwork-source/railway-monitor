/**
 * Authentication API Routes
 *
 * Application login: POST /login with user_id + password (DB, JWT with userId/role).
 * Legacy: device-token, register, etc. for backward compatibility.
 */

import express from 'express';
import { generateToken, ROLES } from './auth.middleware.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import * as authController from '../modules/auth/auth.controller.js';

const router = express.Router();

// In-memory user store (replace with database in production)
// Format: { username: { password, userType, clientId, role } }
const users = new Map();

// Initialize default users (for development/testing)
// In production, load from database
if (users.size === 0) {
  // Default KIOSK user
  users.set('user@gmail.com', {
    password: 'user123', // In production, use hashed passwords
    userType: 'user',
    clientId: 'KIOSK_01',
    role: ROLES.KIOSK,
    name: 'Test User'
  });
  
  // Default MONITOR user
  users.set('monitor@gmail.com', {
    password: 'monitor123',
    userType: 'monitor',
    clientId: 'MONITOR_01',
    role: ROLES.MONITOR,
    name: 'Test Monitor'
  });
  
  logInfo('Auth', 'Default users initialized', {
    kioskUsers: 1,
    monitorUsers: 1
  });
}

/**
 * POST /api/auth/login
 *
 * Application login: body { user_id, password }. Returns accessToken, role, user (JWT has userId, role ADMIN|USER).
 */
router.post('/login', (req, res, next) => {
  authController.login(req, res).catch(next);
});

/**
 * POST /api/auth/device-token
 *
 * Issue a JWT for a device (KIOSK or MONITOR) without email/password.
 * Use a shared secret to authenticate the request.
 *
 * Request Body:
 * {
 *   "deviceId": "KIOSK_01",
 *   "role": "KIOSK",
 *   "secret": "your-device-token-secret"
 * }
 *
 * Response (same shape as login for app compatibility):
 * {
 *   "success": true,
 *   "token": "eyJ...",
 *   "user": {
 *     "clientId": "KIOSK_01",
 *     "role": "KIOSK",
 *     "name": "KIOSK_01"
 *   }
 * }
 *
 * Environment:
 *   DEVICE_TOKEN_SECRET - shared secret (required in production)
 */
const DEVICE_TOKEN_SECRET = process.env.DEVICE_TOKEN_SECRET || 'device-token-secret-change-in-production';

router.post('/device-token', async (req, res) => {
  try {
    const { deviceId, role, secret } = req.body;

    logInfo('Auth', 'Device token request', {
      deviceId,
      role,
      ip: req.ip
    });

    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid deviceId'
      });
    }

    if (!role || (role !== ROLES.KIOSK && role !== ROLES.MONITOR)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be "KIOSK" or "MONITOR"'
      });
    }

    if (!secret || secret !== DEVICE_TOKEN_SECRET) {
      logWarn('Auth', 'Device token failed: Invalid secret', { deviceId, ip: req.ip });
      return res.status(401).json({
        success: false,
        error: 'Invalid secret'
      });
    }

    const clientId = deviceId.trim();
    const token = generateToken(clientId, role);

    logInfo('Auth', 'Device token issued', {
      clientId,
      role,
      ip: req.ip
    });

    res.json({
      success: true,
      token,
      user: {
        clientId,
        role,
        name: clientId
      }
    });
  } catch (error) {
    logError('Auth', 'Device token error', {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/register
 * 
 * Register a new user (optional endpoint for user management)
 * 
 * Request Body:
 * {
 *   "username": "newuser@gmail.com",
 *   "password": "password123",
 *   "userType": "user",
 *   "name": "New User"
 * }
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password, userType, name } = req.body;

    logInfo('Auth', 'Registration attempt', {
      username,
      userType,
      ip: req.ip
    });

    // Validate request body
    if (!username || !password || !userType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: username, password, and userType are required'
      });
    }

    // Check if user already exists
    if (users.has(username)) {
      logWarn('Auth', 'Registration failed: User already exists', {
        username,
        ip: req.ip
      });
      return res.status(409).json({
        success: false,
        error: 'User already exists'
      });
    }

    // Determine role based on userType
    let role;
    if (userType === 'user') {
      role = ROLES.KIOSK;
    } else if (userType === 'monitor') {
      role = ROLES.MONITOR;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid userType. Must be "user" or "monitor"'
      });
    }

    // Generate clientId
    const clientId = role === ROLES.KIOSK 
      ? `KIOSK_${Date.now()}`
      : `MONITOR_${Date.now()}`;

    // Create user
    users.set(username, {
      password, // In production, hash this password
      userType,
      clientId,
      role,
      name: name || username
    });

    logInfo('Auth', 'User registered successfully', {
      username,
      clientId,
      role,
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        clientId,
        role,
        name: name || username
      }
    });

  } catch (error) {
    logError('Auth', 'Registration error', {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/auth/users
 * 
 * List all users (for admin/debugging - remove in production)
 */
router.get('/users', (req, res) => {
  const userList = Array.from(users.entries()).map(([username, user]) => ({
    username,
    clientId: user.clientId,
    role: user.role,
    userType: user.userType,
    name: user.name
  }));

  res.json({
    success: true,
    users: userList,
    count: userList.length
  });
});

export default router;
