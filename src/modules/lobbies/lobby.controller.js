import { sendError, sendSuccess } from '../../utils/apiResponse.js';
import { logWarn } from '../../utils/logger.js';
import {
  isValidUuid,
  parseBoolean,
  validateLobbyCreate,
  validateLobbyUpdate,
} from './lobby.validator.js';
import {
  createLobbyForUser,
  disableLobbyForUser,
  getLobbyByIdForUser,
  listLobbiesForUser,
  updateLobbyForUser,
} from './lobby.service.js';

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
    if (page === null || limit === null) {
      return sendError(res, 'page and limit must be positive integers', 400);
    }

    if (req.query?.division_id && !isValidUuid(req.query.division_id)) {
      return sendError(res, 'division_id must be a valid UUID', 400);
    }
    const parsedStatus = parseBoolean(req.query?.status);
    if (parsedStatus === null) {
      return sendError(res, 'status must be true or false', 400);
    }

    const sort = parseSort(
      req.query?.sort,
      new Set(['name', 'station_name', 'city', 'status', 'created_at', 'updated_at']),
      'created_at',
      'DESC'
    );
    if (!sort) {
      return sendError(res, 'Invalid sort format. Use sort=field:asc|desc', 400);
    }

    const result = await listLobbiesForUser(req.user, {
      division_id: req.query?.division_id,
      city: (req.query?.city || '').trim() || undefined,
      search: (req.query?.search || req.query?.q || '').trim() || undefined,
      status: parsedStatus,
      limit,
      offset: (page - 1) * limit,
      sortField: sort.sortField,
      sortDirection: sort.sortDirection,
    });
    return sendSuccess(res, 'Lobbies fetched successfully', {
      lobbies: result.rows,
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
    logWarn('Lobbies', 'Failed to list lobbies', { error: error.message });
    return sendError(res, 'Failed to fetch lobbies', 500);
  }
}

export async function getById(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid lobby id', 400);

    const result = await getLobbyByIdForUser(id, req.user);
    if (!result) return sendError(res, 'Lobby not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Lobby fetched successfully', { lobby: result.lobby });
  } catch (error) {
    logWarn('Lobbies', 'Failed to fetch lobby', { error: error.message });
    return sendError(res, 'Failed to fetch lobby', 500);
  }
}

export async function create(req, res) {
  try {
    const validation = validateLobbyCreate(req.body);
    if (!validation.isValid) return sendError(res, validation.errors[0], 400);

    const result = await createLobbyForUser(validation.value, req.user);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Lobby created successfully', { lobby: result.lobby }, 201);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return sendError(res, 'Lobby already exists for division and station', 409);
    }
    logWarn('Lobbies', 'Failed to create lobby', { error: error.message });
    return sendError(res, 'Failed to create lobby', 500);
  }
}

export async function patch(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid lobby id', 400);

    const validation = validateLobbyUpdate(req.body);
    if (!validation.isValid) return sendError(res, validation.errors[0], 400);

    const result = await updateLobbyForUser(id, validation.value, req.user);
    if (!result) return sendError(res, 'Lobby not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Lobby updated successfully', { lobby: result.lobby });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return sendError(res, 'Lobby already exists for division and station', 409);
    }
    logWarn('Lobbies', 'Failed to update lobby', { error: error.message });
    return sendError(res, 'Failed to update lobby', 500);
  }
}

export async function remove(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid lobby id', 400);

    const result = await disableLobbyForUser(id, req.user);
    if (!result) return sendError(res, 'Lobby not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Lobby disabled successfully', { lobby: result.lobby });
  } catch (error) {
    logWarn('Lobbies', 'Failed to disable lobby', { error: error.message });
    return sendError(res, 'Failed to disable lobby', 500);
  }
}
