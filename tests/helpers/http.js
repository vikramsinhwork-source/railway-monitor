import assert from 'node:assert';
import { BASE_URL } from './env.js';

export async function rest(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  return { status: res.status, data };
}

export async function login(user_id, password) {
  const response = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id, password }),
  });
  assert.strictEqual(response.status, 200, `Login failed for ${user_id}: ${JSON.stringify(response.data)}`);
  return response.data;
}

export async function deviceToken(deviceId, role, secret = process.env.DEVICE_TOKEN_SECRET || 'device-token-secret-change-in-production') {
  const response = await rest('/api/auth/device-token', {
    method: 'POST',
    body: JSON.stringify({ deviceId, role, secret }),
  });
  return response;
}

export async function healthCheck() {
  try {
    const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}
