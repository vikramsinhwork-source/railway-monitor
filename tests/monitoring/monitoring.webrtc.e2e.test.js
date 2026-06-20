import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

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
      device_name: `WebRTC PI ${suffix}`,
      serial_number: `WRTC-${suffix}`,
    }),
  });
  assert.strictEqual(create.status, 201, JSON.stringify(create.data));
  return create.data.data.device;
}

describe('E2E — Monitoring WebRTC signaling', { skip: process.env.SKIP_SOCKET_E2E === '1' }, () => {
  let adminToken;
  let monitorToken;

  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
    adminToken = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    monitorToken = (await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password)).accessToken;
  });

  test('POST /webrtc/offer rejects invalid offer payload', async () => {
    const device = await createRaspberryDevice(adminToken);

    const res = await rest(
      `/api/monitoring/devices/${device.id}/streams/camera1/webrtc/offer`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ type: 'answer', sdp: '' }),
      }
    );

    assert.strictEqual(res.status, 400, JSON.stringify(res.data));
  });

  test('POST /webrtc/offer returns 401 without JWT', async () => {
    const device = await createRaspberryDevice(adminToken);

    const res = await rest(
      `/api/monitoring/devices/${device.id}/streams/camera1/webrtc/offer`,
      {
        method: 'POST',
        body: JSON.stringify({ type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' }),
      }
    );

    assert.strictEqual(res.status, 401, JSON.stringify(res.data));
  });

  test('POST /webrtc/offer returns 503 when device is offline', async () => {
    const device = await createRaspberryDevice(adminToken);

    const res = await rest(
      `/api/monitoring/devices/${device.id}/streams/camera1/webrtc/offer`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' }),
      }
    );

    assert.strictEqual(res.status, 503, JSON.stringify(res.data));
  });
});
