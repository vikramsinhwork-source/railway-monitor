/**
 * Full flow test: Admin ↔ User connection and interaction.
 *
 * Covers:
 * - REST: admin login, create user, user login, GET /me, GET /users
 * - Socket: admin register-monitor, user register-kiosk, kiosk-online to admin
 * - Session: start-monitoring, stop-monitoring
 * - Call: call-request, call-accept, call-reject, call-end
 * - Video: toggle-video (admin ↔ user) – multiple scenarios
 * - Audio: toggle-audio (admin ↔ user) – multiple scenarios
 * - WebRTC signaling: offer, answer, ice-candidate (camera + screen stream path)
 * - Combined: call + video + audio + toggles + end
 * - Error cases: invalid auth, wrong role, session guards
 *
 * Run: npm test (server must be running on BASE_URL)
 */

import test from 'node:test';
import assert from 'node:assert';
import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const WS_URL = BASE_URL.replace(/^http/, 'ws');

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function once(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeoutMs);
    const handler = (data) => {
      clearTimeout(t);
      socket.off(event, handler);
      resolve(data);
    };
    socket.once(event, handler);
  });
}

/** Create admin + user sockets with active monitoring and call (for media tests). */
async function setupSessionWithActiveCall() {
  const adminLogin = await login('admin', 'admin123');
  const u = `u_${Date.now()}`;
  await createUser(adminLogin.accessToken, u, 'Media User', 'p');
  const userLogin = await login(u, 'p');

  const adminSocket = await connectSocket(adminLogin.accessToken);
  const userSocket = await connectSocket(userLogin.accessToken);
  adminSocket.emit('register-monitor');
  await once(adminSocket, 'monitor-registered');
  const kioskOnlineP = once(adminSocket, 'kiosk-online', 5000);
  userSocket.emit('register-kiosk');
  await once(userSocket, 'kiosk-registered');
  await kioskOnlineP;

  adminSocket.emit('start-monitoring', { kioskId: u });
  await once(adminSocket, 'monitoring-started', 10000);
  adminSocket.emit('call-request', { kioskId: u });
  await once(userSocket, 'call-request', 10000);
  const acceptedP = once(adminSocket, 'call-accepted', 12000);
  const confirmedP = once(userSocket, 'call-accept-confirmed', 12000);
  userSocket.emit('call-accept', { kioskId: u });
  await acceptedP;
  await confirmedP;

  return { adminSocket, userSocket, kioskId: u, disconnect: async () => {
    userSocket.disconnect();
    adminSocket.disconnect();
    await delay(200);
  } };
}

async function rest(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

async function login(userId, password) {
  const { status, data } = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, password }),
  });
  assert.strictEqual(status, 200, `Login failed: ${JSON.stringify(data)}`);
  assert.ok(data?.accessToken, 'Missing accessToken');
  return data;
}

async function createUser(adminToken, user_id, name, password) {
  const { status, data } = await rest('/api/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ user_id, name, password }),
  });
  assert.strictEqual(status, 201, `Create user failed: ${JSON.stringify(data)}`);
  return data.user;
}

async function getMe(token) {
  const { status, data } = await rest('/api/users/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(status, 200);
  return data.user;
}

async function getUsers(adminToken) {
  const { status, data } = await rest('/api/users', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(status, 200);
  return data.users;
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL, {
      auth: { token },
      transports: ['websocket'],
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

// --- Full flow: Admin and User connect and interact (single sequential test) ---

test('Full flow: Admin ↔ User connect and interact', async () => {
  const testUserId = `user_${Date.now()}`;
  const testPassword = 'pass123';

  // 1. REST: Admin login
  const adminLogin = await login('admin', 'admin123');
  assert.strictEqual(adminLogin.role, 'ADMIN');

  // 2. Admin creates user, user logs in
  await createUser(adminLogin.accessToken, testUserId, 'Test User', testPassword);
  const userLogin = await login(testUserId, testPassword);
  assert.strictEqual(userLogin.role, 'USER');

  // 3. REST: GET /me and GET /users
  const meAdmin = await getMe(adminLogin.accessToken);
  assert.strictEqual(meAdmin.role, 'ADMIN');
  const users = await getUsers(adminLogin.accessToken);
  assert.ok(Array.isArray(users) && users.some((u) => u.user_id === testUserId));
  const meUser = await getMe(userLogin.accessToken);
  assert.strictEqual(meUser.role, 'USER');

  // 4. Socket: Admin connects and registers as monitor
  const adminSocket = await connectSocket(adminLogin.accessToken);
  adminSocket.emit('register-monitor');
  const monitorReg = await once(adminSocket, 'monitor-registered');
  assert.ok(monitorReg.monitorId);
  assert.ok(Array.isArray(monitorReg.onlineKiosks));

  // 5. Socket: User connects; admin listens for kiosk-online before user registers
  const userSocket = await connectSocket(userLogin.accessToken);
  const kioskOnlinePromise = once(adminSocket, 'kiosk-online', 5000);
  userSocket.emit('register-kiosk');
  const kioskReg = await once(userSocket, 'kiosk-registered');
  assert.strictEqual(kioskReg.kioskId, testUserId);
  const kioskOnline = await kioskOnlinePromise;
  assert.strictEqual(kioskOnline.kioskId, testUserId);

  // 7. Admin starts monitoring
  adminSocket.emit('start-monitoring', { kioskId: testUserId });
  const monitoringStarted = await once(adminSocket, 'monitoring-started');
  assert.strictEqual(monitoringStarted.kioskId, testUserId);

  // 8. Admin initiates call – user receives call-request
  const userCallReq = once(userSocket, 'call-request');
  adminSocket.emit('call-request', { kioskId: testUserId });
  const toUser = await userCallReq;
  assert.strictEqual(toUser.kioskId, testUserId);
  await once(adminSocket, 'call-request-sent');

  // 9. User accepts call
  const adminCallAccepted = once(adminSocket, 'call-accepted');
  const userCallConfirmed = once(userSocket, 'call-accept-confirmed');
  userSocket.emit('call-accept', { kioskId: testUserId });
  await adminCallAccepted;
  await userCallConfirmed;

  // 10. Admin toggles video – user receives video-toggled
  const userVideoToggled = once(userSocket, 'video-toggled');
  adminSocket.emit('toggle-video', { kioskId: testUserId, enabled: true });
  const videoPayload = await userVideoToggled;
  assert.strictEqual(videoPayload.enabled, true);
  await once(adminSocket, 'video-toggle-confirmed');

  // 11. User toggles audio – admin receives audio-toggled
  const adminAudioToggled = once(adminSocket, 'audio-toggled');
  userSocket.emit('toggle-audio', { kioskId: testUserId, enabled: true });
  const audioPayload = await adminAudioToggled;
  assert.strictEqual(audioPayload.enabled, true);
  await once(userSocket, 'audio-toggle-confirmed');

  // 12. User ends call
  const adminCallEnded = once(adminSocket, 'call-ended');
  const userCallEndConfirmed = once(userSocket, 'call-end-confirmed');
  userSocket.emit('call-end', { kioskId: testUserId });
  await adminCallEnded;
  await userCallEndConfirmed;

  // 13. Second call: admin requests, user accepts, admin ends
  adminSocket.emit('call-request', { kioskId: testUserId });
  await once(userSocket, 'call-request');
  userSocket.emit('call-accept', { kioskId: testUserId });
  await once(adminSocket, 'call-accepted');
  adminSocket.emit('call-end', { kioskId: testUserId });
  await once(userSocket, 'call-ended');

  // 14. Admin stops monitoring
  adminSocket.emit('stop-monitoring', { kioskId: testUserId });
  await once(adminSocket, 'monitoring-stopped');

  // 15. Disconnect
  userSocket.disconnect();
  await delay(200);
  adminSocket.disconnect();
  await delay(200);
  assert.strictEqual(adminSocket.connected, false);
  assert.strictEqual(userSocket.connected, false);
});

// --- Standalone REST tests ---

test('REST: Admin login returns ADMIN role and token', async () => {
  const data = await login('admin', 'admin123');
  assert.strictEqual(data.role, 'ADMIN');
  assert.ok(data.accessToken);
  assert.strictEqual(data.user?.user_id, 'admin');
});

test('REST: Unauthorized GET /api/users returns 401', async () => {
  const { status } = await rest('/api/users', { headers: {} });
  assert.strictEqual(status, 401);
});

test('REST: Login wrong password returns 401', async () => {
  const { status, data } = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'admin', password: 'wrong' }),
  });
  assert.strictEqual(status, 401);
  assert.ok(!data?.accessToken);
});

test('REST: Login missing user_id returns 400', async () => {
  const { status } = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'admin123' }),
  });
  assert.strictEqual(status, 400);
});

// --- Socket error / guard cases ---

test('Socket: User (KIOSK) cannot start-monitoring – receives error', async () => {
  const adminLogin = await login('admin', 'admin123');
  const u = `u_${Date.now()}`;
  await createUser(adminLogin.accessToken, u, 'Guard User', 'p');
  const userLogin = await login(u, 'p');

  const socket = await connectSocket(userLogin.accessToken);
  socket.emit('register-kiosk');
  await once(socket, 'kiosk-registered');

  const errPromise = once(socket, 'error', 4000);
  socket.emit('start-monitoring', { kioskId: u });
  const err = await errPromise;
  assert.ok(err?.code);
  assert.ok(
    String(err?.message || '').toLowerCase().includes('unauthorized') ||
    String(err?.message || '').toLowerCase().includes('monitor')
  );

  socket.disconnect();
});

test('Socket: Call reject flow – monitor requests, kiosk rejects', async () => {
  const adminLogin = await login('admin', 'admin123');
  const u = `u_${Date.now()}`;
  await createUser(adminLogin.accessToken, u, 'Reject User', 'p');
  const userLogin = await login(u, 'p');

  const adminSocket = await connectSocket(adminLogin.accessToken);
  const userSocket = await connectSocket(userLogin.accessToken);
  adminSocket.emit('register-monitor');
  await once(adminSocket, 'monitor-registered');
  userSocket.emit('register-kiosk');
  await once(userSocket, 'kiosk-registered');
  adminSocket.emit('start-monitoring', { kioskId: u });
  await once(adminSocket, 'monitoring-started');

  adminSocket.emit('call-request', { kioskId: u });
  await once(userSocket, 'call-request');
  const adminRejected = once(adminSocket, 'call-rejected');
  const userConfirmed = once(userSocket, 'call-reject-confirmed');
  userSocket.emit('call-reject', { kioskId: u });
  await adminRejected;
  await userConfirmed;

  adminSocket.disconnect();
  userSocket.disconnect();
});

// ========== VIDEO SCENARIOS ==========

test('Video: Admin enables video → user receives video-toggled(true)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const userGot = once(userSocket, 'video-toggled');
  const adminGot = once(adminSocket, 'video-toggle-confirmed');
  adminSocket.emit('toggle-video', { kioskId, enabled: true });
  const payload = await userGot;
  assert.strictEqual(payload.enabled, true);
  assert.strictEqual(payload.kioskId, kioskId);
  await adminGot;
  await disconnect();
});

test('Video: Admin disables video → user receives video-toggled(false)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  adminSocket.emit('toggle-video', { kioskId, enabled: true });
  await once(userSocket, 'video-toggled');
  await once(adminSocket, 'video-toggle-confirmed');
  const userGot = once(userSocket, 'video-toggled');
  adminSocket.emit('toggle-video', { kioskId, enabled: false });
  const payload = await userGot;
  assert.strictEqual(payload.enabled, false);
  await disconnect();
});

test('Video: User enables video → admin receives video-toggled(true)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const adminGot = once(adminSocket, 'video-toggled');
  const userGot = once(userSocket, 'video-toggle-confirmed');
  userSocket.emit('toggle-video', { kioskId, enabled: true });
  const payload = await adminGot;
  assert.strictEqual(payload.enabled, true);
  assert.strictEqual(payload.kioskId, kioskId);
  await userGot;
  await disconnect();
});

test('Video: User disables video → admin receives video-toggled(false)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  userSocket.emit('toggle-video', { kioskId, enabled: true });
  await once(adminSocket, 'video-toggled');
  const adminGot = once(adminSocket, 'video-toggled');
  userSocket.emit('toggle-video', { kioskId, enabled: false });
  const payload = await adminGot;
  assert.strictEqual(payload.enabled, false);
  await disconnect();
});

test('Video: Rapid toggles (on → off → on) admin → user', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  for (const enabled of [true, false, true]) {
    const userGot = once(userSocket, 'video-toggled');
    adminSocket.emit('toggle-video', { kioskId, enabled });
    const payload = await userGot;
    assert.strictEqual(payload.enabled, enabled);
  }
  await disconnect();
});

// ========== AUDIO SCENARIOS ==========

test('Audio: Admin enables audio → user receives audio-toggled(true)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const userGot = once(userSocket, 'audio-toggled');
  const adminGot = once(adminSocket, 'audio-toggle-confirmed');
  adminSocket.emit('toggle-audio', { kioskId, enabled: true });
  const payload = await userGot;
  assert.strictEqual(payload.enabled, true);
  assert.strictEqual(payload.kioskId, kioskId);
  await adminGot;
  await disconnect();
});

test('Audio: Admin disables audio → user receives audio-toggled(false)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  adminSocket.emit('toggle-audio', { kioskId, enabled: true });
  await once(userSocket, 'audio-toggled');
  const userGot = once(userSocket, 'audio-toggled');
  adminSocket.emit('toggle-audio', { kioskId, enabled: false });
  const payload = await userGot;
  assert.strictEqual(payload.enabled, false);
  await disconnect();
});

test('Audio: User enables audio → admin receives audio-toggled(true)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const adminGot = once(adminSocket, 'audio-toggled');
  const userGot = once(userSocket, 'audio-toggle-confirmed');
  userSocket.emit('toggle-audio', { kioskId, enabled: true });
  const payload = await adminGot;
  assert.strictEqual(payload.enabled, true);
  await userGot;
  await disconnect();
});

test('Audio: User disables audio → admin receives audio-toggled(false)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  userSocket.emit('toggle-audio', { kioskId, enabled: true });
  await once(adminSocket, 'audio-toggled');
  const adminGot = once(adminSocket, 'audio-toggled');
  userSocket.emit('toggle-audio', { kioskId, enabled: false });
  const payload = await adminGot;
  assert.strictEqual(payload.enabled, false);
  await disconnect();
});

test('Audio: Mute/unmute sequence (user: on, off, on)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  for (const enabled of [true, false, true]) {
    const adminGot = once(adminSocket, 'audio-toggled');
    userSocket.emit('toggle-audio', { kioskId, enabled });
    const payload = await adminGot;
    assert.strictEqual(payload.enabled, enabled);
  }
  await disconnect();
});

// ========== WEBRTC SIGNALING (camera / screen stream path) ==========

const mockSdpOffer = { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n' };
const mockSdpAnswer = { type: 'answer', sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n' };
const mockIceCandidate = { candidate: 'candidate:0 1 UDP 2122252543 192.168.1.1 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 };

const MONITOR_CLIENT_ID = 'admin';

test('WebRTC signaling: Kiosk sends offer → Monitor receives offer', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // Listen for errors to debug
  let userError = null;
  let adminError = null;
  const userErrorHandler = (err) => {
    userError = err;
    console.error('User socket error:', err);
  };
  const adminErrorHandler = (err) => {
    adminError = err;
    console.error('Admin socket error:', err);
  };
  userSocket.on('error', userErrorHandler);
  adminSocket.on('error', adminErrorHandler);
  
  const adminGot = once(adminSocket, 'offer');
  userSocket.emit('offer', { targetId: MONITOR_CLIENT_ID, offer: mockSdpOffer });
  
  // Wait a bit to see if error occurs
  await delay(100);
  
  if (userError) {
    throw new Error(`User socket error: ${JSON.stringify(userError)}`);
  }
  if (adminError) {
    throw new Error(`Admin socket error: ${JSON.stringify(adminError)}`);
  }
  
  const payload = await adminGot;
  assert.ok(payload.fromId);
  assert.ok(payload.offer);
  assert.strictEqual(payload.offer.type, 'offer');
  
  userSocket.off('error', userErrorHandler);
  adminSocket.off('error', adminErrorHandler);
  await disconnect();
});

test('WebRTC signaling: Monitor sends answer → Kiosk receives answer', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const userGot = once(userSocket, 'answer');
  adminSocket.emit('answer', { targetId: kioskId, answer: mockSdpAnswer });
  const payload = await userGot;
  assert.ok(payload.fromId);
  assert.ok(payload.answer);
  assert.strictEqual(payload.answer.type, 'answer');
  await disconnect();
});

test('WebRTC signaling: Kiosk sends ICE candidate → Monitor receives ice-candidate', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const adminGot = once(adminSocket, 'ice-candidate');
  userSocket.emit('ice-candidate', { targetId: MONITOR_CLIENT_ID, candidate: mockIceCandidate });
  const payload = await adminGot;
  assert.ok(payload.fromId);
  assert.ok(payload.candidate);
  await disconnect();
});

test('WebRTC signaling: Monitor sends ICE candidate → Kiosk receives ice-candidate', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const userGot = once(userSocket, 'ice-candidate');
  adminSocket.emit('ice-candidate', { targetId: kioskId, candidate: mockIceCandidate });
  const payload = await userGot;
  assert.ok(payload.fromId);
  assert.ok(payload.candidate);
  await disconnect();
});

test('WebRTC signaling (screen stream path): Full offer → answer → ICE both ways', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const adminOffer = once(adminSocket, 'offer');
  userSocket.emit('offer', { targetId: MONITOR_CLIENT_ID, offer: mockSdpOffer });
  await adminOffer;
  const userAnswer = once(userSocket, 'answer');
  adminSocket.emit('answer', { targetId: kioskId, answer: mockSdpAnswer });
  await userAnswer;
  const adminIce = once(adminSocket, 'ice-candidate');
  userSocket.emit('ice-candidate', { targetId: MONITOR_CLIENT_ID, candidate: mockIceCandidate });
  await adminIce;
  const userIce = once(userSocket, 'ice-candidate');
  adminSocket.emit('ice-candidate', { targetId: kioskId, candidate: mockIceCandidate });
  await userIce;
  await disconnect();
});

// ========== COMBINED MEDIA SCENARIO ==========

test('Combined: Call + video (both) + audio (both) + toggles off + call end', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();

  adminSocket.emit('toggle-video', { kioskId, enabled: true });
  await once(userSocket, 'video-toggled');
  userSocket.emit('toggle-video', { kioskId, enabled: true });
  await once(adminSocket, 'video-toggled');
  adminSocket.emit('toggle-audio', { kioskId, enabled: true });
  await once(userSocket, 'audio-toggled');
  userSocket.emit('toggle-audio', { kioskId, enabled: true });
  await once(adminSocket, 'audio-toggled');

  adminSocket.emit('toggle-video', { kioskId, enabled: false });
  await once(userSocket, 'video-toggled');
  userSocket.emit('toggle-audio', { kioskId, enabled: false });
  await once(adminSocket, 'audio-toggled');

  adminSocket.emit('call-end', { kioskId });
  await once(userSocket, 'call-ended');
  await once(adminSocket, 'call-end-confirmed');
  await disconnect();
});

test('Combined: Kiosk initiates call, both toggle media, monitor ends call', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  userSocket.emit('call-end', { kioskId });
  await once(adminSocket, 'call-ended');
  await once(userSocket, 'call-end-confirmed');

  adminSocket.emit('call-request', { kioskId });
  await once(userSocket, 'call-request');
  userSocket.emit('call-accept', { kioskId });
  await once(adminSocket, 'call-accepted');
  userSocket.emit('toggle-video', { kioskId, enabled: true });
  await once(adminSocket, 'video-toggled');
  adminSocket.emit('toggle-audio', { kioskId, enabled: true });
  await once(userSocket, 'audio-toggled');
  adminSocket.emit('call-end', { kioskId });
  await once(userSocket, 'call-ended');
  await disconnect();
});

test('Media without session: toggle-video without start-monitoring returns error', async () => {
  const adminLogin = await login('admin', 'admin123');
  const u = `u_${Date.now()}`;
  await createUser(adminLogin.accessToken, u, 'NoSession User', 'p');
  const userLogin = await login(u, 'p');
  const adminSocket = await connectSocket(adminLogin.accessToken);
  const userSocket = await connectSocket(userLogin.accessToken);
  adminSocket.emit('register-monitor');
  await once(adminSocket, 'monitor-registered');
  userSocket.emit('register-kiosk');
  await once(userSocket, 'kiosk-registered');
  const errP = once(userSocket, 'error', 3000);
  userSocket.emit('toggle-video', { kioskId: u, enabled: true });
  const err = await errP;
  assert.ok(err?.code);
  assert.ok(String(err?.message || '').toLowerCase().includes('session') || err?.code !== undefined);
  adminSocket.disconnect();
  userSocket.disconnect();
});
// ========== 2-WAY COMMUNICATION TEST CASES ==========

test('2-way: Monitor creates offer → Kiosk receives offer', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const userGot = once(userSocket, 'offer');
  adminSocket.emit('offer', { targetId: kioskId, offer: mockSdpOffer });
  const payload = await userGot;
  assert.ok(payload.fromId);
  assert.ok(payload.offer);
  assert.strictEqual(payload.offer.type, 'offer');
  await disconnect();
});

test('2-way: Monitor creates offer → Kiosk sends answer → Monitor receives answer', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const userGotOffer = once(userSocket, 'offer');
  adminSocket.emit('offer', { targetId: kioskId, offer: mockSdpOffer });
  await userGotOffer;
  const adminGotAnswer = once(adminSocket, 'answer');
  userSocket.emit('answer', { targetId: MONITOR_CLIENT_ID, answer: mockSdpAnswer });
  const answerPayload = await adminGotAnswer;
  assert.ok(answerPayload.fromId);
  assert.ok(answerPayload.answer);
  assert.strictEqual(answerPayload.answer.type, 'answer');
  await disconnect();
});

test('2-way: Full bidirectional WebRTC signaling (Monitor initiates)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // Monitor creates and sends offer
  const userGotOffer = once(userSocket, 'offer');
  adminSocket.emit('offer', { targetId: kioskId, offer: mockSdpOffer });
  await userGotOffer;
  
  // Kiosk sends answer
  const adminGotAnswer = once(adminSocket, 'answer');
  userSocket.emit('answer', { targetId: MONITOR_CLIENT_ID, answer: mockSdpAnswer });
  await adminGotAnswer;
  
  // Kiosk sends ICE candidate
  const adminGotIce = once(adminSocket, 'ice-candidate');
  userSocket.emit('ice-candidate', { targetId: MONITOR_CLIENT_ID, candidate: mockIceCandidate });
  await adminGotIce;
  
  // Monitor sends ICE candidate
  const userGotIce = once(userSocket, 'ice-candidate');
  adminSocket.emit('ice-candidate', { targetId: kioskId, candidate: mockIceCandidate });
  await userGotIce;
  
  await disconnect();
});

test('2-way: Full bidirectional WebRTC signaling (Kiosk initiates)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // Kiosk creates and sends offer
  const adminGotOffer = once(adminSocket, 'offer');
  userSocket.emit('offer', { targetId: MONITOR_CLIENT_ID, offer: mockSdpOffer });
  await adminGotOffer;
  
  // Monitor sends answer
  const userGotAnswer = once(userSocket, 'answer');
  adminSocket.emit('answer', { targetId: kioskId, answer: mockSdpAnswer });
  await userGotAnswer;
  
  // Monitor sends ICE candidate
  const userGotIce = once(userSocket, 'ice-candidate');
  adminSocket.emit('ice-candidate', { targetId: kioskId, candidate: mockIceCandidate });
  await userGotIce;
  
  // Kiosk sends ICE candidate
  const adminGotIce = once(adminSocket, 'ice-candidate');
  userSocket.emit('ice-candidate', { targetId: MONITOR_CLIENT_ID, candidate: mockIceCandidate });
  await adminGotIce;
  
  await disconnect();
});

test('2-way: Monitor toggles video → Kiosk receives video-toggled', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const userGot = once(userSocket, 'video-toggled');
  const adminGot = once(adminSocket, 'video-toggle-confirmed');
  adminSocket.emit('toggle-video', { kioskId, enabled: true });
  const payload = await userGot;
  assert.strictEqual(payload.enabled, true);
  assert.strictEqual(payload.kioskId, kioskId);
  await adminGot;
  await disconnect();
});

test('2-way: Monitor toggles audio → Kiosk receives audio-toggled', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  const userGot = once(userSocket, 'audio-toggled');
  const adminGot = once(adminSocket, 'audio-toggle-confirmed');
  adminSocket.emit('toggle-audio', { kioskId, enabled: true });
  const payload = await userGot;
  assert.strictEqual(payload.enabled, true);
  assert.strictEqual(payload.kioskId, kioskId);
  await adminGot;
  await disconnect();
});

test('2-way: Monitor disables video → Kiosk receives video-toggled(false)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  adminSocket.emit('toggle-video', { kioskId, enabled: true });
  await once(userSocket, 'video-toggled');
  const userGot = once(userSocket, 'video-toggled');
  adminSocket.emit('toggle-video', { kioskId, enabled: false });
  const payload = await userGot;
  assert.strictEqual(payload.enabled, false);
  await disconnect();
});

test('2-way: Monitor disables audio → Kiosk receives audio-toggled(false)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  adminSocket.emit('toggle-audio', { kioskId, enabled: true });
  await once(userSocket, 'audio-toggled');
  const userGot = once(userSocket, 'audio-toggled');
  adminSocket.emit('toggle-audio', { kioskId, enabled: false });
  const payload = await userGot;
  assert.strictEqual(payload.enabled, false);
  await disconnect();
});

test('2-way: Both parties toggle video simultaneously', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // Monitor enables video - set up all listeners first
  const userGotMonitorVideo = once(userSocket, 'video-toggled');
  const adminGotMonitorConfirm = once(adminSocket, 'video-toggle-confirmed');
  adminSocket.emit('toggle-video', { kioskId, enabled: true });
  await userGotMonitorVideo;
  await adminGotMonitorConfirm;
  
  // Kiosk enables video - set up all listeners first
  const adminGotKioskVideo = once(adminSocket, 'video-toggled');
  const userGotKioskConfirm = once(userSocket, 'video-toggle-confirmed');
  userSocket.emit('toggle-video', { kioskId, enabled: true });
  await adminGotKioskVideo;
  await userGotKioskConfirm;
  
  await disconnect();
});

test('2-way: Both parties toggle audio simultaneously', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // Monitor enables audio - set up all listeners first
  const userGotMonitorAudio = once(userSocket, 'audio-toggled');
  const adminGotMonitorConfirm = once(adminSocket, 'audio-toggle-confirmed');
  adminSocket.emit('toggle-audio', { kioskId, enabled: true });
  await userGotMonitorAudio;
  await adminGotMonitorConfirm;
  
  // Kiosk enables audio - set up all listeners first
  const adminGotKioskAudio = once(adminSocket, 'audio-toggled');
  const userGotKioskConfirm = once(userSocket, 'audio-toggle-confirmed');
  userSocket.emit('toggle-audio', { kioskId, enabled: true });
  await adminGotKioskAudio;
  await userGotKioskConfirm;
  
  await disconnect();
});

test('2-way: Full bidirectional call flow with WebRTC', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // 1. Kiosk creates offer
  const adminGotOffer = once(adminSocket, 'offer');
  userSocket.emit('offer', { targetId: MONITOR_CLIENT_ID, offer: mockSdpOffer });
  await adminGotOffer;
  
  // 2. Monitor sends answer
  const userGotAnswer = once(userSocket, 'answer');
  adminSocket.emit('answer', { targetId: kioskId, answer: mockSdpAnswer });
  await userGotAnswer;
  
  // 3. Exchange ICE candidates (both ways)
  const adminGotIce1 = once(adminSocket, 'ice-candidate');
  userSocket.emit('ice-candidate', { targetId: MONITOR_CLIENT_ID, candidate: mockIceCandidate });
  await adminGotIce1;
  
  const userGotIce1 = once(userSocket, 'ice-candidate');
  adminSocket.emit('ice-candidate', { targetId: kioskId, candidate: mockIceCandidate });
  await userGotIce1;
  
  // 4. Monitor enables video
  const userGotMonitorVideo = once(userSocket, 'video-toggled');
  adminSocket.emit('toggle-video', { kioskId, enabled: true });
  await userGotMonitorVideo;
  
  // 5. Kiosk enables video
  const adminGotKioskVideo = once(adminSocket, 'video-toggled');
  userSocket.emit('toggle-video', { kioskId, enabled: true });
  await adminGotKioskVideo;
  
  // 6. Monitor enables audio
  const userGotMonitorAudio = once(userSocket, 'audio-toggled');
  adminSocket.emit('toggle-audio', { kioskId, enabled: true });
  await userGotMonitorAudio;
  
  // 7. Kiosk enables audio
  const adminGotKioskAudio = once(adminSocket, 'audio-toggled');
  userSocket.emit('toggle-audio', { kioskId, enabled: true });
  await adminGotKioskAudio;
  
  // 8. Monitor disables video
  const userGotMonitorVideoOff = once(userSocket, 'video-toggled');
  adminSocket.emit('toggle-video', { kioskId, enabled: false });
  await userGotMonitorVideoOff;
  
  // 9. Kiosk disables audio
  const adminGotKioskAudioOff = once(adminSocket, 'audio-toggled');
  userSocket.emit('toggle-audio', { kioskId, enabled: false });
  await adminGotKioskAudioOff;
  
  await disconnect();
});

test('2-way: Monitor initiates offer → Kiosk responds → Full bidirectional', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // Monitor initiates (creates offer)
  const userGotOffer = once(userSocket, 'offer');
  adminSocket.emit('offer', { targetId: kioskId, offer: mockSdpOffer });
  await userGotOffer;
  
  // Kiosk responds with answer
  const adminGotAnswer = once(adminSocket, 'answer');
  userSocket.emit('answer', { targetId: MONITOR_CLIENT_ID, answer: mockSdpAnswer });
  await adminGotAnswer;
  
  // Both exchange ICE candidates
  const adminGotIce = once(adminSocket, 'ice-candidate');
  const userGotIce = once(userSocket, 'ice-candidate');
  
  userSocket.emit('ice-candidate', { targetId: MONITOR_CLIENT_ID, candidate: mockIceCandidate });
  adminSocket.emit('ice-candidate', { targetId: kioskId, candidate: mockIceCandidate });
  
  await adminGotIce;
  await userGotIce;
  
  // Both enable media
  const userGotVideo = once(userSocket, 'video-toggled');
  const adminGotVideo = once(adminSocket, 'video-toggled');
  
  adminSocket.emit('toggle-video', { kioskId, enabled: true });
  userSocket.emit('toggle-video', { kioskId, enabled: true });
  
  await userGotVideo;
  await adminGotVideo;
  
  await disconnect();
});

test('2-way: Rapid media toggles (both parties)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // Rapid toggles: Monitor on, Kiosk on, Monitor off, Kiosk off, both on
  const sequences = [
    { from: 'monitor', type: 'video', enabled: true },
    { from: 'kiosk', type: 'video', enabled: true },
    { from: 'monitor', type: 'audio', enabled: true },
    { from: 'kiosk', type: 'audio', enabled: true },
    { from: 'monitor', type: 'video', enabled: false },
    { from: 'kiosk', type: 'audio', enabled: false },
  ];
  
  for (const seq of sequences) {
    if (seq.from === 'monitor') {
      const userGot = once(userSocket, `${seq.type}-toggled`);
      adminSocket.emit(`toggle-${seq.type}`, { kioskId, enabled: seq.enabled });
      const payload = await userGot;
      assert.strictEqual(payload.enabled, seq.enabled);
    } else {
      const adminGot = once(adminSocket, `${seq.type}-toggled`);
      userSocket.emit(`toggle-${seq.type}`, { kioskId, enabled: seq.enabled });
      const payload = await adminGot;
      assert.strictEqual(payload.enabled, seq.enabled);
    }
  }
  
  await disconnect();
});

test('2-way: Monitor can create offer without local stream (view-only mode simulation)', async () => {
  const { adminSocket, userSocket, kioskId, disconnect } = await setupSessionWithActiveCall();
  
  // Monitor creates offer (simulating no local stream - offer still works)
  const userGotOffer = once(userSocket, 'offer');
  adminSocket.emit('offer', { targetId: kioskId, offer: mockSdpOffer });
  const offerPayload = await userGotOffer;
  assert.ok(offerPayload.offer);
  
  // Kiosk responds with answer
  const adminGotAnswer = once(adminSocket, 'answer');
  userSocket.emit('answer', { targetId: MONITOR_CLIENT_ID, answer: mockSdpAnswer });
  await adminGotAnswer;
  
  // Monitor can still receive remote stream (even without local stream)
  // This simulates view-only mode where Monitor doesn't have camera/mic
  
  await disconnect();
});

test('2-way: Complete bidirectional session lifecycle', async () => {
  const adminLogin = await login('admin', 'admin123');
  const u = `u_${Date.now()}`;
  await createUser(adminLogin.accessToken, u, 'Bidirectional User', 'p');
  const userLogin = await login(u, 'p');
  
  const adminSocket = await connectSocket(adminLogin.accessToken);
  const userSocket = await connectSocket(userLogin.accessToken);
  
  adminSocket.emit('register-monitor');
  await once(adminSocket, 'monitor-registered');
  const kioskOnlineP = once(adminSocket, 'kiosk-online', 5000);
  userSocket.emit('register-kiosk');
  await once(userSocket, 'kiosk-registered');
  await kioskOnlineP;
  
  // Start monitoring
  adminSocket.emit('start-monitoring', { kioskId: u });
  await once(adminSocket, 'monitoring-started');
  
  // Call flow
  adminSocket.emit('call-request', { kioskId: u });
  await once(userSocket, 'call-request');
  userSocket.emit('call-accept', { kioskId: u });
  await once(adminSocket, 'call-accepted');
  await once(userSocket, 'call-accept-confirmed');
  
  // Bidirectional WebRTC: Kiosk offers first
  const adminGotOffer = once(adminSocket, 'offer');
  userSocket.emit('offer', { targetId: MONITOR_CLIENT_ID, offer: mockSdpOffer });
  await adminGotOffer;
  
  // Monitor answers
  const userGotAnswer = once(userSocket, 'answer');
  adminSocket.emit('answer', { targetId: u, answer: mockSdpAnswer });
  await userGotAnswer;
  
  // Monitor also creates offer (2-way)
  const userGotMonitorOffer = once(userSocket, 'offer');
  adminSocket.emit('offer', { targetId: u, offer: mockSdpOffer });
  await userGotMonitorOffer;
  
  // Kiosk answers Monitor's offer
  const adminGotKioskAnswer = once(adminSocket, 'answer');
  userSocket.emit('answer', { targetId: MONITOR_CLIENT_ID, answer: mockSdpAnswer });
  await adminGotKioskAnswer;
  
  // Both enable video
  const userGotVideo = once(userSocket, 'video-toggled');
  const adminGotVideo = once(adminSocket, 'video-toggled');
  adminSocket.emit('toggle-video', { kioskId: u, enabled: true });
  userSocket.emit('toggle-video', { kioskId: u, enabled: true });
  await userGotVideo;
  await adminGotVideo;
  
  // Both enable audio
  const userGotAudio = once(userSocket, 'audio-toggled');
  const adminGotAudio = once(adminSocket, 'audio-toggled');
  adminSocket.emit('toggle-audio', { kioskId: u, enabled: true });
  userSocket.emit('toggle-audio', { kioskId: u, enabled: true });
  await userGotAudio;
  await adminGotAudio;
  
  // End call
  adminSocket.emit('call-end', { kioskId: u });
  await once(userSocket, 'call-ended');
  await once(adminSocket, 'call-end-confirmed');
  
  // Stop monitoring
  adminSocket.emit('stop-monitoring', { kioskId: u });
  await once(adminSocket, 'monitoring-stopped');
  
  adminSocket.disconnect();
  userSocket.disconnect();
  await delay(200);
});

// ========== MULTIPLE MONITORS AND USERS TEST CASES ==========

/** Setup multiple monitors and users */
async function setupMultipleMonitorsAndUsers(monitorCount = 2, userCount = 2) {
  const adminLogin = await login('admin', 'admin123');
  
  // Create users
  const users = [];
  for (let i = 0; i < userCount; i++) {
    const userId = `u_multi_${Date.now()}_${i}`;
    await createUser(adminLogin.accessToken, userId, `User ${i + 1}`, 'p');
    const userLogin = await login(userId, 'p');
    users.push({ userId, login: userLogin });
  }
  
  // Connect and register all monitors
  // Backend now supports multiple monitors with same credentials (uses socket.id as unique key)
  const monitors = [];
  const kioskOnlineListeners = new Map(); // Track listeners per monitor
  
  // Connect all monitors first (they join 'monitors' room on connection)
  for (let i = 0; i < monitorCount; i++) {
    const monitorSocket = await connectSocket(adminLogin.accessToken);
    await delay(50); // Small delay to ensure socket is fully connected
    
    monitorSocket.emit('register-monitor');
    await once(monitorSocket, 'monitor-registered');
    
    monitors.push({ socket: monitorSocket, id: `monitor_${i}` });
  }
  
  // Ensure all monitors are ready
  await delay(100);
  
  // Create user sockets and register as kiosks
  const userSockets = [];
  for (const user of users) {
    const userSocket = await connectSocket(user.login.accessToken);
    
    // Set up listeners for kiosk-online BEFORE registering the kiosk
    const kioskOnlinePromises = monitors
      .filter(m => m.socket.connected)
      .map(monitor => once(monitor.socket, 'kiosk-online', 5000));
    
    // Now register the kiosk (broadcasts to 'monitors' room)
    userSocket.emit('register-kiosk');
    await once(userSocket, 'kiosk-registered');
    
    // Wait for all connected monitors to receive kiosk-online
    if (kioskOnlinePromises.length > 0) {
      await Promise.all(kioskOnlinePromises);
    }
    
    userSockets.push({ socket: userSocket, userId: user.userId });
  }
  
  const disconnect = async () => {
    for (const monitor of monitors) {
      if (monitor.socket.connected) {
        monitor.socket.disconnect();
      }
    }
    for (const userSocket of userSockets) {
      if (userSocket.socket.connected) {
        userSocket.socket.disconnect();
      }
    }
    await delay(300);
  };
  
  return { monitors: monitors.filter(m => m.socket.connected), userSockets, disconnect };
}

test('Multiple monitors: 2 monitors see same user online', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(2, 1);
  
  const userId = userSockets[0].userId;
  
  // Both monitors should see the user online
  assert.strictEqual(monitors.length, 2);
  assert.strictEqual(userSockets.length, 1);
  
  // Verify both monitors can see the kiosk
  // (kiosk-online events were already received during setup)
  
  await disconnect();
});

test('Multiple users: 1 monitor sees 3 users online', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(1, 3);
  
  assert.strictEqual(monitors.length, 1);
  assert.strictEqual(userSockets.length, 3);
  
  const monitor = monitors[0].socket;
  
  // Monitor should see all 3 kiosks online
  // (events were received during setup)
  
  await disconnect();
});

test('Multiple monitors + users: 2 monitors see 2 users', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(2, 2);
  
  assert.strictEqual(monitors.length, 2);
  assert.strictEqual(userSockets.length, 2);
  
  await disconnect();
});

test('Multiple monitors: Monitor 1 monitors User 1, Monitor 2 monitors User 2', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(2, 2);
  
  const monitor1 = monitors[0].socket;
  const monitor2 = monitors[1].socket;
  const user1 = userSockets[0];
  const user2 = userSockets[1];
  
  // Monitor 1 starts monitoring User 1
  monitor1.emit('start-monitoring', { kioskId: user1.userId });
  await once(monitor1, 'monitoring-started');
  
  // Monitor 2 starts monitoring User 2
  monitor2.emit('start-monitoring', { kioskId: user2.userId });
  await once(monitor2, 'monitoring-started');
  
  // Monitor 1 requests call with User 1
  monitor1.emit('call-request', { kioskId: user1.userId });
  await once(user1.socket, 'call-request');
  
  // Monitor 2 requests call with User 2
  monitor2.emit('call-request', { kioskId: user2.userId });
  await once(user2.socket, 'call-request');
  
  // Both users accept
  user1.socket.emit('call-accept', { kioskId: user1.userId });
  await once(monitor1, 'call-accepted');
  
  user2.socket.emit('call-accept', { kioskId: user2.userId });
  await once(monitor2, 'call-accepted');
  
  await disconnect();
});

test('Multiple monitors: Both monitors monitor same user sequentially (one at a time)', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(2, 1);
  
  const monitor1 = monitors[0].socket;
  const monitor2 = monitors[1].socket;
  const user = userSockets[0];
  
  // Monitor 1 starts monitoring the user
  monitor1.emit('start-monitoring', { kioskId: user.userId });
  await once(monitor1, 'monitoring-started');
  
  // Monitor 2 tries to start monitoring same user - should get error (only one monitor per kiosk)
  const monitor2Error = once(monitor2, 'error', 3000);
  monitor2.emit('start-monitoring', { kioskId: user.userId });
  const error = await monitor2Error;
  assert.ok(error?.code === 'SESSION_ALREADY_EXISTS' || error?.code !== undefined);
  
  // Monitor 1 requests call
  monitor1.emit('call-request', { kioskId: user.userId });
  await once(user.socket, 'call-request');
  
  user.socket.emit('call-accept', { kioskId: user.userId });
  await once(monitor1, 'call-accepted');
  
  // Monitor 1 ends call and stops monitoring
  monitor1.emit('call-end', { kioskId: user.userId });
  await once(user.socket, 'call-ended');
  monitor1.emit('stop-monitoring', { kioskId: user.userId });
  await once(monitor1, 'monitoring-stopped');
  
  // Now Monitor 2 can start monitoring
  monitor2.emit('start-monitoring', { kioskId: user.userId });
  await once(monitor2, 'monitoring-started');
  
  // Monitor 2 requests call
  monitor2.emit('call-request', { kioskId: user.userId });
  await once(user.socket, 'call-request');
  
  user.socket.emit('call-accept', { kioskId: user.userId });
  await once(monitor2, 'call-accepted');
  
  await disconnect();
});

test('Bidirectional: Monitor 1 ↔ User 1, Monitor 2 ↔ User 2 (parallel calls)', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(2, 2);
  
  const monitor1 = monitors[0].socket;
  const monitor2 = monitors[1].socket;
  const user1 = userSockets[0];
  const user2 = userSockets[1];
  
  // Setup sessions for both pairs
  monitor1.emit('start-monitoring', { kioskId: user1.userId });
  await once(monitor1, 'monitoring-started');
  
  monitor2.emit('start-monitoring', { kioskId: user2.userId });
  await once(monitor2, 'monitoring-started');
  
  // Start calls for both pairs
  monitor1.emit('call-request', { kioskId: user1.userId });
  await once(user1.socket, 'call-request');
  
  monitor2.emit('call-request', { kioskId: user2.userId });
  await once(user2.socket, 'call-request');
  
  // Both users accept
  user1.socket.emit('call-accept', { kioskId: user1.userId });
  await once(monitor1, 'call-accepted');
  
  user2.socket.emit('call-accept', { kioskId: user2.userId });
  await once(monitor2, 'call-accepted');
  
  // Monitor 1 ↔ User 1: Bidirectional video
  const user1GotVideo = once(user1.socket, 'video-toggled');
  const monitor1GotConfirm = once(monitor1, 'video-toggle-confirmed');
  monitor1.emit('toggle-video', { kioskId: user1.userId, enabled: true });
  await user1GotVideo;
  await monitor1GotConfirm;
  
  const monitor1GotVideo = once(monitor1, 'video-toggled');
  const user1GotConfirm = once(user1.socket, 'video-toggle-confirmed');
  user1.socket.emit('toggle-video', { kioskId: user1.userId, enabled: true });
  await monitor1GotVideo;
  await user1GotConfirm;
  
  // Monitor 2 ↔ User 2: Bidirectional audio
  const user2GotAudio = once(user2.socket, 'audio-toggled');
  const monitor2GotConfirm = once(monitor2, 'audio-toggle-confirmed');
  monitor2.emit('toggle-audio', { kioskId: user2.userId, enabled: true });
  await user2GotAudio;
  await monitor2GotConfirm;
  
  const monitor2GotAudio = once(monitor2, 'audio-toggled');
  const user2GotConfirm = once(user2.socket, 'audio-toggle-confirmed');
  user2.socket.emit('toggle-audio', { kioskId: user2.userId, enabled: true });
  await monitor2GotAudio;
  await user2GotConfirm;
  
  await disconnect();
});

test('Bidirectional: Monitor 1 ↔ User 1, Monitor 1 ↔ User 2 (one monitor, multiple users)', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(1, 2);
  
  const monitor = monitors[0].socket;
  const user1 = userSockets[0];
  const user2 = userSockets[1];
  
  // Monitor starts monitoring both users
  monitor.emit('start-monitoring', { kioskId: user1.userId });
  await once(monitor, 'monitoring-started');
  
  monitor.emit('start-monitoring', { kioskId: user2.userId });
  await once(monitor, 'monitoring-started');
  
  // Start call with User 1
  monitor.emit('call-request', { kioskId: user1.userId });
  await once(user1.socket, 'call-request');
  user1.socket.emit('call-accept', { kioskId: user1.userId });
  await once(monitor, 'call-accepted');
  
  // Start call with User 2
  monitor.emit('call-request', { kioskId: user2.userId });
  await once(user2.socket, 'call-request');
  user2.socket.emit('call-accept', { kioskId: user2.userId });
  await once(monitor, 'call-accepted');
  
  // Monitor ↔ User 1: Bidirectional video
  const user1GotVideo = once(user1.socket, 'video-toggled');
  monitor.emit('toggle-video', { kioskId: user1.userId, enabled: true });
  await user1GotVideo;
  
  const monitorGotVideo1 = once(monitor, 'video-toggled');
  user1.socket.emit('toggle-video', { kioskId: user1.userId, enabled: true });
  await monitorGotVideo1;
  
  // Monitor ↔ User 2: Bidirectional audio
  const user2GotAudio = once(user2.socket, 'audio-toggled');
  monitor.emit('toggle-audio', { kioskId: user2.userId, enabled: true });
  await user2GotAudio;
  
  const monitorGotAudio2 = once(monitor, 'audio-toggled');
  user2.socket.emit('toggle-audio', { kioskId: user2.userId, enabled: true });
  await monitorGotAudio2;
  
  await disconnect();
});

test('Bidirectional WebRTC: Monitor 1 ↔ User 1, Monitor 2 ↔ User 2 (parallel signaling)', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(2, 2);
  
  const monitor1 = monitors[0].socket;
  const monitor2 = monitors[1].socket;
  const user1 = userSockets[0];
  const user2 = userSockets[1];
  
  // Setup sessions
  monitor1.emit('start-monitoring', { kioskId: user1.userId });
  await once(monitor1, 'monitoring-started');
  
  monitor2.emit('start-monitoring', { kioskId: user2.userId });
  await once(monitor2, 'monitoring-started');
  
  // Start calls
  monitor1.emit('call-request', { kioskId: user1.userId });
  await once(user1.socket, 'call-request');
  user1.socket.emit('call-accept', { kioskId: user1.userId });
  await once(monitor1, 'call-accepted');
  
  monitor2.emit('call-request', { kioskId: user2.userId });
  await once(user2.socket, 'call-request');
  user2.socket.emit('call-accept', { kioskId: user2.userId });
  await once(monitor2, 'call-accepted');
  
  // Monitor 1 ↔ User 1: User 1 creates offer
  const monitor1GotOffer = once(monitor1, 'offer');
  user1.socket.emit('offer', { targetId: MONITOR_CLIENT_ID, offer: mockSdpOffer });
  await monitor1GotOffer;
  
  // Monitor 2 ↔ User 2: User 2 creates offer
  const monitor2GotOffer = once(monitor2, 'offer');
  user2.socket.emit('offer', { targetId: MONITOR_CLIENT_ID, offer: mockSdpOffer });
  await monitor2GotOffer;
  
  // Monitor 1 sends answer to User 1
  const user1GotAnswer = once(user1.socket, 'answer');
  monitor1.emit('answer', { targetId: user1.userId, answer: mockSdpAnswer });
  await user1GotAnswer;
  
  // Monitor 2 sends answer to User 2
  const user2GotAnswer = once(user2.socket, 'answer');
  monitor2.emit('answer', { targetId: user2.userId, answer: mockSdpAnswer });
  await user2GotAnswer;
  
  // Monitor 1 creates offer to User 1 (bidirectional)
  const user1GotMonitorOffer = once(user1.socket, 'offer');
  monitor1.emit('offer', { targetId: user1.userId, offer: mockSdpOffer });
  await user1GotMonitorOffer;
  
  // Monitor 2 creates offer to User 2 (bidirectional)
  const user2GotMonitorOffer = once(user2.socket, 'offer');
  monitor2.emit('offer', { targetId: user2.userId, offer: mockSdpOffer });
  await user2GotMonitorOffer;
  
  // Exchange ICE candidates for both pairs
  const monitor1GotIce = once(monitor1, 'ice-candidate');
  user1.socket.emit('ice-candidate', { targetId: MONITOR_CLIENT_ID, candidate: mockIceCandidate });
  await monitor1GotIce;
  
  const monitor2GotIce = once(monitor2, 'ice-candidate');
  user2.socket.emit('ice-candidate', { targetId: MONITOR_CLIENT_ID, candidate: mockIceCandidate });
  await monitor2GotIce;
  
  await disconnect();
});

test('Bidirectional: Monitor 1 ↔ User 1 ↔ Monitor 2 (user talks to both monitors)', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(2, 1);
  
  const monitor1 = monitors[0].socket;
  const monitor2 = monitors[1].socket;
  const user = userSockets[0];
  
  // Monitor 1 starts monitoring (only one monitor can monitor a kiosk at a time)
  monitor1.emit('start-monitoring', { kioskId: user.userId });
  await once(monitor1, 'monitoring-started');
  
  // Monitor 1 requests call
  monitor1.emit('call-request', { kioskId: user.userId });
  await once(user.socket, 'call-request');
  
  // User accepts call
  user.socket.emit('call-accept', { kioskId: user.userId });
  await once(monitor1, 'call-accepted');
  
  // User ↔ Monitor 1: Bidirectional communication
  const monitor1GotVideo = once(monitor1, 'video-toggled');
  const userGotConfirm1 = once(user.socket, 'video-toggle-confirmed');
  user.socket.emit('toggle-video', { kioskId: user.userId, enabled: true });
  await monitor1GotVideo;
  await userGotConfirm1;
  
  const userGotVideo1 = once(user.socket, 'video-toggled');
  const monitor1GotConfirm = once(monitor1, 'video-toggle-confirmed');
  monitor1.emit('toggle-video', { kioskId: user.userId, enabled: true });
  await userGotVideo1;
  await monitor1GotConfirm;
  
  // Monitor 1 ends call and stops monitoring
  monitor1.emit('call-end', { kioskId: user.userId });
  await once(user.socket, 'call-ended');
  monitor1.emit('stop-monitoring', { kioskId: user.userId });
  await once(monitor1, 'monitoring-stopped');
  
  // Now Monitor 2 can start monitoring the same user
  monitor2.emit('start-monitoring', { kioskId: user.userId });
  await once(monitor2, 'monitoring-started');
  
  // Monitor 2 requests call
  monitor2.emit('call-request', { kioskId: user.userId });
  await once(user.socket, 'call-request');
  
  // User accepts call
  user.socket.emit('call-accept', { kioskId: user.userId });
  await once(monitor2, 'call-accepted');
  
  // User ↔ Monitor 2: Bidirectional communication
  const monitor2GotAudio = once(monitor2, 'audio-toggled');
  const userGotConfirm2 = once(user.socket, 'audio-toggle-confirmed');
  user.socket.emit('toggle-audio', { kioskId: user.userId, enabled: true });
  await monitor2GotAudio;
  await userGotConfirm2;
  
  const userGotAudio2 = once(user.socket, 'audio-toggled');
  const monitor2GotConfirm = once(monitor2, 'audio-toggle-confirmed');
  monitor2.emit('toggle-audio', { kioskId: user.userId, enabled: true });
  await userGotAudio2;
  await monitor2GotConfirm;
  
  await disconnect();
});

test('Bidirectional: Complex scenario - 3 monitors, 3 users, multiple sessions', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(3, 3);
  
  // Monitor 1 ↔ User 1
  monitors[0].socket.emit('start-monitoring', { kioskId: userSockets[0].userId });
  await once(monitors[0].socket, 'monitoring-started');
  
  // Monitor 2 ↔ User 2
  monitors[1].socket.emit('start-monitoring', { kioskId: userSockets[1].userId });
  await once(monitors[1].socket, 'monitoring-started');
  
  // Monitor 3 ↔ User 3
  monitors[2].socket.emit('start-monitoring', { kioskId: userSockets[2].userId });
  await once(monitors[2].socket, 'monitoring-started');
  
  // Start calls for all pairs
  monitors[0].socket.emit('call-request', { kioskId: userSockets[0].userId });
  await once(userSockets[0].socket, 'call-request');
  
  monitors[1].socket.emit('call-request', { kioskId: userSockets[1].userId });
  await once(userSockets[1].socket, 'call-request');
  
  monitors[2].socket.emit('call-request', { kioskId: userSockets[2].userId });
  await once(userSockets[2].socket, 'call-request');
  
  // All users accept
  userSockets[0].socket.emit('call-accept', { kioskId: userSockets[0].userId });
  await once(monitors[0].socket, 'call-accepted');
  
  userSockets[1].socket.emit('call-accept', { kioskId: userSockets[1].userId });
  await once(monitors[1].socket, 'call-accepted');
  
  userSockets[2].socket.emit('call-accept', { kioskId: userSockets[2].userId });
  await once(monitors[2].socket, 'call-accepted');
  
  // Bidirectional media for all pairs
  // Pair 1: Video
  const user1GotVideo = once(userSockets[0].socket, 'video-toggled');
  monitors[0].socket.emit('toggle-video', { kioskId: userSockets[0].userId, enabled: true });
  await user1GotVideo;
  
  const monitor1GotVideo = once(monitors[0].socket, 'video-toggled');
  userSockets[0].socket.emit('toggle-video', { kioskId: userSockets[0].userId, enabled: true });
  await monitor1GotVideo;
  
  // Pair 2: Audio
  const user2GotAudio = once(userSockets[1].socket, 'audio-toggled');
  monitors[1].socket.emit('toggle-audio', { kioskId: userSockets[1].userId, enabled: true });
  await user2GotAudio;
  
  const monitor2GotAudio = once(monitors[1].socket, 'audio-toggled');
  userSockets[1].socket.emit('toggle-audio', { kioskId: userSockets[1].userId, enabled: true });
  await monitor2GotAudio;
  
  // Pair 3: WebRTC signaling
  const monitor3GotOffer = once(monitors[2].socket, 'offer');
  userSockets[2].socket.emit('offer', { targetId: MONITOR_CLIENT_ID, offer: mockSdpOffer });
  await monitor3GotOffer;
  
  const user3GotAnswer = once(userSockets[2].socket, 'answer');
  monitors[2].socket.emit('answer', { targetId: userSockets[2].userId, answer: mockSdpAnswer });
  await user3GotAnswer;
  
  await disconnect();
});

test('Bidirectional: User 1 talks to Monitor 1, then Monitor 2 (switching monitors)', async () => {
  const { monitors, userSockets, disconnect } = await setupMultipleMonitorsAndUsers(2, 1);
  
  const monitor1 = monitors[0].socket;
  const monitor2 = monitors[1].socket;
  const user = userSockets[0];
  
  // Monitor 1 starts monitoring
  monitor1.emit('start-monitoring', { kioskId: user.userId });
  await once(monitor1, 'monitoring-started');
  
  // Start call with Monitor 1
  monitor1.emit('call-request', { kioskId: user.userId });
  await once(user.socket, 'call-request');
  user.socket.emit('call-accept', { kioskId: user.userId });
  await once(monitor1, 'call-accepted');
  
  // User ↔ Monitor 1: Bidirectional video
  const userGotVideo1 = once(user.socket, 'video-toggled');
  monitor1.emit('toggle-video', { kioskId: user.userId, enabled: true });
  await userGotVideo1;
  
  const monitor1GotVideo = once(monitor1, 'video-toggled');
  user.socket.emit('toggle-video', { kioskId: user.userId, enabled: true });
  await monitor1GotVideo;
  
  // End call with Monitor 1
  monitor1.emit('call-end', { kioskId: user.userId });
  await once(user.socket, 'call-ended');
  
  // Monitor 1 stops monitoring
  monitor1.emit('stop-monitoring', { kioskId: user.userId });
  await once(monitor1, 'monitoring-stopped');
  
  // Monitor 2 starts monitoring
  monitor2.emit('start-monitoring', { kioskId: user.userId });
  await once(monitor2, 'monitoring-started');
  
  // Start call with Monitor 2
  monitor2.emit('call-request', { kioskId: user.userId });
  await once(user.socket, 'call-request');
  user.socket.emit('call-accept', { kioskId: user.userId });
  await once(monitor2, 'call-accepted');
  
  // User ↔ Monitor 2: Bidirectional audio
  const userGotAudio2 = once(user.socket, 'audio-toggled');
  monitor2.emit('toggle-audio', { kioskId: user.userId, enabled: true });
  await userGotAudio2;
  
  const monitor2GotAudio = once(monitor2, 'audio-toggled');
  user.socket.emit('toggle-audio', { kioskId: user.userId, enabled: true });
  await monitor2GotAudio;
  
  await disconnect();
});
