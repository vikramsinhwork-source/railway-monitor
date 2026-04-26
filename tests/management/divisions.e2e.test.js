import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

describe('E2E — Division APIs', () => {
  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
  });

  test('Create division', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const code = `T${Date.now().toString(36).slice(-6)}`.slice(0, 10);
    const res = await rest('/api/divisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name: `E2E Division ${Date.now()}`,
        code,
        description: 'e2e create',
      }),
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.data));
    assert.ok(res.data.data.division.id);
  });

  test('Duplicate code blocked', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const code = `U${Date.now().toString(36).slice(-6)}`.slice(0, 10);
    const first = await rest('/api/divisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name: `Dup A ${Date.now()}`,
        code,
      }),
    });
    assert.strictEqual(first.status, 201, JSON.stringify(first.data));
    const second = await rest('/api/divisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name: `Dup B ${Date.now()}`,
        code,
      }),
    });
    assert.ok(second.status === 409 || second.status === 400, JSON.stringify(second.data));
  });

  test('Get all divisions with pagination', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/divisions?page=1&limit=2&sort=name:asc', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.divisions.length <= 2);
    assert.ok(res.data.data.pagination.total >= 1);
  });

  test('Search works', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/divisions?page=1&limit=20&sort=name:asc&search=Ahmed', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.data.divisions.some((d) => d.name.includes('Ahmed')));
  });

  test('Sort works', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const res = await rest('/api/divisions?page=1&limit=20&sort=code:desc', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200);
    const codes = res.data.data.divisions.map((d) => d.code).filter(Boolean);
    if (codes.length >= 2) {
      const sorted = [...codes].sort((a, b) => b.localeCompare(a));
      assert.deepStrictEqual(codes, sorted);
    }
  });

  test('Update division', async () => {
    const { accessToken } = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
    const code = `V${Date.now().toString(36).slice(-6)}`.slice(0, 10);
    const created = await rest('/api/divisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name: `Patch Me ${Date.now()}`,
        code,
      }),
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    const id = created.data.data.division.id;
    const patched = await rest(`/api/divisions/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ description: 'patched-by-e2e', status: false }),
    });
    assert.strictEqual(patched.status, 200, JSON.stringify(patched.data));
    assert.strictEqual(patched.data.data.division.description, 'patched-by-e2e');
    assert.strictEqual(patched.data.data.division.status, false);
  });
});
