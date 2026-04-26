import { Op } from 'sequelize';
import Device from '../divisions/device.model.js';
import Lobby from '../divisions/lobby.model.js';
import MonitorLobbyAccess from '../access/monitorLobby.model.js';
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

function toDeviceResponse(device) {
  return {
    id: device.id,
    division_id: device.division_id,
    lobby_id: device.lobby_id,
    device_type: device.device_type,
    device_name: device.device_name,
    stream_url: device.stream_url,
    ip_address: device.ip_address,
    mac_address: device.mac_address,
    serial_number: device.serial_number,
    status: device.status,
    is_active: device.is_active,
    meta: device.meta,
    last_seen_at: device.last_seen_at,
    health_status: device.health_status,
    firmware_version: device.firmware_version,
    notes: device.notes,
    created_at: device.created_at,
    updated_at: device.updated_at,
  };
}

async function getAllowedMonitorLobbyIds(userId) {
  const assignments = await MonitorLobbyAccess.findAll({
    where: {
      user_id: userId,
      is_active: true,
    },
    attributes: ['lobby_id'],
  });
  return assignments.map((row) => row.lobby_id);
}

async function ensureLobbyBelongsToDivision(lobbyId, divisionId) {
  const lobby = await Lobby.findOne({
    where: {
      id: lobbyId,
      division_id: divisionId,
    },
    attributes: ['id', 'division_id'],
  });
  return !!lobby;
}

export async function listDevicesForUser(user, filters = {}) {
  const role = normalizeRole(user.role);
  const where = {};

  if (filters.division_id) where.division_id = filters.division_id;
  if (filters.lobby_id) where.lobby_id = filters.lobby_id;
  if (filters.device_type) where.device_type = filters.device_type;
  if (filters.status) where.status = filters.status;
  if (filters.is_active !== undefined) where.is_active = filters.is_active;
  if (filters.search) {
    where[Op.or] = [
      { device_name: { [Op.iLike]: `%${filters.search}%` } },
      { ip_address: { [Op.iLike]: `%${filters.search}%` } },
      { serial_number: { [Op.iLike]: `%${filters.search}%` } },
      { firmware_version: { [Op.iLike]: `%${filters.search}%` } },
    ];
  }

  if (isDivisionAdmin(role)) {
    if (!user.division_id) return [];
    where.division_id = user.division_id;
  } else if (isMonitor(role)) {
    if (!user.division_id) return [];
    where.division_id = user.division_id;
    const allowedLobbyIds = await getAllowedMonitorLobbyIds(user.id);
    if (allowedLobbyIds.length === 0) return [];
    where.lobby_id = where.lobby_id
      ? { [Op.and]: [where.lobby_id, { [Op.in]: allowedLobbyIds }] }
      : { [Op.in]: allowedLobbyIds };
  } else if (!isSuperAdmin(role)) {
    return [];
  }

  const devices = await Device.findAndCountAll({
    where,
    limit: filters.limit,
    offset: filters.offset,
    order: [[filters.sortField || 'created_at', filters.sortDirection || 'DESC']],
  });
  return {
    rows: devices.rows.map(toDeviceResponse),
    count: devices.count,
  };
}

export async function getDeviceByIdForUser(id, user) {
  const role = normalizeRole(user.role);
  const device = await Device.findByPk(id);
  if (!device) return null;

  if (isSuperAdmin(role)) {
    return { device: toDeviceResponse(device) };
  }

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== device.division_id) return { forbidden: true };
    return { device: toDeviceResponse(device) };
  }

  if (isMonitor(role)) {
    if (!user.division_id || user.division_id !== device.division_id) return { forbidden: true };
    const allowedLobbyIds = await getAllowedMonitorLobbyIds(user.id);
    if (!allowedLobbyIds.includes(device.lobby_id)) return { forbidden: true };
    return { device: toDeviceResponse(device) };
  }

  return { forbidden: true };
}

export async function createDeviceForUser(payload, user) {
  const role = normalizeRole(user.role);
  const data = { ...payload };

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== data.division_id) return { forbidden: true };
  } else if (!isSuperAdmin(role)) {
    return { forbidden: true };
  }

  const isLinked = await ensureLobbyBelongsToDivision(data.lobby_id, data.division_id);
  if (!isLinked) {
    return { invalidRelation: true };
  }

  const device = await Device.create({
    ...data,
    status: data.status || 'OFFLINE',
    is_active: true,
  });
  const response = toDeviceResponse(device);

  await createAuditLog({
    userId: user.id,
    action: 'DEVICE_CREATE',
    entityType: 'device',
    entityId: device.id,
    oldData: null,
    newData: response,
  });

  return { device: response };
}

export async function updateDeviceForUser(id, updates, user) {
  const role = normalizeRole(user.role);
  const device = await Device.findByPk(id);
  if (!device) return null;

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== device.division_id) return { forbidden: true };
  } else if (!isSuperAdmin(role)) {
    return { forbidden: true };
  }

  const finalDivisionId = updates.division_id || device.division_id;
  const finalLobbyId = updates.lobby_id || device.lobby_id;
  const isLinked = await ensureLobbyBelongsToDivision(finalLobbyId, finalDivisionId);
  if (!isLinked) return { invalidRelation: true };

  if (isDivisionAdmin(role) && finalDivisionId !== user.division_id) {
    return { forbidden: true };
  }

  const before = toDeviceResponse(device);
  await device.update(updates);
  await device.reload();
  const after = toDeviceResponse(device);

  await createAuditLog({
    userId: user.id,
    action: 'DEVICE_UPDATE',
    entityType: 'device',
    entityId: device.id,
    oldData: before,
    newData: after,
  });

  return { device: after };
}

export async function disableDeviceForUser(id, user) {
  const role = normalizeRole(user.role);
  const device = await Device.findByPk(id);
  if (!device) return null;

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== device.division_id) return { forbidden: true };
  } else if (!isSuperAdmin(role)) {
    return { forbidden: true };
  }

  const before = toDeviceResponse(device);
  await device.update({ is_active: false });
  await device.reload();
  const after = toDeviceResponse(device);

  await createAuditLog({
    userId: user.id,
    action: 'DEVICE_DISABLE',
    entityType: 'device',
    entityId: device.id,
    oldData: before,
    newData: after,
  });

  return { device: after };
}

export async function reactivateDeviceForUser(id, user) {
  const role = normalizeRole(user.role);
  const device = await Device.findByPk(id);
  if (!device) return null;

  if (isDivisionAdmin(role)) {
    if (!user.division_id || user.division_id !== device.division_id) return { forbidden: true };
  } else if (!isSuperAdmin(role)) {
    return { forbidden: true };
  }

  const before = toDeviceResponse(device);
  await device.update({ is_active: true });
  await device.reload();
  const after = toDeviceResponse(device);

  await createAuditLog({
    userId: user.id,
    action: 'DEVICE_REACTIVATE',
    entityType: 'device',
    entityId: device.id,
    oldData: before,
    newData: after,
  });

  return { device: after };
}
