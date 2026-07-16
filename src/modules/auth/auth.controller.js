/**
 * Auth controller: login, signup, forgot-password, reset-password.
 * Returns JWT with id, role, division_id, email, name (plus legacy userId/user_id claims).
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import User from '../users/user.model.js';
import { logInfo, logWarn } from '../../utils/logger.js';
import { toUserResponse } from '../users/userResponse.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';
import { isValidEmail, normalizeEmail } from '../../utils/email.js';
import { resolveSignupStatus } from '../../utils/signupApproval.js';
import { sendPasswordResetEmail } from '../../services/email.service.js';

const JWT_SECRET = process.env.JWT_SECRET || 'demo-secret-key-change-in-production';
const PASSWORD_RESET_TTL_MS =
  Math.max(1, parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '30', 10)) * 60 * 1000;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

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

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildResetUrl(token) {
  return `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
}

const GENERIC_FORGOT_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

export async function signup(req, res) {
  try {
    const { user_id, name, password, email, crew_type, head_quarter, mobile } = req.body || {};

    if (!user_id || !name || !password || !email) {
      return res.status(400).json({
        success: false,
        message: 'user_id, name, email, and password are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'email is invalid',
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const status = resolveSignupStatus();
    const user = await User.create({
      user_id,
      name,
      email: normalizeEmail(email),
      password_hash,
      role: 'USER',
      status,
      approved_at: status === 'ACTIVE' ? new Date() : null,
      created_by: null,
      crew_type: crew_type !== undefined ? crew_type || null : null,
      head_quarter: head_quarter !== undefined ? head_quarter || null : null,
      mobile: mobile !== undefined ? mobile || null : null,
    });

    if (status === 'ACTIVE') {
      logInfo('Auth', 'Self-signup auto-approved', { user_id: user.user_id });
      return res.status(201).json({
        success: true,
        message: 'Registration successful. You can log in now.',
        user_id: user.user_id,
        status,
      });
    }

    logInfo('Auth', 'Self-signup pending approval', { user_id: user.user_id });

    return res.status(201).json({
      success: true,
      message: 'Registration submitted. Your account is pending admin approval.',
      user_id: user.user_id,
      status,
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

    if (user.status === 'PENDING_APPROVAL') {
      logWarn('Auth', 'Login failed: pending approval', { user_id });
      return res.status(403).json({
        success: false,
        error: 'ACCOUNT_PENDING_APPROVAL',
        message: 'Your account is awaiting admin approval.',
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

export async function forgotPassword(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email is required',
      });
    }

    const user = await User.scope(null).findOne({
      where: {
        email: { [Op.iLike]: email },
        status: 'ACTIVE',
      },
    });

    if (!user) {
      // Do not reveal whether the account exists.
      return res.json({ success: true, message: GENERIC_FORGOT_MESSAGE });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(token);
    const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await user.update({
      password_reset_token_hash: tokenHash,
      password_reset_expires: expires,
    });

    const resetUrl = buildResetUrl(token);
    const sendResult = await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl,
    });

    if (!sendResult.ok) {
      logWarn('Auth', 'Password reset email failed to send', { user_id: user.user_id });
      return res.status(502).json({
        success: false,
        message: 'Unable to send password reset email. Try again later.',
      });
    }

    logInfo('Auth', 'Password reset requested', { user_id: user.user_id });

    return res.json({ success: true, message: GENERIC_FORGOT_MESSAGE });
  } catch (err) {
    logWarn('Auth', 'Forgot password error', { error: err.message });
    return res.status(500).json({
      success: false,
      message: 'Unable to process password reset request',
    });
  }
}

export async function resetPassword(req, res) {
  try {
    const { token, password, newPassword } = req.body || {};
    const nextPassword = password || newPassword;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'token is required',
      });
    }

    if (!nextPassword || typeof nextPassword !== 'string' || nextPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'password must be at least 6 characters',
      });
    }

    const tokenHash = hashResetToken(token.trim());
    const user = await User.scope(null).findOne({
      where: {
        password_reset_token_hash: tokenHash,
        password_reset_expires: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: 'Account is inactive',
      });
    }

    const password_hash = await bcrypt.hash(nextPassword, 10);
    await user.update({
      password_hash,
      password_reset_token_hash: null,
      password_reset_expires: null,
    });

    logInfo('Auth', 'Password reset completed', { user_id: user.user_id });

    return res.json({
      success: true,
      message: 'Password has been reset. You can log in with your new password.',
    });
  } catch (err) {
    logWarn('Auth', 'Reset password error', { error: err.message });
    return res.status(500).json({
      success: false,
      message: 'Unable to reset password',
    });
  }
}
