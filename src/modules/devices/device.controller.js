import { sendError, sendSuccess } from '../../utils/apiResponse.js';
import { logWarn } from '../../utils/logger.js';
import {
  isValidDeviceStatus,
  isValidDeviceType,
  isValidUuid,
  parseBoolean,
  validateDeviceCreate,
  validateDeviceUpdate,
} from './device.validator.js';
import {
  createDeviceForUser,
  deleteDeviceForUser,
  disableDeviceForUser,
  getDeviceByIdForUser,
  listDevicesForUser,
  reactivateDeviceForUser,
  updateDeviceForUser,
} from './device.service.js';

function parsePositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseSort(raw, allowedFields, defaultField = 'created_at', defaultDirection = 'DESC') {
  if (!raw) {
    return { sortField: defaultField, sortDirection: defaultDirection };
  }

  const [field, direction] = String(raw).split(':');
  const normalizedField = (field || '').trim();
  const normalizedDirection = (direction || 'desc').trim().toUpperCase();
  if (!allowedFields.has(normalizedField)) return null;
  if (!['ASC', 'DESC'].includes(normalizedDirection)) return null;
  return { sortField: normalizedField, sortDirection: normalizedDirection };
}

export async function list(req, res) {
  try {
    const page = parsePositiveInt(req.query?.page, 1);
    const limit = parsePositiveInt(req.query?.limit, 25);
    if (page === null || limit === null) return sendError(res, 'page and limit must be positive integers', 400);

    const { division_id, lobby_id, device_type, status } = req.query;
    if (division_id && !isValidUuid(division_id)) return sendError(res, 'division_id must be a valid UUID', 400);
    if (lobby_id && !isValidUuid(lobby_id)) return sendError(res, 'lobby_id must be a valid UUID', 400);
    if (device_type && !isValidDeviceType(device_type)) return sendError(res, 'device_type is invalid', 400);
    if (status && !isValidDeviceStatus(status)) return sendError(res, 'status is invalid', 400);
    const isActive = parseBoolean(req.query?.is_active);
    if (isActive === null) return sendError(res, 'is_active must be true or false', 400);

    const sort = parseSort(
      req.query?.sort,
      new Set([
        'device_name',
        'device_type',
        'status',
        'is_active',
        'created_at',
        'updated_at',
        'last_seen_at',
      ]),
      'created_at',
      'DESC'
    );
    if (!sort) return sendError(res, 'Invalid sort format. Use sort=field:asc|desc', 400);

    const result = await listDevicesForUser(req.user, {
      division_id,
      lobby_id,
      device_type: device_type?.toUpperCase(),
      status: status?.toUpperCase(),
      is_active: isActive,
      search: (req.query?.search || req.query?.q || '').trim() || undefined,
      limit,
      offset: (page - 1) * limit,
      sortField: sort.sortField,
      sortDirection: sort.sortDirection,
    });
    return sendSuccess(res, 'Devices fetched successfully', {
      devices: result.rows,
      pagination: {
        page,
        limit,
        total: result.count,
      },
      sort: {
        field: sort.sortField,
        direction: sort.sortDirection,
      },
    });
  } catch (error) {
    logWarn('Devices', 'Failed to list devices', { error: error.message });
    return sendError(res, 'Failed to fetch devices', 500);
  }
}

export async function getById(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid device id', 400);

    const result = await getDeviceByIdForUser(id, req.user);
    if (!result) return sendError(res, 'Device not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Device fetched successfully', { device: result.device });
  } catch (error) {
    logWarn('Devices', 'Failed to fetch device', { error: error.message });
    return sendError(res, 'Failed to fetch device', 500);
  }
}

export async function create(req, res) {
  try {
    const validation = validateDeviceCreate(req.body);
    if (!validation.isValid) return sendError(res, validation.errors[0], 400);

    const result = await createDeviceForUser(validation.value, req.user);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.invalidRelation) return sendError(res, 'lobby_id must belong to division_id', 400);

    return sendSuccess(res, 'Device created successfully', { device: result.device }, 201);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return sendError(res, 'Device already exists for division and lobby', 409);
    }
    logWarn('Devices', 'Failed to create device', { error: error.message });
    return sendError(res, 'Failed to create device', 500);
  }
}

export async function patch(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid device id', 400);

    const validation = validateDeviceUpdate(req.body);
    if (!validation.isValid) return sendError(res, validation.errors[0], 400);

    const result = await updateDeviceForUser(id, validation.value, req.user);
    if (!result) return sendError(res, 'Device not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.invalidRelation) return sendError(res, 'lobby_id must belong to division_id', 400);

    return sendSuccess(res, 'Device updated successfully', { device: result.device });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return sendError(res, 'Device already exists for division and lobby', 409);
    }
    logWarn('Devices', 'Failed to update device', { error: error.message });
    return sendError(res, 'Failed to update device', 500);
  }
}

export async function remove(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid device id', 400);

    const result = await deleteDeviceForUser(id, req.user);
    if (!result) return sendError(res, 'Device not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Device deleted successfully', { device: result.device });
  } catch (error) {
    logWarn('Devices', 'Failed to delete device', { error: error.message });
    return sendError(res, 'Failed to delete device', 500);
  }
}

export async function deactivate(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid device id', 400);

    const result = await disableDeviceForUser(id, req.user);
    if (!result) return sendError(res, 'Device not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Device deactivated successfully', { device: result.device });
  } catch (error) {
    logWarn('Devices', 'Failed to deactivate device', { error: error.message });
    return sendError(res, 'Failed to deactivate device', 500);
  }
}

export async function reactivate(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid device id', 400);

    const result = await reactivateDeviceForUser(id, req.user);
    if (!result) return sendError(res, 'Device not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Device reactivated successfully', { device: result.device });
  } catch (error) {
    logWarn('Devices', 'Failed to reactivate device', { error: error.message });
    return sendError(res, 'Failed to reactivate device', 500);
  }
}
