/**
 * REST auth middleware: requireAuth, requireAdmin, requireUser.
 */

import jwt from 'jsonwebtoken';
import User from '../modules/users/user.model.js';
import { logWarn } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'demo-secret-key-change-in-production';

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.userId) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    req.auth = { userId: decoded.userId, role: decoded.role, user_id: decoded.user_id };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

export async function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ success: false, message: 'Authentication required' });
  if (req.auth.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
}

export async function requireUser(req, res, next) {
  if (!req.auth) return res.status(401).json({ success: false, message: 'Authentication required' });
  if (req.auth.role !== 'USER') {
    return res.status(403).json({ success: false, message: 'User access required' });
  }
  next();
}
