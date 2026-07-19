import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

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
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, headers: res.headers };
}

async function login(userId, password) {
  const { status, data } = await rest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, password }),
  });
  assert.equal(status, 200, `Login failed: ${JSON.stringify(data)}`);
  return data;
}

function sampleAnswer(question) {
  const type = question.field_type || 'TEXT';
  switch (type) {
    case 'NUMBER':
      return '12';
    case 'DATE':
      return '2026-07-19';
    case 'TIME':
      return '09:30';
    case 'DATETIME':
      return '2026-07-19T09:30';
    case 'YES_NO':
      return 'Yes';
    case 'DROPDOWN': {
      const opts = Array.isArray(question.options) ? question.options : [];
      return String(opts[0] || 'A');
    }
    case 'SIGNATURE':
      return 'data:image/png;base64,aaa';
    case 'LONG_TEXT':
      return 'Long answer text';
    default:
      return `answer-${question.id.slice(0, 8)}`;
  }
}

function buildAnswers(questions) {
  return (questions || [])
    .filter((q) => q.is_required)
    .map((q) => ({
      question_id: q.id,
      answer_text: sampleAnswer(q),
    }));
}

test('Public forms: contexts and current form require no auth', async () => {
  const contexts = await rest('/api/public/forms/contexts');
  assert.equal(contexts.status, 200, JSON.stringify(contexts.data));
  assert.equal(contexts.data.success, true);
  assert.ok(Array.isArray(contexts.data.contexts));

  const current = await rest('/api/public/forms/current?staffType=ALP&dutyType=SIGN_ON');
  assert.ok([200, 404].includes(current.status), JSON.stringify(current.data));
  if (current.status === 200) {
    assert.equal(current.data.success, true);
    assert.ok(current.data.form?.id);
    assert.ok(Array.isArray(current.data.questions));
  }
});

test('Public forms: create user uppercase, submit, duplicate, login, register visibility', async () => {
  const stamp = Date.now();
  const lowerUserId = `pub_${stamp}_a`;
  const upperUserId = lowerUserId.toUpperCase();

  const current = await rest('/api/public/forms/current?staffType=ALP&dutyType=SIGN_ON');
  assert.equal(current.status, 200, `Need active ALP SIGN_ON form: ${JSON.stringify(current.data)}`);
  const questions = current.data.questions || [];
  const answers = buildAnswers(questions);
  assert.ok(answers.length > 0 || questions.every((q) => !q.is_required), 'Need answerable form');

  const key1 = randomUUID();
  const submit1 = await rest('/api/public/forms/submissions', {
    method: 'POST',
    body: JSON.stringify({
      staffType: 'ALP',
      dutyType: 'SIGN_ON',
      respondent: {
        user_id: lowerUserId,
        name: 'Public Form Tester',
        mobile: '+91 90000 11111',
      },
      idempotency_key: key1,
      answers: answers.length
        ? answers
        : questions.slice(0, 1).map((q) => ({
            question_id: q.id,
            answer_text: sampleAnswer(q),
          })),
    }),
  });

  if (questions.length === 0) {
    assert.equal(submit1.status, 400);
    return;
  }

  assert.equal(submit1.status, 201, JSON.stringify(submit1.data));
  assert.equal(submit1.data.success, true);
  assert.equal(submit1.data.user_created, true);
  assert.equal(submit1.data.user.user_id, upperUserId);
  assert.equal(submit1.data.idempotent_replay, false);

  const replay = await rest('/api/public/forms/submissions', {
    method: 'POST',
    body: JSON.stringify({
      staffType: 'ALP',
      dutyType: 'SIGN_ON',
      respondent: {
        user_id: lowerUserId,
        name: 'Public Form Tester',
        mobile: '+91 90000 11111',
      },
      idempotency_key: key1,
      answers: submit1.data.answer_count
        ? answers
        : [{ question_id: questions[0].id, answer_text: sampleAnswer(questions[0]) }],
    }),
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.data));
  assert.equal(replay.data.idempotent_replay, true);
  assert.equal(replay.data.submission_id, submit1.data.submission_id);

  const duplicate = await rest('/api/public/forms/submissions', {
    method: 'POST',
    body: JSON.stringify({
      staffType: 'ALP',
      dutyType: 'SIGN_ON',
      respondent: {
        user_id: upperUserId,
        name: 'Public Form Tester',
        mobile: '9000011111',
      },
      idempotency_key: randomUUID(),
      answers,
    }),
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));
  assert.equal(duplicate.data.code, 'ALREADY_SUBMITTED_TODAY');

  const loginData = await login(upperUserId, '12345678');
  assert.ok(loginData.accessToken);
  assert.equal(loginData.user.user_id, upperUserId);

  // Reuse existing user with different casing should not create another account
  const admin = await login('admin', 'admin123');
  const users = await rest(`/api/users?account_origin=PUBLIC_FORM&search=${encodeURIComponent(upperUserId)}`, {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
  });
  assert.equal(users.status, 200, JSON.stringify(users.data));
  const matches = (users.data.users || []).filter((u) => u.user_id === upperUserId);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].account_origin, 'PUBLIC_FORM');

  const registers = await rest('/api/registers?isActive=true', {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
  });
  assert.equal(registers.status, 200, JSON.stringify(registers.data));
  const registerId = registers.data.registers?.[0]?.id;
  if (registerId) {
    const entries = await rest(
      `/api/registers/${registerId}/entries?search=${encodeURIComponent(upperUserId)}&limit=20`,
      { headers: { Authorization: `Bearer ${admin.accessToken}` } }
    );
    assert.equal(entries.status, 200, JSON.stringify(entries.data));
    const hit = (entries.data.entries || []).find((e) => e.user?.user_id === upperUserId);
    if (hit) {
      assert.equal(hit.submission_source, 'PUBLIC');
      assert.equal(hit.user.account_origin, 'PUBLIC_FORM');
      assert.ok(hit.user.mobile);
    }
  }
});

test('Public forms: invalid context returns 400', async () => {
  const bad = await rest('/api/public/forms/current?staffType=XYZ&dutyType=SIGN_ON');
  assert.equal(bad.status, 400);
});

test('Public forms: rate limit headers present on public routes', async () => {
  const res = await rest('/api/public/forms/contexts');
  assert.equal(res.status, 200);
  const remaining = res.headers.get('ratelimit-remaining') || res.headers.get('x-ratelimit-remaining');
  assert.ok(remaining != null, 'Expected rate limit headers on public routes');
});
