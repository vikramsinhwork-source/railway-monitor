const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function validateLobbyCreate(payload) {
  const value = {
    division_id: normalizeString(payload?.division_id),
    name: normalizeString(payload?.name),
    station_name: normalizeString(payload?.station_name),
    city: payload?.city === undefined ? null : normalizeString(payload?.city),
    location: payload?.location === undefined ? null : normalizeString(payload?.location),
  };

  const errors = [];
  if (!value.division_id || !isValidUuid(value.division_id)) errors.push('division_id must be a valid UUID');
  if (!value.name) errors.push('name is required');
  if (!value.station_name) errors.push('station_name is required');

  return {
    isValid: errors.length === 0,
    errors,
    value,
  };
}

export function validateLobbyUpdate(payload) {
  const value = {};
  const errors = [];

  if (payload?.name !== undefined) {
    const name = normalizeString(payload.name);
    if (!name) errors.push('name cannot be empty');
    else value.name = name;
  }

  if (payload?.station_name !== undefined) {
    const station = normalizeString(payload.station_name);
    if (!station) errors.push('station_name cannot be empty');
    else value.station_name = station;
  }

  if (payload?.city !== undefined) {
    value.city = normalizeString(payload.city);
  }

  if (payload?.location !== undefined) {
    value.location = normalizeString(payload.location);
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
