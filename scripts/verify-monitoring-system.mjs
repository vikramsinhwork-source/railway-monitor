#!/usr/bin/env node
/**
 * Verification script for Observer Monitoring System.
 * Run: node scripts/verify-monitoring-system.mjs
 * Env: BASE_URL (default http://localhost:3000)
 */

import {
  canJoinAsObserver,
  canObserveSession,
  isRecvOnlySignaling,
} from '../src/services/observer-permission.service.js';
import * as activeSessionsState from '../src/state/active-sessions.state.js';
import { ROLES } from '../src/middleware/rbac.middleware.js';

const results = [];

function check(name, pass) {
  results.push({ name, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
}

async function main() {
  console.log('\nObserver Monitoring System Verification\n');

  check(
    'Session creation (in-memory registry)',
    (() => {
      activeSessionsState.clearAllActiveSessions();
      const s = activeSessionsState.registerActiveSession({
        sessionId: 'verify-1',
        kioskId: 'k1',
        monitorUserId: 'm1',
        monitorSocketId: 'sock',
        monitorClientId: 'c1',
      });
      return s.status === 'ACTIVE';
    })()
  );

  check(
    'Observer restriction (MONITOR denied)',
    !canJoinAsObserver({ role: ROLES.MONITOR }).allowed
  );

  check(
    'Observer restriction (USER denied)',
    !canJoinAsObserver({ role: ROLES.USER }).allowed
  );

  check(
    'SUPER_ADMIN allowed all divisions',
    canObserveSession(
      { role: ROLES.SUPER_ADMIN },
      { division_id: 'any' }
    ).allowed
  );

  check(
    'Cross-division validation',
    !canObserveSession(
      { role: ROLES.DIVISION_ADMIN, division_id: 'div-a' },
      { division_id: 'div-b' }
    ).allowed
  );

  check(
    'Same-division DIVISION_ADMIN allowed',
    canObserveSession(
      { role: ROLES.DIVISION_ADMIN, division_id: 'div-a' },
      { division_id: 'div-a' }
    ).allowed
  );

  check(
    'Observer recvonly mode flag',
    isRecvOnlySignaling({ mediaIntent: 'recvonly' })
  );

  check(
    'No media publishing flag (missing recvonly)',
    !isRecvOnlySignaling({ signalingMode: 'observer' })
  );

  activeSessionsState.addObserverToSession('verify-1', {
    observer_user_id: 'o1',
    observer_role: ROLES.SUPER_ADMIN,
    observer_socket_id: 's1',
    observer_client_id: 'o1',
  });
  check(
    'Multiple observer support (count)',
    activeSessionsState.listActiveSessions()[0].observer_count === 1
  );

  activeSessionsState.removeObserverFromSession('verify-1', 'o1');
  check(
    'Cleanup observer removal',
    activeSessionsState.listActiveSessions()[0].observer_count === 0
  );

  activeSessionsState.closeActiveSession('verify-1');
  check(
    'Session cleanup',
    activeSessionsState.getActiveSessionById('verify-1') === null
  );

  check(
    'Socket events constants exported',
    typeof (await import('../src/constants/observer.constants.js')).OBSERVER_SOCKET_EVENTS
      .JOIN_AS_OBSERVER === 'string'
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
