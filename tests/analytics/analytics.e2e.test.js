import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

describe('E2E — Analytics APIs', () => {
  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
    const probe = await rest('/api/analytics/summary');
    if (probe.status === 404) {
      throw new Error(
        'GET /api/analytics/summary returned 404. Restart the Node process so server.js mounts /api/analytics.'
      );
    }
  });

  test('Summary returns metrics', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/analytics/summary', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(typeof res.data.data.uptime_pct === 'number');
    assert.ok(Array.isArray(res.data.data.division_ranking));
  });

  test('Division ranking present for super admin', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/analytics/divisions', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(Array.isArray(res.data.data.divisions));
  });

  test('Incidents filter critical', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/analytics/incidents?severity=CRITICAL&page=1&limit=10&sort=created_at:desc', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(Array.isArray(res.data.data.incidents));
  });

  test('SLA report shape', async () => {
    const { accessToken } = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    const res = await rest('/api/analytics/sla', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.actuals);
    assert.ok('compliance' in res.data.data);
  });

  test('Monitor limited to summary + SLA (not divisions detail)', async () => {
    const { accessToken } = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    const blocked = await rest('/api/analytics/divisions', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(blocked.status, 403);
  });
});
