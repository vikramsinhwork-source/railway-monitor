import { sendError } from '../../utils/apiResponse.js';
import { buildWebrtcPlayUrl, listCamerasForUser } from './camera.service.js';

export async function getWebrtcUrl(req, res) {
  const result = await buildWebrtcPlayUrl(req.params.id, req.user);
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  if (result.notFound) {
    return sendError(res, result.message || 'Camera not found', 404);
  }

  return res.json({
    success: true,
    data: {
      url: result.url,
      token: result.token,
      expiresAt: result.expiresAt,
      camera: result.camera,
    },
  });
}

export async function listCameras(req, res) {
  const result = await listCamerasForUser(req.user, {
    lobbyId: req.query.lobbyId || req.query.lobby_id || null,
  });
  if (result.forbidden) return sendError(res, 'Forbidden', 403);
  return res.json({ success: true, data: { cameras: result.cameras } });
}
