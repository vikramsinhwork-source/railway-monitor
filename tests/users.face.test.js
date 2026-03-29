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

test('GET /api/users/me/face/status — USER: none when not enrolled', async () => {
  const user_id = `face_user_${Date.now()}`;
  const signup = await restJson('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      user_id,
      name: 'Face Test User',
      password: 'face_test_pw_1',
    }),
  });
  assert.strictEqual(signup.status, 201, JSON.stringify(signup.data));
  const token = signup.data.accessToken;

  const status = await restJson('/api/users/me/face/status', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(status.status, 200, JSON.stringify(status.data));
  assert.strictEqual(status.data.success, true);
  assert.strictEqual(status.data.status, 'none');
  assert.strictEqual(status.data.last_error, null);
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

test('POST /api/users/me/face/enroll — 503 when Rekognition/S3 not fully configured', async () => {
  if (
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_REGION &&
    (process.env.AWS_REKOGNITION_COLLECTION_ID || '').trim()
  ) {
    return;
  }

  const user_id = `face_enroll_${Date.now()}`;
  const signup = await restJson('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      user_id,
      name: 'Face Enroll User',
      password: 'face_enroll_pw_1',
    }),
  });
  assert.strictEqual(signup.status, 201, JSON.stringify(signup.data));
  const token = signup.data.accessToken;

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
