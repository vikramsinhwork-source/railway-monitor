import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck, deviceToken } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';
import { connectSocket, once, disconnectQuietly } from '../helpers/socket.js';

async function getAhmedabadContext(adminToken) {
  const divRes = await rest('/api/divisions?page=1&limit=50&sort=name:asc&search=Ahmed', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const division = (divRes.data.data.divisions || []).find((d) => d.name === 'Ahmedabad');
  assert.ok(division, 'Ahmedabad division missing');

  const lobbyRes = await rest('/api/lobbies?page=1&limit=20&status=true&sort=name:asc&search=Vatva', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const lobby = lobbyRes.data.data.lobbies[0];
  assert.ok(lobby, 'Vatva lobby missing');
  return { division, lobby };
}

async function createRaspberryDevice(adminToken) {
  const { division, lobby } = await getAhmedabadContext(adminToken);
  const suffix = Date.now().toString(36);
  const create = await rest('/api/devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      division_id: division.id,
      lobby_id: lobby.id,
      device_type: 'RASPBERRY',
      device_name: `Monitoring PI ${suffix}`,
      serial_number: `MON-${suffix}`,
    }),
  });
  assert.strictEqual(create.status, 201, JSON.stringify(create.data));
  return create.data.data.device;
}

describe('E2E — Monitoring module', { skip: process.env.SKIP_SOCKET_E2E === '1' }, () => {
  let adminToken;
  let monitorToken;

  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
    adminToken = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    monitorToken = (await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password)).accessToken;
  });

  test('device-token success', async () => {
    const device = await createRaspberryDevice(adminToken);
    const res = await deviceToken(device.id, 'KIOSK');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.token);
  });

  test('device-token invalid secret', async () => {
    const device = await createRaspberryDevice(adminToken);
    const res = await deviceToken(device.id, 'KIOSK', 'wrong-secret-value');
    assert.strictEqual(res.status, 401);
  });

  test('register device via REST', async () => {
    const device = await createRaspberryDevice(adminToken);
    const tokenRes = await deviceToken(device.id, 'KIOSK');
    const token = tokenRes.data.token;

    const res = await rest('/api/monitoring/devices/register', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        deviceId: device.id,
        hostname: 'test-pi',
        ipAddress: '10.0.0.1',
        agentVersion: '1.0.0-test',
      }),
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.data.device.status, 'ONLINE');
  });

  test('heartbeat via REST', async () => {
    const device = await createRaspberryDevice(adminToken);
    const token = (await deviceToken(device.id, 'KIOSK')).data.token;

    const res = await rest('/api/monitoring/devices/heartbeat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: device.id, cpu: 0.5, memory: 42 }),
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.heartbeatId);
  });

  test('stream status via REST', async () => {
    const device = await createRaspberryDevice(adminToken);
    const token = (await deviceToken(device.id, 'KIOSK')).data.token;

    const res = await rest('/api/monitoring/devices/stream-status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        deviceId: device.id,
        streams: [{ name: 'kiosk1', online: true, producers: 1, consumers: 0 }],
        mediamtx: { summary: { online: 1, offline: 0, total: 1 } },
      }),
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  });

  test('device:online socket event', async () => {
    const device = await createRaspberryDevice(adminToken);
    const token = (await deviceToken(device.id, 'KIOSK')).data.token;
    const socket = connectSocket(token);
    await once(socket, 'connect', 10000);

    socket.emit('device:online', {
      deviceId: device.id,
      hostname: 'socket-pi',
      agentVersion: '1.0.0',
      serialNumber: device.serial_number,
    });

    const ack = await once(socket, 'device:online-ack', 10000);
    assert.strictEqual(ack.deviceId, device.id);
    assert.strictEqual(ack.status, 'ONLINE');
    await disconnectQuietly(socket);
  });

  test('device:heartbeat socket event', async () => {
    const device = await createRaspberryDevice(adminToken);
    const token = (await deviceToken(device.id, 'KIOSK')).data.token;
    const socket = connectSocket(token);
    await once(socket, 'connect', 10000);

    socket.emit('device:online', {
      deviceId: device.id,
      hostname: 'hb-pi',
      agentVersion: '1.0.0',
      serialNumber: device.serial_number,
    });
    await once(socket, 'device:online-ack', 10000);

    socket.emit('device:heartbeat', { deviceId: device.id, cpu: 1, memory: 50 });
    const ack = await once(socket, 'device:heartbeat-ack', 10000);
    assert.strictEqual(ack.deviceId, device.id);
    await disconnectQuietly(socket);
  });

  test('command delivery — capture screenshot', async () => {
    const device = await createRaspberryDevice(adminToken);
    const token = (await deviceToken(device.id, 'KIOSK')).data.token;
    const socket = connectSocket(token);
    await once(socket, 'connect', 10000);

    socket.emit('device:online', {
      deviceId: device.id,
      hostname: 'cmd-pi',
      agentVersion: '1.0.0',
      serialNumber: device.serial_number,
    });
    await once(socket, 'device:online-ack', 10000);

    const cmdPromise = once(socket, 'device:capture-screenshot', 10000);
    const cmdRes = await rest(`/api/monitoring/devices/${device.id}/capture-screenshot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${monitorToken}` },
      body: JSON.stringify({}),
    });
    assert.strictEqual(cmdRes.status, 200, JSON.stringify(cmdRes.data));

    const cmd = await cmdPromise;
    assert.strictEqual(cmd.deviceId, device.id);
    await disconnectQuietly(socket);
  });

  test('dashboard statistics generation', async () => {
    const res = await rest('/api/monitoring/dashboard', {
      headers: { Authorization: `Bearer ${monitorToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(typeof res.data.data.total_devices === 'number');
    assert.ok(typeof res.data.data.online_devices === 'number');
    assert.ok(typeof res.data.data.offline_devices === 'number');
  });
});
