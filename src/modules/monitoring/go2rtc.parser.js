/**
 * Parse go2rtc /api/streams entries into normalized monitoring fields.
 */

function parseCodecsFromMedias(medias) {
  const codecs = [];
  for (const media of medias || []) {
    const parts = String(media).split(',').map((s) => s.trim());
    const kind = parts[0]?.toLowerCase();
    if (kind !== 'video' && kind !== 'audio') continue;
    for (const part of parts.slice(2)) {
      if (/^(H264|H265|HEVC|VP8|VP9|AV1|AAC|OPUS|PCMU|PCMA|MJPEG)$/i.test(part)) {
        codecs.push(part.toUpperCase());
      }
    }
  }
  return [...new Set(codecs)];
}

function parseFpsFromProducer(producer) {
  if (typeof producer?.fps === 'number' && Number.isFinite(producer.fps)) {
    return producer.fps;
  }
  for (const media of producer?.medias || []) {
    const text = String(media);
    const fpsMatch = text.match(/(\d+(?:\.\d+)?)\s*fps/i)
      || text.match(/fps[:\s]+(\d+(?:\.\d+)?)/i);
    if (fpsMatch) return Number(fpsMatch[1]);
  }
  for (const track of producer?.tracks || []) {
    if (typeof track?.fps === 'number' && Number.isFinite(track.fps)) {
      return track.fps;
    }
  }
  return null;
}

export function parseGo2rtcStreamEntry(name, info = {}) {
  const producers = Array.isArray(info.producers) ? info.producers : [];
  const consumers = Array.isArray(info.consumers) ? info.consumers : [];
  const producerCount = producers.length || info.producerCount || 0;
  const consumerCount = consumers.length || info.consumerCount || 0;

  const codecs = [];
  let fps = null;
  for (const producer of producers) {
    codecs.push(...parseCodecsFromMedias(producer.medias));
    if (fps == null) {
      const producerFps = parseFpsFromProducer(producer);
      if (producerFps != null) fps = producerFps;
    }
  }
  if (Array.isArray(info.medias)) {
    codecs.push(...parseCodecsFromMedias(info.medias));
  }

  const isOnline = !!(
    producerCount > 0
    || info.online === true
    || (info.medias && info.medias.length > 0)
  );

  return {
    name,
    online: isOnline,
    status: isOnline ? 'online' : 'offline',
    producerCount,
    consumerCount,
    producers: producerCount,
    consumers: consumerCount,
    codec: [...new Set(codecs)][0] || null,
    codecs: [...new Set(codecs)],
    fps,
    source: producers[0]?.url || info.url || null,
  };
}

export function parseGo2rtcStreamsPayload(raw) {
  const streams = [];
  let online = 0;
  let offline = 0;

  if (!raw || typeof raw !== 'object') {
    return { streams, summary: { online, offline, total: 0 } };
  }

  for (const [name, info] of Object.entries(raw)) {
    const entry = parseGo2rtcStreamEntry(name, info);
    if (entry.online) online += 1;
    else offline += 1;
    streams.push(entry);
  }

  return {
    streams,
    summary: { online, offline, total: streams.length },
  };
}
