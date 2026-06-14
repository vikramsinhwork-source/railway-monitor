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

  test('GET /webrtc/config returns signaling config shape', async () => {
    const device = await createRaspberryDevice(adminToken);

    const res = await rest(`/api/monitoring/devices/${device.id}/webrtc/config`, {
      headers: { Authorization: `Bearer ${monitorToken}` },
    });

    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.device_id, device.id);
    assert.strictEqual(res.data.data.pi_ip, null);
    assert.ok(Number(res.data.data.go2rtc_port) > 0);
    assert.strictEqual(res.data.data.local_go2rtc_url, null);
    assert.strictEqual(
      res.data.data.proxy_offer_base_url,
      `/api/monitoring/devices/${device.id}/streams`
    );
    assert.ok(Array.isArray(res.data.data.ice_servers));
    assert.ok(res.data.data.ice_servers.length > 0);
  });

  test('POST /webrtc/offer rejects invalid offer payload', async () => {
    const device = await createRaspberryDevice(adminToken);

    const res = await rest(
      `/api/monitoring/devices/${device.id}/streams/kiosk1/webrtc/offer`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ type: 'answer', sdp: '' }),
      }
    );

    assert.strictEqual(res.status, 400, JSON.stringify(res.data));
  });

  test('POST /webrtc/offer returns 503 when Pi IP is unavailable', async () => {
    const device = await createRaspberryDevice(adminToken);

    const res = await rest(
      `/api/monitoring/devices/${device.id}/streams/kiosk1/webrtc/offer`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' }),
      }
    );

    assert.strictEqual(res.status, 503, JSON.stringify(res.data));
  });
});
