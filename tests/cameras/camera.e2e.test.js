import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

describe('E2E — Camera MediaMTX URLs', { skip: process.env.SKIP_SOCKET_E2E === '1' }, () => {
  let adminToken;
  let monitorToken;

  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
    adminToken = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    monitorToken = (await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password)).accessToken;
  });

  test('GET /api/cameras/:id/webrtc-url returns 404 for unknown camera', async () => {
    const res = await rest('/api/cameras/00000000-0000-4000-8000-000000000099/webrtc-url', {
      headers: { Authorization: `Bearer ${monitorToken}` },
    });
    assert.strictEqual(res.status, 404);
  });

  test('GET /api/cameras requires monitor auth', async () => {
    const res = await rest('/api/cameras');
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/cameras lists cameras for monitor', async () => {
    const res = await rest('/api/cameras', {
      headers: { Authorization: `Bearer ${monitorToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.data.cameras));
  });
});
