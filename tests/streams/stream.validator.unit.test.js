import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  validateStreamRequest,
  validateStreamOffer,
  validateStreamAnswer,
  validateIceCandidate,
} from '../../src/modules/streams/stream.validator.js';

describe('Unit — stream validators', () => {
  test('validateStreamRequest accepts KIOSK', () => {
    const result = validateStreamRequest({
      deviceId: '550e8400-e29b-41d4-a716-446655440000',
      streamType: 'KIOSK',
    });
    assert.strictEqual(result.isValid, true);
  });

  test('validateStreamRequest rejects invalid streamType', () => {
    const result = validateStreamRequest({
      deviceId: '550e8400-e29b-41d4-a716-446655440000',
      streamType: 'INVALID',
    });
    assert.strictEqual(result.isValid, false);
  });

  test('validateStreamOffer requires offer object', () => {
    const result = validateStreamOffer({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    assert.strictEqual(result.isValid, false);
  });

  test('validateStreamAnswer requires answer object', () => {
    const result = validateStreamAnswer({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      answer: { type: 'answer', sdp: 'v=0' },
    });
    assert.strictEqual(result.isValid, true);
  });

  test('validateIceCandidate requires candidate', () => {
    const result = validateIceCandidate({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      candidate: { candidate: 'x' },
    });
    assert.strictEqual(result.isValid, true);
  });
});
