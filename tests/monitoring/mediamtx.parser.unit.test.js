import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaMtxPathsPayload } from '../../src/modules/monitoring/mediamtx.parser.js';

describe('mediamtx parser', () => {
  test('parseMediaMtxPathsPayload normalizes ready paths', () => {
    const parsed = parseMediaMtxPathsPayload({
      camera1: { ready: true, source: 'rtsp://nvr/c1', tracks: [{ type: 'video', codec: 'H264' }] },
      camera2: { ready: false },
    });
    assert.equal(parsed.summary.online, 1);
    assert.equal(parsed.summary.offline, 1);
    assert.equal(parsed.streams[0].codec, 'H264');
  });
});
