import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, deviceToken, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

describe('E2E — Regression smoke', () => {
  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
  });

  test('Primary admin login still works', async () => {
    const data = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    assert.ok(data.accessToken);
  });

  test('Legacy device-token path still works', async () => {
    const res = await deviceToken('regression-kiosk-1', 'KIOSK');
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.token);
  });

  test('Core REST contracts unchanged (divisions list)', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/divisions?page=1&limit=5&sort=name:asc', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.data.divisions));
  });

  test('Monitor cannot exfiltrate other divisions via analytics detail', async () => {
    const { accessToken } = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    const res = await rest('/api/analytics/incidents?page=1&limit=5', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 403);
  });
});
