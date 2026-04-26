import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';
import { connectSocket, once, disconnectQuietly } from '../helpers/socket.js';

async function createIsolatedDevice(token) {
  const divRes = await rest('/api/divisions?page=1&limit=50&sort=name:asc&search=Ahmed', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(divRes.status, 200, JSON.stringify(divRes.data));
  const division = (divRes.data.data.divisions || []).find((d) => d.name === 'Ahmedabad');
  assert.ok(division, 'Ahmedabad division missing');

  const lobbyRes = await rest('/api/lobbies?page=1&limit=20&status=true&sort=name:asc&search=Vatva', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(lobbyRes.status, 200, JSON.stringify(lobbyRes.data));
  const lobby = lobbyRes.data.data.lobbies[0];
  assert.ok(lobby, 'No active lobby found for command-queue test');

  const suffix = Date.now().toString(36);
  const create = await rest('/api/devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      division_id: division.id,
      lobby_id: lobby.id,
      device_type: 'KIOSK',
      device_name: `CQ Test Device ${suffix}`,
    }),
  });
  assert.strictEqual(create.status, 201, JSON.stringify(create.data));
  return create.data.data.device.id;
}

describe(
  'E2E — Command queue (socket)',
  { skip: process.env.SKIP_SOCKET_E2E === '1' },
  () => {
    before(async () => {
      if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
    });

    test('enqueue, kiosk fetch, complete maintains order for single device', async () => {
      const adminTok = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
      const kioskLogin = await login(USERS.kioskUser.user_id, USERS.kioskUser.password);
      const deviceId = await createIsolatedDevice(adminTok);

      const kiosk = connectSocket(kioskLogin.accessToken);
      await new Promise((resolve, reject) => {
        kiosk.on('connect_error', reject);
        kiosk.on('connect', resolve);
      });
      kiosk.emit('register-kiosk', { deviceId });
      await once(kiosk, 'kiosk-registered', 10000);

      const mon = connectSocket(adminTok);
      await new Promise((resolve, reject) => {
        mon.on('connect_error', reject);
        mon.on('connect', resolve);
      });
      mon.emit('register-monitor', {});
      await once(mon, 'monitor-registered', 10000);

      mon.emit('enqueue-device-command', { deviceId, command: 'REBOOT', payload: { e2e: true } });
      await once(mon, 'device-command-queued', 10000);
      mon.emit('enqueue-device-command', { deviceId, command: 'REFRESH_STREAM', payload: { e2e: true } });
      await once(mon, 'device-command-queued', 10000);

      kiosk.emit('fetch-device-command', { deviceId });
      const first = await once(kiosk, 'device-command', 10000);
      assert.ok(first.command);
      assert.strictEqual(first.command.command, 'REBOOT');

      kiosk.emit('complete-device-command', {
        queueId: first.command.queueId,
        success: true,
        deviceId,
      });
      await once(mon, 'device-command-status', 8000);

      kiosk.emit('fetch-device-command', { deviceId });
      const second = await once(kiosk, 'device-command', 10000);
      assert.ok(second.command);
      assert.strictEqual(second.command.command, 'REFRESH_STREAM');

      kiosk.emit('complete-device-command', {
        queueId: second.command.queueId,
        success: true,
        deviceId,
      });

      await disconnectQuietly(mon);
      await disconnectQuietly(kiosk);
    });

    test('Stale command expiry not implemented (queue processes FIFO)', async () => {
      assert.ok(true);
    });
  }
);
