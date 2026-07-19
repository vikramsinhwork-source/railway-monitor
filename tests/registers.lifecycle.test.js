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

async function restBinary(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  return { status: res.status, buffer, contentType };
}

async function login(userId, password) {
  const { status, data } = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, password }),
  });
  assert.strictEqual(status, 200, `Login failed: ${JSON.stringify(data)}`);
  return data;
}

async function createUser(adminToken, user_id, name, password) {
  const { status, data } = await rest('/api/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id,
      name,
      password,
      email: `${user_id}@example.com`,
    }),
  });
  assert.strictEqual(status, 201, `Create user failed: ${JSON.stringify(data)}`);
  return data.user;
}

async function setupAdminAndUser() {
  const adminLogin = await login('admin', 'admin123');
  const adminToken = adminLogin.accessToken;
  const testUserId = `reg_user_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const testPassword = 'pass123';
  const createdUser = await createUser(adminToken, testUserId, 'Register Test User', testPassword);
  const userLogin = await login(testUserId, testPassword);
  return {
    adminToken,
    userToken: userLogin.accessToken,
    userId: userLogin.user.id || createdUser.id,
    testUserId,
  };
}

async function addTemplateQuestion(adminToken, templateId, payload) {
  return rest(`/api/forms/templates/${templateId}/questions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(payload),
  });
}

async function getActiveTemplateId(adminToken, staffType = 'ALP', dutyType = 'SIGN_ON') {
  const templates = await rest(
    `/api/forms/templates?staffType=${staffType}&dutyType=${dutyType}&isActive=true`,
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert.strictEqual(templates.status, 200, JSON.stringify(templates.data));
  const templateId = templates.data.templates?.[0]?.id;
  assert.ok(templateId, `Expected active ${staffType} ${dutyType} template`);
  return templateId;
}

test('Registers auth guards', async () => {
  const { userToken } = await setupAdminAndUser();

  const unauthorized = await rest('/api/registers');
  assert.strictEqual(unauthorized.status, 401);

  const forbidden = await rest('/api/registers', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(forbidden.status, 403);
});

test('Registers CRUD, mapping, entries visibility, and export', async () => {
  const { adminToken, userToken } = await setupAdminAndUser();
  const stamp = Date.now();

  const templateId = await getActiveTemplateId(adminToken);

  const trainQ = await addTemplateQuestion(adminToken, templateId, {
    prompt: `Train No ${stamp}`,
    key: `train_no_${stamp}`,
    field_type: 'TEXT',
    is_required: true,
    sort_order: 10,
  });
  assert.strictEqual(trainQ.status, 201, JSON.stringify(trainQ.data));

  const detonatorQ = await addTemplateQuestion(adminToken, templateId, {
    prompt: `Detonator No ${stamp}`,
    key: `detonator_no_${stamp}`,
    field_type: 'NUMBER',
    is_required: false,
    sort_order: 11,
  });
  assert.strictEqual(detonatorQ.status, 201, JSON.stringify(detonatorQ.data));

  const remarksQ = await addTemplateQuestion(adminToken, templateId, {
    prompt: `Remarks ${stamp}`,
    key: `remarks_${stamp}`,
    field_type: 'TEXT',
    is_required: false,
    sort_order: 12,
  });
  assert.strictEqual(remarksQ.status, 201, JSON.stringify(remarksQ.data));

  const trainId = trainQ.data.question.id;
  const detonatorId = detonatorQ.data.question.id;
  const remarksId = remarksQ.data.question.id;

  const todayMeta = await rest('/api/forms/today?staffType=ALP&dutyType=SIGN_ON', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(todayMeta.status, 200, JSON.stringify(todayMeta.data));
  const todayQuestions = todayMeta.data.questions;
  assert.ok(Array.isArray(todayQuestions));

  function buildAnswers(overrides = {}) {
    return todayQuestions
      .map((q) => {
        if (overrides[q.id] !== undefined) {
          return { question_id: q.id, answer_text: overrides[q.id] };
        }
        if (q.id === trainId) return { question_id: q.id, answer_text: '59556' };
        if (q.id === detonatorId) return null;
        if (q.id === remarksId) return { question_id: q.id, answer_text: 'no detonator' };
        if (!q.is_required) return null;
        if (q.field_type === 'NUMBER') return { question_id: q.id, answer_text: '1' };
        if (q.field_type === 'DATE') return { question_id: q.id, answer_text: '2026-07-19' };
        if (q.field_type === 'TIME') return { question_id: q.id, answer_text: '10:00' };
        if (q.field_type === 'DATETIME') return { question_id: q.id, answer_text: '2026-07-19 10:00' };
        if (q.field_type === 'YES_NO') return { question_id: q.id, answer_text: 'Yes' };
        if (q.field_type === 'DROPDOWN' && Array.isArray(q.options) && q.options[0]) {
          return { question_id: q.id, answer_text: q.options[0] };
        }
        return { question_id: q.id, answer_text: `auto-${q.id.slice(0, 8)}` };
      })
      .filter((a) => a && String(a.answer_text).trim() !== '');
  }

  const invalidNumber = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      staffType: 'ALP',
      dutyType: 'SIGN_ON',
      answers: buildAnswers({ [detonatorId]: 'not-a-number', [trainId]: '19204' }),
    }),
  });
  assert.strictEqual(invalidNumber.status, 400);

  const createRegister = await rest('/api/registers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: `Detonator Register ${stamp}`,
      description: 'Test detonator register',
    }),
  });
  assert.strictEqual(createRegister.status, 201, JSON.stringify(createRegister.data));
  const registerId = createRegister.data.data.register.id;
  assert.ok(registerId);

  const map = await rest(`/api/registers/${registerId}/questions`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      questions: [
        { question_id: trainId, sort_order: 0, is_key_field: false },
        { question_id: detonatorId, sort_order: 1, is_key_field: true, column_label: 'Detonator No.' },
        { question_id: remarksId, sort_order: 2, is_key_field: false },
      ],
    }),
  });
  assert.strictEqual(map.status, 200, JSON.stringify(map.data));
  assert.strictEqual(map.data.data.questions.length, 3);

  // Submission without detonator should not appear in register
  const withoutDetonator = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      staffType: 'ALP',
      dutyType: 'SIGN_ON',
      answers: buildAnswers({
        [trainId]: '59556',
        [remarksId]: 'no detonator',
      }),
    }),
  });
  assert.strictEqual(withoutDetonator.status, 201, JSON.stringify(withoutDetonator.data));

  // Submission with detonator should appear
  const withDetonator = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      staffType: 'ALP',
      dutyType: 'SIGN_ON',
      answers: buildAnswers({
        [trainId]: '19204',
        [detonatorId]: '22',
        [remarksId]: 'issued',
      }),
    }),
  });
  assert.strictEqual(withDetonator.status, 201, JSON.stringify(withDetonator.data));

  const entries = await rest(`/api/registers/${registerId}/entries?page=1&limit=20`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(entries.status, 200, JSON.stringify(entries.data));
  const entryRows = entries.data.data.entries;
  assert.ok(Array.isArray(entryRows));
  assert.ok(entryRows.length >= 1);
  assert.ok(entryRows.every((row) => String(row.values[detonatorId] || '').trim() !== ''));
  const match = entryRows.find((row) => row.values[detonatorId] === '22');
  assert.ok(match, 'Expected detonator entry 22');
  assert.strictEqual(match.values[trainId], '19204');

  const summary = await rest(`/api/registers/${registerId}/analytics/summary`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(summary.status, 200, JSON.stringify(summary.data));
  assert.ok(summary.data.data.totals.submission_count >= 1);

  const preview = await rest(`/api/registers/${registerId}/export/preview`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(preview.status, 200, JSON.stringify(preview.data));
  assert.ok(preview.data.data.workbook.sheets?.[0]?.rows?.length >= 1);

  const xlsx = await restBinary(`/api/registers/${registerId}/export`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(xlsx.status, 200);
  assert.ok(xlsx.contentType.includes('spreadsheetml') || xlsx.buffer.length > 100);

  const deactivated = await rest(`/api/registers/${registerId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(deactivated.status, 200, JSON.stringify(deactivated.data));
  assert.strictEqual(deactivated.data.data.register.is_active, false);
});

test('Typed question field metadata is returned on /today', async () => {
  const { adminToken, userToken } = await setupAdminAndUser();
  const stamp = Date.now();
  const templateId = await getActiveTemplateId(adminToken);

  const created = await addTemplateQuestion(adminToken, templateId, {
    prompt: `Designation ${stamp}`,
    key: `designation_${stamp}`,
    field_type: 'DROPDOWN',
    options: ['LP', 'ALP', 'TM'],
    is_required: false,
    sort_order: 20,
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.data));

  const today = await rest('/api/forms/today?staffType=ALP&dutyType=SIGN_ON', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(today.status, 200, JSON.stringify(today.data));
  const found = today.data.questions.find((q) => q.id === created.data.question.id);
  assert.ok(found);
  assert.strictEqual(found.field_type, 'DROPDOWN');
  assert.deepStrictEqual(found.options, ['LP', 'ALP', 'TM']);
  assert.strictEqual(found.key, `designation_${stamp}`);
});
