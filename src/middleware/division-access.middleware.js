import Lobby from '../modules/divisions/lobby.model.js';
import MonitorLobbyAccess from '../modules/access/monitorLobby.model.js';
import { logWarn } from '../utils/logger.js';
import { ROLES, isSuperAdminRole, normalizeRole } from './rbac.middleware.js';

const ENFORCE_RBAC = process.env.RBAC_DRY_RUN !== 'true';

function getRequestedDivisionId(req) {
  return (
    req.params?.division_id ||
    req.params?.divisionId ||
    req.body?.division_id ||
    req.body?.divisionId ||
    req.query?.division_id ||
    req.query?.divisionId ||
    null
  );
}

function getRequestedLobbyId(req) {
  return (
    req.params?.lobby_id ||
    req.params?.lobbyId ||
    req.params?.id ||
    req.body?.lobby_id ||
    req.body?.lobbyId ||
    req.query?.lobby_id ||
    req.query?.lobbyId ||
    null
  );
}

function denyOrWarn(req, res, next, message, context = {}) {
  if (ENFORCE_RBAC) {
    return res.status(403).json({ success: false, message });
  }

  logWarn('DivisionAccess', `Dry-run bypass: ${message}`, {
    route: req.originalUrl,
    method: req.method,
    userId: req.user?.id || req.auth?.userId || null,
    role: req.user?.role || req.auth?.role || null,
    ...context,
  });
  return next();
}

export async function requireDivisionAccess(req, res, next) {
  try {
    const role = req.user?.role || req.auth?.role;
    if (isSuperAdminRole(role)) return next();

    const requestedDivisionId = getRequestedDivisionId(req);
    if (!requestedDivisionId) {
      return denyOrWarn(req, res, next, 'division_id is required for division scoped access');
    }

    const userDivisionId = req.user?.division_id || req.auth?.division_id || null;
    if (!userDivisionId || userDivisionId !== requestedDivisionId) {
      return denyOrWarn(req, res, next, 'Division access denied', {
        requestedDivisionId,
        userDivisionId,
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requireLobbyAccess(req, res, next) {
  try {
    const role = normalizeRole(req.user?.role || req.auth?.role);
    if (isSuperAdminRole(role)) return next();

    const requestedLobbyId = getRequestedLobbyId(req);
    if (!requestedLobbyId) {
      return denyOrWarn(req, res, next, 'lobby_id is required for lobby scoped access');
    }

    const lobby = await Lobby.findByPk(requestedLobbyId, {
      attributes: ['id', 'division_id'],
    });
    if (!lobby) {
      return res.status(404).json({ success: false, message: 'Lobby not found' });
    }

    const userDivisionId = req.user?.division_id || req.auth?.division_id || null;

    if (role === ROLES.DIVISION_ADMIN) {
      if (!userDivisionId || userDivisionId !== lobby.division_id) {
        return denyOrWarn(req, res, next, 'Division admin cannot access this lobby', {
          requestedLobbyId,
          lobbyDivisionId: lobby.division_id,
          userDivisionId,
        });
      }
      req.lobby = lobby;
      return next();
    }

    if (role === ROLES.MONITOR) {
      if (!userDivisionId || userDivisionId !== lobby.division_id) {
        return denyOrWarn(req, res, next, 'Monitor division mismatch for lobby', {
          requestedLobbyId,
          lobbyDivisionId: lobby.division_id,
          userDivisionId,
        });
      }

      const access = await MonitorLobbyAccess.findOne({
        where: {
          user_id: req.user?.id || req.auth?.userId,
          division_id: userDivisionId,
          lobby_id: requestedLobbyId,
          is_active: true,
        },
      });

      if (!access) {
        return denyOrWarn(req, res, next, 'Monitor is not assigned to this lobby', {
          requestedLobbyId,
          userDivisionId,
        });
      }

      req.lobby = lobby;
      return next();
    }

    return denyOrWarn(req, res, next, 'Lobby access denied for this role');
  } catch (error) {
    return next(error);
  }
}
