import jwt from 'jsonwebtoken';
import { ROLES } from '../../auth/auth.middleware.js';
import { sendError } from '../../utils/apiResponse.js';

const JWT_SECRET = process.env.JWT_SECRET || 'demo-secret-key-change-in-production';

/**
 * Authenticate Raspberry Pi agent REST requests using device JWT (KIOSK role).
 */
export function requireDeviceAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return sendError(res, 'Authentication required', 401);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const clientId = decoded.clientId;
    const role = decoded.role;

    if (role !== ROLES.KIOSK || !clientId) {
      return sendError(res, 'Device token required (KIOSK role)', 403);
    }

    req.deviceAuth = { deviceId: String(clientId), role };
    return next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return sendError(res, message, 401);
  }
}

/**
 * Ensure authenticated device can only act on its own deviceId.
 */
export function requireOwnDevice(req, res, next) {
  const bodyDeviceId = req.body?.deviceId || req.params?.id;
  if (bodyDeviceId && req.deviceAuth?.deviceId && bodyDeviceId !== req.deviceAuth.deviceId) {
    return sendError(res, 'Forbidden: deviceId mismatch', 403);
  }
  return next();
}
