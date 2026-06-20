import { isValidUuid } from '../devices/device.validator.js';

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

export function validateRegisterPayload(payload) {
  const errors = [];
  const deviceId = normalizeString(payload?.deviceId);
  const divisionId = normalizeString(payload?.divisionId || payload?.division_id);
  const lobbyId = normalizeString(payload?.lobbyId || payload?.lobby_id);
  const deviceName = normalizeString(payload?.deviceName || payload?.device_name);
  const serialNumber = normalizeString(payload?.serialNumber || payload?.serial_number);
  const hostname = normalizeString(payload?.hostname);
  const ipAddress = normalizeString(payload?.ipAddress || payload?.ip_address);
  const agentVersion = normalizeString(payload?.agentVersion || payload?.agent_version);

  if (deviceId && !isValidUuid(deviceId)) errors.push('deviceId must be a valid UUID when provided');
  if (divisionId && !isValidUuid(divisionId)) errors.push('divisionId must be a valid UUID');
  if (lobbyId && !isValidUuid(lobbyId)) errors.push('lobbyId must be a valid UUID');

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      deviceId,
      divisionId,
      lobbyId,
      deviceName,
      serialNumber,
      hostname,
      ipAddress,
      agentVersion,
      mediamtxPaths: Array.isArray(payload?.mediamtxPaths) ? payload.mediamtxPaths : [],
      stationCode: normalizeString(payload?.stationCode),
    },
  };
}

export function validateHeartbeatPayload(payload) {
  const errors = [];
  const deviceId = normalizeString(payload?.deviceId);
  if (!deviceId || !isValidUuid(deviceId)) errors.push('deviceId must be a valid UUID');

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      deviceId,
      metrics: {
        cpu: payload?.cpu ?? null,
        memory: payload?.memory ?? null,
        disk: payload?.disk ?? null,
        temperature: payload?.temperature ?? null,
        uptime: payload?.uptime ?? null,
        ipAddress: normalizeString(payload?.ipAddress || payload?.ip_address),
        agentVersion: normalizeString(payload?.agentVersion || payload?.agent_version),
        hostname: normalizeString(payload?.hostname),
      },
    },
  };
}

export function validateStreamStatusPayload(payload) {
  const errors = [];
  const deviceId = normalizeString(payload?.deviceId);
  if (!deviceId || !isValidUuid(deviceId)) errors.push('deviceId must be a valid UUID');
  if (!payload?.streams && !payload?.mediamtx && !payload?.go2rtc) {
    errors.push('streams or mediamtx status is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      deviceId,
      streamPayload: payload,
    },
  };
}

export function validateScreenshotUpload(fields) {
  const errors = [];
  const deviceId = normalizeString(fields?.deviceId);
  const screenType = normalizeString(fields?.screenType || fields?.screen_type);

  if (!deviceId || !isValidUuid(deviceId)) errors.push('deviceId must be a valid UUID');
  if (!screenType || !['desktop', 'kiosk'].includes(screenType)) {
    errors.push('screenType must be desktop or kiosk');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: { deviceId, screenType },
  };
}

export function validateDeviceOnlinePayload(payload) {
  const errors = [];
  const deviceId = normalizeString(payload?.deviceId);
  if (!deviceId || !isValidUuid(deviceId)) errors.push('deviceId must be a valid UUID');

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      deviceId,
      ipAddress: normalizeString(payload?.ipAddress || payload?.ip_address),
      agentVersion: normalizeString(payload?.agentVersion || payload?.agent_version),
      hostname: normalizeString(payload?.hostname),
      mediamtxPaths: Array.isArray(payload?.mediamtxPaths) ? payload.mediamtxPaths : [],
      capabilities: payload?.capabilities || null,
      serialNumber: normalizeString(payload?.serialNumber || payload?.serial_number),
    },
  };
}

export function validateCommandResultPayload(payload) {
  const errors = [];
  const commandId = normalizeString(payload?.commandId);
  const success = payload?.success;
  const message = payload?.message === undefined ? null : normalizeString(payload?.message);
  const timestamp = normalizeString(payload?.timestamp) || new Date().toISOString();

  if (!commandId || !isValidUuid(commandId)) errors.push('commandId must be a valid UUID');
  if (typeof success !== 'boolean') errors.push('success must be a boolean');

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      commandId,
      success,
      message,
      timestamp,
      data: payload?.data ?? null,
    },
  };
}
