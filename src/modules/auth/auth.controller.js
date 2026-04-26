/**
 * Auth controller: POST /api/auth/login, POST /api/auth/signup.
 * Returns JWT with id, role, division_id, email, name (plus legacy userId/user_id claims).
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../users/user.model.js';
import { logInfo, logWarn } from '../../utils/logger.js';
import { toUserResponse } from '../users/userResponse.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';

const JWT_SECRET = process.env.JWT_SECRET || 'demo-secret-key-change-in-production';

function signAccessToken(user) {
  const normalizedRole = normalizeRole(user.role);
  const payload = {
    id: user.id,
    // Backward-compatible claims
    userId: user.id,
    role: normalizedRole,
    division_id: user.division_id || null,
    email: user.email || null,
    name: user.name,
    user_id: user.user_id,
  };
  return jwt.sign(payload, JWT_SECRET);
}

export async function signup(req, res) {
  try {
    const { user_id, name, password, email, crew_type, head_quarter, mobile } = req.body || {};

    if (!user_id || !name || !password) {
      return res.status(400).json({
        success: false,
        message: 'user_id, name, and password are required',
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      user_id,
      name,
      email: email !== undefined ? email || null : null,
      password_hash,
      role: 'USER',
      status: 'ACTIVE',
      created_by: null,
      crew_type: crew_type !== undefined ? crew_type || null : null,
      head_quarter: head_quarter !== undefined ? head_quarter || null : null,
      mobile: mobile !== undefined ? mobile || null : null,
    });

    logInfo('Auth', 'Self-signup', { user_id: user.user_id });

    const accessToken = signAccessToken(user);

    return res.status(201).json({
      success: true,
      accessToken,
      role: user.role,
      user: await toUserResponse(user),
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: 'user_id or email already exists',
      });
    }
    logWarn('Auth', 'Signup error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Signup failed' });
  }
}

export async function login(req, res) {
  try {
    const { user_id, password } = req.body;

    if (!user_id || !password) {
      return res.status(400).json({
        success: false,
        message: 'user_id and password are required',
      });
    }

    const user = await User.scope(null).findOne({ where: { user_id } });
    if (!user) {
      logWarn('Auth', 'Login failed: user not found', { user_id });
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logWarn('Auth', 'Login failed: invalid password', { user_id });
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    if (user.status !== 'ACTIVE') {
      logWarn('Auth', 'Login failed: user inactive', { user_id });
      return res.status(403).json({
        success: false,
        message: 'Account is inactive',
      });
    }

    const accessToken = signAccessToken(user);

    logInfo('Auth', 'Login success', { user_id: user.user_id, role: user.role });

    return res.json({
      success: true,
      accessToken,
      role: user.role,
      user: await toUserResponse(user),
    });
  } catch (err) {
    logWarn('Auth', 'Login error', { error: err.message });
    return res.status(500).json({
      success: false,
      message: 'Login failed',
    });
  }
}
