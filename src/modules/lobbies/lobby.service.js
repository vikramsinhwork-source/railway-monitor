import { Op } from 'sequelize';
import Lobby from '../divisions/lobby.model.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';
import { createAuditLog } from '../audit/audit.service.js';

function isSuperAdmin(role) {
  return normalizeRole(role) === 'SUPER_ADMIN';
}

function isDivisionAdmin(role) {
  return normalizeRole(role) === 'DIVISION_ADMIN';
}

function isMonitor(role) {
  return normalizeRole(role) === 'MONITOR';
}

function toLobbyResponse(lobby) {
  return {
    id: lobby.id,
    division_id: lobby.division_id,
    name: lobby.name,
    station_name: lobby.station_name,
    city: lobby.city,
    location: lobby.location,
    status: lobby.status,
    created_at: lobby.created_at,
    updated_at: lobby.updated_at,
  };
}

export async function listLobbiesForUser(user, filters = {}) {
  const role = normalizeRole(user.role);
  const where = {};

  if (filters.search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${filters.search}%` } },
      { station_name: { [Op.iLike]: `%${filters.search}%` } },
      { city: { [Op.iLike]: `%${filters.search}%` } },
    ];
  }

  if (filters.division_id) where.division_id = filters.division_id;
  if (filters.city) where.city = { [Op.iLike]: `%${filters.city}%` };
  if (filters.status !== undefined) where.status = filters.status;

  if (isDivisionAdmin(role)) {
    if (!user.division_id) return [];
    where.division_id = user.division_id;
  } else if (isMonitor(role)) {
    if (!user.division_id) return [];
    where.division_id = user.division_id;
  } else if (!isSuperAdmin(role)) {
    return [];
  }

  const lobbies = await Lobby.findAndCountAll({
    where,
    limit: filters.limit,
    offset: filters.offset,
    order: [[filters.sortField || 'created_at', filters.sortDirection || 'DESC']],
  });
  return {
    rows: lobbies.rows.map(toLobbyResponse),
    count: lobbies.count,
  };
}

export async function getLobbyByIdForUser(id, user) {
  const role = normalizeRole(user.role);
  const lobby = await Lobby.findByPk(id);
  if (!lobby) return null;

  if (isSuperAdmin(role)) {
    return { lobby: toLobbyResponse(lobby) };
  }

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== lobby.division_id) return { forbidden: true };
    return { lobby: toLobbyResponse(lobby) };
  }

  if (isMonitor(role)) {
    if (!user.division_id || user.division_id !== lobby.division_id) return { forbidden: true };
    return { lobby: toLobbyResponse(lobby) };
  }

  return { forbidden: true };
}

export async function createLobbyForUser(payload, user) {
  const role = normalizeRole(user.role);
  const data = { ...payload };

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== data.division_id) return { forbidden: true };
  } else if (!isSuperAdmin(role)) {
    return { forbidden: true };
  }

  const lobby = await Lobby.create({
    ...data,
    status: true,
  });

  const response = toLobbyResponse(lobby);
  await createAuditLog({
    userId: user.id,
    action: 'LOBBY_CREATE',
    entityType: 'lobby',
    entityId: lobby.id,
    oldData: null,
    newData: response,
  });
  return { lobby: response };
}

export async function updateLobbyForUser(id, updates, user) {
  const role = normalizeRole(user.role);
  const lobby = await Lobby.findByPk(id);
  if (!lobby) return null;

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== lobby.division_id) return { forbidden: true };
  } else if (!isSuperAdmin(role)) {
    return { forbidden: true };
  }

  const before = toLobbyResponse(lobby);
  await lobby.update(updates);
  await lobby.reload();
  const after = toLobbyResponse(lobby);

  await createAuditLog({
    userId: user.id,
    action: 'LOBBY_UPDATE',
    entityType: 'lobby',
    entityId: lobby.id,
    oldData: before,
    newData: after,
  });

  return { lobby: after };
}

export async function disableLobbyForUser(id, user) {
  const role = normalizeRole(user.role);
  const lobby = await Lobby.findByPk(id);
  if (!lobby) return null;

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== lobby.division_id) return { forbidden: true };
  } else if (!isSuperAdmin(role)) {
    return { forbidden: true };
  }

  const before = toLobbyResponse(lobby);
  await lobby.update({ status: false });
  await lobby.reload();
  const after = toLobbyResponse(lobby);

  await createAuditLog({
    userId: user.id,
    action: 'LOBBY_DISABLE',
    entityType: 'lobby',
    entityId: lobby.id,
    oldData: before,
    newData: after,
  });

  return { lobby: after };
}
