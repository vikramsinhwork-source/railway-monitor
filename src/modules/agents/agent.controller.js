import { sendError, sendSuccess } from '../../utils/apiResponse.js';
import { logWarn } from '../../utils/logger.js';
import { isValidUuid } from '../devices/device.validator.js';
import { validateAgentCommand } from './agent.validator.js';
import {
  disableAgentForUser,
  enableAgentForUser,
  getAgentByIdForUser,
  getAgentHealthForUser,
  getAgentLogsForUser,
  listAgentsForUser,
  sendAgentCommandForUser,
} from './agent.service.js';

function parsePositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function list(req, res) {
  try {
    const page = parsePositiveInt(req.query?.page, 1);
    const limit = parsePositiveInt(req.query?.limit, 25);
    if (page === null || limit === null) return sendError(res, 'page and limit must be positive integers', 400);

    const { division_id, lobby_id, status } = req.query;
    if (division_id && !isValidUuid(division_id)) return sendError(res, 'division_id must be a valid UUID', 400);
    if (lobby_id && !isValidUuid(lobby_id)) return sendError(res, 'lobby_id must be a valid UUID', 400);

    const result = await listAgentsForUser(req.user, {
      division_id,
      lobby_id,
      status: status?.toUpperCase(),
      limit,
      offset: (page - 1) * limit,
    });

    return sendSuccess(res, 'Agents fetched successfully', {
      agents: result.agents,
      pagination: {
        page,
        limit,
        total: result.count,
      },
    });
  } catch (error) {
    logWarn('Agents', 'Failed to list agents', { error: error.message });
    return sendError(res, 'Failed to fetch agents', 500);
  }
}

export async function getById(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid agent id', 400);

    const result = await getAgentByIdForUser(id, req.user);
    if (!result) return sendError(res, 'Agent not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.notAgent) return sendError(res, 'Device is not a Raspberry Pi agent', 400);

    return sendSuccess(res, 'Agent fetched successfully', { agent: result.agent });
  } catch (error) {
    logWarn('Agents', 'Failed to fetch agent', { error: error.message });
    return sendError(res, 'Failed to fetch agent', 500);
  }
}

export async function health(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid agent id', 400);

    const result = await getAgentHealthForUser(req.user, id);
    if (!result) return sendError(res, 'Agent not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.notAgent) return sendError(res, 'Device is not a Raspberry Pi agent', 400);

    return sendSuccess(res, 'Agent health fetched successfully', { health: result.health });
  } catch (error) {
    logWarn('Agents', 'Failed to fetch agent health', { error: error.message });
    return sendError(res, 'Failed to fetch agent health', 500);
  }
}

export async function logs(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid agent id', 400);

    const limit = parsePositiveInt(req.query?.limit, 100);
    if (limit === null) return sendError(res, 'limit must be a positive integer', 400);

    const result = await getAgentLogsForUser(req.user, id, limit);
    if (!result) return sendError(res, 'Agent not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.notAgent) return sendError(res, 'Device is not a Raspberry Pi agent', 400);

    return sendSuccess(res, 'Agent logs fetched successfully', { logs: result.logs });
  } catch (error) {
    logWarn('Agents', 'Failed to fetch agent logs', { error: error.message });
    return sendError(res, 'Failed to fetch agent logs', 500);
  }
}

export async function sendCommand(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid agent id', 400);

    const validation = validateAgentCommand(req.body);
    if (!validation.isValid) return sendError(res, validation.errors[0], 400);

    const result = await sendAgentCommandForUser(
      req.user,
      id,
      validation.value.command,
      validation.value.payload
    );
    if (!result) return sendError(res, 'Agent not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.notAgent) return sendError(res, 'Device is not a Raspberry Pi agent', 400);
    if (result.inactive) return sendError(res, 'Agent is disabled', 400);
    if (result.error) return sendError(res, result.error, 400);

    return sendSuccess(res, 'Command queued successfully', result, 201);
  } catch (error) {
    logWarn('Agents', 'Failed to send agent command', { error: error.message });
    return sendError(res, 'Failed to send command', 500);
  }
}

export async function disable(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid agent id', 400);

    const result = await disableAgentForUser(id, req.user);
    if (!result) return sendError(res, 'Agent not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.notAgent) return sendError(res, 'Device is not a Raspberry Pi agent', 400);

    return sendSuccess(res, 'Agent disabled successfully', { agent: result.agent });
  } catch (error) {
    logWarn('Agents', 'Failed to disable agent', { error: error.message });
    return sendError(res, 'Failed to disable agent', 500);
  }
}

export async function enable(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return sendError(res, 'Invalid agent id', 400);

    const result = await enableAgentForUser(id, req.user);
    if (!result) return sendError(res, 'Agent not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.notAgent) return sendError(res, 'Device is not a Raspberry Pi agent', 400);

    return sendSuccess(res, 'Agent enabled successfully', { agent: result.agent });
  } catch (error) {
    logWarn('Agents', 'Failed to enable agent', { error: error.message });
    return sendError(res, 'Failed to enable agent', 500);
  }
}
