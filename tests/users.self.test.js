import test from 'node:test';
import assert from 'node:assert';
import { login, rest } from './helpers/http.js';
import { USERS } from './helpers/fixtures.js';

async function signupUser(user_id, password = 'test_pw_1', extra = {}) {
  return rest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      user_id,
      name: 'Pending Test User',
      password,
      ...extra,
    }),
  });
}

async function approveUserByUserId(adminToken, user_id) {
  const pending = await rest('/api/users/pending', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(pending.status, 200, JSON.stringify(pending.data));
  const match = pending.data.users.find((u) => u.user_id === user_id);
  assert.ok(match, `Pending user ${user_id} not found`);
  return rest(`/api/users/${match.id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

test('POST /api/auth/signup creates PENDING_APPROVAL user without JWT', async () => {
  const user_id = `pending_signup_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const password = 'signup_secret_1';

  const signup = await signupUser(user_id, password, {
    name: 'Self Signup User',
    crew_type: 'DRIVER',
    head_quarter: 'North Yard',
    mobile: '+910000000001',
  });

  assert.strictEqual(signup.status, 201, JSON.stringify(signup.data));
  assert.strictEqual(signup.data.success, true);
  assert.strictEqual(
    signup.data.message,
    'Registration submitted. Your account is pending admin approval.'
  );
  assert.strictEqual(signup.data.user_id, user_id);
  assert.strictEqual(signup.data.accessToken, undefined);
  assert.strictEqual(signup.data.user, undefined);
  assert.strictEqual(signup.data.password_hash, undefined);

  const blockedLogin = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id, password }),
  });
  assert.strictEqual(blockedLogin.status, 403, JSON.stringify(blockedLogin.data));
  assert.strictEqual(blockedLogin.data.error, 'ACCOUNT_PENDING_APPROVAL');
  assert.strictEqual(blockedLogin.data.message, 'Your account is awaiting admin approval.');

  const admin = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
  const approve = await approveUserByUserId(admin.accessToken, user_id);
  assert.strictEqual(approve.status, 200, JSON.stringify(approve.data));
  assert.strictEqual(approve.data.user.status, 'ACTIVE');
  assert.ok(approve.data.user.approved_by);
  assert.ok(approve.data.user.approved_at);

  const loginAfter = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id, password }),
  });
  assert.strictEqual(loginAfter.status, 200, JSON.stringify(loginAfter.data));
  assert.strictEqual(loginAfter.data.user.user_id, user_id);
});

test('POST /api/auth/signup validation and unique constraints', async () => {
  const missing = await rest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'only_id' }),
  });
  assert.strictEqual(missing.status, 400);

  const user_id = `dup_user_${Date.now()}`;
  const first = await signupUser(user_id);
  assert.strictEqual(first.status, 201, JSON.stringify(first.data));

  const dupId = await signupUser(user_id, 'p2');
  assert.strictEqual(dupId.status, 409);

  const email = `unique_${Date.now()}@example.com`;
  const withEmail = await signupUser(`email_user_${Date.now()}`, 'p3', { email });
  assert.strictEqual(withEmail.status, 201, JSON.stringify(withEmail.data));

  const dupEmail = await signupUser(`other_${Date.now()}`, 'p4', { email });
  assert.strictEqual(dupEmail.status, 409);
});

test('Admin approve/reject enforces role and division scoping', async () => {
  const user_id = `scope_user_${Date.now()}`;
  const password = 'scope_pw_1';
  const signup = await signupUser(user_id, password);
  assert.strictEqual(signup.status, 201, JSON.stringify(signup.data));

  const superAdmin = await login(USERS.superAdmin.user_id, USERS.superAdmin.password);
  const pending = await rest('/api/users/pending', {
    headers: { Authorization: `Bearer ${superAdmin.accessToken}` },
  });
  assert.strictEqual(pending.status, 200, JSON.stringify(pending.data));
  const target = pending.data.users.find((u) => u.user_id === user_id);
  assert.ok(target);

  const bhavnagarAdmin = await login(USERS.bhavnagarAdmin.user_id, USERS.bhavnagarAdmin.password);
  const outOfDivision = await rest(`/api/users/${target.id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${bhavnagarAdmin.accessToken}` },
  });
  assert.strictEqual(outOfDivision.status, 403, JSON.stringify(outOfDivision.data));

  const reject = await rest(`/api/users/${target.id}/reject`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${superAdmin.accessToken}` },
  });
  assert.strictEqual(reject.status, 200, JSON.stringify(reject.data));
  assert.strictEqual(reject.data.user.status, 'INACTIVE');

  const approveAgain = await rest(`/api/users/${target.id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${superAdmin.accessToken}` },
  });
  assert.strictEqual(approveAgain.status, 400, JSON.stringify(approveAgain.data));

  const inactiveLogin = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id, password }),
  });
  assert.strictEqual(inactiveLogin.status, 403, JSON.stringify(inactiveLogin.data));
  assert.notStrictEqual(inactiveLogin.data.error, 'ACCOUNT_PENDING_APPROVAL');
});

test('GET /api/users/pending requires admin auth', async () => {
  const noAuth = await rest('/api/users/pending');
  assert.strictEqual(noAuth.status, 401);
});
