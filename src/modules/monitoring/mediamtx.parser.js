/**
 * Parse MediaMTX path list / agent stream status into normalized monitoring fields.
 */

export function parseMediaMtxPathEntry(name, info = {}) {
  const ready = info.ready === true || info.sourceReady === true;
  const tracks = Array.isArray(info.tracks) ? info.tracks : [];
  const videoTrack = tracks.find((t) => t?.type === 'video');

  return {
    name,
    online: ready,
    status: ready ? 'online' : 'offline',
    producerCount: ready ? 1 : 0,
    consumerCount: info.readers?.length || 0,
    producers: ready ? 1 : 0,
    consumers: info.readers?.length || 0,
    codec: videoTrack?.codec || null,
    codecs: tracks.map((t) => t?.codec).filter(Boolean),
    fps: null,
    source: info.source || info.sourceUrl || null,
  };
}

export function parseMediaMtxPathsPayload(raw) {
  const streams = [];
  let online = 0;
  let offline = 0;

  if (!raw || typeof raw !== 'object') {
    return { streams, summary: { online, offline, total: 0 } };
  }

  const entries = Array.isArray(raw.items)
    ? raw.items.reduce((acc, item) => {
      if (item?.name) acc[item.name] = item;
      return acc;
    }, {})
    : raw;

  for (const [name, info] of Object.entries(entries)) {
    if (name === 'items') continue;
    const entry = parseMediaMtxPathEntry(name, info);
    if (entry.online) online += 1;
    else offline += 1;
    streams.push(entry);
  }

  return {
    streams,
    summary: { online, offline, total: streams.length },
  };
}
