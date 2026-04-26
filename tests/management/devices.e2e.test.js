import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS, DIVISION_NAMES } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

async function divisionId(token, name) {
  const res = await rest(`/api/divisions?page=1&limit=50&sort=name:asc&search=${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  const d = res.data.data.divisions.find((x) => x.name === name);
  assert.ok(d, name);
  return d.id;
}

async function lobbyBySearch(token, search) {
  const res = await rest(`/api/lobbies?page=1&limit=30&status=true&sort=name:asc&search=${encodeURIComponent(search)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  const lobby = res.data.data.lobbies[0];
  assert.ok(lobby, `No lobby for search=${search}`);
  return lobby;
}

describe('E2E — Device APIs', () => {
  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
  });

  test('Create camera', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const ah = await divisionId(accessToken, DIVISION_NAMES.ahmedabad);
    const lobby = await lobbyBySearch(accessToken, 'Vatva');
    const res = await rest('/api/devices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        division_id: ah,
        lobby_id: lobby.id,
        device_type: 'CAMERA',
        device_name: `E2E Cam ${Date.now()}`,
        stream_url: 'https://example.com/hls/test.m3u8',
      }),
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.data));
  });

  test('Create kiosk', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const ah = await divisionId(accessToken, DIVISION_NAMES.ahmedabad);
    const lobby = await lobbyBySearch(accessToken, 'Vatva');
    const res = await rest('/api/devices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        division_id: ah,
        lobby_id: lobby.id,
        device_type: 'KIOSK',
        device_name: `E2E Kiosk ${Date.now()}`,
      }),
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.data));
  });

  test('Update stream URL', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const ah = await divisionId(accessToken, DIVISION_NAMES.ahmedabad);
    const lobby = await lobbyBySearch(accessToken, 'Vatva');
    const created = await rest('/api/devices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        division_id: ah,
        lobby_id: lobby.id,
        device_type: 'CAMERA',
        device_name: `StreamPatch ${Date.now()}`,
      }),
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    const id = created.data.data.device.id;
    const patched = await rest(`/api/devices/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ stream_url: 'https://cdn.example/updated.m3u8' }),
    });
    assert.strictEqual(patched.status, 200, JSON.stringify(patched.data));
    assert.strictEqual(patched.data.data.device.stream_url, 'https://cdn.example/updated.m3u8');
  });

  test('Soft disable device', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const ah = await divisionId(accessToken, DIVISION_NAMES.ahmedabad);
    const lobby = await lobbyBySearch(accessToken, 'Vatva');
    const created = await rest('/api/devices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        division_id: ah,
        lobby_id: lobby.id,
        device_type: 'CAMERA',
        device_name: `SoftOff ${Date.now()}`,
      }),
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    const id = created.data.data.device.id;
    const del = await rest(`/api/devices/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(del.status, 200, JSON.stringify(del.data));
    assert.strictEqual(del.data.data.device.is_active, false);
  });

  test('Filter by lobby', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const lobby = await lobbyBySearch(accessToken, 'Vatva');
    const res = await rest(
      `/api/devices?page=1&limit=20&sort=device_name:asc&is_active=true&lobby_id=${lobby.id}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.devices.every((d) => d.lobby_id === lobby.id));
  });

  test('Filter by type', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/devices?page=1&limit=20&sort=device_name:asc&is_active=true&device_type=KIOSK', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.devices.every((d) => d.device_type === 'KIOSK'));
  });

  test('Pagination works', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/devices?page=1&limit=2&sort=device_name:asc&is_active=true', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.devices.length <= 2);
    assert.ok(res.data.data.pagination.total >= 0);
  });
});
