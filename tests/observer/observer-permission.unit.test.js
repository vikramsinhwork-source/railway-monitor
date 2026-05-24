import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canJoinAsObserver,
  canObserveSession,
  isRecvOnlySignaling,
} from '../../src/services/observer-permission.service.js';
import { ROLES } from '../../src/middleware/rbac.middleware.js';

describe('observer-permission.service', () => {
  it('allows SUPER_ADMIN observer', () => {
    const r = canJoinAsObserver({ role: ROLES.SUPER_ADMIN, userId: '1' });
    assert.equal(r.allowed, true);
  });

  it('allows DIVISION_ADMIN observer', () => {
    const r = canJoinAsObserver({ role: ROLES.DIVISION_ADMIN, userId: '2' });
    assert.equal(r.allowed, true);
  });

  it('denies MONITOR observer', () => {
    const r = canJoinAsObserver({ role: ROLES.MONITOR, userId: '3' });
    assert.equal(r.allowed, false);
  });

  it('denies USER/KIOSK observer', () => {
    const r = canJoinAsObserver({ role: ROLES.USER, userId: '4' });
    assert.equal(r.allowed, false);
  });

  it('DIVISION_ADMIN same division allowed', () => {
    const div = '11111111-1111-4111-8111-111111111111';
    const r = canObserveSession(
      { role: ROLES.DIVISION_ADMIN, division_id: div },
      { division_id: div }
    );
    assert.equal(r.allowed, true);
  });

  it('DIVISION_ADMIN cross division denied', () => {
    const r = canObserveSession(
      { role: ROLES.DIVISION_ADMIN, division_id: '11111111-1111-4111-8111-111111111111' },
      { division_id: '22222222-2222-4222-8222-222222222222' }
    );
    assert.equal(r.allowed, false);
  });

  it('SUPER_ADMIN any division allowed', () => {
    const r = canObserveSession(
      { role: ROLES.SUPER_ADMIN, division_id: null },
      { division_id: '22222222-2222-4222-8222-222222222222' }
    );
    assert.equal(r.allowed, true);
  });

  it('recvonly signaling detection', () => {
    assert.equal(isRecvOnlySignaling({ mediaIntent: 'recvonly' }), true);
    assert.equal(
      isRecvOnlySignaling({ signalingMode: 'observer', recvOnly: true }),
      true
    );
    assert.equal(isRecvOnlySignaling({}), false);
  });
});
