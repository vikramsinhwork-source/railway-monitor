import { sendError } from '../../utils/apiResponse.js';
import Device from '../divisions/device.model.js';
import { getWebrtcPlaybackMode } from '../cameras/camera.service.js';
import { getMonitoringDeviceForUser } from './monitoring.service.js';
import { isAgentOnline } from './webrtc-offer.relay.js';
import { fetchHlsFromAgent, parseRelativeHlsPath, rewriteHlsManifest } from './hls-proxy.relay.js';

function ensureAccessResult(result, res) {
  if (!result) {
    sendError(res, 'Device not found', 404);
    return false;
  }
  if (result.forbidden) {
    sendError(res, 'Forbidden', 403);
    return false;
  }
  if (result.notAgent) {
    sendError(res, 'Not a Raspberry Pi monitoring device', 400);
    return false;
  }
  return true;
}

function requestBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function rawRelativeHlsPathFromRequest(req) {
  const fromParam = req.params.hlsPath || req.params.segmentFile;
  if (fromParam) {
    if (req.params.subdir) {
      return `${req.params.subdir}/${fromParam}`;
    }
    return fromParam;
  }
  const url = req.url || '';
  const match = url.match(/\/hls\/?(.*)$/);
  const tail = match?.[1]?.split('?')[0]?.replace(/^\/+/, '');
  return tail || 'index.m3u8';
}

export async function proxyHlsSegment(req, res) {
  if (!req.user) {
    return sendError(res, 'Authentication required', 401);
  }

  if (getWebrtcPlaybackMode() !== 'hls') {
    return sendError(res, 'HLS proxy playback is not enabled on this server', 503);
  }

  const access = await getMonitoringDeviceForUser(req.params.id, req.user);
  if (!ensureAccessResult(access, res)) return;

  const device = await Device.findByPk(req.params.id);
  if (!device) return sendError(res, 'Device not found', 404);

  const streamName = req.params.streamName;
  const rawPath = rawRelativeHlsPathFromRequest(req);
  const { path: relativePath, mediamtxQuery } = parseRelativeHlsPath(rawPath, req.query);
  const authToken = String(req.query.token || req.query.access_token || '').trim();

  try {
    const io = req.app?.get?.('io');
    const fetched = await fetchHlsFromAgent(io, device.id, streamName, relativePath, {
      mediamtxQuery,
    });
    let { body, contentType } = fetched;

    const isManifest =
      relativePath.endsWith('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('m3u8') ||
      (body.length < 65536 && body.toString('utf8').includes('#EXTM3U'));

    if (isManifest) {
      const text = rewriteHlsManifest(body.toString('utf8'), {
        piDeviceId: device.id,
        streamName,
        apiPrefix: requestBaseUrl(req),
        authToken,
      });
      body = Buffer.from(text, 'utf8');
      contentType = 'application/vnd.apple.mpegurl';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return res.status(fetched.statusCode >= 200 && fetched.statusCode < 300 ? 200 : fetched.statusCode).send(body);
  } catch (err) {
    if (err?.code === 'SOCKET_TIMEOUT' || err?.name === 'AbortError') {
      const reachable = await isAgentOnline(device.id);
      if (!reachable) {
        return sendError(res, 'Device is not connected (offline)', 503);
      }
      return sendError(res, 'Pi agent did not respond in time', 504);
    }
    if (err?.code === 'SOCKET_RELAY_ERROR') {
      return sendError(res, err.message, err.statusCode || 502);
    }
    return sendError(res, `Failed to proxy HLS: ${err?.message || 'unknown error'}`, 502);
  }
}

export async function startStreamPlayback(req, res) {
  if (!req.user) {
    return sendError(res, 'Authentication required', 401);
  }

  const mode = getWebrtcPlaybackMode();
  const access = await getMonitoringDeviceForUser(req.params.id, req.user);
  if (!ensureAccessResult(access, res)) return;

  const device = await Device.findByPk(req.params.id);
  if (!device) return sendError(res, 'Device not found', 404);

  const streamName = req.params.streamName;
  const agentOnline = await isAgentOnline(device.id);
  if (!agentOnline) {
    return sendError(res, 'Device is not connected (offline)', 503);
  }

  const base = requestBaseUrl(req);
  const piDeviceId = device.id;

  if (mode === 'hls') {
    const hlsPath = `/api/monitoring/devices/${encodeURIComponent(piDeviceId)}/streams/${encodeURIComponent(streamName)}/hls/index.m3u8`;
    const mjpegPath = `/api/monitoring/devices/${encodeURIComponent(piDeviceId)}/streams/${encodeURIComponent(streamName)}/live.mjpeg`;
    return res.json({
      success: true,
      data: {
        playback_mode: 'hls',
        hls_url: `${base}${hlsPath}`,
        mjpeg_url: `${base}${mjpegPath}`,
        pi_device_id: piDeviceId,
        stream_name: streamName,
      },
    });
  }

  if (mode === 'socket') {
    return res.json({
      success: true,
      data: {
        playback_mode: 'socket',
        offer_url: `${base}/api/monitoring/devices/${encodeURIComponent(piDeviceId)}/streams/${encodeURIComponent(streamName)}/webrtc/offer`,
        pi_device_id: piDeviceId,
        stream_name: streamName,
        playback_ip: device.ip_address || null,
      },
    });
  }

  return sendError(res, `Unsupported playback mode: ${mode}`, 503);
}
