import test from 'node:test';
import assert from 'node:assert';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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
  return data;
}

async function createUser(adminToken, user_id, name, password, extra = {}) {
  const { status, data } = await rest('/api/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ user_id, name, password, ...extra }),
  });
  assert.strictEqual(status, 201, `Create user failed: ${JSON.stringify(data)}`);
  return data.user;
}

test('User profile fields: PATCH /me, login payload, admin APIs, forbidden keys', async () => {
  const adminLogin = await login('admin', 'admin123');
  const adminToken = adminLogin.accessToken;

  const testUserId = `profile_user_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const testPassword = 'pass123';
  const created = await createUser(adminToken, testUserId, 'Profile Test', testPassword, {
    crew_type: 'DRIVER',
    head_quarter: 'HQ1',
    mobile: '+919876543210',
  });

  assert.strictEqual(created.crew_type, 'DRIVER');
  assert.strictEqual(created.head_quarter, 'HQ1');
  assert.strictEqual(created.mobile, '+919876543210');
  assert.ok('profile_image_url' in created);
  assert.strictEqual(created.profile_image_url, null);

  const userLogin = await login(testUserId, testPassword);
  assert.ok('profile_image_url' in userLogin.user);
  assert.strictEqual(userLogin.user.crew_type, 'DRIVER');

  const patchRes = await rest('/api/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${userLogin.accessToken}` },
    body: JSON.stringify({
      crew_type: 'GUARD',
      head_quarter: 'North',
      mobile: '9876500000',
    }),
  });
  assert.strictEqual(patchRes.status, 200, JSON.stringify(patchRes.data));
  assert.strictEqual(patchRes.data.user.crew_type, 'GUARD');
  assert.strictEqual(patchRes.data.user.head_quarter, 'North');
  assert.strictEqual(patchRes.data.user.mobile, '9876500000');

  const meRes = await rest('/api/users/me', {
    headers: { Authorization: `Bearer ${userLogin.accessToken}` },
  });
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meRes.data.user.crew_type, 'GUARD');

  const forbidden = await rest('/api/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${userLogin.accessToken}` },
    body: JSON.stringify({ role: 'ADMIN' }),
  });
  assert.strictEqual(forbidden.status, 400);

  const listRes = await rest('/api/users', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(listRes.status, 200);
  const row = listRes.data.users.find((u) => u.user_id === testUserId);
  assert.ok(row);
  assert.strictEqual(row.crew_type, 'GUARD');
  assert.ok('profile_image_url' in row);

  const adminPatch = await rest(`/api/users/${created.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ crew_type: 'DRIVER', head_quarter: 'South' }),
  });
  assert.strictEqual(adminPatch.status, 200, JSON.stringify(adminPatch.data));
  assert.strictEqual(adminPatch.data.user.crew_type, 'DRIVER');
  assert.strictEqual(adminPatch.data.user.head_quarter, 'South');

  const getOne = await rest(`/api/users/${created.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(getOne.status, 200);
  assert.strictEqual(getOne.data.user.mobile, '9876500000');
});

test('POST /api/users/me/avatar returns 503 when S3 is not configured', async () => {
  const adminLogin = await login('admin', 'admin123');
  const testUserId = `avatar_user_${Date.now()}`;
  await createUser(adminLogin.accessToken, testUserId, 'Avatar Test', 'pass123');
  const userLogin = await login(testUserId, 'pass123');

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'pixel.png');

  const res = await fetch(`${BASE_URL}/api/users/me/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userLogin.accessToken}` },
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (process.env.AWS_S3_BUCKET && process.env.AWS_REGION) {
    assert.ok([200, 400, 502].includes(res.status), `Unexpected status ${res.status}: ${text}`);
  } else {
    assert.strictEqual(res.status, 503, text);
    assert.ok(data?.message?.includes('not configured'), text);
  }
});
