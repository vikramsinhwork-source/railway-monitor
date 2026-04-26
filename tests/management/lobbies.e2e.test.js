import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS, DIVISION_NAMES } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

async function divisionId(token, name) {
  const res = await rest(
    `/api/divisions?page=1&limit=50&sort=name:asc&search=${encodeURIComponent(name.slice(0, 4))}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  const d = res.data.data.divisions.find((x) => x.name === name);
  assert.ok(d, name);
  return d.id;
}

describe('E2E — Lobby APIs', () => {
  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
  });

  test('Create lobby under division (super admin)', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const bhId = await divisionId(accessToken, DIVISION_NAMES.bhavnagar);
    const res = await rest('/api/lobbies', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        division_id: bhId,
        name: `E2E Lobby ${Date.now()}`,
        station_name: `E2E-${Date.now().toString(36).slice(-6)}`,
        city: 'Bhavnagar',
      }),
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.data));
  });

  test('Division admin own division only', async () => {
    const superTok = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    const adminTok = (await login(USERS.bhavnagarAdmin.user_id, USERS.bhavnagarAdmin.password)).accessToken;
    const ahId = await divisionId(superTok, DIVISION_NAMES.ahmedabad);
    const blocked = await rest('/api/lobbies', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminTok}` },
      body: JSON.stringify({
        division_id: ahId,
        name: 'Blocked',
        station_name: 'B1',
        city: 'Ahmedabad',
      }),
    });
    assert.strictEqual(blocked.status, 403, JSON.stringify(blocked.data));
  });

  test('Soft delete lobby', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const ahId = await divisionId(accessToken, DIVISION_NAMES.ahmedabad);
    const created = await rest('/api/lobbies', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        division_id: ahId,
        name: `SoftDel ${Date.now()}`,
        station_name: `SD-${Date.now().toString(36).slice(-6)}`,
        city: 'Ahmedabad',
      }),
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    const id = created.data.data.lobby.id;
    const del = await rest(`/api/lobbies/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(del.status, 200, JSON.stringify(del.data));
    assert.strictEqual(del.data.data.lobby.status, false);
  });

  test('Search Vatva', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/lobbies?page=1&limit=20&status=true&sort=name:asc&search=Vatva', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.lobbies.some((l) => String(l.name + l.station_name).includes('Vatva')));
  });

  test('City filter works', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/lobbies?page=1&limit=30&status=true&sort=city:asc&city=Ahmedabad', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.lobbies.every((l) => /ahmedabad/i.test(l.city)));
  });

  test('Monitor sees assigned only', async () => {
    const mon = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    const res = await rest('/api/lobbies?page=1&limit=50&status=true&sort=name:asc', {
      headers: { Authorization: `Bearer ${mon.accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok((res.data.data.lobbies || []).length >= 1);
  });
});
