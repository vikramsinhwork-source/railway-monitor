import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  validateRegisterPayload,
  validateHeartbeatPayload,
  validateStreamStatusPayload,
  validateDeviceOnlinePayload,
  validateCommandResultPayload,
} from '../../src/modules/monitoring/monitoring.validator.js';

describe('Monitoring validator unit tests', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';

  test('validateRegisterPayload accepts minimal payload', () => {
    const result = validateRegisterPayload({ deviceId: uuid, hostname: 'pi-1' });
    assert.strictEqual(result.isValid, true);
  });

  test('validateHeartbeatPayload requires UUID deviceId', () => {
    const bad = validateHeartbeatPayload({ deviceId: 'not-uuid' });
    assert.strictEqual(bad.isValid, false);
    const good = validateHeartbeatPayload({ deviceId: uuid, cpu: 1 });
    assert.strictEqual(good.isValid, true);
  });

  test('validateStreamStatusPayload requires streams or mediamtx', () => {
    const bad = validateStreamStatusPayload({ deviceId: uuid });
    assert.strictEqual(bad.isValid, false);
    const good = validateStreamStatusPayload({
      deviceId: uuid,
      streams: [{ name: 'kiosk1', online: true }],
    });
    assert.strictEqual(good.isValid, true);
  });

  test('validateDeviceOnlinePayload', () => {
    const result = validateDeviceOnlinePayload({ deviceId: uuid, hostname: 'pi' });
    assert.strictEqual(result.isValid, true);
  });

  test('validateCommandResultPayload requires commandId and success boolean', () => {
    const bad = validateCommandResultPayload({ commandId: uuid });
    assert.strictEqual(bad.isValid, false);
    const good = validateCommandResultPayload({
      commandId: uuid,
      success: true,
      message: 'done',
      timestamp: new Date().toISOString(),
    });
    assert.strictEqual(good.isValid, true);
  });
});
