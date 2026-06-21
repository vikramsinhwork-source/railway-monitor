import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  buildMediaMtxHlsPath,
  buildProxyHlsUrl,
  parseManifestResourceLine,
  parseRelativeHlsPath,
  rewriteHlsManifest,
  stripAuthFromQuery,
} from '../../src/modules/monitoring/hls-proxy.relay.js';

describe('hls-proxy.relay', () => {
  test('buildMediaMtxHlsPath joins stream name and relative path', () => {
    assert.strictEqual(buildMediaMtxHlsPath('camera1', 'index.m3u8'), 'camera1/index.m3u8');
    assert.strictEqual(buildMediaMtxHlsPath('camera1', '/segment0.ts'), 'camera1/segment0.ts');
    assert.strictEqual(buildMediaMtxHlsPath('camera1', 'nested/seg.ts'), 'camera1/nested/seg.ts');
  });

  test('parseManifestResourceLine splits path and MediaMTX session query', () => {
    assert.deepStrictEqual(parseManifestResourceLine('video1_stream.m3u8?session=abc-123'), {
      path: 'video1_stream.m3u8',
      query: 'session=abc-123',
    });
  });

  test('parseRelativeHlsPath decodes embedded session from path segment', () => {
    const parsed = parseRelativeHlsPath('video1_stream.m3u8%3Fsession%3Dabc-123', {});
    assert.strictEqual(parsed.path, 'video1_stream.m3u8');
    assert.strictEqual(parsed.mediamtxQuery, 'session=abc-123');
  });

  test('stripAuthFromQuery removes token but keeps session', () => {
    assert.strictEqual(
      stripAuthFromQuery('session=abc&token=jwt&access_token=x'),
      'session=abc'
    );
  });

  test('buildProxyHlsUrl appends token and preserves session', () => {
    const url = buildProxyHlsUrl('https://example.com/hls/', 'video1_stream.m3u8', {
      mtxQuery: 'session=abc',
      authToken: 'jwt-token',
    });
    assert.strictEqual(
      url,
      'https://example.com/hls/video1_stream.m3u8?session=abc&token=jwt-token'
    );
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
      authToken: 'monitor-jwt',
    });

    assert.match(
      rewritten,
      /https:\/\/railwaymonitor\.in\/api\/monitoring\/devices\/b6ee0d2b-a66c-416f-b266-ad372f42ebae\/streams\/camera1\/hls\/segment0\.ts\?token=monitor-jwt/
    );
    assert.match(
      rewritten,
      /https:\/\/railwaymonitor\.in\/api\/monitoring\/devices\/b6ee0d2b-a66c-416f-b266-ad372f42ebae\/streams\/camera1\/hls\/segment1\.ts\?token=monitor-jwt/
    );
    assert.match(rewritten, /^#EXTM3U/m);
  });

  test('rewriteHlsManifest preserves MediaMTX session query and adds token', () => {
    const manifest = ['#EXTM3U', 'video1_stream.m3u8?session=edf5e23a'].join('\n');

    const rewritten = rewriteHlsManifest(manifest, {
      piDeviceId: 'pi-uuid',
      streamName: 'camera5',
      apiPrefix: 'https://railwaymonitor.in',
      authToken: 'jwt',
    });

    assert.match(
      rewritten,
      /\/hls\/video1_stream\.m3u8\?session=edf5e23a&token=jwt$/
    );
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
