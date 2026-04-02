import test from 'node:test';
import assert from 'node:assert';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DEFAULT_STAFF_TYPE = 'ALP';
const DEFAULT_DUTY_TYPE = 'SIGN_ON';

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

async function createTemplate(adminToken, payload) {
  return rest('/api/forms/templates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(payload),
  });
}

async function addTemplateQuestion(adminToken, templateId, payload) {
  return rest(`/api/forms/templates/${templateId}/questions`, {
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

async function getTodayQuestionIds(userToken, { staffType = DEFAULT_STAFF_TYPE, dutyType = DEFAULT_DUTY_TYPE } = {}) {
  const query = new URLSearchParams({ staffType, dutyType }).toString();
  const todayQuestions = await rest(`/api/forms/today?${query}`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(todayQuestions.status, 200, JSON.stringify(todayQuestions.data));
  assert.ok(Array.isArray(todayQuestions.data.questions));
  return todayQuestions.data.questions.map((q) => q.id);
}

/** Adds a question to the active template for this staff+duty (not the legacy /forms/questions form, which may be a different duty). */
async function addQuestionToActiveDutyTemplate(adminToken, staffType, dutyType, payload) {
  const templates = await rest(
    `/api/forms/templates?staffType=${staffType}&dutyType=${dutyType}&isActive=true`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  assert.strictEqual(templates.status, 200, JSON.stringify(templates.data));
  const templateId = templates.data.templates?.[0]?.id;
  assert.ok(templateId, `Expected an active ${staffType} ${dutyType} template`);
  return addTemplateQuestion(adminToken, templateId, payload);
}

/** First staff+duty pair in the list with no active form (404 on /today), for DBs that already publish many duty types. */
async function findContextWithNoActiveForm(userToken) {
  const pairs = [
    ['TM', 'SIGN_OFF'],
    ['LP', 'SIGN_OFF'],
    ['TM', 'SIGN_ON'],
    ['LP', 'SIGN_ON'],
  ];
  for (const [staffType, dutyType] of pairs) {
    const r = await rest(`/api/forms/today?staffType=${staffType}&dutyType=${dutyType}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (r.status === 404) return { staffType, dutyType };
  }
  return null;
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

test('Forms admin template lifecycle and template-scoped questions', async () => {
  const { adminToken } = await setupAdminAndUser();

  const invalidTemplate = await createTemplate(adminToken, {
    title: '',
    staffType: 'ALP',
    dutyType: 'SIGN_ON',
  });
  assert.strictEqual(invalidTemplate.status, 400);

  const firstTemplate = await createTemplate(adminToken, {
    title: `ALP SIGN ON draft ${Date.now()}`,
    description: 'Draft template for ALP SIGN ON',
    staffType: 'ALP',
    dutyType: 'SIGN_ON',
  });
  assert.strictEqual(firstTemplate.status, 201, JSON.stringify(firstTemplate.data));
  const firstTemplateId = firstTemplate.data.template.id;
  assert.strictEqual(firstTemplate.data.template.is_active, false);

  const createQuestionInTemplate = await rest(`/api/forms/templates/${firstTemplateId}/questions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ prompt: 'Template prompt one', is_required: true, sort_order: 0 }),
  });
  assert.strictEqual(createQuestionInTemplate.status, 201, JSON.stringify(createQuestionInTemplate.data));
  const templateQuestionId = createQuestionInTemplate.data.question.id;

  const listTemplateQuestions = await rest(`/api/forms/templates/${firstTemplateId}/questions`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(listTemplateQuestions.status, 200);
  assert.ok(listTemplateQuestions.data.questions.some((q) => q.id === templateQuestionId));

  const updateTemplateQuestion = await rest(`/api/forms/templates/${firstTemplateId}/questions/${templateQuestionId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ prompt: 'Template prompt one updated' }),
  });
  assert.strictEqual(updateTemplateQuestion.status, 200);
  assert.strictEqual(updateTemplateQuestion.data.question.prompt, 'Template prompt one updated');

  const publishFirstTemplate = await rest(`/api/forms/templates/${firstTemplateId}/publish`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(publishFirstTemplate.status, 200);
  assert.strictEqual(publishFirstTemplate.data.template.is_active, true);

  const secondTemplate = await createTemplate(adminToken, {
    title: `ALP SIGN ON v2 ${Date.now()}`,
    staffType: 'ALP',
    dutyType: 'SIGN_ON',
  });
  assert.strictEqual(secondTemplate.status, 201, JSON.stringify(secondTemplate.data));
  const secondTemplateId = secondTemplate.data.template.id;

  const publishSecondTemplate = await rest(`/api/forms/templates/${secondTemplateId}/publish`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(publishSecondTemplate.status, 200);
  assert.strictEqual(publishSecondTemplate.data.template.is_active, true);

  const activeTemplates = await rest('/api/forms/templates?staffType=ALP&dutyType=SIGN_ON&isActive=true', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(activeTemplates.status, 200);
  assert.strictEqual(activeTemplates.data.templates.length, 1);
  assert.strictEqual(activeTemplates.data.templates[0].id, secondTemplateId);

  const firstTemplateQuestionsAfterPublish = await rest(`/api/forms/templates/${firstTemplateId}/questions`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(firstTemplateQuestionsAfterPublish.status, 200);
  assert.ok(firstTemplateQuestionsAfterPublish.data.questions.some((q) => q.id === templateQuestionId));

  const deleteTemplateQuestion = await rest(`/api/forms/templates/${firstTemplateId}/questions/${templateQuestionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(deleteTemplateQuestion.status, 200);
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

  const createRequired = await addQuestionToActiveDutyTemplate(adminToken, DEFAULT_STAFF_TYPE, DEFAULT_DUTY_TYPE, {
    prompt: 'Main update',
    is_required: true,
    sort_order: 0,
  });
  assert.strictEqual(createRequired.status, 201);
  const requiredQuestionId = createRequired.data.question.id;

  const createOptional = await addQuestionToActiveDutyTemplate(adminToken, DEFAULT_STAFF_TYPE, DEFAULT_DUTY_TYPE, {
    prompt: 'Optional note',
    is_required: false,
    sort_order: 1,
  });
  assert.strictEqual(createOptional.status, 201);
  const optionalQuestionId = createOptional.data.question.id;

  const todayQuestions = await rest(`/api/forms/today?staffType=${DEFAULT_STAFF_TYPE}&dutyType=${DEFAULT_DUTY_TYPE}`, {
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
    body: JSON.stringify({
      staffType: DEFAULT_STAFF_TYPE,
      dutyType: DEFAULT_DUTY_TYPE,
      answers: [],
    }),
  });
  assert.strictEqual(emptyAnswers.status, 400);

  const invalidQuestionId = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      staffType: DEFAULT_STAFF_TYPE,
      dutyType: DEFAULT_DUTY_TYPE,
      answers: [{ question_id: 'not-a-uuid', answer_text: 'X' }],
    }),
  });
  assert.strictEqual(invalidQuestionId.status, 400);

  const duplicateQuestionAnswers = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      staffType: DEFAULT_STAFF_TYPE,
      dutyType: DEFAULT_DUTY_TYPE,
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
      staffType: DEFAULT_STAFF_TYPE,
      dutyType: DEFAULT_DUTY_TYPE,
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
      staffType: DEFAULT_STAFF_TYPE,
      dutyType: DEFAULT_DUTY_TYPE,
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
      staffType: DEFAULT_STAFF_TYPE,
      dutyType: DEFAULT_DUTY_TYPE,
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

test('Forms role+duty filtering, required validation, and missing-template handling', async () => {
  const { adminToken, userToken } = await setupAdminAndUser();

  const activeSignInTemplates = await rest('/api/forms/templates?staffType=ALP&dutyType=SIGN_ON&isActive=true', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(activeSignInTemplates.status, 200, JSON.stringify(activeSignInTemplates.data));
  const signInTemplateId = activeSignInTemplates.data.templates?.[0]?.id;
  assert.ok(signInTemplateId, 'Expected an active ALP SIGN_ON duty template');

  const signInRequired = await addTemplateQuestion(adminToken, signInTemplateId, {
    prompt: 'ALP SIGN ON required prompt',
    is_required: true,
    sort_order: 0,
  });
  assert.strictEqual(signInRequired.status, 201, JSON.stringify(signInRequired.data));
  const signInRequiredQuestionId = signInRequired.data.question.id;

  const signInOptional = await addTemplateQuestion(adminToken, signInTemplateId, {
    prompt: 'ALP SIGN ON optional prompt',
    is_required: false,
    sort_order: 1,
  });
  assert.strictEqual(signInOptional.status, 201, JSON.stringify(signInOptional.data));
  const signInOptionalQuestionId = signInOptional.data.question.id;

  const signOffDraftTemplate = await createTemplate(adminToken, {
    title: `Role-duty ALP sign-off draft ${Date.now()}`,
    staffType: 'ALP',
    dutyType: 'SIGN_OFF',
  });
  assert.strictEqual(signOffDraftTemplate.status, 201, JSON.stringify(signOffDraftTemplate.data));
  const signOffTemplateId = signOffDraftTemplate.data.template.id;

  const signOffRequired = await addTemplateQuestion(adminToken, signOffTemplateId, {
    prompt: 'ALP sign-off required prompt',
    is_required: true,
    sort_order: 0,
  });
  assert.strictEqual(signOffRequired.status, 201, JSON.stringify(signOffRequired.data));
  const signOffRequiredQuestionId = signOffRequired.data.question.id;

  const todaySignIn = await rest('/api/forms/today?staffType=ALP&dutyType=SIGN_ON', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(todaySignIn.status, 200, JSON.stringify(todaySignIn.data));
  const todaySignInIds = todaySignIn.data.questions.map((q) => q.id);
  assert.ok(todaySignInIds.includes(signInRequiredQuestionId));
  assert.ok(todaySignInIds.includes(signInOptionalQuestionId));
  assert.ok(!todaySignInIds.includes(signOffRequiredQuestionId));

  const noFormCtx = await findContextWithNoActiveForm(userToken);
  assert.ok(
    noFormCtx,
    'Tests need at least one staff+duty with no active published form (e.g. TM+SIGN_OFF). Unpublish extra templates or use a DB without full seed.',
  );

  const todayNoForm = await rest(
    `/api/forms/today?staffType=${noFormCtx.staffType}&dutyType=${noFormCtx.dutyType}`,
    {
      headers: { Authorization: `Bearer ${userToken}` },
    },
  );
  assert.strictEqual(todayNoForm.status, 404, JSON.stringify(todayNoForm.data));
  assert.match(todayNoForm.data.message, /No active form found/i);

  const missingSignInRequired = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      staffType: 'ALP',
      dutyType: 'SIGN_ON',
      answers: [{ question_id: signInOptionalQuestionId, answer_text: 'Only optional for SIGN ON' }],
    }),
  });
  assert.strictEqual(missingSignInRequired.status, 400, JSON.stringify(missingSignInRequired.data));
  assert.strictEqual(missingSignInRequired.data.message, 'All required questions must be answered');
  assert.ok(Array.isArray(missingSignInRequired.data.missing_required_question_ids));
  assert.ok(missingSignInRequired.data.missing_required_question_ids.includes(signInRequiredQuestionId));

  const missingTemplateSubmit = await rest('/api/forms/submissions/today', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      staffType: noFormCtx.staffType,
      dutyType: noFormCtx.dutyType,
      answers: [{ question_id: signInRequiredQuestionId, answer_text: 'Should fail without template' }],
    }),
  });
  assert.strictEqual(missingTemplateSubmit.status, 404, JSON.stringify(missingTemplateSubmit.data));
  assert.match(missingTemplateSubmit.data.message, /No active form found/i);
});

test('Forms analytics endpoints: filters, pagination, and validation errors', async () => {
  const { adminToken, userToken, userId, testUserId } = await setupAdminAndUser();

  const createRequired = await addQuestionToActiveDutyTemplate(adminToken, DEFAULT_STAFF_TYPE, DEFAULT_DUTY_TYPE, {
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
      staffType: DEFAULT_STAFF_TYPE,
      dutyType: DEFAULT_DUTY_TYPE,
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

test('GET /api/forms/submissions/me: scoped history, pagination, role guards', async () => {
  const { adminToken, userToken, userId, testUserId } = await setupAdminAndUser();

  const unauthorized = await rest('/api/forms/submissions/me');
  assert.strictEqual(unauthorized.status, 401);

  const adminBlocked = await rest('/api/forms/submissions/me?page=1&limit=10', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(adminBlocked.status, 403);

  const emptyHistory = await rest('/api/forms/submissions/me?page=1&limit=10', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(emptyHistory.status, 200, JSON.stringify(emptyHistory.data));
  assert.strictEqual(emptyHistory.data.user.id, userId);
  assert.strictEqual(emptyHistory.data.user.user_id, testUserId);
  assert.ok(Array.isArray(emptyHistory.data.history));
  assert.strictEqual(emptyHistory.data.history.length, 0);
  assert.strictEqual(emptyHistory.data.pagination.total, 0);

  const createRequired = await addQuestionToActiveDutyTemplate(adminToken, DEFAULT_STAFF_TYPE, DEFAULT_DUTY_TYPE, {
    prompt: `Me history ${Date.now()}`,
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
      staffType: DEFAULT_STAFF_TYPE,
      dutyType: DEFAULT_DUTY_TYPE,
      answers: allQuestionIds.map((qid) => ({
        question_id: qid,
        answer_text: qid === requiredQuestionId ? 'My history row' : 'Other answer',
      })),
    }),
  });
  assert.strictEqual(submitToday.status, 201, JSON.stringify(submitToday.data));

  const withData = await rest('/api/forms/submissions/me?page=1&limit=10', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(withData.status, 200);
  assert.ok(withData.data.history.length >= 1);
  const first = withData.data.history[0];
  assert.ok(first.id);
  assert.ok(Array.isArray(first.answers));
  assert.ok(first.answers.some((a) => a.answer_text === 'My history row'));

  const invalidLimit = await rest('/api/forms/submissions/me?limit=200', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(invalidLimit.status, 400);

  const badDate = await rest('/api/forms/submissions/me?from_date=not-a-date', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(badDate.status, 400);
});
