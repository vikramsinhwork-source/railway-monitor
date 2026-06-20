import { describe, test } from 'node:test';
import assert from 'node:assert';
import { isPrivateIp } from '../../src/modules/monitoring/webrtc-offer.relay.js';

describe('webrtc-offer.relay', () => {
  test('isPrivateIp detects RFC1918 and loopback', () => {
    assert.strictEqual(isPrivateIp('192.168.1.8'), true);
    assert.strictEqual(isPrivateIp('10.71.35.100'), true);
    assert.strictEqual(isPrivateIp('127.0.0.1'), true);
    assert.strictEqual(isPrivateIp('8.8.8.8'), false);
    assert.strictEqual(isPrivateIp(null), false);
  });
});
