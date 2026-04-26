import { sendError, sendSuccess } from '../../utils/apiResponse.js';
import { logWarn } from '../../utils/logger.js';
import { isValidUuid, validateDivisionCreate, validateDivisionUpdate } from './division.validator.js';
import {
  createDivision,
  getDivisionByIdForUser,
  listDivisionsForUser,
  updateDivision,
} from './division.service.js';

function parseStatus(value) {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

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

    const parsedStatus = parseStatus(req.query?.status);
    if (parsedStatus === null) {
      return sendError(res, 'status must be true or false', 400);
    }

    const sort = parseSort(
      req.query?.sort,
      new Set(['name', 'code', 'created_at', 'updated_at', 'status']),
      'created_at',
      'DESC'
    );
    if (!sort) {
      return sendError(res, 'Invalid sort format. Use sort=field:asc|desc', 400);
    }

    const result = await listDivisionsForUser(req.user, {
      search: (req.query?.search || req.query?.q || '').trim() || undefined,
      status: parsedStatus,
      limit,
      offset: (page - 1) * limit,
      sortField: sort.sortField,
      sortDirection: sort.sortDirection,
    });
    return sendSuccess(res, 'Divisions fetched successfully', {
      divisions: result.rows,
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
    logWarn('Divisions', 'Failed to list divisions', { error: error.message });
    return sendError(res, 'Failed to fetch divisions', 500);
  }
}

export async function getById(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) {
      return sendError(res, 'Invalid division id', 400);
    }

    const result = await getDivisionByIdForUser(id, req.user);
    if (!result) {
      return sendError(res, 'Division not found', 404);
    }
    if (result.forbidden) {
      return sendError(res, 'Forbidden', 403);
    }
    return sendSuccess(res, 'Division fetched successfully', { division: result.division });
  } catch (error) {
    logWarn('Divisions', 'Failed to fetch division', { error: error.message });
    return sendError(res, 'Failed to fetch division', 500);
  }
}

export async function create(req, res) {
  try {
    const validation = validateDivisionCreate(req.body);
    if (!validation.isValid) {
      return sendError(res, validation.errors[0], 400);
    }

    const division = await createDivision(validation.value, req.user);
    return sendSuccess(res, 'Division created successfully', { division }, 201);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return sendError(res, 'Division name or code already exists', 409);
    }
    logWarn('Divisions', 'Failed to create division', { error: error.message });
    return sendError(res, 'Failed to create division', 500);
  }
}

export async function patch(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) {
      return sendError(res, 'Invalid division id', 400);
    }

    const validation = validateDivisionUpdate(req.body);
    if (!validation.isValid) {
      return sendError(res, validation.errors[0], 400);
    }

    const division = await updateDivision(id, validation.value, req.user);
    if (!division) {
      return sendError(res, 'Division not found', 404);
    }

    return sendSuccess(res, 'Division updated successfully', { division });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return sendError(res, 'Division name or code already exists', 409);
    }
    logWarn('Divisions', 'Failed to update division', { error: error.message });
    return sendError(res, 'Failed to update division', 500);
  }
}
