/**
 * Auth controller: POST /api/auth/login with user_id + password.
 * Returns JWT with userId, role; response: accessToken, role, user.
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../users/user.model.js';
import { logInfo, logWarn } from '../../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'demo-secret-key-change-in-production';

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

    const payload = {
      userId: user.id,
      role: user.role,
      user_id: user.user_id,
      name: user.name,
    };
    // No expiresIn = lifetime token (never expires)
const accessToken = jwt.sign(payload, JWT_SECRET);

    const userPojo = user.get({ plain: true });
    delete userPojo.password_hash;

    logInfo('Auth', 'Login success', { user_id: user.user_id, role: user.role });

    return res.json({
      success: true,
      accessToken,
      role: user.role,
      user: {
        id: user.id,
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (err) {
    logWarn('Auth', 'Login error', { error: err.message });
    return res.status(500).json({
      success: false,
      message: 'Login failed',
    });
  }
}
