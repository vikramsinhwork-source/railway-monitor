import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseMediaMtxPathsPayload } from '../../src/modules/monitoring/mediamtx.parser.js';
import { enrichStreamPayload } from '../../src/modules/monitoring/monitoring.service.js';

describe('mediamtx parser (service unit)', () => {
  test('extracts codec and online counts from path map', () => {
    const parsed = parseMediaMtxPathsPayload({
      camera1: {
        ready: true,
        source: 'rtsp://nvr/c1',
        tracks: [{ type: 'video', codec: 'H264' }],
        readers: [{}],
      },
      camera2: { ready: false },
    });

    assert.strictEqual(parsed.summary.online, 1);
    assert.strictEqual(parsed.summary.offline, 1);
    assert.strictEqual(parsed.streams[0].codec, 'H264');
    assert.strictEqual(parsed.streams[0].consumerCount, 1);
  });
});

describe('Monitoring service stream enrichment', () => {
  test('enrichStreamPayload normalizes agent stream entries', () => {
    const enriched = enrichStreamPayload({
      streams: [{
        name: 'camera1',
        online: true,
        producers: 1,
        consumers: 2,
        codec: 'H264',
        fps: 30,
      }],
    });

    assert.strictEqual(enriched.streams[0].producerCount, 1);
    assert.strictEqual(enriched.streams[0].consumerCount, 2);
    assert.strictEqual(enriched.streams[0].codec, 'H264');
    assert.strictEqual(enriched.streams[0].fps, 30);
  });

  test('enrichStreamPayload parses mediamtx raw payload', () => {
    const enriched = enrichStreamPayload({
      mediamtx: {
        raw: {
          camera1: { ready: true, tracks: [{ type: 'video', codec: 'H264' }] },
        },
      },
    });

    assert.strictEqual(enriched.streams.length, 1);
    assert.strictEqual(enriched.streams[0].name, 'camera1');
    assert.strictEqual(enriched.mediamtx.summary.online, 1);
  });
});
