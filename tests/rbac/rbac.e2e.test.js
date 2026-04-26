import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS, DIVISION_NAMES } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

async function getDivisionIdByName(token, name) {
  const res = await rest(`/api/divisions?page=1&limit=50&sort=name:asc&search=${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  const row = res.data.data.divisions.find((d) => d.name === name);
  assert.ok(row, `division ${name}`);
  return row.id;
}

describe('E2E — RBAC + division security', () => {
  before(async () => {
    if (!(await healthCheck())) {
      throw new Error(`Server not reachable at ${BASE_URL}`);
    }
  });

  test('SUPER_ADMIN can list all divisions', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/divisions?page=1&limit=50&sort=name:asc', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.data.divisions.length >= 2);
  });

  test('Bhavnagar admin blocked from creating lobby in Ahmedabad', async () => {
    const superTok = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    const adminTok = (await login(USERS.bhavnagarAdmin.user_id, USERS.bhavnagarAdmin.password)).accessToken;
    const ahmedabadId = await getDivisionIdByName(superTok, DIVISION_NAMES.ahmedabad);

    const blocked = await rest('/api/lobbies', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminTok}` },
      body: JSON.stringify({
        division_id: ahmedabadId,
        name: `RBAC Block ${Date.now()}`,
        station_name: 'X',
        city: 'Ahmedabad',
      }),
    });
    assert.strictEqual(blocked.status, 403, JSON.stringify(blocked.data));
  });

  test('Monitor sees only assigned lobby list scope', async () => {
    const mon = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    const res = await rest('/api/lobbies?page=1&limit=50&sort=name:asc', {
      headers: { Authorization: `Bearer ${mon.accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    const names = (res.data.data.lobbies || []).map((l) => l.name + '/' + l.station_name);
    assert.ok(names.some((n) => n.includes('Vatva')), 'Expected Vatva assignment from seed');
  });

  test('Bhavnagar monitor sees only Botad assignment', async (t) => {
    const resLogin = await rest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        user_id: USERS.bhavnagarMonitor.user_id,
        password: USERS.bhavnagarMonitor.password,
      }),
    });
    if (resLogin.status === 401) {
      t.skip('Seed bhavnagar_monitor (e2e operators seeder)');
      return;
    }
    const mon = resLogin.data;
    const res = await rest('/api/lobbies?page=1&limit=50&sort=name:asc', {
      headers: { Authorization: `Bearer ${mon.accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    const lobbies = res.data.data.lobbies || [];
    assert.ok(lobbies.every((l) => l.name === 'Botad' && l.station_name === 'Botad'));
  });

  test('Division admin cannot PATCH divisions (super admin only)', async () => {
    const adminTok = (await login(USERS.bhavnagarAdmin.user_id, USERS.bhavnagarAdmin.password)).accessToken;
    const superTok = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    const ahmedabadId = await getDivisionIdByName(superTok, DIVISION_NAMES.ahmedabad);
    const blocked = await rest(`/api/divisions/${ahmedabadId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminTok}` },
      body: JSON.stringify({ description: 'should fail' }),
    });
    assert.strictEqual(blocked.status, 403, JSON.stringify(blocked.data));
  });

  test('RBAC dry-run bypass is opt-in (documented)', async () => {
    if (process.env.RBAC_DRY_RUN === 'true') {
      assert.ok(true, 'RBAC_DRY_RUN=true — enforcement relaxed; see server logs for bypass warnings.');
    } else {
      const mon = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
      const res = await rest('/api/analytics/divisions', {
        headers: { Authorization: `Bearer ${mon.accessToken}` },
      });
      assert.strictEqual(res.status, 403);
    }
  });
});
