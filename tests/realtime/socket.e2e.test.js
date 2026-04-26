import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';
import { connectSocket, once, disconnectQuietly } from '../helpers/socket.js';

async function pickActiveDeviceId(monitorToken) {
  const res = await rest('/api/devices?page=1&limit=50&is_active=true&sort=device_name:asc', {
    headers: { Authorization: `Bearer ${monitorToken}` },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  const d =
    res.data.data.devices.find((x) => String(x.device_name || '').startsWith('E2E')) ||
    res.data.data.devices[0];
  assert.ok(d, 'No active device for socket test');
  return d.id;
}

describe(
  'E2E — Realtime socket monitoring',
  { skip: process.env.SKIP_SOCKET_E2E === '1' },
  () => {
  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
  });

  test('Monitor connects and registers', async () => {
    const { accessToken } = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    const socket = connectSocket(accessToken);
    await new Promise((resolve, reject) => {
      socket.on('connect_error', reject);
      socket.on('connect', resolve);
    });
    socket.emit('register-monitor', {});
    const payload = await once(socket, 'monitor-registered', 10000);
    assert.ok(payload);
    await disconnectQuietly(socket);
  });

  test('Kiosk connects and registers with device id', async () => {
    const kioskLogin = await login(USERS.kioskUser.user_id, USERS.kioskUser.password);
    const monitorTok = (await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password)).accessToken;
    const deviceId = await pickActiveDeviceId(monitorTok);

    const socket = connectSocket(kioskLogin.accessToken);
    await new Promise((resolve, reject) => {
      socket.on('connect_error', reject);
      socket.on('connect', resolve);
    });
    socket.emit('register-kiosk', { deviceId });
    const payload = await once(socket, 'kiosk-registered', 10000);
    assert.strictEqual(payload.kioskId, deviceId);
    await disconnectQuietly(socket);
  });

  test('start-monitoring success and second monitor blocked', async () => {
    const monTok = (await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password)).accessToken;
    const kioskLogin = await login(USERS.kioskUser.user_id, USERS.kioskUser.password);
    const deviceId = await pickActiveDeviceId(monTok);

    const kiosk = connectSocket(kioskLogin.accessToken);
    await new Promise((resolve, reject) => {
      kiosk.on('connect_error', reject);
      kiosk.on('connect', resolve);
    });
    kiosk.emit('register-kiosk', { deviceId });
    await once(kiosk, 'kiosk-registered', 10000);

    const m1 = connectSocket(monTok);
    await new Promise((resolve, reject) => {
      m1.on('connect_error', reject);
      m1.on('connect', resolve);
    });
    m1.emit('register-monitor', {});
    await once(m1, 'monitor-registered', 10000);

    m1.emit('start-monitoring', { deviceId });
    const s1 = await once(m1, 'monitoring-started', 10000);
    assert.strictEqual(s1.deviceId, deviceId);

    const adminTok = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    const m2 = connectSocket(adminTok);
    await new Promise((resolve, reject) => {
      m2.on('connect_error', reject);
      m2.on('connect', resolve);
    });
    m2.emit('register-monitor', {});
    await once(m2, 'monitor-registered', 10000);

    m2.emit('start-monitoring', { deviceId });
    const err = await once(m2, 'error', 10000);
    assert.ok(err && (err.code || err.message), JSON.stringify(err));

    m1.emit('stop-monitoring', { deviceId });
    await once(m1, 'monitoring-stopped', 10000);

    await disconnectQuietly(m2);
    await disconnectQuietly(m1);
    await disconnectQuietly(kiosk);
  });

  test('force-stop by admin ends session', async () => {
    const monTok = (await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password)).accessToken;
    const kioskLogin = await login(USERS.kioskUser.user_id, USERS.kioskUser.password);
    const deviceId = await pickActiveDeviceId(monTok);

    const kiosk = connectSocket(kioskLogin.accessToken);
    await new Promise((resolve, reject) => {
      kiosk.on('connect_error', reject);
      kiosk.on('connect', resolve);
    });
    kiosk.emit('register-kiosk', { deviceId });
    await once(kiosk, 'kiosk-registered', 10000);

    const m1 = connectSocket(monTok);
    await new Promise((resolve, reject) => {
      m1.on('connect_error', reject);
      m1.on('connect', resolve);
    });
    m1.emit('register-monitor', {});
    await once(m1, 'monitor-registered', 10000);
    m1.emit('start-monitoring', { deviceId });
    await once(m1, 'monitoring-started', 10000);

    const adminTok = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    const adminSock = connectSocket(adminTok);
    await new Promise((resolve, reject) => {
      adminSock.on('connect_error', reject);
      adminSock.on('connect', resolve);
    });
    adminSock.emit('register-monitor', {});
    await once(adminSock, 'monitor-registered', 10000);

    adminSock.emit('force-stop-monitoring', { deviceId });
    await once(adminSock, 'monitoring-stopped', 10000);

    await disconnectQuietly(adminSock);
    await disconnectQuietly(m1);
    await disconnectQuietly(kiosk);
  });

  test('Reconnect restore is covered by realtime.manager unit tests (no wall-clock wait)', async () => {
    assert.ok(true);
  });

  test('Session heartbeat timeout is covered by tests/realtime/realtime.manager.unit.test.js', async () => {
    assert.ok(true);
  });
  }
);
