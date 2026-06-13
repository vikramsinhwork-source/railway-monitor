import { isValidUuid } from '../devices/device.validator.js';

const AGENT_COMMANDS = new Set([
  'START_KIOSK_STREAM',
  'STOP_KIOSK_STREAM',
  'START_CCTV_STREAM',
  'STOP_CCTV_STREAM',
  'OPEN_VNC',
  'REBOOT_PI',
  'REFRESH_RTSP',
  'TAKE_SCREENSHOT',
  'REBOOT',
  'REFRESH_STREAM',
  'RESTART_APP',
]);

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function isOptionalNumber(value) {
  if (value === undefined || value === null) return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalBoolean(value) {
  if (value === undefined || value === null) return true;
  return typeof value === 'boolean';
}

export function validateRegisterAgent(payload) {
  const errors = [];
  const deviceId = normalizeString(payload?.deviceId);
  const serialNumber = normalizeString(payload?.serialNumber);
  const hostname = normalizeString(payload?.hostname);
  const version = normalizeString(payload?.version);
  const capabilities = payload?.capabilities;

  if (!deviceId || !isValidUuid(deviceId)) errors.push('deviceId must be a valid UUID');
  if (!serialNumber) errors.push('serialNumber is required');
  if (!hostname) errors.push('hostname is required');
  if (!version) errors.push('version is required');
  if (!capabilities || typeof capabilities !== 'object') {
    errors.push('capabilities must be an object');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      deviceId,
      serialNumber,
      hostname,
      version,
      capabilities: capabilities || {},
    },
  };
}

export function validateAgentHeartbeat(payload) {
  const errors = [];
  const {
    cpu,
    memory,
    disk,
    temperature,
    uptime,
    kioskOnline,
    cctvOnline,
    vncOnline,
  } = payload || {};

  if (!isOptionalNumber(cpu)) errors.push('cpu must be a number');
  if (!isOptionalNumber(memory)) errors.push('memory must be a number');
  if (!isOptionalNumber(disk)) errors.push('disk must be a number');
  if (!isOptionalNumber(temperature)) errors.push('temperature must be a number');
  if (!isOptionalNumber(uptime)) errors.push('uptime must be a number');
  if (!isOptionalBoolean(kioskOnline)) errors.push('kioskOnline must be a boolean');
  if (!isOptionalBoolean(cctvOnline)) errors.push('cctvOnline must be a boolean');
  if (!isOptionalBoolean(vncOnline)) errors.push('vncOnline must be a boolean');

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      cpu: cpu ?? null,
      memory: memory ?? null,
      disk: disk ?? null,
      temperature: temperature ?? null,
      uptime: uptime ?? null,
      kioskOnline: kioskOnline ?? null,
      cctvOnline: cctvOnline ?? null,
      vncOnline: vncOnline ?? null,
    },
  };
}

export function validateAgentStatusUpdate(payload) {
  const errors = [];
  const {
    kioskReachable,
    cameraReachable,
    rtspWorking,
    vncWorking,
  } = payload || {};

  if (!isOptionalBoolean(kioskReachable)) errors.push('kioskReachable must be a boolean');
  if (!isOptionalBoolean(cameraReachable)) errors.push('cameraReachable must be a boolean');
  if (!isOptionalBoolean(rtspWorking)) errors.push('rtspWorking must be a boolean');
  if (!isOptionalBoolean(vncWorking)) errors.push('vncWorking must be a boolean');

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      kioskReachable: kioskReachable ?? null,
      cameraReachable: cameraReachable ?? null,
      rtspWorking: rtspWorking ?? null,
      vncWorking: vncWorking ?? null,
    },
  };
}

export function validateAgentCommandResult(payload) {
  const errors = [];
  const commandId = normalizeString(payload?.commandId);
  const success = payload?.success;
  const message = payload?.message === undefined ? null : normalizeString(payload?.message);

  if (!commandId || !isValidUuid(commandId)) errors.push('commandId must be a valid UUID');
  if (typeof success !== 'boolean') errors.push('success must be a boolean');

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      commandId,
      success,
      message,
      data: payload?.data ?? null,
    },
  };
}

export function validateAgentCommand(payload) {
  const errors = [];
  const command = normalizeString(payload?.command)?.toUpperCase() || null;

  if (!command || !AGENT_COMMANDS.has(command)) {
    errors.push('command is invalid or unsupported');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      command,
      payload: payload?.payload ?? null,
    },
  };
}

export function isValidAgentCommand(value) {
  return AGENT_COMMANDS.has(String(value || '').toUpperCase());
}

export { isValidUuid };
