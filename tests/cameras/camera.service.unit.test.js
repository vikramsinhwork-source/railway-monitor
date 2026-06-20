import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  buildDirectPiWebrtcUrl,
  buildEdgeWebrtcUrl,
  getWebrtcPlaybackMode,
  parseLegacyCameraId,
  resolveWebrtcPlayUrl,
} from '../../src/modules/cameras/camera.service.js';

describe('camera.service — WebRTC play URL', () => {
  test('getWebrtcPlaybackMode defaults to direct in non-production', () => {
    assert.strictEqual(getWebrtcPlaybackMode({}), 'direct');
    assert.strictEqual(getWebrtcPlaybackMode({ PI_WEBRTC_PLAYBACK_MODE: 'direct' }), 'direct');
  });

  test('getWebrtcPlaybackMode socket in production or when set', () => {
    assert.strictEqual(getWebrtcPlaybackMode({ NODE_ENV: 'production' }), 'socket');
    assert.strictEqual(getWebrtcPlaybackMode({ PI_WEBRTC_PLAYBACK_MODE: 'socket' }), 'socket');
  });

  test('getWebrtcPlaybackMode edge when set', () => {
    assert.strictEqual(getWebrtcPlaybackMode({ PI_WEBRTC_PLAYBACK_MODE: 'edge' }), 'edge');
  });

  test('buildDirectPiWebrtcUrl uses pi ip_address and path', () => {
    const url = buildDirectPiWebrtcUrl(
      { ip_address: '10.0.0.5' },
      'camera1',
      { MEDIAMTX_WEBRTC_SCHEME: 'http', MEDIAMTX_WEBRTC_PORT: '8889' }
    );
    assert.strictEqual(url, 'http://10.0.0.5:8889/camera1');
  });

  test('buildDirectPiWebrtcUrl returns null when ip missing', () => {
    assert.strictEqual(buildDirectPiWebrtcUrl({}, 'camera1', {}), null);
    assert.strictEqual(buildDirectPiWebrtcUrl({ ip_address: '  ' }, 'camera1', {}), null);
  });

  test('buildEdgeWebrtcUrl uses EDGE_WEBRTC_BASE_URL', () => {
    const url = buildEdgeWebrtcUrl('camera2', {
      EDGE_WEBRTC_BASE_URL: 'https://edge.example.com/webrtc',
    });
    assert.strictEqual(url, 'https://edge.example.com/webrtc/camera2');
  });

  test('resolveWebrtcPlayUrl direct mode uses pi ip', () => {
    const url = resolveWebrtcPlayUrl(
      { ip_address: '192.168.1.10' },
      'camera3',
      { PI_WEBRTC_PLAYBACK_MODE: 'direct', MEDIAMTX_WEBRTC_PORT: '8889' }
    );
    assert.strictEqual(url, 'http://192.168.1.10:8889/camera3');
  });

  test('resolveWebrtcPlayUrl edge mode ignores pi ip', () => {
    const url = resolveWebrtcPlayUrl(
      { ip_address: '192.168.1.10' },
      'camera3',
      {
        PI_WEBRTC_PLAYBACK_MODE: 'edge',
        EDGE_WEBRTC_BASE_URL: 'https://edge.railwatch.in/webrtc',
      }
    );
    assert.strictEqual(url, 'https://edge.railwatch.in/webrtc/camera3');
  });

  test('parseLegacyCameraId extracts pi device and mediamtx path', () => {
    const parsed = parseLegacyCameraId('b6ee0d2b-a66c-416f-b266-ad372f42ebae_camera1');
    assert.deepStrictEqual(parsed, {
      piDeviceId: 'b6ee0d2b-a66c-416f-b266-ad372f42ebae',
      mediamtxPath: 'camera1',
    });
  });
});
