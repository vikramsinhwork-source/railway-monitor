import { sendError, sendSuccess } from '../../utils/apiResponse.js';
import {
  getAutoheal,
  getDeviceAnalytics,
  getDivisionsBreakdown,
  getIncidents,
  getLobbyAnalytics,
  getSla,
  getSummary,
} from './analytics.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_REGEX.test(String(value || ''));
}

function mapServiceError(res, error) {
  if (error.code === 'FORBIDDEN') return sendError(res, 'Forbidden', 403);
  if (error.code === 'NO_DIVISION') return sendError(res, 'User has no division assignment', 400);
  return sendError(res, error.message || 'Request failed', 500);
}

export async function summary(req, res) {
  try {
    const data = await getSummary(req.user, req.query || {});
    return sendSuccess(res, 'Analytics summary fetched successfully', data);
  } catch (error) {
    return mapServiceError(res, error);
  }
}

export async function sla(req, res) {
  try {
    const data = await getSla(req.user, req.query || {});
    return sendSuccess(res, 'SLA analytics fetched successfully', data);
  } catch (error) {
    return mapServiceError(res, error);
  }
}

export async function divisions(req, res) {
  try {
    const data = await getDivisionsBreakdown(req.user, req.query || {});
    return sendSuccess(res, 'Division analytics fetched successfully', { divisions: data });
  } catch (error) {
    return mapServiceError(res, error);
  }
}

export async function lobby(req, res) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return sendError(res, 'Invalid lobby id', 400);
    const data = await getLobbyAnalytics(req.user, id, req.query || {});
    if (!data) return sendError(res, 'Lobby not found', 404);
    if (data.forbidden) return sendError(res, 'Forbidden', 403);
    return sendSuccess(res, 'Lobby analytics fetched successfully', data);
  } catch (error) {
    return mapServiceError(res, error);
  }
}

export async function device(req, res) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return sendError(res, 'Invalid device id', 400);
    const data = await getDeviceAnalytics(req.user, id, req.query || {});
    if (!data) return sendError(res, 'Device not found', 404);
    if (data.forbidden) return sendError(res, 'Forbidden', 403);
    return sendSuccess(res, 'Device analytics fetched successfully', data);
  } catch (error) {
    return mapServiceError(res, error);
  }
}

export async function incidents(req, res) {
  try {
    const data = await getIncidents(req.user, req.query || {});
    return sendSuccess(res, 'Incidents fetched successfully', data);
  } catch (error) {
    return mapServiceError(res, error);
  }
}

export async function autoheal(req, res) {
  try {
    const data = await getAutoheal(req.user, req.query || {});
    return sendSuccess(res, 'Auto-heal analytics fetched successfully', data);
  } catch (error) {
    return mapServiceError(res, error);
  }
}
