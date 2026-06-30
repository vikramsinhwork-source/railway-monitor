import test from 'node:test';
import assert from 'node:assert';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function restJson(path, options = {}) {
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

async function signupAndApprove(user_id, password) {
  const signup = await restJson('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      user_id,
      name: 'Face Test User',
      password,
    }),
  });
  assert.strictEqual(signup.status, 201, JSON.stringify(signup.data));

  const adminLogin = await restJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'admin', password: 'admin123' }),
  });
  assert.strictEqual(adminLogin.status, 200, JSON.stringify(adminLogin.data));

  const pending = await restJson('/api/users/pending', {
    headers: { Authorization: `Bearer ${adminLogin.data.accessToken}` },
  });
  assert.strictEqual(pending.status, 200, JSON.stringify(pending.data));
  const match = pending.data.users.find((u) => u.user_id === user_id);
  assert.ok(match, `Pending user ${user_id} not found`);

  const approve = await restJson(`/api/users/${match.id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminLogin.data.accessToken}` },
  });
  assert.strictEqual(approve.status, 200, JSON.stringify(approve.data));

  const login = await restJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id, password }),
  });
  assert.strictEqual(login.status, 200, JSON.stringify(login.data));
  return login.data.accessToken;
}

test('GET /api/users/me/face/status — USER: not enrolled when no active profile', async () => {
  const user_id = `face_user_${Date.now()}`;
  const token = await signupAndApprove(user_id, 'face_test_pw_1');

  const status = await restJson('/api/users/me/face/status', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(status.status, 200, JSON.stringify(status.data));
  assert.strictEqual(status.data.success, true);
  assert.ok(status.data.data);
  assert.strictEqual(status.data.data.enrolled, false);
  assert.strictEqual(status.data.data.enrolledAt, null);
  assert.strictEqual(status.data.data.isActive, false);
});

test('GET /api/users/me/face/status — ADMIN receives 403', async () => {
  const login = await restJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'admin', password: 'admin123' }),
  });
  assert.strictEqual(login.status, 200, JSON.stringify(login.data));

  const status = await restJson('/api/users/me/face/status', {
    headers: { Authorization: `Bearer ${login.data.accessToken}` },
  });
  assert.strictEqual(status.status, 403);
  assert.strictEqual(status.data.success, false);
});

test('POST /api/users/me/face/enroll — 503 when Rekognition/S3 not fully configured', async (t) => {
  if (
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_REGION &&
    (process.env.AWS_REKOGNITION_COLLECTION_ID || '').trim()
  ) {
    t.skip('AWS face enrollment is configured on this server');
    return;
  }

  const user_id = `face_enroll_${Date.now()}`;
  const token = await signupAndApprove(user_id, 'face_enroll_pw_1');

  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAAaABoDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAMBBP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=',
    'base64'
  );

  const form = new FormData();
  form.append('image', new Blob([jpeg], { type: 'image/jpeg' }), 'tiny.jpg');

  const url = `${BASE_URL}/api/users/me/face/enroll`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  assert.strictEqual(res.status, 503, JSON.stringify(data));
  assert.strictEqual(data.success, false);
  assert.ok(typeof data.message === 'string');
});
