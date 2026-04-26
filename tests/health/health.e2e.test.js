import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import sequelize from '../../src/config/sequelize.js';
import Device from '../../src/modules/divisions/device.model.js';
import { runHealthTier } from '../../src/modules/health/health.service.js';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';

describe('E2E — Health engine (DB + tier runner)', () => {
  test('runHealthTier inserts logs and snapshots', async () => {
    const fakeIo = { to: () => ({ emit: () => {} }) };
    await runHealthTier(fakeIo, 'HEARTBEAT_30S');
    const [logs] = await sequelize.query(`SELECT COUNT(*)::int AS c FROM device_logs`);
    const [snaps] = await sequelize.query(`SELECT COUNT(*)::int AS c FROM device_health_snapshots`);
    assert.ok(logs[0].c >= 1);
    assert.ok(snaps[0].c >= 1);
  });

  test('MAINTENANCE device stays in maintenance path across tier run', async () => {
    const d0 = await Device.findOne({ where: { is_active: true } });
    assert.ok(d0);
    await Device.update(
      { status: 'MAINTENANCE', health_status: 'MAINTENANCE', health_reason: 'device-maintenance' },
      { where: { id: d0.id } }
    );
    const fakeIo = { to: () => ({ emit: () => {} }) };
    await runHealthTier(fakeIo, 'HEARTBEAT_30S');
    const d = await Device.findByPk(d0.id);
    assert.strictEqual(d.health_status, 'MAINTENANCE');
    await Device.update(
      { status: 'ONLINE', health_status: 'ONLINE', health_reason: null },
      { where: { id: d0.id } }
    );
  });
});

describe('E2E — Health REST', () => {
  before(async () => {
    if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
  });

  test('Summary API returns structured data', async () => {
    const { accessToken } = await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password);
    const res = await rest('/api/health/summary', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.data.summary);
  });
});
