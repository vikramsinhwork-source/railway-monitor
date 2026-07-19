const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAFF_TYPES = new Set(['ALP', 'LP', 'TM']);
const DUTY_TYPES = new Set(['SIGN_ON', 'SIGN_OFF']);

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

export function isValidUuid(value) {
  return UUID_REGEX.test(String(value || ''));
}

export function parseBoolean(value) {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

export function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function parseDateOnly(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, mo, da] = trimmed.split('-').map((n) => Number.parseInt(n, 10));
  const parsed = new Date(y, mo - 1, da);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}

export function validateRegisterCreate(payload) {
  const value = {
    name: normalizeString(payload?.name),
    description:
      payload?.description === undefined ? null : normalizeString(payload.description),
    is_active: payload?.is_active === undefined ? true : parseBoolean(payload.is_active),
    staff_type:
      payload?.staff_type === undefined && payload?.staffType === undefined
        ? null
        : normalizeString(payload?.staff_type ?? payload?.staffType)?.toUpperCase(),
    duty_type:
      payload?.duty_type === undefined && payload?.dutyType === undefined
        ? null
        : normalizeString(payload?.duty_type ?? payload?.dutyType)?.toUpperCase(),
  };

  const errors = [];
  if (!value.name) errors.push('name is required');
  if (value.is_active === null) errors.push('is_active must be a boolean');
  if (value.staff_type && !STAFF_TYPES.has(value.staff_type)) {
    errors.push('staff_type must be ALP, LP, or TM');
  }
  if (value.duty_type && !DUTY_TYPES.has(value.duty_type)) {
    errors.push('duty_type must be SIGN_ON or SIGN_OFF');
  }
  if ((value.staff_type && !value.duty_type) || (!value.staff_type && value.duty_type)) {
    errors.push('staff_type and duty_type must both be provided or both omitted');
  }

  return { isValid: errors.length === 0, errors, value };
}

export function validateRegisterUpdate(payload) {
  const value = {};
  const errors = [];

  if (payload?.name !== undefined) {
    const name = normalizeString(payload.name);
    if (!name) errors.push('name cannot be empty');
    else value.name = name;
  }

  if (payload?.description !== undefined) {
    value.description = normalizeString(payload.description);
  }

  if (payload?.is_active !== undefined) {
    const isActive = parseBoolean(payload.is_active);
    if (isActive === null) errors.push('is_active must be a boolean');
    else value.is_active = isActive;
  }

  const hasStaff =
    payload?.staff_type !== undefined || payload?.staffType !== undefined;
  const hasDuty = payload?.duty_type !== undefined || payload?.dutyType !== undefined;

  if (hasStaff) {
    const raw = payload?.staff_type ?? payload?.staffType;
    value.staff_type = raw === null || raw === '' ? null : normalizeString(raw)?.toUpperCase();
    if (value.staff_type && !STAFF_TYPES.has(value.staff_type)) {
      errors.push('staff_type must be ALP, LP, or TM');
    }
  }

  if (hasDuty) {
    const raw = payload?.duty_type ?? payload?.dutyType;
    value.duty_type = raw === null || raw === '' ? null : normalizeString(raw)?.toUpperCase();
    if (value.duty_type && !DUTY_TYPES.has(value.duty_type)) {
      errors.push('duty_type must be SIGN_ON or SIGN_OFF');
    }
  }

  return { isValid: errors.length === 0, errors, value };
}

export function validateRegisterQuestionMapping(payload) {
  const questions = payload?.questions;
  const errors = [];

  if (!Array.isArray(questions)) {
    return { isValid: false, errors: ['questions must be an array'], value: null };
  }

  const seen = new Set();
  const value = [];

  for (const [index, item] of questions.entries()) {
    if (!item || typeof item !== 'object') {
      errors.push(`questions[${index}] must be an object`);
      continue;
    }

    const questionId = item.question_id ?? item.questionId;
    if (!isValidUuid(questionId)) {
      errors.push(`questions[${index}].question_id must be a valid UUID`);
      continue;
    }
    if (seen.has(questionId)) {
      errors.push(`Duplicate question_id ${questionId}`);
      continue;
    }
    seen.add(questionId);

    let sortOrder = item.sort_order ?? item.sortOrder ?? index;
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      errors.push(`questions[${index}].sort_order must be an integer >= 0`);
      continue;
    }

    let isKeyField = false;
    if (item.is_key_field !== undefined || item.isKeyField !== undefined) {
      const parsed = parseBoolean(item.is_key_field ?? item.isKeyField);
      if (parsed === null) {
        errors.push(`questions[${index}].is_key_field must be a boolean`);
        continue;
      }
      isKeyField = parsed;
    }

    const columnLabelRaw = item.column_label ?? item.columnLabel;
    const columnLabel =
      columnLabelRaw === undefined || columnLabelRaw === null
        ? null
        : normalizeString(columnLabelRaw);

    value.push({
      question_id: questionId,
      sort_order: sortOrder,
      column_label: columnLabel,
      is_key_field: isKeyField,
    });
  }

  return { isValid: errors.length === 0, errors, value };
}

export function validateEntriesQuery(query) {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 20);
  const errors = [];

  if (!page || !limit) errors.push('page and limit must be positive integers');
  if (limit && limit > 100) errors.push('limit cannot exceed 100');

  const fromDate = parseDateOnly(query.from_date);
  const toDate = parseDateOnly(query.to_date);
  if ((query.from_date !== undefined && query.from_date !== '' && !fromDate) ||
      (query.to_date !== undefined && query.to_date !== '' && !toDate)) {
    errors.push('from_date and to_date must be in YYYY-MM-DD format');
  }
  if (fromDate && toDate && fromDate > toDate) {
    errors.push('from_date cannot be after to_date');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      page: page || 1,
      limit: limit || 20,
      fromDate,
      toDate,
      search: normalizeString(query.search || query.q) || null,
    },
  };
}
