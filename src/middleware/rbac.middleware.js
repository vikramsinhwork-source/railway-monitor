import { logWarn } from '../utils/logger.js';

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  DIVISION_ADMIN: 'DIVISION_ADMIN',
  MONITOR: 'MONITOR',
  USER: 'USER',
  LEGACY_ADMIN: 'ADMIN',
};

const ROLE_ALIAS = {
  [ROLES.LEGACY_ADMIN]: ROLES.SUPER_ADMIN,
};

const ENFORCE_RBAC = process.env.RBAC_DRY_RUN !== 'true';

export function normalizeRole(role) {
  if (!role) return role;
  return ROLE_ALIAS[role] || role;
}

function hasRole(userRole, allowedRoles) {
  const normalized = normalizeRole(userRole);
  return allowedRoles.includes(normalized);
}

function denyOrWarn(req, res, next, message) {
  if (ENFORCE_RBAC) {
    return res.status(403).json({ success: false, message });
  }

  logWarn('RBAC', `Dry-run bypass: ${message}`, {
    route: req.originalUrl,
    method: req.method,
    userId: req.user?.id || req.auth?.userId || null,
    role: req.user?.role || req.auth?.role || null,
  });
  return next();
}

export function requireSuperAdmin(req, res, next) {
  const role = req.user?.role || req.auth?.role;
  if (!hasRole(role, [ROLES.SUPER_ADMIN])) {
    return denyOrWarn(req, res, next, 'Super admin access required');
  }
  return next();
}

export function requireDivisionAdmin(req, res, next) {
  const role = req.user?.role || req.auth?.role;
  if (!hasRole(role, [ROLES.SUPER_ADMIN, ROLES.DIVISION_ADMIN])) {
    return denyOrWarn(req, res, next, 'Division admin access required');
  }
  return next();
}

export function requireMonitor(req, res, next) {
  const role = req.user?.role || req.auth?.role;
  if (!hasRole(role, [ROLES.SUPER_ADMIN, ROLES.DIVISION_ADMIN, ROLES.MONITOR])) {
    return denyOrWarn(req, res, next, 'Monitor access required');
  }
  return next();
}

export function isSuperAdminRole(role) {
  return hasRole(role, [ROLES.SUPER_ADMIN]);
}
