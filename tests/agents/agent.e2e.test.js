import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { rest, login, healthCheck, deviceToken } from '../helpers/http.js';
import { USERS } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/env.js';
import { connectSocket, once, disconnectQuietly } from '../helpers/socket.js';

async function getAhmedabadContext(adminToken) {
  const divRes = await rest('/api/divisions?page=1&limit=50&sort=name:asc&search=Ahmed', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(divRes.status, 200, JSON.stringify(divRes.data));
  const division = (divRes.data.data.divisions || []).find((d) => d.name === 'Ahmedabad');
  assert.ok(division, 'Ahmedabad division missing');

  const lobbyRes = await rest('/api/lobbies?page=1&limit=20&status=true&sort=name:asc&search=Vatva', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(lobbyRes.status, 200, JSON.stringify(lobbyRes.data));
  const lobby = lobbyRes.data.data.lobbies[0];
  assert.ok(lobby, 'Vatva lobby missing');

  return { division, lobby };
}

async function createRaspberryDevice(adminToken) {
  const { division, lobby } = await getAhmedabadContext(adminToken);
  const suffix = Date.now().toString(36);
  const create = await rest('/api/devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      division_id: division.id,
      lobby_id: lobby.id,
      device_type: 'RASPBERRY',
      device_name: `Agent Test PI ${suffix}`,
      serial_number: `PI-${suffix}`,
    }),
  });
  assert.strictEqual(create.status, 201, JSON.stringify(create.data));
  return create.data.data.device;
}

async function connectAgentSocket(deviceId) {
  const tokenRes = await deviceToken(deviceId, 'KIOSK');
  assert.strictEqual(tokenRes.status, 200, JSON.stringify(tokenRes.data));
  const token = tokenRes.data.token || tokenRes.data.accessToken;
  assert.ok(token, 'device token missing');

  const socket = connectSocket(token);
  await new Promise((resolve, reject) => {
    socket.on('connect_error', reject);
    socket.on('connect', resolve);
  });
  return socket;
}

describe(
  'E2E — Raspberry Pi agents',
  { skip: process.env.SKIP_SOCKET_E2E === '1' },
  () => {
    let adminToken;
    let monitorToken;

    before(async () => {
      if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
      adminToken = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
      monitorToken = (await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password)).accessToken;
    });

    test('1. Register Agent Success — socket connected, room joined, status ONLINE', async () => {
      const device = await createRaspberryDevice(adminToken);
      const socket = await connectAgentSocket(device.id);

      socket.emit('register-agent', {
        deviceId: device.id,
        serialNumber: 'PI001',
        hostname: 'railway-pi-1',
        version: '1.0.0',
        capabilities: { vnc: true, rtsp: true, camera: true },
      });

      const ack = await once(socket, 'agent-registered', 10000);
      assert.strictEqual(ack.deviceId, device.id);
      assert.strictEqual(ack.status, 'ONLINE');

      const detail = await rest(`/api/agents/${device.id}`, {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(detail.status, 200, JSON.stringify(detail.data));
      assert.strictEqual(detail.data.data.agent.status, 'ONLINE');

      await disconnectQuietly(socket);
    });

    test('2. Register Agent Invalid Device — error returned', async () => {
      const socket = await connectAgentSocket('00000000-0000-4000-8000-000000000001');

      socket.emit('register-agent', {
        deviceId: '00000000-0000-4000-8000-000000000001',
        serialNumber: 'PI-BAD',
        hostname: 'bad-pi',
        version: '1.0.0',
        capabilities: { vnc: true },
      });

      const err = await once(socket, 'error', 10000);
      assert.ok(err.message || err.code);

      await disconnectQuietly(socket);
    });

    test('3. Heartbeat Success — snapshot saved', async () => {
      const device = await createRaspberryDevice(adminToken);
      const socket = await connectAgentSocket(device.id);

      socket.emit('register-agent', {
        deviceId: device.id,
        serialNumber: 'PI-HB',
        hostname: 'railway-pi-hb',
        version: '1.0.0',
        capabilities: { vnc: true, rtsp: true, camera: true },
      });
      await once(socket, 'agent-registered', 10000);

      socket.emit('agent-heartbeat', {
        deviceId: device.id,
        cpu: 12.5,
        memory: 45.2,
        disk: 60.0,
        temperature: 42.1,
        uptime: 3600,
        kioskOnline: true,
        cctvOnline: true,
        vncOnline: false,
      });
      await once(socket, 'agent-heartbeat-ack', 10000);

      const health = await rest(`/api/agents/${device.id}/health`, {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(health.status, 200, JSON.stringify(health.data));
      assert.strictEqual(health.data.data.health.cpu, 12.5);
      assert.strictEqual(health.data.data.health.memory, 45.2);

      await disconnectQuietly(socket);
    });

    test('4. Heartbeat Invalid Payload — validation error', async () => {
      const device = await createRaspberryDevice(adminToken);
      const socket = await connectAgentSocket(device.id);

      socket.emit('register-agent', {
        deviceId: device.id,
        serialNumber: 'PI-VAL',
        hostname: 'railway-pi-val',
        version: '1.0.0',
        capabilities: { vnc: true },
      });
      await once(socket, 'agent-registered', 10000);

      socket.emit('agent-heartbeat', {
        deviceId: device.id,
        cpu: 'not-a-number',
        memory: 45,
      });

      const err = await once(socket, 'error', 10000);
      assert.ok(err.message);

      await disconnectQuietly(socket);
    });

    test('5. Agent Status Update — log created', async () => {
      const device = await createRaspberryDevice(adminToken);
      const socket = await connectAgentSocket(device.id);

      socket.emit('register-agent', {
        deviceId: device.id,
        serialNumber: 'PI-ST',
        hostname: 'railway-pi-st',
        version: '1.0.0',
        capabilities: { vnc: true, rtsp: true, camera: true },
      });
      await once(socket, 'agent-registered', 10000);

      socket.emit('agent-status-update', {
        deviceId: device.id,
        kioskReachable: true,
        cameraReachable: true,
        rtspWorking: true,
        vncWorking: false,
      });
      await once(socket, 'agent-status-update-ack', 10000);

      const logs = await rest(`/api/agents/${device.id}/logs?limit=20`, {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(logs.status, 200, JSON.stringify(logs.data));
      const statusLog = (logs.data.data.logs || []).find((l) => l.log_type === 'AGENT_STATUS_UPDATE');
      assert.ok(statusLog, 'AGENT_STATUS_UPDATE log missing');

      await disconnectQuietly(socket);
    });

    test('6. Command Queue Success — command stored', async () => {
      const device = await createRaspberryDevice(adminToken);
      const cmd = await rest(`/api/agents/${device.id}/command`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ command: 'REBOOT_PI', payload: { e2e: true } }),
      });
      assert.strictEqual(cmd.status, 201, JSON.stringify(cmd.data));
      assert.ok(cmd.data.data.commandId);
      assert.strictEqual(cmd.data.data.command, 'REBOOT_PI');
    });

    test('7. Command Result Success — command marked completed', async () => {
      const device = await createRaspberryDevice(adminToken);
      const socket = await connectAgentSocket(device.id);

      socket.emit('register-agent', {
        deviceId: device.id,
        serialNumber: 'PI-CMD',
        hostname: 'railway-pi-cmd',
        version: '1.0.0',
        capabilities: { vnc: true },
      });
      await once(socket, 'agent-registered', 10000);

      const cmd = await rest(`/api/agents/${device.id}/command`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ command: 'TAKE_SCREENSHOT' }),
      });
      assert.strictEqual(cmd.status, 201, JSON.stringify(cmd.data));
      const commandId = cmd.data.data.commandId;

      socket.emit('agent-command-result', {
        commandId,
        success: true,
        message: 'Screenshot captured',
        data: { path: '/tmp/shot.png' },
      });
      const ack = await once(socket, 'agent-command-result-ack', 10000);
      assert.strictEqual(ack.commandId, commandId);
      assert.strictEqual(ack.status, 'COMPLETED');

      await disconnectQuietly(socket);
    });

    test('8. Get Agents API — returns Raspberry devices only', async () => {
      const device = await createRaspberryDevice(adminToken);
      const kiosk = await rest('/api/devices', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          division_id: device.division_id,
          lobby_id: device.lobby_id,
          device_type: 'KIOSK',
          device_name: `Agent Filter Kiosk ${Date.now()}`,
        }),
      });
      assert.strictEqual(kiosk.status, 201, JSON.stringify(kiosk.data));

      const res = await rest('/api/agents?page=1&limit=100', {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(res.status, 200, JSON.stringify(res.data));
      const agents = res.data.data.agents || [];
      assert.ok(agents.length > 0);
      assert.ok(agents.every((a) => a.device_type === 'RASPBERRY'));
      assert.ok(agents.some((a) => a.id === device.id));
    });

    test('9. Get Agent Health API — latest health returned', async () => {
      const device = await createRaspberryDevice(adminToken);
      const socket = await connectAgentSocket(device.id);

      socket.emit('register-agent', {
        deviceId: device.id,
        serialNumber: 'PI-HEALTH',
        hostname: 'railway-pi-health',
        version: '1.0.0',
        capabilities: { vnc: true },
      });
      await once(socket, 'agent-registered', 10000);

      socket.emit('agent-heartbeat', {
        deviceId: device.id,
        cpu: 5,
        memory: 30,
        disk: 50,
        temperature: 38,
        uptime: 100,
        kioskOnline: true,
        cctvOnline: false,
        vncOnline: true,
      });
      await once(socket, 'agent-heartbeat-ack', 10000);

      const health = await rest(`/api/agents/${device.id}/health`, {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(health.status, 200);
      assert.strictEqual(health.data.data.health.temperature, 38);

      await disconnectQuietly(socket);
    });

    test('10. Disable Agent — device disabled', async () => {
      const device = await createRaspberryDevice(adminToken);
      const res = await rest(`/api/agents/${device.id}/disable`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.status, 200, JSON.stringify(res.data));
      assert.strictEqual(res.data.data.agent.is_active, false);
    });

    test('11. Enable Agent — device enabled', async () => {
      const device = await createRaspberryDevice(adminToken);

      await rest(`/api/agents/${device.id}/disable`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      const res = await rest(`/api/agents/${device.id}/enable`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.status, 200, JSON.stringify(res.data));
      assert.strictEqual(res.data.data.agent.is_active, true);
    });

    test('12. Permission Test — Monitor allowed, User forbidden', async () => {
      const monRes = await rest('/api/agents?page=1&limit=5', {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(monRes.status, 200, JSON.stringify(monRes.data));

      const userLogin = await login(USERS.kioskUser.user_id, USERS.kioskUser.password);
      const userRes = await rest('/api/agents?page=1&limit=5', {
        headers: { Authorization: `Bearer ${userLogin.accessToken}` },
      });
      assert.strictEqual(userRes.status, 403, JSON.stringify(userRes.data));
    });
  }
);
