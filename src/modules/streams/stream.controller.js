import { sendError, sendSuccess } from '../../utils/apiResponse.js';
import { logWarn } from '../../utils/logger.js';
import { isValidUuid } from '../devices/device.validator.js';
import { validateStreamRequest } from './stream.validator.js';
import {
  deleteStreamSessionForUser,
  getStreamSessionForUser,
  listActiveStreamsForUser,
  requestStream,
} from './stream.service.js';

export async function request(req, res) {
  try {
    const validation = validateStreamRequest(req.body);
    if (!validation.isValid) return sendError(res, validation.errors[0], 400);

    const io = req.app.get('io');
    const result = await requestStream({
      user: req.user,
      deviceId: validation.value.deviceId,
      streamType: validation.value.streamType,
      streamName: validation.value.streamName,
      io,
    });

    if (result.forbidden) return sendError(res, 'Forbidden', 403);
    if (result.notFound) return sendError(res, result.message || 'Agent not found', 404);
    if (result.inactive) return sendError(res, result.message || 'Agent is disabled', 400);
    if (result.conflict) return sendError(res, result.message, 409);

    return sendSuccess(res, 'Stream requested successfully', {
      sessionId: result.session.id,
      session: result.session,
    }, 201);
  } catch (error) {
    logWarn('Streams', 'Failed to request stream', { error: error.message });
    return sendError(res, 'Failed to request stream', 500);
  }
}

export async function getById(req, res) {
  try {
    const { sessionId } = req.params;
    if (!isValidUuid(sessionId)) return sendError(res, 'Invalid session id', 400);

    const result = await getStreamSessionForUser(sessionId, req.user);
    if (!result) return sendError(res, 'Stream session not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Stream session fetched successfully', { session: result.session });
  } catch (error) {
    logWarn('Streams', 'Failed to fetch stream session', { error: error.message });
    return sendError(res, 'Failed to fetch stream session', 500);
  }
}

export async function listActive(req, res) {
  try {
    const result = await listActiveStreamsForUser(req.user);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Active streams fetched successfully', { sessions: result.sessions });
  } catch (error) {
    logWarn('Streams', 'Failed to list active streams', { error: error.message });
    return sendError(res, 'Failed to list active streams', 500);
  }
}

export async function remove(req, res) {
  try {
    const { sessionId } = req.params;
    if (!isValidUuid(sessionId)) return sendError(res, 'Invalid session id', 400);

    const io = req.app.get('io');
    const result = await deleteStreamSessionForUser(sessionId, req.user, io);
    if (!result) return sendError(res, 'Stream session not found', 404);
    if (result.forbidden) return sendError(res, 'Forbidden', 403);

    return sendSuccess(res, 'Stream session closed successfully', { session: result.session });
  } catch (error) {
    logWarn('Streams', 'Failed to close stream session', { error: error.message });
    return sendError(res, 'Failed to close stream session', 500);
  }
}
