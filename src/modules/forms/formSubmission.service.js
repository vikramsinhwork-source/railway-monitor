import { UniqueConstraintError } from 'sequelize';
import { Form, Question, Submission, Answer } from './index.js';
import { validateAnswerForFieldType } from './questionFieldTypes.js';

export const STAFF_TYPES = ['ALP', 'LP', 'TM'];
export const DUTY_TYPES = ['SIGN_ON', 'SIGN_OFF'];
export const SUBMISSION_SOURCES = ['AUTHENTICATED', 'PUBLIC'];

export function isValidUuid(value) {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function normalizeEnumValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

export function getTodayDateOnly() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseFormContext({ staffType, dutyType }, { source = 'query' } = {}) {
  const normalizedStaffType = normalizeEnumValue(staffType);
  const normalizedDutyType = normalizeEnumValue(dutyType);

  if (!normalizedStaffType) {
    return { error: `${source}.staffType is required` };
  }
  if (!STAFF_TYPES.includes(normalizedStaffType)) {
    return { error: `${source}.staffType must be one of ${STAFF_TYPES.join(', ')}` };
  }
  if (!normalizedDutyType) {
    return { error: `${source}.dutyType is required` };
  }
  if (!DUTY_TYPES.includes(normalizedDutyType)) {
    return { error: `${source}.dutyType must be one of ${DUTY_TYPES.join(', ')}` };
  }

  return {
    context: {
      staffType: normalizedStaffType,
      dutyType: normalizedDutyType,
    },
  };
}

export async function getActiveFormByContext({ staffType, dutyType }, options = {}) {
  return Form.findOne({
    where: {
      is_active: true,
      staff_type: staffType,
      duty_type: dutyType,
    },
    ...options,
  });
}

export async function listActiveFormContexts() {
  const forms = await Form.findAll({
    where: { is_active: true },
    attributes: ['id', 'title', 'staff_type', 'duty_type'],
    order: [
      ['staff_type', 'ASC'],
      ['duty_type', 'ASC'],
    ],
  });

  return forms.map((form) => ({
    form_id: form.id,
    title: form.title,
    staff_type: form.staff_type,
    duty_type: form.duty_type,
  }));
}

export async function loadOrderedFormQuestions(formId, options = {}) {
  return Question.findAll({
    where: { form_id: formId },
    order: [
      ['sort_order', 'ASC'],
      ['created_at', 'ASC'],
    ],
    attributes: ['id', 'prompt', 'field_type', 'options', 'key', 'is_required', 'sort_order'],
    ...options,
  });
}

export function toPublicFormPayload(form, questions, submissionDate = getTodayDateOnly()) {
  return {
    form: {
      id: form.id,
      title: form.title,
      description: form.description,
      staff_type: form.staff_type,
      duty_type: form.duty_type,
    },
    questions: questions.map((q) => {
      const plain = q.get ? q.get({ plain: true }) : q;
      return {
        id: plain.id,
        prompt: plain.prompt,
        field_type: plain.field_type || 'TEXT',
        options: plain.options ?? null,
        key: plain.key ?? null,
        is_required: Boolean(plain.is_required),
        sort_order: plain.sort_order ?? 0,
      };
    }),
    submission_date: submissionDate,
  };
}

/**
 * Validate and normalize answer payloads against the given questions.
 * @returns {{ normalizedAnswers?: Array<{question_id:string,answer_text:string}>, error?: {status:number,message:string,missing_required_question_ids?:string[]} }}
 */
export function validateAndNormalizeAnswers(payloadAnswers, questions) {
  if (!Array.isArray(payloadAnswers) || payloadAnswers.length === 0) {
    return { error: { status: 400, message: 'answers must be a non-empty array' } };
  }

  if (!questions || questions.length === 0) {
    return { error: { status: 400, message: 'No active questions available for submission' } };
  }

  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const seenQuestionIds = new Set();
  const normalizedAnswers = [];

  for (const [index, answer] of payloadAnswers.entries()) {
    if (!answer || typeof answer !== 'object') {
      return { error: { status: 400, message: `answers[${index}] must be an object` } };
    }

    const questionId = answer.question_id;
    const answerText = typeof answer.answer_text === 'string' ? answer.answer_text.trim() : '';
    if (!isValidUuid(questionId)) {
      return {
        error: {
          status: 400,
          message: `answers[${index}].question_id must be a valid UUID`,
        },
      };
    }
    if (!answerText) {
      return {
        error: {
          status: 400,
          message: `answers[${index}].answer_text is required`,
        },
      };
    }
    if (!questionMap.has(questionId)) {
      return {
        error: {
          status: 400,
          message: `answers[${index}].question_id is not an active question`,
        },
      };
    }
    if (seenQuestionIds.has(questionId)) {
      return {
        error: {
          status: 400,
          message: `Duplicate answer for question ${questionId}`,
        },
      };
    }

    const question = questionMap.get(questionId);
    const typeError = validateAnswerForFieldType(
      question.field_type || 'TEXT',
      answerText,
      question.options
    );
    if (typeError) {
      return {
        error: {
          status: 400,
          message: `answers[${index}]: ${typeError}`,
        },
      };
    }

    seenQuestionIds.add(questionId);
    normalizedAnswers.push({ question_id: questionId, answer_text: answerText });
  }

  const missingRequired = questions
    .filter((q) => q.is_required && !seenQuestionIds.has(q.id))
    .map((q) => q.id);
  if (missingRequired.length > 0) {
    return {
      error: {
        status: 400,
        message: 'All required questions must be answered',
        missing_required_question_ids: missingRequired,
      },
    };
  }

  return { normalizedAnswers };
}

/**
 * Create a submission + answers inside an existing transaction.
 */
export async function createSubmissionWithAnswers(
  {
    userId,
    formId,
    submissionDate,
    staffType,
    dutyType,
    submissionSource = 'AUTHENTICATED',
    idempotencyKey = null,
    normalizedAnswers,
  },
  transaction
) {
  const submission = await Submission.create(
    {
      user_id: userId,
      form_id: formId,
      submission_date: submissionDate,
      submission_source: submissionSource,
      staff_type: staffType || null,
      duty_type: dutyType || null,
      idempotency_key: idempotencyKey || null,
    },
    { transaction }
  );

  const answers = await Answer.bulkCreate(
    normalizedAnswers.map((answer) => ({
      submission_id: submission.id,
      question_id: answer.question_id,
      answer_text: answer.answer_text,
    })),
    { transaction }
  );

  return { submission, answers };
}

export function isUniqueConstraintError(err) {
  return err instanceof UniqueConstraintError || err?.name === 'SequelizeUniqueConstraintError';
}

export function uniqueConstraintTouches(err, fieldNames = []) {
  if (!isUniqueConstraintError(err)) return false;
  const fields = new Set([
    ...(err.fields ? Object.keys(err.fields) : []),
    ...((err.errors || []).map((e) => e.path).filter(Boolean)),
  ]);
  const message = String(err.message || err.parent?.message || '').toLowerCase();
  return fieldNames.some(
    (name) => fields.has(name) || message.includes(String(name).toLowerCase())
  );
}
