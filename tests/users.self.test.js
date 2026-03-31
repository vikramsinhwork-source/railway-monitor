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

test('POST /api/auth/signup creates USER, returns JWT, PATCH /me works with token', async () => {
  const user_id = `signup_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const password = 'signup_secret_1';

  const signup = await rest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      user_id,
      name: 'Self Signup User',
      password,
      crew_type: 'DRIVER',
      head_quarter: 'North Yard',
      mobile: '+910000000001',
    }),
  });
  assert.strictEqual(signup.status, 201, JSON.stringify(signup.data));
  assert.strictEqual(signup.data.success, true);
  assert.ok(signup.data.accessToken);
  assert.strictEqual(signup.data.role, 'USER');
  assert.strictEqual(signup.data.user.user_id, user_id);
  assert.strictEqual(signup.data.user.crew_type, 'DRIVER');
  assert.strictEqual(signup.data.user.head_quarter, 'North Yard');
  assert.strictEqual(signup.data.user.mobile, '+910000000001');

  const login = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id, password }),
  });
  assert.strictEqual(login.status, 200, JSON.stringify(login.data));
  assert.strictEqual(login.data.user.user_id, user_id);

  const patch = await rest('/api/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${signup.data.accessToken}` },
    body: JSON.stringify({ name: 'Renamed After Signup', crew_type: 'GUARD' }),
  });
  assert.strictEqual(patch.status, 200, JSON.stringify(patch.data));
  assert.strictEqual(patch.data.user.name, 'Renamed After Signup');
  assert.strictEqual(patch.data.user.crew_type, 'GUARD');
});

test('POST /api/auth/signup validation and unique constraints', async () => {
  const missing = await rest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'only_id' }),
  });
  assert.strictEqual(missing.status, 400);

  const user_id = `dup_user_${Date.now()}`;
  const first = await rest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ user_id, name: 'First', password: 'p1' }),
  });
  assert.strictEqual(first.status, 201, JSON.stringify(first.data));

  const dupId = await rest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ user_id, name: 'Second', password: 'p2' }),
  });
  assert.strictEqual(dupId.status, 409);

  const email = `unique_${Date.now()}@example.com`;
  const withEmail = await rest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      user_id: `email_user_${Date.now()}`,
      name: 'Has Email',
      password: 'p3',
      email,
    }),
  });
  assert.strictEqual(withEmail.status, 201, JSON.stringify(withEmail.data));

  const dupEmail = await rest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      user_id: `other_${Date.now()}`,
      name: 'Other',
      password: 'p4',
      email,
    }),
  });
  assert.strictEqual(dupEmail.status, 409);
});
