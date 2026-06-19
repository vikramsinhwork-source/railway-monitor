const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STREAM_TYPES = new Set(['KIOSK', 'CCTV']);
const STREAM_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

export function isValidUuid(value) {
  return UUID_REGEX.test(String(value || ''));
}

export function validateStreamRequest(payload) {
  const errors = [];
  const deviceId = normalizeString(payload?.deviceId);
  const streamType = normalizeString(payload?.streamType)?.toUpperCase() || null;
  const streamName = normalizeString(payload?.streamName);

  if (!deviceId || !isValidUuid(deviceId)) errors.push('deviceId must be a valid UUID');
  if (!streamType || !STREAM_TYPES.has(streamType)) errors.push('streamType must be KIOSK or CCTV');
  if (streamName && !STREAM_NAME_REGEX.test(streamName)) {
    errors.push('streamName must be 1-64 alphanumeric, underscore, or hyphen characters');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: { deviceId, streamType, streamName: streamName || null },
  };
}

export function validateStreamSessionId(payload) {
  const sessionId = normalizeString(payload?.sessionId);
  if (!sessionId || !isValidUuid(sessionId)) {
    return { isValid: false, errors: ['sessionId must be a valid UUID'], value: null };
  }
  return { isValid: true, errors: [], value: { sessionId } };
}

export function validateStreamOffer(payload) {
  const sessionResult = validateStreamSessionId(payload);
  if (!sessionResult.isValid) return sessionResult;
  if (!payload?.offer || typeof payload.offer !== 'object') {
    return { isValid: false, errors: ['offer is required'], value: null };
  }
  return {
    isValid: true,
    errors: [],
    value: { sessionId: sessionResult.value.sessionId, offer: payload.offer },
  };
}

/** Viewer WebRTC offer (Flutter → Backend). Same shape as validateStreamOffer. */
export function validateViewerOffer(payload) {
  return validateStreamOffer(payload);
}

export function validateStreamAnswer(payload) {
  const sessionResult = validateStreamSessionId(payload);
  if (!sessionResult.isValid) return sessionResult;
  if (!payload?.answer || typeof payload.answer !== 'object') {
    return { isValid: false, errors: ['answer is required'], value: null };
  }
  return {
    isValid: true,
    errors: [],
    value: { sessionId: sessionResult.value.sessionId, answer: payload.answer },
  };
}

/** go2rtc answer relayed by Pi (Pi → Backend). Same shape as validateStreamAnswer. */
export function validateAgentAnswer(payload) {
  return validateStreamAnswer(payload);
}

export function validateIceCandidate(payload, fieldName = 'candidate') {
  const sessionResult = validateStreamSessionId(payload);
  if (!sessionResult.isValid) return sessionResult;
  const candidate = payload?.candidate ?? payload?.[fieldName];
  if (!candidate || typeof candidate !== 'object') {
    return { isValid: false, errors: ['candidate is required'], value: null };
  }
  return {
    isValid: true,
    errors: [],
    value: { sessionId: sessionResult.value.sessionId, candidate },
  };
}

/** Viewer ICE candidate (Flutter → Backend). */
export function validateViewerIce(payload) {
  return validateIceCandidate(payload);
}

/** Pi/go2rtc ICE candidate (Pi → Backend). */
export function validateAgentIce(payload) {
  return validateIceCandidate(payload);
}

export function isValidStreamType(value) {
  return STREAM_TYPES.has(String(value || '').toUpperCase());
}
