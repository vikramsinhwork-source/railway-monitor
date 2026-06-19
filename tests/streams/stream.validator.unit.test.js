import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  validateStreamRequest,
  validateStreamOffer,
  validateStreamAnswer,
  validateIceCandidate,
  validateViewerOffer,
  validateAgentAnswer,
  validateViewerIce,
  validateAgentIce,
} from '../../src/modules/streams/stream.validator.js';

describe('Unit — stream validators', () => {
  test('validateStreamRequest accepts KIOSK', () => {
    const result = validateStreamRequest({
      deviceId: '550e8400-e29b-41d4-a716-446655440000',
      streamType: 'KIOSK',
    });
    assert.strictEqual(result.isValid, true);
  });

  test('validateStreamRequest accepts optional streamName', () => {
    const result = validateStreamRequest({
      deviceId: '550e8400-e29b-41d4-a716-446655440000',
      streamType: 'CCTV',
      streamName: 'camera1',
    });
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.value.streamName, 'camera1');
  });

  test('validateStreamRequest rejects invalid streamName', () => {
    const result = validateStreamRequest({
      deviceId: '550e8400-e29b-41d4-a716-446655440000',
      streamType: 'CCTV',
      streamName: 'bad name!',
    });
    assert.strictEqual(result.isValid, false);
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

  test('validateViewerOffer accepts offer object', () => {
    const result = validateViewerOffer({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      offer: { type: 'offer', sdp: 'v=0' },
    });
    assert.strictEqual(result.isValid, true);
  });

  test('validateStreamAnswer requires answer object', () => {
    const result = validateStreamAnswer({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      answer: { type: 'answer', sdp: 'v=0' },
    });
    assert.strictEqual(result.isValid, true);
  });

  test('validateAgentAnswer accepts answer object', () => {
    const result = validateAgentAnswer({
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

  test('validateViewerIce and validateAgentIce accept candidate', () => {
    const payload = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      candidate: { candidate: 'x' },
    };
    assert.strictEqual(validateViewerIce(payload).isValid, true);
    assert.strictEqual(validateAgentIce(payload).isValid, true);
  });
});
