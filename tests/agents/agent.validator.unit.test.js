import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  validateRegisterAgent,
  validateAgentHeartbeat,
  validateAgentStatusUpdate,
  validateAgentCommandResult,
  validateAgentCommand,
} from '../../src/modules/agents/agent.validator.js';

describe('Unit — agent validators', () => {
  test('validateRegisterAgent accepts valid payload', () => {
    const result = validateRegisterAgent({
      deviceId: '550e8400-e29b-41d4-a716-446655440000',
      serialNumber: 'PI001',
      hostname: 'railway-pi-1',
      version: '1.0.0',
      capabilities: { vnc: true, rtsp: true, camera: true },
    });
    assert.strictEqual(result.isValid, true);
  });

  test('validateRegisterAgent rejects invalid deviceId', () => {
    const result = validateRegisterAgent({
      deviceId: 'bad-id',
      serialNumber: 'PI001',
      hostname: 'railway-pi-1',
      version: '1.0.0',
      capabilities: {},
    });
    assert.strictEqual(result.isValid, false);
  });

  test('validateAgentHeartbeat rejects invalid cpu', () => {
    const result = validateAgentHeartbeat({ cpu: 'high' });
    assert.strictEqual(result.isValid, false);
  });

  test('validateAgentStatusUpdate accepts booleans', () => {
    const result = validateAgentStatusUpdate({
      kioskReachable: true,
      cameraReachable: false,
      rtspWorking: true,
      vncWorking: false,
    });
    assert.strictEqual(result.isValid, true);
  });

  test('validateAgentCommandResult requires UUID commandId', () => {
    const result = validateAgentCommandResult({ commandId: 'x', success: true });
    assert.strictEqual(result.isValid, false);
  });

  test('validateAgentCommand accepts REBOOT_PI', () => {
    const result = validateAgentCommand({ command: 'REBOOT_PI' });
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.value.command, 'REBOOT_PI');
  });
});
