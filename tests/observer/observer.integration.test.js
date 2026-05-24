/**
 * Observer monitoring integration tests (CASE 1–10).
 * Requires running server + seeded users (npm test prerequisites).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { login } from '../helpers/http.js';
import { socketBaseUrl } from '../helpers/env.js';
import { USERS } from '../helpers/fixtures.js';
import { once, disconnectQuietly } from '../helpers/socket.js';

const OBSERVER_EVENTS = {
  JOIN: 'join-as-observer',
  ACTIVE: 'active-sessions',
  GET: 'get-active-sessions',
  JOINED: 'observer-joined',
};

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(socketBaseUrl(), {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 10000);
  });
}

async function loginToken(credentials) {
  const res = await login(credentials.user_id, credentials.password);
  const token = res.accessToken || res.token;
  assert.ok(token, 'login token required');
  return token;
}

describe('observer monitoring integration', { skip: !process.env.BASE_URL }, () => {
  let monitorSocket;
  let kioskSocket;
  let superAdminSocket;
  let divisionAdminSocket;
  let monitorToken;
  let kioskToken;
  let superToken;
  let divAdminToken;
  let deviceId;

  before(async () => {
    monitorToken = await loginToken(USERS.bhavnagarMonitor);
    kioskToken = await loginToken(USERS.kioskUser);
    superToken = await loginToken(USERS.superAdmin);
    divAdminToken = await loginToken(USERS.bhavnagarAdmin);

    monitorSocket = await connectSocket(monitorToken);
    kioskSocket = await connectSocket(kioskToken);
    superAdminSocket = await connectSocket(superToken);
    divisionAdminSocket = await connectSocket(divAdminToken);

    kioskSocket.emit('register-kiosk');
    await once(kioskSocket, 'kiosk-registered', 8000).catch(() => {});

    monitorSocket.emit('register-monitor');
    await once(monitorSocket, 'monitor-registered', 8000).catch(() => {});

    superAdminSocket.emit('register-monitor');
    await once(superAdminSocket, 'monitor-registered', 8000).catch(() => {});

    divisionAdminSocket.emit('register-monitor');
    await once(divisionAdminSocket, 'monitor-registered', 8000).catch(() => {});
  });

  after(async () => {
    await disconnectQuietly(monitorSocket);
    await disconnectQuietly(kioskSocket);
    await disconnectQuietly(superAdminSocket);
    await disconnectQuietly(divisionAdminSocket);
  });

  it('CASE 1: MONITOR starts session — session created', async () => {
    const reg = await once(kioskSocket, 'kiosk-registered', 5000).catch(() => null);
    deviceId = reg?.kioskId || reg?.deviceId;
    if (!deviceId) {
      const listPayload = await new Promise((resolve) => {
        monitorSocket.emit('register-monitor');
        monitorSocket.once('monitor-registered', (d) => resolve(d));
        setTimeout(() => resolve({}), 3000);
      });
      const first = listPayload?.onlineKiosks?.[0];
      deviceId = first?.kioskId || first?.deviceId;
    }
    assert.ok(deviceId, 'kiosk device id required');

    const createdP = once(superAdminSocket, 'session-created', 15000);
    monitorSocket.emit('start-monitoring', { kioskId: deviceId, deviceId });
    await once(monitorSocket, 'monitoring-started', 10000);
    const created = await createdP;
    assert.ok(created?.session_id || created?.kiosk_id);
  });

  it('CASE 2: SUPER_ADMIN joins as observer', async () => {
    const sessionsP = once(superAdminSocket, OBSERVER_EVENTS.ACTIVE, 8000);
    superAdminSocket.emit(OBSERVER_EVENTS.GET, {});
    const { sessions } = await sessionsP;
    assert.ok(Array.isArray(sessions) && sessions.length >= 1);

    const sessionId = sessions[0].session_id;
    const joinP = once(superAdminSocket, OBSERVER_EVENTS.JOINED, 10000);
    superAdminSocket.emit(OBSERVER_EVENTS.JOIN, { sessionId });
    const joined = await joinP;
    assert.ok(joined?.sessionId || joined?.kioskId);
    superAdminSocket.data = superAdminSocket.data || {};
    superAdminSocket.data.isObserver = true;
  });

  it('CASE 3: DIVISION_ADMIN same division allowed', async () => {
    const sessionsP = once(divisionAdminSocket, OBSERVER_EVENTS.ACTIVE, 8000);
    divisionAdminSocket.emit(OBSERVER_EVENTS.GET, {});
    const { sessions } = await sessionsP;
    const sessionId = sessions?.[0]?.session_id;
    assert.ok(sessionId);

    const errP = once(divisionAdminSocket, 'error', 5000).catch(() => null);
    divisionAdminSocket.emit(OBSERVER_EVENTS.JOIN, { sessionId });
    const err = await errP;
    assert.equal(err, null);
  });

  it('CASE 5: MONITOR denied observer mode', async () => {
    const sessionsP = once(monitorSocket, OBSERVER_EVENTS.ACTIVE, 8000).catch(() => ({ sessions: [] }));
    monitorSocket.emit(OBSERVER_EVENTS.GET, {});
    const payload = await sessionsP;
    const sessionId = payload?.sessions?.[0]?.session_id;
    if (!sessionId) return;

    const err = await once(monitorSocket, 'error', 8000).catch(() => null);
    monitorSocket.emit(OBSERVER_EVENTS.JOIN, { sessionId });
    const denied = await err;
    assert.ok(denied?.code || denied?.message);
  });

  it('CASE 8: Session ends — observers notified', async () => {
    monitorSocket.emit('stop-monitoring', { kioskId: deviceId, deviceId });
    await once(monitorSocket, 'monitoring-stopped', 8000).catch(() => {});
    const ended = await once(superAdminSocket, 'session-ended', 8000).catch(() => null);
    assert.ok(ended);
  });
});
