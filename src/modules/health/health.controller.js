import { sendError, sendSuccess } from '../../utils/apiResponse.js';
import {
  getDeviceLogs,
  getHealthByDivision,
  getHealthSummary,
  getLobbyHealth,
  triggerManualRecovery,
} from './health.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return UUID_REGEX.test(String(value || ''));
}

export async function summary(req, res) {
  try {
    const data = await getHealthSummary(req.user);
    return sendSuccess(res, 'Health summary fetched successfully', { summary: data });
  } catch (error) {
    return sendError(res, 'Failed to fetch health summary', 500);
  }
}

export async function divisions(req, res) {
  try {
    const data = await getHealthByDivision(req.user);
    return sendSuccess(res, 'Division health fetched successfully', { divisions: data });
  } catch (error) {
    return sendError(res, 'Failed to fetch division health', 500);
  }
}

export async function lobby(req, res) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return sendError(res, 'Invalid lobby id', 400);
    const data = await getLobbyHealth(req.user, id);
    if (!data) return sendError(res, 'Lobby not found', 404);
    if (data.forbidden) return sendError(res, 'Forbidden', 403);
    return sendSuccess(res, 'Lobby health fetched successfully', data);
  } catch (error) {
    return sendError(res, 'Failed to fetch lobby health', 500);
  }
}

export async function deviceLogs(req, res) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return sendError(res, 'Invalid device id', 400);
    const limit = req.query?.limit ? Number.parseInt(req.query.limit, 10) : 100;
    if (Number.isNaN(limit) || limit <= 0 || limit > 500) {
      return sendError(res, 'limit must be between 1 and 500', 400);
    }

    const data = await getDeviceLogs(req.user, id, limit);
    if (!data) return sendError(res, 'Device not found', 404);
    if (data.forbidden) return sendError(res, 'Forbidden', 403);
    return sendSuccess(res, 'Device logs fetched successfully', { logs: data });
  } catch (error) {
    return sendError(res, 'Failed to fetch device logs', 500);
  }
}

export async function recover(req, res) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return sendError(res, 'Invalid device id', 400);
    const data = await triggerManualRecovery(req.user, id);
    if (!data) return sendError(res, 'Device not found', 404);
    if (data.forbidden) return sendError(res, 'Forbidden', 403);
    if (data.error) return sendError(res, data.error, 400);
    return sendSuccess(res, 'Manual recovery triggered successfully', data, 201);
  } catch (error) {
    return sendError(res, 'Failed to trigger recovery', 500);
  }
}
