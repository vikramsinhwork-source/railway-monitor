import { describe, test } from 'node:test';
import assert from 'node:assert';
import router from '../../src/modules/monitoring/monitoring.routes.js';
import { proxyWebrtcOffer } from '../../src/modules/monitoring/monitoring.webrtc.controller.js';

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('Unit — monitoring WebRTC routes', () => {
  test('registers WebRTC config and offer routes', () => {
    const routes = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods || {}),
      }));

    assert.ok(routes.some((r) => r.path === '/devices/:id/webrtc/config' && r.methods.includes('get')));
    assert.ok(
      routes.some(
        (r) => r.path === '/devices/:id/streams/:streamName/webrtc/offer' && r.methods.includes('post')
      )
    );
  });
});

describe('Unit — monitoring WebRTC controller', () => {
  test('proxyWebrtcOffer returns 400 for invalid payload', async () => {
    const req = {
      body: { type: 'answer', sdp: '' },
      params: { id: 'device-id', streamName: 'kiosk1' },
      user: { role: 'MONITOR' },
    };
    const res = createMockRes();

    await proxyWebrtcOffer(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.ok(
      typeof res.body?.message === 'string' &&
      res.body.message.includes('Body must contain')
    );
  });
});
