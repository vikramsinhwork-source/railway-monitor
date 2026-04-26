const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

export function isValidUuid(value) {
  return UUID_REGEX.test(String(value || ''));
}

export function validateDivisionCreate(payload) {
  const name = normalizeString(payload?.name);
  const code = normalizeString(payload?.code);
  const description = payload?.description === undefined ? null : normalizeString(payload.description);

  const errors = [];
  if (!name) errors.push('name is required');
  if (!code) errors.push('code is required');
  if (code && code.length > 10) errors.push('code must be 10 characters or fewer');

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      name,
      code,
      description,
    },
  };
}

export function validateDivisionUpdate(payload) {
  const value = {};
  const errors = [];

  if (payload?.name !== undefined) {
    const name = normalizeString(payload.name);
    if (!name) errors.push('name cannot be empty');
    else value.name = name;
  }

  if (payload?.code !== undefined) {
    const code = normalizeString(payload.code);
    if (!code) errors.push('code cannot be empty');
    else if (code.length > 10) errors.push('code must be 10 characters or fewer');
    else value.code = code;
  }

  if (payload?.description !== undefined) {
    value.description = normalizeString(payload.description);
  }

  if (payload?.status !== undefined) {
    if (typeof payload.status !== 'boolean') errors.push('status must be boolean');
    else value.status = payload.status;
  }

  if (Object.keys(value).length === 0 && errors.length === 0) {
    errors.push('No valid fields provided for update');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value,
  };
}
