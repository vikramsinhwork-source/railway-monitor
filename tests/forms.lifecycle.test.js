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

async function createUser(adminToken, user_id, name, password) {
  const { status, data } = await rest('/api/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ user_id, name, password }),
  });
  assert.strictEqual(status, 201, `Create user failed: ${JSON.stringify(data)}`);
  return data.user;
}

async function createQuestion(adminToken, payload) {
  return rest('/api/forms/questions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(payload),
  });
}

async function setupAdminAndUser() {
  const adminLogin = await login('admin', 'admin123');
  const adminToken = adminLogin.accessToken;
  const testUserId = `forms_user_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const testPassword = 'pass123';
  const createdUser = await createUser(adminToken, testUserId, 'Forms Test User', testPassword);
  const userLogin = await login(testUserId, testPassword);
  return {
    adminToken,
    userToken: userLogin.accessToken,
    userId: userLogin.user.id || createdUser.id,
    testUserId,
  };
}

async function getTodayQuestionIds(userToken) {
  const todayQuestions = await rest('/api/forms/today', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(todayQuestions.status, 200, JSON.stringify(todayQuestions.data));
  assert.ok(Array.isArray(todayQuestions.data.questions));
  return todayQuestions.data.questions.map((q) => q.id);
}

test('Forms auth and role guards', async () => {
  const { adminToken, userToken } = await setupAdminAndUser();

  const unauthorizedQuestions = await rest('/api/forms/questions');
  assert.strictEqual(unauthorizedQuestions.status, 401);

  const userCannotListQuestions = await rest('/api/forms/questions', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(userCannotListQuestions.status, 403);

  const adminCannotAccessUserEndpoint = await rest('/api/forms/today', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(adminCannotAccessUserEndpoint.status, 403);

  const userCannotViewAnalytics = await rest('/api/forms/analytics/users', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(userCannotViewAnalytics.status, 403);
});

test('Forms question CRUD validations and edge cases', async () => {
  const { adminToken } = await setupAdminAndUser();

  const invalidCreateMissingPrompt = await createQuestion(adminToken, { is_required: true, sort_order: 0 });
  assert.strictEqual(invalidCreateMissingPrompt.status, 400);

  const invalidCreateRequiredType = await createQuestion(adminToken, {
    prompt: 'Invalid required type',
    is_required: 'yes',
    sort_order: 0,
  });
  assert.strictEqual(invalidCreateRequiredType.status, 400);

  const invalidCreateSortOrder = await createQuestion(adminToken, {
    prompt: 'Invalid sort order',
    is_required: true,
    sort_order: -1,
  });
  assert.strictEqual(invalidCreateSortOrder.status, 400);

  const createRequired = await createQuestion(adminToken, {
    prompt: 'What did you complete today?',
    is_required: true,
    sort_order: 0,
  });
  assert.strictEqual(createRequired.status, 201, JSON.stringify(createRequired.data));
  const requiredQuestionId = createRequired.data.question.id;

  const createOptional = await createQuestion(adminToken, {
    prompt: 'Any blockers?',
    is_required: false,
    sort_order: 1,
  });
  assert.strictEqual(createOptional.status, 201, JSON.stringify(createOptional.data));
  const optionalQuestionId = createOptional.data.question.id;

  const listQuestions = await rest('/api/forms/questions', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(listQuestions.status, 200);
  assert.ok(Array.isArray(listQuestions.data.questions));
  assert.ok(listQuestions.data.questions.length >= 2);

  const questionDetail = await rest(`/api/forms/questions/${requiredQuestionId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(questionDetail.status, 200);
  assert.strictEqual(questionDetail.data.question.id, requiredQuestionId);

  const invalidQuestionId = await rest('/api/forms/questions/not-a-uuid', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidQuestionId.status, 400);

  const unknownQuestionId = await rest('/api/forms/questions/11111111-1111-4111-8111-111111111111', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(unknownQuestionId.status, 404);

  const invalidPatchPayload = await rest(`/api/forms/questions/${optionalQuestionId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({}),
  });
  assert.strictEqual(invalidPatchPayload.status, 400);

  const updateQuestion = await rest(`/api/forms/questions/${optionalQuestionId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ prompt: 'Any blockers or support needed?', sort_order: 2 }),
  });
  assert.strictEqual(updateQuestion.status, 200);

  const invalidDeleteId = await rest('/api/forms/questions/not-a-uuid', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidDeleteId.status, 400);

  const deleteQuestion = await rest(`/api/forms/questions/${optionalQuestionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(deleteQuestion.status, 200);
  assert.strictEqual(deleteQuestion.data.success, true);
});

test('Forms user submissions allow multiple per day and latest endpoint works', async () => {
  const { adminToken, userToken } = await setupAdminAndUser();

  const createRequired = await createQuestion(adminToken, {
    prompt: 'Main update',
    is_required: true,
    sort_order: 0,
  });
  assert.strictEqual(createRequired.status, 201);
  const requiredQuestionId = createRequired.data.question.id;

  const createOptional = await createQuestion(adminToken, {
    prompt: 'Optional note',
    is_required: false,
    sort_order: 1,
  });
  assert.strictEqual(createOptional.status, 201);
  const optionalQuestionId = createOptional.data.question.id;

  const todayQuestions = await rest('/api/forms/today', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(todayQuestions.status, 200);
  assert.ok(Array.isArray(todayQuestions.data.questions));

  const latestBeforeSubmission = await rest('/api/forms/submissions/me/latest', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(latestBeforeSubmission.status, 200);
  assert.strictEqual(latestBeforeSubmission.data.submission, null);

  const emptyAnswers = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ answers: [] }),
  });
  assert.strictEqual(emptyAnswers.status, 400);

  const invalidQuestionId = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      answers: [{ question_id: 'not-a-uuid', answer_text: 'X' }],
    }),
  });
  assert.strictEqual(invalidQuestionId.status, 400);

  const duplicateQuestionAnswers = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      answers: [
        { question_id: requiredQuestionId, answer_text: 'First' },
        { question_id: requiredQuestionId, answer_text: 'Second' },
      ],
    }),
  });
  assert.strictEqual(duplicateQuestionAnswers.status, 400);

  const missingRequired = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      answers: [{ question_id: optionalQuestionId, answer_text: 'Only optional' }],
    }),
  });
  assert.strictEqual(missingRequired.status, 400);
  assert.strictEqual(missingRequired.data.message, 'All required questions must be answered');

  const allQuestionIds = await getTodayQuestionIds(userToken);
  const submitToday = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      answers: allQuestionIds.map((questionId) => ({
        question_id: questionId,
        answer_text:
          questionId === requiredQuestionId
            ? 'Worked on questionnaire APIs and tests.'
            : questionId === optionalQuestionId
              ? 'No blockers currently.'
              : 'Filled for required coverage.',
      })),
    }),
  });
  assert.strictEqual(submitToday.status, 201, JSON.stringify(submitToday.data));
  assert.ok(submitToday.data.answers.length >= 2);

  const secondSubmit = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      answers: allQuestionIds.map((questionId) => ({
        question_id: questionId,
        answer_text: questionId === requiredQuestionId ? 'Second submission same day.' : 'Second payload',
      })),
    }),
  });
  assert.strictEqual(secondSubmit.status, 201, JSON.stringify(secondSubmit.data));
  assert.ok(secondSubmit.data.submission?.id);

  const latestSubmission = await rest('/api/forms/submissions/me/latest', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(latestSubmission.status, 200);
  assert.ok(latestSubmission.data.submission);
  assert.ok(latestSubmission.data.submission.answers.length >= 2);
  assert.strictEqual(latestSubmission.data.submission.id, secondSubmit.data.submission.id);
});

test('Forms analytics endpoints: filters, pagination, and validation errors', async () => {
  const { adminToken, userToken, userId, testUserId } = await setupAdminAndUser();

  const createRequired = await createQuestion(adminToken, {
    prompt: `Daily update ${Date.now()}`,
    is_required: true,
    sort_order: 0,
  });
  assert.strictEqual(createRequired.status, 201);
  const requiredQuestionId = createRequired.data.question.id;

  const allQuestionIds = await getTodayQuestionIds(userToken);
  const submitToday = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      answers: allQuestionIds.map((questionId) => ({
        question_id: questionId,
        answer_text: questionId === requiredQuestionId ? 'Analytics test submission' : 'Additional required answer',
      })),
    }),
  });
  assert.strictEqual(submitToday.status, 201, JSON.stringify(submitToday.data));

  const analyticsUsers = await rest('/api/forms/analytics/users?page=1&limit=10', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(analyticsUsers.status, 200);
  assert.ok(Array.isArray(analyticsUsers.data.users));
  assert.ok(analyticsUsers.data.pagination);
  const analyticsEntry = analyticsUsers.data.users.find((u) => u.user_id === testUserId);
  assert.ok(analyticsEntry);
  assert.ok(analyticsEntry.submission_count >= 1);

  const searchFilter = await rest(`/api/forms/analytics/users?page=1&limit=10&search=${encodeURIComponent(testUserId)}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(searchFilter.status, 200);
  assert.ok(searchFilter.data.users.some((u) => u.user_id === testUserId));

  const invalidAnalyticsStatus = await rest('/api/forms/analytics/users?status=BAD', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidAnalyticsStatus.status, 400);

  const invalidAnalyticsPage = await rest('/api/forms/analytics/users?page=0&limit=10', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidAnalyticsPage.status, 400);

  const invalidAnalyticsLimit = await rest('/api/forms/analytics/users?page=1&limit=101', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidAnalyticsLimit.status, 400);

  const invalidAnalyticsDate = await rest('/api/forms/analytics/users?from_date=2026/01/01', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidAnalyticsDate.status, 400);

  const invalidDateRange = await rest('/api/forms/analytics/users?from_date=2026-12-31&to_date=2026-01-01', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidDateRange.status, 400);

  const history = await rest(`/api/forms/analytics/users/${userId}/history?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(history.status, 200);
  assert.ok(Array.isArray(history.data.history));
  assert.ok(history.data.history.length >= 1);
  assert.ok(Array.isArray(history.data.history[0].answers));

  const historyByUserId = await rest(`/api/forms/analytics/users/${encodeURIComponent(testUserId)}/history`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(historyByUserId.status, 200);
  assert.ok(Array.isArray(historyByUserId.data.history));

  const invalidHistoryUserId = await rest('/api/forms/analytics/users/not-a-real-user/history', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidHistoryUserId.status, 404);

  const unknownHistoryUser = await rest('/api/forms/analytics/users/11111111-1111-4111-8111-111111111111/history', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(unknownHistoryUser.status, 404);

  const invalidHistoryLimit = await rest(`/api/forms/analytics/users/${userId}/history?limit=200`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidHistoryLimit.status, 400);

  const invalidHistoryDate = await rest(`/api/forms/analytics/users/${userId}/history?from_date=bad-date`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(invalidHistoryDate.status, 400);
});
