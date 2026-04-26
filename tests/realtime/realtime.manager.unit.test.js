import test from 'node:test';
import assert from 'node:assert';
import User from '../../src/modules/users/user.model.js';
import Division from '../../src/modules/divisions/division.model.js';
import Lobby from '../../src/modules/divisions/lobby.model.js';
import Device from '../../src/modules/divisions/device.model.js';
import MonitoringSession from '../../src/modules/realtime/monitoringSession.model.js';
import SocketPresence from '../../src/modules/realtime/socketPresence.model.js';
import MonitorLobbyAccess from '../../src/modules/access/monitorLobby.model.js';
import {
  claimNextDeviceCommand,
  completeDeviceCommand,
  enqueueDeviceCommand,
  endMonitoringSession,
  getRealtimeMetrics,
  heartbeatTimeoutSweep,
  startMonitoringSession,
  touchSocketHeartbeat,
  upsertSocketPresence,
  markSocketPresenceOffline,
} from '../../src/socket/realtime.manager.js';
import DeviceCommand from '../../src/modules/realtime/deviceCommand.model.js';

async function ensureFixtureDevice() {
  const ahmedabad = await Division.findOne({ where: { name: 'Ahmedabad' } });
  assert.ok(ahmedabad, 'Ahmedabad division missing');

  let vatva = await Lobby.findOne({
    where: { division_id: ahmedabad.id, station_name: 'Vatva' },
  });
  if (!vatva) {
    vatva = await Lobby.create({
      division_id: ahmedabad.id,
      name: 'Vatva Lobby',
      station_name: 'Vatva',
      city: 'Ahmedabad',
      status: true,
    });
  }

  let device = await Device.findOne({
    where: {
      division_id: ahmedabad.id,
      lobby_id: vatva.id,
      device_name: 'Realtime Test Camera',
    },
  });
  if (!device) {
    device = await Device.create({
      division_id: ahmedabad.id,
      lobby_id: vatva.id,
      device_type: 'CAMERA',
      device_name: 'Realtime Test Camera',
      status: 'ONLINE',
      is_active: true,
    });
  }

  return { ahmedabad, vatva, device };
}

test('Phase 4 start/end monitoring session with lock enforcement', async () => {
  const { device, ahmedabad, vatva } = await ensureFixtureDevice();
  const monitor = await User.findOne({ where: { user_id: 'ahmedabad_monitor' } });
  assert.ok(monitor, 'ahmedabad_monitor missing');

  await MonitoringSession.destroy({ where: { device_id: device.id, status: 'ACTIVE' } });

  const started = await startMonitoringSession({
    deviceId: device.id,
    monitorUserId: monitor.id,
    monitorSocketId: 'socket-test-1',
    monitorClientId: 'monitor-client-1',
    user: {
      userId: monitor.id,
      role: monitor.role,
      division_id: monitor.division_id,
    },
  });
  assert.strictEqual(started.ok, true, JSON.stringify(started));
  assert.strictEqual(started.device.division_id, ahmedabad.id);
  assert.strictEqual(started.device.lobby_id, vatva.id);
  assert.ok(started.dbSession.access_token);
  assert.ok(started.dbSession.token_expires_at);

  const blocked = await startMonitoringSession({
    deviceId: device.id,
    monitorUserId: '00000000-0000-0000-0000-000000000001',
    monitorSocketId: 'socket-test-2',
    monitorClientId: 'monitor-client-2',
    user: {
      userId: '00000000-0000-0000-0000-000000000001',
      role: 'MONITOR',
      division_id: ahmedabad.id,
    },
  });
  assert.strictEqual(blocked.ok, false);
  assert.ok(['SESSION_ALREADY_EXISTS', 'SESSION_NOT_AUTHORIZED'].includes(blocked.code));

  const ended = await endMonitoringSession({
    deviceId: device.id,
    actorUserId: monitor.id,
    status: 'ENDED',
    disconnectReason: 'test-stop',
  });
  assert.strictEqual(ended.ok, true, JSON.stringify(ended));
  assert.strictEqual(ended.dbSession.status, 'ENDED');
});

test('Phase 4 heartbeat timeout marks presence offline and times out sessions', async () => {
  const { device } = await ensureFixtureDevice();
  const monitor = await User.findOne({ where: { user_id: 'ahmedabad_monitor' } });
  assert.ok(monitor);

  await endMonitoringSession({
    deviceId: device.id,
    actorUserId: monitor.id,
    status: 'ENDED',
    disconnectReason: 'test-pre-clean',
  });

  const assignment = await MonitorLobbyAccess.findOne({
    where: {
      user_id: monitor.id,
      lobby_id: device.lobby_id,
      division_id: device.division_id,
      is_active: true,
    },
  });
  assert.ok(assignment, 'Monitor lobby assignment missing');

  await MonitoringSession.destroy({ where: { device_id: device.id } });
  const started = await startMonitoringSession({
    deviceId: device.id,
    monitorUserId: monitor.id,
    monitorSocketId: 'socket-timeout-1',
    monitorClientId: 'monitor-timeout-1',
    user: {
      userId: monitor.id,
      role: monitor.role,
      division_id: monitor.division_id,
    },
  });
  assert.strictEqual(started.ok, true, JSON.stringify(started));

  const presence = await upsertSocketPresence({
    userId: monitor.id,
    socketId: 'socket-timeout-1',
    role: 'MONITOR',
    divisionId: monitor.division_id,
    lobbyId: device.lobby_id,
  });
  assert.ok(presence);

  await SocketPresence.update(
    { last_heartbeat_at: new Date(Date.now() - 60_000) },
    { where: { socket_id: 'socket-timeout-1' } }
  );

  const emitted = [];
  const fakeIo = {
    to() {
      return {
        emit(event, payload) {
          emitted.push({ event, payload });
        },
      };
    },
  };

  await heartbeatTimeoutSweep(fakeIo);

  const refreshedPresence = await SocketPresence.findOne({ where: { socket_id: 'socket-timeout-1' } });
  assert.strictEqual(refreshedPresence.is_online, false);

  const timedOutSession = await MonitoringSession.findByPk(started.dbSession.id);
  assert.strictEqual(timedOutSession.status, 'TIMEOUT');
  assert.ok(emitted.some((e) => e.event === 'session-status' && e.payload.status === 'TIMEOUT'));
  assert.ok(emitted.some((e) => e.event === 'device-offline'));

  await touchSocketHeartbeat({ socketId: 'socket-timeout-1', userId: monitor.id });
});

test('Phase 4 device command queue and presence reason codes', async () => {
  const { device } = await ensureFixtureDevice();
  const monitor = await User.findOne({ where: { user_id: 'ahmedabad_monitor' } });
  assert.ok(monitor);

  await DeviceCommand.destroy({ where: { device_id: device.id } });
  const queued = await enqueueDeviceCommand({
    deviceId: device.id,
    command: 'REBOOT',
    payload: { reason: 'test' },
    requestedBy: monitor.id,
  });
  assert.strictEqual(queued.ok, true, JSON.stringify(queued));
  assert.strictEqual(queued.command.status, 'PENDING');

  const claimed = await claimNextDeviceCommand(device.id);
  assert.ok(claimed);
  assert.strictEqual(claimed.status, 'PROCESSING');

  const completed = await completeDeviceCommand({
    commandId: claimed.id,
    success: true,
  });
  assert.ok(completed);
  assert.strictEqual(completed.status, 'COMPLETED');

  const presence = await upsertSocketPresence({
    userId: monitor.id,
    socketId: 'socket-reason-1',
    role: 'MONITOR',
    divisionId: monitor.division_id,
    lobbyId: device.lobby_id,
  });
  assert.ok(presence);
  await markSocketPresenceOffline({
    socketId: 'socket-reason-1',
    userId: monitor.id,
    reason: 'NETWORK_LOST',
  });
  const updatedPresence = await SocketPresence.findOne({ where: { socket_id: 'socket-reason-1' } });
  assert.strictEqual(updatedPresence.is_online, false);
  assert.strictEqual(updatedPresence.offline_reason, 'NETWORK_LOST');
});

test('Phase 4 metrics counters increment', async () => {
  const metrics = getRealtimeMetrics();
  assert.ok(Number.isInteger(metrics.sessions_started));
  assert.ok(Number.isInteger(metrics.sessions_failed_lock));
  assert.ok(Number.isInteger(metrics.timeouts));
  assert.ok(Number.isInteger(metrics.reconnect_restores));
});
