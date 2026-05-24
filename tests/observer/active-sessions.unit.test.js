import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as activeSessionsState from '../../src/state/active-sessions.state.js';

describe('active-sessions.state', () => {
  beforeEach(() => {
    activeSessionsState.clearAllActiveSessions();
  });

  it('registers and lists active session', () => {
    activeSessionsState.registerActiveSession({
      sessionId: 'sess-1',
      divisionId: 'div-1',
      lobbyId: 'lobby-1',
      kioskId: 'kiosk-1',
      monitorUserId: 'mon-1',
      monitorSocketId: 'sock-m',
      monitorClientId: 'MON_01',
    });

    const list = activeSessionsState.listActiveSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].session_id, 'sess-1');
    assert.equal(list[0].observer_count, 0);
  });

  it('adds and removes observer', () => {
    activeSessionsState.registerActiveSession({
      sessionId: 'sess-2',
      kioskId: 'kiosk-2',
      monitorUserId: 'mon-2',
      monitorSocketId: 'sock-m2',
      monitorClientId: 'MON_02',
    });

    activeSessionsState.addObserverToSession('sess-2', {
      observer_user_id: 'admin-1',
      observer_role: 'SUPER_ADMIN',
      observer_socket_id: 'sock-o1',
      observer_client_id: 'admin-1',
    });

    let list = activeSessionsState.listActiveSessions();
    assert.equal(list[0].observer_count, 1);

    activeSessionsState.removeObserverFromSession('sess-2', 'admin-1');
    list = activeSessionsState.listActiveSessions();
    assert.equal(list[0].observer_count, 0);
  });

  it('filters by division', () => {
    activeSessionsState.registerActiveSession({
      sessionId: 'a',
      divisionId: 'div-a',
      kioskId: 'k1',
      monitorUserId: 'm1',
      monitorSocketId: 's1',
      monitorClientId: 'c1',
    });
    activeSessionsState.registerActiveSession({
      sessionId: 'b',
      divisionId: 'div-b',
      kioskId: 'k2',
      monitorUserId: 'm2',
      monitorSocketId: 's2',
      monitorClientId: 'c2',
    });

    const filtered = activeSessionsState.listActiveSessions({ divisionId: 'div-a' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].session_id, 'a');
  });

  it('closes session and clears observers', () => {
    activeSessionsState.registerActiveSession({
      sessionId: 'sess-3',
      kioskId: 'kiosk-3',
      monitorUserId: 'mon-3',
      monitorSocketId: 'sock-m3',
      monitorClientId: 'MON_03',
    });
    activeSessionsState.addObserverToSession('sess-3', {
      observer_user_id: 'obs-1',
      observer_role: 'DIVISION_ADMIN',
      observer_socket_id: 'sock-o',
      observer_client_id: 'obs-1',
    });

    activeSessionsState.closeActiveSession('sess-3', 'ended');
    assert.equal(activeSessionsState.listActiveSessions().length, 0);
    assert.equal(activeSessionsState.getActiveSessionByKioskId('kiosk-3'), null);
  });
});
