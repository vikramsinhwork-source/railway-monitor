import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  buildMediaMtxHlsPath,
  rewriteHlsManifest,
} from '../../src/modules/monitoring/hls-proxy.relay.js';

describe('hls-proxy.relay', () => {
  test('buildMediaMtxHlsPath joins stream name and relative path', () => {
    assert.strictEqual(buildMediaMtxHlsPath('camera1', 'index.m3u8'), 'camera1/index.m3u8');
    assert.strictEqual(buildMediaMtxHlsPath('camera1', '/segment0.ts'), 'camera1/segment0.ts');
    assert.strictEqual(buildMediaMtxHlsPath('camera1', 'nested/seg.ts'), 'camera1/nested/seg.ts');
  });

  test('rewriteHlsManifest rewrites relative segment lines to backend proxy URLs', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:2',
      'segment0.ts',
      'segment1.ts',
    ].join('\n');

    const rewritten = rewriteHlsManifest(manifest, {
      piDeviceId: 'b6ee0d2b-a66c-416f-b266-ad372f42ebae',
      streamName: 'camera1',
      apiPrefix: 'https://railwaymonitor.in',
    });

    assert.match(
      rewritten,
      /https:\/\/railwaymonitor\.in\/api\/monitoring\/devices\/b6ee0d2b-a66c-416f-b266-ad372f42ebae\/streams\/camera1\/hls\/segment0\.ts/
    );
    assert.match(
      rewritten,
      /https:\/\/railwaymonitor\.in\/api\/monitoring\/devices\/b6ee0d2b-a66c-416f-b266-ad372f42ebae\/streams\/camera1\/hls\/segment1\.ts/
    );
    assert.match(rewritten, /^#EXTM3U/m);
  });

  test('rewriteHlsManifest rewrites absolute MediaMTX URLs to proxy paths', () => {
    const manifest = [
      '#EXTM3U',
      'http://127.0.0.1:8888/camera1/segment0.ts',
    ].join('\n');

    const rewritten = rewriteHlsManifest(manifest, {
      piDeviceId: 'pi-uuid',
      streamName: 'camera1',
      apiPrefix: 'https://example.com',
    });

    assert.match(
      rewritten,
      /https:\/\/example\.com\/api\/monitoring\/devices\/pi-uuid\/streams\/camera1\/hls\/segment0\.ts/
    );
  });

  test('rewriteHlsManifest leaves non-manifest text unchanged', () => {
    const binary = 'not-a-manifest';
    assert.strictEqual(
      rewriteHlsManifest(binary, { piDeviceId: 'x', streamName: 'y' }),
      binary
    );
  });
});
