#!/usr/bin/env node
/**
 * Load test: simulate kiosks, monitors, and observer clients.
 *
 * Prerequisites:
 *   1. Server running: npm run dev  (PORT from .env, default 3000)
 *   2. .env with DEVICE_TOKEN_SECRET set
 *
 * Run:
 *   npm run load:observers
 *
 * Env:
 *   BASE_URL=http://localhost:3000
 *   DEVICE_TOKEN_SECRET=...  (from .env via dotenv)
 *   LOAD_KIOSKS=50  LOAD_MONITORS=20  LOAD_OBSERVERS=10
 *   LOAD_DURATION_SEC=30
 */

import 'dotenv/config';
import { io as ioClient } from 'socket.io-client';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const DEVICE_SECRET =
  process.env.DEVICE_TOKEN_SECRET || 'change-this-device-token-secret';
const KIOSKS = parseInt(process.env.LOAD_KIOSKS || '50', 10);
const MONITORS = parseInt(process.env.LOAD_MONITORS || '20', 10);
const OBSERVERS = parseInt(process.env.LOAD_OBSERVERS || '10', 10);
const DURATION_SEC = parseInt(process.env.LOAD_DURATION_SEC || '30', 10);
const CONNECT_TIMEOUT_MS = parseInt(process.env.LOAD_CONNECT_TIMEOUT_MS || '10000', 10);

const metrics = {
  connected: 0,
  tokenFailed: 0,
  socketFailed: 0,
  observerPolls: 0,
  startMs: Date.now(),
};

let firstError = null;

function recordError(label, err) {
  if (!firstError) {
    firstError = `${label}: ${err?.message || String(err)}`;
  }
}

async function healthCheck() {
  try {
    const res = await fetch(`${BASE}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err) {
    recordError('health', err);
    return false;
  }
}

async function fetchToken(role, clientId) {
  const res = await fetch(`${BASE}/api/auth/device-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: clientId,
      role,
      secret: DEVICE_SECRET,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `device-token ${res.status} for ${clientId}: ${data?.error || text}`
    );
  }

  const token = data?.token || data?.data?.token;
  if (!token) {
    throw new Error(`device-token missing token for ${clientId}`);
  }
  return token;
}

function connectSocket(token, label) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (socket) => {
      if (settled) return;
      settled = true;
      resolve(socket);
    };

    const socket = ioClient(BASE, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });

    socket.on('connect', () => {
      metrics.connected += 1;
      finish(socket);
    });

    socket.on('connect_error', (err) => {
      metrics.socketFailed += 1;
      recordError(`socket ${label}`, err);
      finish(null);
    });

    setTimeout(() => {
      if (!settled) {
        metrics.socketFailed += 1;
        recordError(`socket ${label}`, new Error('connect timeout'));
        socket.disconnect();
        finish(null);
      }
    }, CONNECT_TIMEOUT_MS);
  });
}

async function spawnClient(role, clientId, label, onConnected) {
  try {
    const token = await fetchToken(role, clientId);
    const socket = await connectSocket(token, label);
    if (socket) {
      await onConnected(socket);
      return socket;
    }
  } catch (err) {
    metrics.tokenFailed += 1;
    recordError(label, err);
  }
  return null;
}

async function main() {
  console.log(`\nLoad test target: ${BASE}`);
  console.log(`Clients: ${KIOSKS} kiosks, ${MONITORS} monitors, ${OBSERVERS} observers`);
  console.log(`Duration: ${DURATION_SEC}s\n`);

  const healthy = await healthCheck();
  if (!healthy) {
    console.error('[FAIL] Server not reachable. Start it first:\n');
    console.error('  cd railway-monitor && npm run dev\n');
    if (firstError) console.error(`  Detail: ${firstError}\n`);
    process.exit(1);
  }
  console.log('[OK] Server health check passed\n');

  const sockets = [];

  for (let i = 0; i < KIOSKS; i++) {
    const s = await spawnClient('KIOSK', `LOAD_KIOSK_${i}`, `kiosk-${i}`, async (socket) => {
      socket.emit('register-kiosk');
    });
    if (s) sockets.push(s);
  }

  for (let i = 0; i < MONITORS; i++) {
    const s = await spawnClient('MONITOR', `LOAD_MON_${i}`, `mon-${i}`, async (socket) => {
      socket.emit('register-monitor');
    });
    if (s) sockets.push(s);
  }

  for (let i = 0; i < OBSERVERS; i++) {
    const s = await spawnClient('MONITOR', `LOAD_OBS_${i}`, `obs-${i}`, async (socket) => {
      socket.emit('register-monitor');
      socket.emit('get-active-sessions', {});
      socket.on('active-sessions', () => {
        metrics.observerPolls += 1;
      });
    });
    if (s) sockets.push(s);
  }

  const expected = KIOSKS + MONITORS + OBSERVERS;
  console.log(`Connected ${metrics.connected}/${expected} before soak...\n`);

  if (metrics.connected === 0) {
    console.error('[FAIL] No sockets connected.');
    if (firstError) console.error(`First error: ${firstError}`);
    console.error('\nCheck: server running, DEVICE_TOKEN_SECRET in .env matches API.\n');
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, DURATION_SEC * 1000));

  const elapsed = ((Date.now() - metrics.startMs) / 1000).toFixed(1);
  const mem = process.memoryUsage();
  const totalFailed = metrics.tokenFailed + metrics.socketFailed;

  console.log('--- Load Test Results ---');
  console.log(`Duration:        ${elapsed}s`);
  console.log(`Connected:       ${metrics.connected}/${expected}`);
  console.log(`Token failures:  ${metrics.tokenFailed}`);
  console.log(`Socket failures: ${metrics.socketFailed}`);
  console.log(`Total failed:    ${totalFailed}`);
  console.log(`Observer polls:  ${metrics.observerPolls}`);
  console.log(`Heap MB:         ${(mem.heapUsed / 1024 / 1024).toFixed(1)}`);
  console.log(`RSS MB:          ${(mem.rss / 1024 / 1024).toFixed(1)}`);

  for (const s of sockets) {
    s.disconnect();
  }

  const pass = metrics.connected > 0 && metrics.connected >= expected * 0.8;
  console.log(pass ? '\n[PASS] Load test completed\n' : '\n[FAIL] Too many connection failures\n');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
