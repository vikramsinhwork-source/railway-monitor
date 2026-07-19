import { sendError, sendSuccess } from '../../utils/apiResponse.js';
import { logInfo, logWarn } from '../../utils/logger.js';
import * as registerService from './register.service.js';
import {
  isValidUuid,
  parseBoolean,
  parseDateOnly,
  validateRegisterCreate,
  validateRegisterUpdate,
  validateRegisterQuestionMapping,
  validateEntriesQuery,
} from './register.validator.js';

export async function create(req, res) {
  try {
    const parsed = validateRegisterCreate(req.body || {});
    if (!parsed.isValid) {
      return sendError(res, parsed.errors[0], 400);
    }

    const register = await registerService.createRegister(parsed.value);
    logInfo('Registers', 'Register created', {
      registerId: register.id,
      createdBy: req.auth?.userId,
    });
    return sendSuccess(res, 'Register created', { register }, 201);
  } catch (err) {
    logWarn('Registers', 'Create register error', { error: err.message });
    return sendError(res, 'Failed to create register', 500);
  }
}

export async function list(req, res) {
  try {
    let isActive;
    if (req.query.isActive !== undefined || req.query.is_active !== undefined) {
      const raw = req.query.isActive ?? req.query.is_active;
      const parsed = parseBoolean(raw);
      if (parsed === null) {
        return sendError(res, 'isActive must be true or false', 400);
      }
      isActive = parsed;
    }

    const staffType = (req.query.staffType || req.query.staff_type || '')
      .toString()
      .trim()
      .toUpperCase() || null;
    const dutyType = (req.query.dutyType || req.query.duty_type || '')
      .toString()
      .trim()
      .toUpperCase() || null;
    const search = (req.query.search || req.query.q || '').toString().trim() || null;

    const registers = await registerService.listRegisters({
      isActive,
      search,
      staffType,
      dutyType,
    });
    return sendSuccess(res, 'Registers fetched', { registers });
  } catch (err) {
    logWarn('Registers', 'List registers error', { error: err.message });
    return sendError(res, 'Failed to list registers', 500);
  }
}

export async function getById(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }
    const register = await registerService.getRegisterById(req.params.id);
    if (!register) return sendError(res, 'Register not found', 404);
    return sendSuccess(res, 'Register fetched', { register });
  } catch (err) {
    logWarn('Registers', 'Get register error', { error: err.message });
    return sendError(res, 'Failed to get register', 500);
  }
}

export async function patch(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }
    const parsed = validateRegisterUpdate(req.body || {});
    if (!parsed.isValid) {
      return sendError(res, parsed.errors[0], 400);
    }
    if (Object.keys(parsed.value).length === 0) {
      return sendError(res, 'No valid fields to update', 400);
    }

    const register = await registerService.updateRegister(req.params.id, parsed.value);
    if (!register) return sendError(res, 'Register not found', 404);

    logInfo('Registers', 'Register updated', {
      registerId: register.id,
      updatedBy: req.auth?.userId,
    });
    return sendSuccess(res, 'Register updated', { register });
  } catch (err) {
    logWarn('Registers', 'Update register error', { error: err.message });
    return sendError(res, 'Failed to update register', 500);
  }
}

export async function remove(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }
    const register = await registerService.deactivateRegister(req.params.id);
    if (!register) return sendError(res, 'Register not found', 404);
    logInfo('Registers', 'Register deactivated', {
      registerId: register.id,
      deactivatedBy: req.auth?.userId,
    });
    return sendSuccess(res, 'Register deactivated', { register });
  } catch (err) {
    logWarn('Registers', 'Deactivate register error', { error: err.message });
    return sendError(res, 'Failed to deactivate register', 500);
  }
}

export async function listQuestions(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }
    const result = await registerService.getRegisterQuestions(req.params.id);
    if (result.error) {
      return sendError(res, result.error.message, result.error.status);
    }
    return sendSuccess(res, 'Register questions fetched', result);
  } catch (err) {
    logWarn('Registers', 'List register questions error', { error: err.message });
    return sendError(res, 'Failed to list register questions', 500);
  }
}

export async function replaceQuestions(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }
    const parsed = validateRegisterQuestionMapping(req.body || {});
    if (!parsed.isValid) {
      return sendError(res, parsed.errors[0], 400);
    }

    const result = await registerService.replaceRegisterQuestions(req.params.id, parsed.value);
    if (result.error) {
      return sendError(res, result.error.message, result.error.status);
    }

    logInfo('Registers', 'Register questions replaced', {
      registerId: req.params.id,
      count: parsed.value.length,
      updatedBy: req.auth?.userId,
    });
    return sendSuccess(res, 'Register questions updated', result);
  } catch (err) {
    logWarn('Registers', 'Replace register questions error', { error: err.message });
    return sendError(res, 'Failed to update register questions', 500);
  }
}

export async function listEntries(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }
    const parsed = validateEntriesQuery(req.query || {});
    if (!parsed.isValid) {
      return sendError(res, parsed.errors[0], 400);
    }

    const result = await registerService.listRegisterEntries(req.params.id, parsed.value);
    if (result.error) {
      return sendError(res, result.error.message, result.error.status);
    }
    return sendSuccess(res, 'Register entries fetched', result);
  } catch (err) {
    logWarn('Registers', 'List register entries error', { error: err.message });
    return sendError(res, 'Failed to list register entries', 500);
  }
}

export async function analyticsSummary(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }

    const fromDate = parseDateOnly(req.query.from_date);
    const toDate = parseDateOnly(req.query.to_date);
    if (
      (req.query.from_date !== undefined && req.query.from_date !== '' && !fromDate) ||
      (req.query.to_date !== undefined && req.query.to_date !== '' && !toDate)
    ) {
      return sendError(res, 'from_date and to_date must be in YYYY-MM-DD format', 400);
    }
    if (fromDate && toDate && fromDate > toDate) {
      return sendError(res, 'from_date cannot be after to_date', 400);
    }

    const result = await registerService.getRegisterAnalyticsSummary(req.params.id, {
      fromDate,
      toDate,
    });
    if (result.error) {
      return sendError(res, result.error.message, result.error.status);
    }
    return sendSuccess(res, 'Register analytics summary fetched', result);
  } catch (err) {
    logWarn('Registers', 'Register analytics summary error', { error: err.message });
    return sendError(res, 'Failed to fetch register analytics summary', 500);
  }
}

export async function exportPreview(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }

    const fromDate = parseDateOnly(req.query.from_date);
    const toDate = parseDateOnly(req.query.to_date);
    if (
      (req.query.from_date !== undefined && req.query.from_date !== '' && !fromDate) ||
      (req.query.to_date !== undefined && req.query.to_date !== '' && !toDate)
    ) {
      return sendError(res, 'from_date and to_date must be in YYYY-MM-DD format', 400);
    }
    if (fromDate && toDate && fromDate > toDate) {
      return sendError(res, 'from_date cannot be after to_date', 400);
    }

    const search = (req.query.search || req.query.q || '').toString().trim() || null;
    const result = await registerService.buildRegisterExportPreview(req.params.id, {
      fromDate,
      toDate,
      search,
    });
    if (result.error) {
      return sendError(res, result.error.message, result.error.status);
    }
    return sendSuccess(res, 'Register export preview fetched', { workbook: result });
  } catch (err) {
    logWarn('Registers', 'Register export preview error', { error: err.message });
    return sendError(res, 'Failed to preview register export', 500);
  }
}

export async function exportXlsx(req, res) {
  try {
    if (!isValidUuid(req.params.id)) {
      return sendError(res, 'Invalid register id', 400);
    }

    const fromDate = parseDateOnly(req.query.from_date);
    const toDate = parseDateOnly(req.query.to_date);
    if (
      (req.query.from_date !== undefined && req.query.from_date !== '' && !fromDate) ||
      (req.query.to_date !== undefined && req.query.to_date !== '' && !toDate)
    ) {
      return sendError(res, 'from_date and to_date must be in YYYY-MM-DD format', 400);
    }
    if (fromDate && toDate && fromDate > toDate) {
      return sendError(res, 'from_date cannot be after to_date', 400);
    }

    const search = (req.query.search || req.query.q || '').toString().trim() || null;
    const result = await registerService.buildRegisterExportXlsxBuffer(req.params.id, {
      fromDate,
      toDate,
      search,
    });
    if (result.error) {
      return sendError(res, result.error.message, result.error.status);
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.buffer);
  } catch (err) {
    logWarn('Registers', 'Register export XLSX error', { error: err.message });
    return sendError(res, 'Failed to export register', 500);
  }
}
