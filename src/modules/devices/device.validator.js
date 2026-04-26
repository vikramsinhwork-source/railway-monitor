const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_TYPES = new Set(['KIOSK', 'CAMERA', 'DVR', 'RASPBERRY', 'NVR']);
const DEVICE_STATUSES = new Set(['ONLINE', 'OFFLINE', 'MAINTENANCE']);

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

export function validateDeviceCreate(payload) {
  const value = {
    division_id: normalizeString(payload?.division_id),
    lobby_id: normalizeString(payload?.lobby_id),
    device_type: normalizeString(payload?.device_type)?.toUpperCase() || null,
    device_name: normalizeString(payload?.device_name),
    stream_url: payload?.stream_url === undefined ? null : normalizeString(payload?.stream_url),
    ip_address: payload?.ip_address === undefined ? null : normalizeString(payload?.ip_address),
    mac_address: payload?.mac_address === undefined ? null : normalizeString(payload?.mac_address),
    serial_number: payload?.serial_number === undefined ? null : normalizeString(payload?.serial_number),
    status: payload?.status ? normalizeString(payload.status)?.toUpperCase() : undefined,
    meta: payload?.meta === undefined ? null : payload.meta,
    last_seen_at: payload?.last_seen_at ? new Date(payload.last_seen_at) : null,
    health_status: payload?.health_status === undefined ? null : normalizeString(payload?.health_status),
    firmware_version: payload?.firmware_version === undefined ? null : normalizeString(payload?.firmware_version),
    notes: payload?.notes === undefined ? null : normalizeString(payload?.notes),
  };

  const errors = [];
  if (!value.division_id || !isValidUuid(value.division_id)) errors.push('division_id must be a valid UUID');
  if (!value.lobby_id || !isValidUuid(value.lobby_id)) errors.push('lobby_id must be a valid UUID');
  if (!value.device_name) errors.push('device_name is required');
  if (!value.device_type || !DEVICE_TYPES.has(value.device_type)) errors.push('device_type is invalid');
  if (value.status && !DEVICE_STATUSES.has(value.status)) errors.push('status is invalid');
  if (value.last_seen_at && Number.isNaN(value.last_seen_at.getTime())) errors.push('last_seen_at must be a valid date');

  return {
    isValid: errors.length === 0,
    errors,
    value,
  };
}

export function validateDeviceUpdate(payload) {
  const value = {};
  const errors = [];

  if (payload?.device_name !== undefined) {
    const deviceName = normalizeString(payload.device_name);
    if (!deviceName) errors.push('device_name cannot be empty');
    else value.device_name = deviceName;
  }

  if (payload?.stream_url !== undefined) value.stream_url = normalizeString(payload.stream_url);
  if (payload?.ip_address !== undefined) value.ip_address = normalizeString(payload.ip_address);
  if (payload?.mac_address !== undefined) value.mac_address = normalizeString(payload.mac_address);
  if (payload?.serial_number !== undefined) value.serial_number = normalizeString(payload.serial_number);
  if (payload?.notes !== undefined) value.notes = normalizeString(payload.notes);
  if (payload?.firmware_version !== undefined) value.firmware_version = normalizeString(payload.firmware_version);
  if (payload?.health_status !== undefined) value.health_status = normalizeString(payload.health_status);
  if (payload?.meta !== undefined) value.meta = payload.meta;

  if (payload?.status !== undefined) {
    const status = normalizeString(payload.status)?.toUpperCase();
    if (!status || !DEVICE_STATUSES.has(status)) errors.push('status is invalid');
    else value.status = status;
  }

  if (payload?.device_type !== undefined) {
    const deviceType = normalizeString(payload.device_type)?.toUpperCase();
    if (!deviceType || !DEVICE_TYPES.has(deviceType)) errors.push('device_type is invalid');
    else value.device_type = deviceType;
  }

  if (payload?.division_id !== undefined) {
    const divisionId = normalizeString(payload.division_id);
    if (!divisionId || !isValidUuid(divisionId)) errors.push('division_id must be a valid UUID');
    else value.division_id = divisionId;
  }

  if (payload?.lobby_id !== undefined) {
    const lobbyId = normalizeString(payload.lobby_id);
    if (!lobbyId || !isValidUuid(lobbyId)) errors.push('lobby_id must be a valid UUID');
    else value.lobby_id = lobbyId;
  }

  if (payload?.is_active !== undefined) {
    if (typeof payload.is_active !== 'boolean') errors.push('is_active must be boolean');
    else value.is_active = payload.is_active;
  }

  if (payload?.last_seen_at !== undefined) {
    if (payload.last_seen_at === null) {
      value.last_seen_at = null;
    } else {
      const lastSeenAt = new Date(payload.last_seen_at);
      if (Number.isNaN(lastSeenAt.getTime())) errors.push('last_seen_at must be a valid date');
      else value.last_seen_at = lastSeenAt;
    }
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

export function isValidDeviceType(value) {
  return DEVICE_TYPES.has(String(value || '').toUpperCase());
}

export function isValidDeviceStatus(value) {
  return DEVICE_STATUSES.has(String(value || '').toUpperCase());
}
