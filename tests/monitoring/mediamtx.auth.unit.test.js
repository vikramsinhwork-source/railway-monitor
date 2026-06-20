import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { mediamtxAuth } from '../../src/modules/monitoring/mediamtx.auth.controller.js';

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('mediamtx.auth.controller', () => {
  const originalSecret = process.env.JWT_SECRET;

  before(() => {
    process.env.JWT_SECRET = 'test-stream-token-secret';
  });

  after(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  test('allows localhost agent WHEP without token', async () => {
    const res = mockRes();
    await mediamtxAuth(
      {
        body: {
          ip: '127.0.0.1',
          action: 'read',
          protocol: 'webrtc',
          path: 'camera1',
        },
      },
      res
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, 'OK');
  });

  test('allows localhost MediaMTX API poll without token', async () => {
    const res = mockRes();
    await mediamtxAuth(
      {
        body: {
          ip: '127.0.0.1',
          action: 'api',
          path: '',
        },
      },
      res
    );
    assert.strictEqual(res.statusCode, 200);
  });

  test('rejects LAN webrtc read without token', async () => {
    const res = mockRes();
    await mediamtxAuth(
      {
        body: {
          ip: '192.168.1.50',
          action: 'read',
          protocol: 'webrtc',
          path: 'camera1',
        },
      },
      res
    );
    assert.strictEqual(res.statusCode, 401);
  });

  test('accepts valid stream_token for matching path', async () => {
    const token = jwt.sign(
      {
        sub: 'user-1',
        piDeviceId: 'pi-1',
        mediamtxPath: 'camera1',
        typ: 'stream',
      },
      process.env.JWT_SECRET,
      { expiresIn: 60 }
    );

    const res = mockRes();
    await mediamtxAuth(
      {
        body: {
          ip: '192.168.1.50',
          action: 'read',
          protocol: 'webrtc',
          path: 'camera1',
          password: token,
        },
      },
      res
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, 'OK');
  });

  test('rejects stream_token for wrong path', async () => {
    const token = jwt.sign(
      {
        sub: 'user-1',
        piDeviceId: 'pi-1',
        mediamtxPath: 'camera2',
        typ: 'stream',
      },
      process.env.JWT_SECRET,
      { expiresIn: 60 }
    );

    const res = mockRes();
    await mediamtxAuth(
      {
        body: {
          ip: '192.168.1.50',
          action: 'playback',
          protocol: 'webrtc',
          path: 'camera1',
          token,
        },
      },
      res
    );
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects expired stream_token', async () => {
    const token = jwt.sign(
      {
        sub: 'user-1',
        piDeviceId: 'pi-1',
        mediamtxPath: 'camera1',
        typ: 'stream',
      },
      process.env.JWT_SECRET,
      { expiresIn: -10 }
    );

    const res = mockRes();
    await mediamtxAuth(
      {
        body: {
          ip: '192.168.1.50',
          action: 'read',
          protocol: 'webrtc',
          path: 'camera1',
          token,
        },
      },
      res
    );
    assert.strictEqual(res.statusCode, 403);
  });
});
