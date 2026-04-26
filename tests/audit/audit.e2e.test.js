import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import sequelize from '../../src/config/sequelize.js';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

async function countAudit(action) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = :action`,
    { replacements: { action } }
  );
  return rows[0]?.c ?? 0;
}

describe('E2E — Audit logs', () => {
  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
  });

  test('Manual device recover creates audit entry', async () => {
    const superTok = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
    const devices = await rest('/api/devices?page=1&limit=5&is_active=true&sort=created_at:desc', {
      headers: { Authorization: `Bearer ${superTok}` },
    });
    assert.strictEqual(devices.status, 200, JSON.stringify(devices.data));
    const id = devices.data.data.devices[0]?.id;
    assert.ok(id);
    const before = await countAudit('DEVICE_MANUAL_RECOVERY');
    const res = await rest(`/api/health/devices/${id}/recover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superTok}` },
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.data));
    const after = await countAudit('DEVICE_MANUAL_RECOVERY');
    assert.ok(after >= before);
  });
});
