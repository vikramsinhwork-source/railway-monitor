/**
 * REST auth middleware: requireAuth, requireAdmin, requireUser.
 */

import jwt from 'jsonwebtoken';
import { normalizeRole } from './rbac.middleware.js';

const JWT_SECRET = process.env.JWT_SECRET || 'demo-secret-key-change-in-production';
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'DIVISION_ADMIN']);

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id || decoded.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const role = normalizeRole(decoded.role);
    const user = {
      id: userId,
      role,
      division_id: decoded.division_id || null,
      email: decoded.email || null,
      name: decoded.name || null,
      user_id: decoded.user_id || null,
    };

    req.user = user;
    // Legacy compatibility for existing controllers.
    req.auth = { userId: user.id, role: user.role, user_id: user.user_id, division_id: user.division_id };
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
  if (!ADMIN_ROLES.has(req.auth.role)) {
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
