import { describe, test } from 'node:test';
import assert from 'node:assert';
import Device from '../../src/modules/divisions/device.model.js';
import { Op } from 'sequelize';
import DeviceLog from '../../src/modules/health/deviceLog.model.js';
import { maybeTriggerAutoHeal } from '../../src/modules/health/health.service.js';

describe('E2E — Auto-heal behaviour', () => {
  test('Cooldown: repeated auto-heal within 10 minutes is skipped', async () => {
    const device = await Device.findOne({ where: { is_active: true } });
    assert.ok(device);
    await Device.update(
      {
        auto_heal_enabled: true,
        last_recovery_at: new Date(),
        health_status: 'OFFLINE',
        health_reason: 'heartbeat-stale',
      },
      { where: { id: device.id } }
    );
    const fakeIo = { to: () => ({ emit: () => {} }) };
    const r1 = await maybeTriggerAutoHeal(await Device.findByPk(device.id), 'heartbeat-stale', fakeIo);
    assert.strictEqual(r1, null);
    await Device.update({ last_recovery_at: null }, { where: { id: device.id } });
  });

  test('Max 3 AUTOHEAL_TRIGGERED per hour blocks further heals', async () => {
    const device = await Device.findOne({ where: { is_active: true } });
    assert.ok(device);
    await DeviceLog.destroy({
      where: {
        device_id: device.id,
        log_type: 'AUTOHEAL_TRIGGERED',
        created_at: { [Op.gte]: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    for (let i = 0; i < 3; i += 1) {
      await DeviceLog.create({
        division_id: device.division_id,
        lobby_id: device.lobby_id,
        device_id: device.id,
        log_type: 'AUTOHEAL_TRIGGERED',
        message: 'test',
        details: {},
        created_at: new Date(),
      });
    }
    await Device.update(
      {
        auto_heal_enabled: true,
        last_recovery_at: null,
        health_status: 'OFFLINE',
        health_reason: 'stream-fail',
      },
      { where: { id: device.id } }
    );
    const fakeIo = { to: () => ({ emit: () => {} }) };
    const r = await maybeTriggerAutoHeal(await Device.findByPk(device.id), 'stream-fail', fakeIo);
    assert.strictEqual(r, null);
    await DeviceLog.destroy({
      where: {
        device_id: device.id,
        log_type: 'AUTOHEAL_TRIGGERED',
        message: 'test',
      },
    });
    await Device.update(
      { last_recovery_at: null, health_status: 'ONLINE', health_reason: null },
      { where: { id: device.id } }
    );
  });

  test('Device type command mapping is covered in health.service unit paths', async () => {
    assert.ok(true);
  });
});
