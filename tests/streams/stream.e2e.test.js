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
      device_name: `Stream Test PI ${suffix}`,
      serial_number: `PI-STR-${suffix}`,
    }),
  });
  assert.strictEqual(create.status, 201, JSON.stringify(create.data));
  return create.data.data.device;
}

async function connectViewer(monitorToken) {
  const viewer = connectSocket(monitorToken);
  await new Promise((resolve, reject) => {
    viewer.on('connect_error', reject);
    viewer.on('connect', resolve);
  });
  viewer.emit('register-monitor', {});
  await once(viewer, 'monitor-registered', 10000);
  return viewer;
}

async function requestStreamViaSocket(viewer, agent, deviceId, streamType) {
  const requestedPromise = once(viewer, 'stream-requested', 10000);
  const startPromise = once(agent, 'start-stream', 10000);
  viewer.emit('request-stream', { deviceId, streamType });
  const [requested, startStream] = await Promise.all([requestedPromise, startPromise]);
  return { requested, startStream };
}

async function connectAgent(deviceId) {
  const tokenRes = await deviceToken(deviceId, 'KIOSK');
  assert.strictEqual(tokenRes.status, 200, JSON.stringify(tokenRes.data));
  const token = tokenRes.data.token || tokenRes.data.accessToken;
  const socket = connectSocket(token);
  await new Promise((resolve, reject) => {
    socket.on('connect_error', reject);
    socket.on('connect', resolve);
  });
  socket.emit('register-agent', {
    deviceId,
    serialNumber: 'PI-STR',
    hostname: 'stream-pi',
    version: '1.0.0',
    capabilities: { vnc: true, rtsp: true, camera: true },
  });
  await once(socket, 'agent-registered', 10000);
  return socket;
}

describe(
  'E2E — Live stream infrastructure',
  { skip: process.env.SKIP_SOCKET_E2E === '1' },
  () => {
    let adminToken;
    let monitorToken;

    before(async () => {
      if (!(await healthCheck())) throw new Error(`Server not reachable at ${BASE_URL}`);
      adminToken = (await login(USERS.superAdmin.user_id, USERS.superAdmin.password)).accessToken;
      monitorToken = (await login(USERS.ahmedabadMonitor.user_id, USERS.ahmedabadMonitor.password)).accessToken;
    });

    test('request stream via REST creates session', async () => {
      const device = await createRaspberryDevice(adminToken);
      const res = await rest('/api/streams/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ deviceId: device.id, streamType: 'KIOSK' }),
      });
      assert.strictEqual(res.status, 201, JSON.stringify(res.data));
      assert.ok(res.data.data.sessionId);
      assert.strictEqual(res.data.data.session.status, 'REQUESTED');
    });

    test('create session via socket request-stream', async () => {
      const device = await createRaspberryDevice(adminToken);
      const agent = await connectAgent(device.id);
      const viewer = await connectViewer(monitorToken);

      const { requested, startStream } = await requestStreamViaSocket(viewer, agent, device.id, 'CCTV');
      assert.ok(requested.sessionId);
      assert.strictEqual(startStream.sessionId, requested.sessionId);
      assert.strictEqual(startStream.streamType, 'CCTV');

      await disconnectQuietly(viewer);
      await disconnectQuietly(agent);
    });

    test('authorization — kiosk user forbidden', async () => {
      const userLogin = await login(USERS.kioskUser.user_id, USERS.kioskUser.password);
      const res = await rest('/api/streams/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userLogin.accessToken}` },
        body: JSON.stringify({
          deviceId: '550e8400-e29b-41d4-a716-446655440000',
          streamType: 'KIOSK',
        }),
      });
      assert.strictEqual(res.status, 403, JSON.stringify(res.data));
    });

    test('close session via DELETE', async () => {
      const device = await createRaspberryDevice(adminToken);
      const create = await rest('/api/streams/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ deviceId: device.id, streamType: 'KIOSK' }),
      });
      assert.strictEqual(create.status, 201, JSON.stringify(create.data));
      const sessionId = create.data.data.sessionId;

      const del = await rest(`/api/streams/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(del.status, 200, JSON.stringify(del.data));
      assert.strictEqual(del.data.data.session.status, 'CLOSED');

      const get = await rest(`/api/streams/${sessionId}`, {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(get.status, 200);
      assert.strictEqual(get.data.data.session.status, 'CLOSED');
    });

    test('offer forwarding from agent to viewer', async () => {
      const device = await createRaspberryDevice(adminToken);
      const agent = await connectAgent(device.id);
      const viewer = await connectViewer(monitorToken);

      const { requested } = await requestStreamViaSocket(viewer, agent, device.id, 'KIOSK');

      const offer = { type: 'offer', sdp: 'v=0 fake-offer-sdp' };
      const offerPromise = once(viewer, 'stream-offer', 10000);
      agent.emit('stream-offer', { sessionId: requested.sessionId, offer });
      await once(agent, 'stream-offer-ack', 10000);

      const forwarded = await offerPromise;
      assert.strictEqual(forwarded.sessionId, requested.sessionId);
      assert.strictEqual(forwarded.offer.sdp, offer.sdp);

      await disconnectQuietly(viewer);
      await disconnectQuietly(agent);
    });

    test('answer forwarding from viewer to agent', async () => {
      const device = await createRaspberryDevice(adminToken);
      const agent = await connectAgent(device.id);
      const viewer = await connectViewer(monitorToken);

      const { requested } = await requestStreamViaSocket(viewer, agent, device.id, 'KIOSK');

      const offerPromise = once(viewer, 'stream-offer', 10000);
      agent.emit('stream-offer', {
        sessionId: requested.sessionId,
        offer: { type: 'offer', sdp: 'v=0 offer' },
      });
      await offerPromise;

      const answer = { type: 'answer', sdp: 'v=0 fake-answer-sdp' };
      const answerPromise = once(agent, 'stream-answer', 10000);
      viewer.emit('stream-answer', { sessionId: requested.sessionId, answer });
      await once(viewer, 'stream-answer-ack', 10000);

      const forwarded = await answerPromise;
      assert.strictEqual(forwarded.sessionId, requested.sessionId);
      assert.strictEqual(forwarded.answer.sdp, answer.sdp);

      await disconnectQuietly(viewer);
      await disconnectQuietly(agent);
    });

    test('ICE candidate forwarding both directions', async () => {
      const device = await createRaspberryDevice(adminToken);
      const agent = await connectAgent(device.id);
      const viewer = await connectViewer(monitorToken);

      const { requested } = await requestStreamViaSocket(viewer, agent, device.id, 'KIOSK');

      const viewerCandidate = { candidate: 'viewer-candidate-1', sdpMid: '0', sdpMLineIndex: 0 };
      const toAgentPromise = once(agent, 'viewer-ice-candidate', 10000);
      viewer.emit('viewer-ice-candidate', { sessionId: requested.sessionId, candidate: viewerCandidate });
      const toAgent = await toAgentPromise;
      assert.strictEqual(toAgent.candidate.candidate, viewerCandidate.candidate);

      const agentCandidate = { candidate: 'agent-candidate-1', sdpMid: '0', sdpMLineIndex: 0 };
      const toViewerPromise = once(viewer, 'agent-ice-candidate', 10000);
      agent.emit('agent-ice-candidate', { sessionId: requested.sessionId, candidate: agentCandidate });
      const toViewer = await toViewerPromise;
      assert.strictEqual(toViewer.candidate.candidate, agentCandidate.candidate);

      await disconnectQuietly(viewer);
      await disconnectQuietly(agent);
    });

    test('viewer disconnect closes stream session', async () => {
      const device = await createRaspberryDevice(adminToken);
      const agent = await connectAgent(device.id);
      const viewer = await connectViewer(monitorToken);

      const { requested } = await requestStreamViaSocket(viewer, agent, device.id, 'KIOSK');

      const closedPromise = once(agent, 'stop-stream', 10000);
      await disconnectQuietly(viewer);
      const closed = await closedPromise;
      assert.strictEqual(closed.sessionId, requested.sessionId);

      const get = await rest(`/api/streams/${requested.sessionId}`, {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(get.data.data.session.status, 'CLOSED');

      await disconnectQuietly(agent);
    });

    test('agent disconnect closes stream session', async () => {
      const device = await createRaspberryDevice(adminToken);
      const agent = await connectAgent(device.id);
      const viewer = await connectViewer(monitorToken);

      const { requested } = await requestStreamViaSocket(viewer, agent, device.id, 'KIOSK');

      const closedPromise = once(viewer, 'stream-closed', 10000);
      await disconnectQuietly(agent);
      const closed = await closedPromise;
      assert.strictEqual(closed.sessionId, requested.sessionId);

      await disconnectQuietly(viewer);
    });

    test('GET active streams returns open sessions', async () => {
      const device = await createRaspberryDevice(adminToken);
      const create = await rest('/api/streams/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
        body: JSON.stringify({ deviceId: device.id, streamType: 'KIOSK' }),
      });
      assert.strictEqual(create.status, 201);
      const sessionId = create.data.data.sessionId;

      const active = await rest('/api/streams/active', {
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      assert.strictEqual(active.status, 200);
      assert.ok((active.data.data.sessions || []).some((s) => s.id === sessionId));

      await rest(`/api/streams/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
    });
  }
);
