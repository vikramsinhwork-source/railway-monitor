import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { normalizeRole } from '../../src/middleware/rbac.middleware.js';
import { rest, login, deviceToken, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

describe('E2E — Authentication', () => {
  before(async () => {
    if (!(await healthCheck())) {
      throw new Error(`Server not reachable at ${BASE_URL}. Start the API (e.g. npm start) or set BASE_URL.`);
    }
  });

  test('Login SUPER_ADMIN', async () => {
    const data = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    assert.ok(data.accessToken);
    assert.strictEqual(data.success, true);
  });

  test('Login DIVISION_ADMIN (Bhavnagar)', async () => {
    const data = await login(USERS.bhavnagarAdmin.user_id, USERS.bhavnagarAdmin.password);
    assert.ok(data.accessToken);
  });

  test('Login DIVISION_ADMIN (Ahmedabad) when seeded', async (t) => {
    const res = await rest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        user_id: USERS.ahmedabadAdmin.user_id,
        password: USERS.ahmedabadAdmin.password,
      }),
    });
    if (res.status === 401) {
      t.skip('Seed ahmedabad_admin (npx sequelize-cli db:seed --seed 20260424120000-seed-e2e-operators-and-fixtures.cjs)');
      return;
    }
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.accessToken);
  });

  test('Login MONITOR', async () => {
    const data = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    assert.ok(data.accessToken);
  });

  test('Wrong password fails', async () => {
    const res = await rest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ user_id: USERS.superAdmin.user_id, password: 'wrong-password-xyz' }),
    });
    assert.strictEqual(res.status, 401);
  });

  test('Invalid token rejected for protected route', async () => {
    const res = await rest('/api/divisions?page=1&limit=5&sort=name:asc', {
      headers: { Authorization: 'Bearer not-a-real-jwt-token' },
    });
    assert.strictEqual(res.status, 401);
  });

  test('JWT contains role + division_id claims', async () => {
    const data = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    const decoded = jwt.decode(data.accessToken);
    assert.ok(decoded);
    assert.strictEqual(decoded.role, 'MONITOR');
    assert.ok(decoded.division_id);
  });

  test('Legacy device-token MONITOR path', async () => {
    const res = await deviceToken('legacy-kiosk-test-1', 'MONITOR');
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.token);
    const decoded = jwt.decode(res.data.token);
    assert.strictEqual(decoded.role, 'MONITOR');
    assert.ok(decoded.clientId);
  });

  test('Legacy ADMIN role string normalizes to SUPER_ADMIN (compatibility)', () => {
    assert.strictEqual(normalizeRole('ADMIN'), 'SUPER_ADMIN');
  });
});
