import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseGo2rtcStreamsPayload } from '../../src/modules/monitoring/go2rtc.parser.js';
import { enrichStreamPayload } from '../../src/modules/monitoring/monitoring.service.js';

describe('go2rtc parser', () => {
  test('extracts codec, fps, producer and consumer counts', () => {
    const parsed = parseGo2rtcStreamsPayload({
      kiosk1: {
        producers: [{
          url: 'vnc://10.0.0.1:5900',
          medias: ['video, recvonly, H264, 1920x1080, 25 fps'],
        }],
        consumers: [{}, {}],
      },
      kiosk2: { producers: [], consumers: [] },
    });

    assert.strictEqual(parsed.summary.online, 1);
    assert.strictEqual(parsed.summary.offline, 1);
    assert.strictEqual(parsed.streams[0].producerCount, 1);
    assert.strictEqual(parsed.streams[0].consumerCount, 2);
    assert.strictEqual(parsed.streams[0].codec, 'H264');
    assert.strictEqual(parsed.streams[0].fps, 25);
  });
});

describe('Monitoring service stream enrichment', () => {
  test('enrichStreamPayload normalizes agent stream entries', () => {
    const enriched = enrichStreamPayload({
      streams: [{
        name: 'kiosk1',
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
});
