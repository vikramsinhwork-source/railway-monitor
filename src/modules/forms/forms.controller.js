import { Op, QueryTypes, UniqueConstraintError } from 'sequelize';
import ExcelJS from 'exceljs';
import sequelize from '../../config/sequelize.js';
import User from '../users/user.model.js';
import { toUserResponse } from '../users/userResponse.js';
import { Form, Question, Submission, Answer } from './index.js';
import { logInfo, logWarn, logError } from '../../utils/logger.js';

function isValidUuid(value) {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const STAFF_TYPES = ['ALP', 'LP', 'TM'];
const DUTY_TYPES = ['SIGN_ON', 'SIGN_OFF'];

function normalizeEnumValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function parseFormContext({ staffType, dutyType }, { source = 'query' } = {}) {
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

function parseQuestionPayload(body, { partial = false } = {}) {
  const updates = {};

  if (!partial || body.prompt !== undefined) {
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return { error: 'prompt is required and must be a non-empty string' };
    }
    updates.prompt = body.prompt.trim();
  }

  if (body.is_required !== undefined) {
    if (typeof body.is_required !== 'boolean') {
      return { error: 'is_required must be a boolean' };
    }
    updates.is_required = body.is_required;
  } else if (!partial) {
    updates.is_required = false;
  }

  if (body.sort_order !== undefined) {
    if (!Number.isInteger(body.sort_order) || body.sort_order < 0) {
      return { error: 'sort_order must be an integer greater than or equal to 0' };
    }
    updates.sort_order = body.sort_order;
  } else if (!partial) {
    updates.sort_order = 0;
  }

  if (partial && Object.keys(updates).length === 0) {
    return { error: 'No valid fields to update. Provide prompt, is_required, or sort_order.' };
  }

  return { updates };
}

function parseTemplatePayload(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return { error: 'title is required and must be a non-empty string' };
  }

  const { context, error } = parseFormContext(
    {
      staffType: body.staffType ?? body.staff_type,
      dutyType: body.dutyType ?? body.duty_type,
    },
    { source: 'body' }
  );
  if (error) {
    return { error };
  }

  const description = body.description == null ? null : String(body.description).trim() || null;
  return {
    payload: {
      title,
      description,
      staff_type: context.staffType,
      duty_type: context.dutyType,
      is_active: false,
    },
  };
}

async function getActiveForm() {
  return Form.findOne({ where: { is_active: true } });
}

async function getActiveFormByContext({ staffType, dutyType }) {
  return Form.findOne({
    where: {
      is_active: true,
      staff_type: staffType,
      duty_type: dutyType,
    },
  });
}

async function getOrCreateActiveForm() {
  const existing = await getActiveForm();
  if (existing) return existing;

  try {
    return await Form.create({
      title: 'Daily Questionnaire',
      description: 'Default daily questionnaire form',
      is_active: true,
    });
  } catch (err) {
    // Another request may have created the active form concurrently.
    if (err instanceof UniqueConstraintError) {
      const activeForm = await getActiveForm();
      if (activeForm) return activeForm;
    }
    throw err;
  }
}

function getTodayDateOnly() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parsePositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseDateOnly(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, mo, da] = trimmed.split('-').map((n) => Number.parseInt(n, 10));
  const parsed = new Date(y, mo - 1, da);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}

function parseSubmissionHistoryQuery(query) {
  const page = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, 20);
  if (!page || !limit) {
    return { error: { status: 400, message: 'page and limit must be positive integers' } };
  }
  if (limit > 100) {
    return { error: { status: 400, message: 'limit cannot exceed 100' } };
  }

  const fromDate = parseDateOnly(query.from_date);
  const toDate = parseDateOnly(query.to_date);
  if ((query.from_date !== undefined && !fromDate) || (query.to_date !== undefined && !toDate)) {
    return { error: { status: 400, message: 'from_date and to_date must be in YYYY-MM-DD format' } };
  }
  if (fromDate && toDate && fromDate > toDate) {
    return { error: { status: 400, message: 'from_date cannot be after to_date' } };
  }

  return { page, limit, fromDate, toDate };
}

function submissionHistoryWhere(userPk, fromDate, toDate) {
  const where = { user_id: userPk };
  if (fromDate && toDate) {
    where.submission_date = { [Op.between]: [fromDate, toDate] };
  } else if (fromDate) {
    where.submission_date = { [Op.gte]: fromDate };
  } else if (toDate) {
    where.submission_date = { [Op.lte]: toDate };
  }
  return where;
}

/** SQL `WHERE` fragment for `submissions` aliased as `s`, plus bound replacements (same semantics as list/history date filters). */
function submissionDateSqlForAliasS(fromDate, toDate) {
  if (fromDate && toDate) {
    return { clause: 's.submission_date BETWEEN :fromDate AND :toDate', replacements: { fromDate, toDate } };
  }
  if (fromDate) {
    return { clause: 's.submission_date >= :fromDate', replacements: { fromDate } };
  }
  if (toDate) {
    return { clause: 's.submission_date <= :toDate', replacements: { toDate } };
  }
  return { clause: 'TRUE', replacements: {} };
}

/**
 * Shared analytics export filters; mirrors listUsersSubmissionAnalytics / getSubmissionAnalyticsSummary
 * plus optional staffType + dutyType pair (both required when either is present).
 * @returns {{ error: { status: number, message: string } } | { fromDate: string|null, toDate: string|null, search: string, userStatus: string, formContext: { staffType: string, dutyType: string }|null }}
 */
function parseAnalyticsExportQuery(query) {
  const fromDate = parseDateOnly(query.from_date);
  const toDate = parseDateOnly(query.to_date);
  if (
    (query.from_date !== undefined && query.from_date !== null && query.from_date !== '' && !fromDate) ||
    (query.to_date !== undefined && query.to_date !== null && query.to_date !== '' && !toDate)
  ) {
    return { error: { status: 400, message: 'from_date and to_date must be in YYYY-MM-DD format' } };
  }
  if (fromDate && toDate && fromDate > toDate) {
    return { error: { status: 400, message: 'from_date cannot be after to_date' } };
  }

  const search = (query.search || query.q || '').toString().trim();
  const userStatus = (query.status || '').toString().trim().toUpperCase();
  if (userStatus && !['ACTIVE', 'INACTIVE'].includes(userStatus)) {
    return { error: { status: 400, message: 'status must be ACTIVE or INACTIVE' } };
  }

  let formContext = null;
  if (query.staffType !== undefined || query.dutyType !== undefined) {
    const parsed = parseFormContext(query, { source: 'query' });
    if (parsed.error) {
      return { error: { status: 400, message: parsed.error } };
    }
    formContext = parsed.context;
  }

  return { fromDate, toDate, search, userStatus, formContext };
}

function getFormsExportMaxRows() {
  const raw = process.env.FORMS_EXPORT_MAX_ROWS;
  if (raw === undefined || raw === '') return 50000;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 50000;
  if (n <= 0) return null;
  return n;
}

function sanitizeExportFilenamePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'all';
}

function formatExportFilenameTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}-${pad(x.getHours())}${pad(x.getMinutes())}${pad(x.getSeconds())}`;
}

const EXPORT_WORKBOOK_TITLE = 'Form submissions analytics export';

function buildExportFilename(fromDate, toDate, exportedAt) {
  let range = 'all';
  if (fromDate && toDate) range = `${fromDate}_to_${toDate}`;
  else if (fromDate) range = `from_${fromDate}`;
  else if (toDate) range = `to_${toDate}`;
  const ts = formatExportFilenameTimestamp(exportedAt);
  return `form-submissions-${sanitizeExportFilenamePart(range)}-${sanitizeExportFilenamePart(ts)}.xlsx`;
}

function mapSubmissionsToHistory(rows) {
  return rows.map((submission) => {
    const data = submission.get({ plain: true });
    const answers = (data.answers || []).map((answer) => ({
      id: answer.id,
      answer_text: answer.answer_text,
      created_at: answer.created_at,
      question: answer.question
        ? {
            id: answer.question.id,
            prompt: answer.question.prompt,
            is_required: answer.question.is_required,
            sort_order: answer.question.sort_order,
          }
        : null,
    }));

    return {
      id: data.id,
      submission_date: data.submission_date,
      created_at: data.created_at,
      updated_at: data.updated_at,
      answers,
    };
  });
}

async function fetchSubmissionHistoryPage(userPk, { page, limit, fromDate, toDate }) {
  const where = submissionHistoryWhere(userPk, fromDate, toDate);
  const offset = (page - 1) * limit;
  const { rows, count } = await Submission.findAndCountAll({
    where,
    include: [
      {
        model: Answer,
        as: 'answers',
        attributes: ['id', 'answer_text', 'created_at'],
        include: [
          {
            model: Question,
            as: 'question',
            attributes: ['id', 'prompt', 'is_required', 'sort_order'],
            paranoid: false,
          },
        ],
      },
    ],
    order: [
      ['submission_date', 'DESC'],
      ['created_at', 'DESC'],
      [{ model: Answer, as: 'answers' }, { model: Question, as: 'question' }, 'sort_order', 'ASC'],
      [{ model: Answer, as: 'answers' }, 'created_at', 'ASC'],
    ],
    limit,
    offset,
    distinct: true,
  });

  return {
    history: mapSubmissionsToHistory(rows),
    total: count,
  };
}

export async function createQuestion(req, res) {
  try {
    const activeForm = await getOrCreateActiveForm();

    const { updates, error } = parseQuestionPayload(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const question = await Question.create({
      form_id: activeForm.id,
      ...updates,
    });

    logInfo('Forms', 'Question created', {
      questionId: question.id,
      formId: activeForm.id,
      createdBy: req.auth.userId,
    });

    return res.status(201).json({
      success: true,
      question: question.get({ plain: true }),
    });
  } catch (err) {
    logWarn('Forms', 'Create question error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to create question' });
  }
}

export async function listQuestions(req, res) {
  try {
    const activeForm = await getActiveForm();
    if (!activeForm) {
      return res.json({ success: true, questions: [] });
    }

    const questions = await Question.findAll({
      where: { form_id: activeForm.id },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
    });

    return res.json({ success: true, questions });
  } catch (err) {
    logWarn('Forms', 'List questions error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to list questions' });
  }
}

export async function getQuestionById(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid question id' });
    }

    const question = await Question.findByPk(id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    return res.json({ success: true, question: question.get({ plain: true }) });
  } catch (err) {
    logWarn('Forms', 'Get question by ID error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to get question' });
  }
}

export async function updateQuestion(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid question id' });
    }

    const question = await Question.findByPk(id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    const { updates, error } = parseQuestionPayload(req.body, { partial: true });
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    await question.update(updates);

    logInfo('Forms', 'Question updated', {
      questionId: question.id,
      updatedBy: req.auth.userId,
    });

    return res.json({
      success: true,
      question: question.get({ plain: true }),
    });
  } catch (err) {
    logWarn('Forms', 'Update question error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to update question' });
  }
}

export async function deleteQuestion(req, res) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid question id' });
    }

    const question = await Question.findByPk(id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    await question.destroy();

    logInfo('Forms', 'Question soft-deleted', {
      questionId: question.id,
      deletedBy: req.auth.userId,
    });

    return res.json({
      success: true,
      message: 'Question deleted successfully',
    });
  } catch (err) {
    logWarn('Forms', 'Delete question error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to delete question' });
  }
}

export async function getTodayQuestions(req, res) {
  try {
    const { context, error } = parseFormContext(req.query, { source: 'query' });
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const activeForm = await getActiveFormByContext(context);
    if (!activeForm) {
      return res.status(404).json({
        success: false,
        message: `No active form found for staffType=${context.staffType} and dutyType=${context.dutyType}`,
      });
    }

    const questions = await Question.findAll({
      where: { form_id: activeForm.id },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
      attributes: ['id', 'prompt', 'is_required', 'sort_order'],
    });

    return res.json({
      success: true,
      form: {
        id: activeForm.id,
        title: activeForm.title,
        description: activeForm.description,
        staff_type: activeForm.staff_type,
        duty_type: activeForm.duty_type,
      },
      questions,
      submission_date: getTodayDateOnly(),
    });
  } catch (err) {
    const sqlDetail = err.parent?.message || err.original?.message;
    logError('Forms', 'Get today questions error', {
      error: err.message,
      ...(sqlDetail && sqlDetail !== err.message ? { sqlMessage: sqlDetail } : {}),
      userId: req.auth?.userId,
    });
    return res.status(500).json({ success: false, message: 'Failed to fetch today questions' });
  }
}

export async function submitTodayAnswers(req, res) {
  const tx = await sequelize.transaction();
  try {
    const userId = req.auth?.userId;
    const submissionDate = getTodayDateOnly();
    const { context, error } = parseFormContext(req.body, { source: 'body' });
    if (error) {
      await tx.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const payloadAnswers = req.body?.answers;

    if (!Array.isArray(payloadAnswers) || payloadAnswers.length === 0) {
      await tx.rollback();
      return res.status(400).json({ success: false, message: 'answers must be a non-empty array' });
    }

    const activeForm = await getActiveFormByContext(context);
    if (!activeForm) {
      await tx.rollback();
      return res.status(404).json({
        success: false,
        message: `No active form found for staffType=${context.staffType} and dutyType=${context.dutyType}`,
      });
    }

    const questions = await Question.findAll({
      where: { form_id: activeForm.id },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });

    if (questions.length === 0) {
      await tx.rollback();
      return res.status(400).json({ success: false, message: 'No active questions available for submission' });
    }

    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const seenQuestionIds = new Set();
    const normalizedAnswers = [];

    for (const [index, answer] of payloadAnswers.entries()) {
      if (!answer || typeof answer !== 'object') {
        await tx.rollback();
        return res.status(400).json({ success: false, message: `answers[${index}] must be an object` });
      }

      const questionId = answer.question_id;
      const answerText = typeof answer.answer_text === 'string' ? answer.answer_text.trim() : '';
      if (!isValidUuid(questionId)) {
        await tx.rollback();
        return res.status(400).json({ success: false, message: `answers[${index}].question_id must be a valid UUID` });
      }
      if (!answerText) {
        await tx.rollback();
        return res.status(400).json({ success: false, message: `answers[${index}].answer_text is required` });
      }
      if (!questionMap.has(questionId)) {
        await tx.rollback();
        return res.status(400).json({ success: false, message: `answers[${index}].question_id is not an active question` });
      }
      if (seenQuestionIds.has(questionId)) {
        await tx.rollback();
        return res.status(400).json({ success: false, message: `Duplicate answer for question ${questionId}` });
      }

      seenQuestionIds.add(questionId);
      normalizedAnswers.push({ question_id: questionId, answer_text: answerText });
    }

    const missingRequired = questions
      .filter((q) => q.is_required && !seenQuestionIds.has(q.id))
      .map((q) => q.id);
    if (missingRequired.length > 0) {
      await tx.rollback();
      return res.status(400).json({
        success: false,
        message: 'All required questions must be answered',
        missing_required_question_ids: missingRequired,
      });
    }

    const submission = await Submission.create(
      {
        user_id: userId,
        form_id: activeForm.id,
        submission_date: submissionDate,
      },
      { transaction: tx }
    );

    const answers = await Answer.bulkCreate(
      normalizedAnswers.map((answer) => ({
        submission_id: submission.id,
        question_id: answer.question_id,
        answer_text: answer.answer_text,
      })),
      { transaction: tx }
    );

    await tx.commit();

    logInfo('Forms', 'Today submission created', {
      userId,
      submissionId: submission.id,
      submissionDate,
      staffType: context.staffType,
      dutyType: context.dutyType,
      answerCount: answers.length,
    });

    return res.status(201).json({
      success: true,
      submission: submission.get({ plain: true }),
      answers,
    });
  } catch (err) {
    await tx.rollback();
    logWarn('Forms', 'Submit today answers error', { error: err.message, userId: req.auth?.userId });
    return res.status(500).json({ success: false, message: 'Failed to submit answers' });
  }
}

export async function getMyLatestSubmission(req, res) {
  try {
    const userId = req.auth?.userId;
    const latestSubmission = await Submission.findOne({
      where: { user_id: userId },
      include: [
        {
          model: Answer,
          as: 'answers',
          attributes: ['id', 'question_id', 'answer_text', 'created_at'],
          include: [
            {
              model: Question,
              as: 'question',
              attributes: ['id', 'prompt', 'is_required', 'sort_order'],
              paranoid: false,
            },
          ],
        },
      ],
      order: [
        ['submission_date', 'DESC'],
        ['created_at', 'DESC'],
        [{ model: Answer, as: 'answers' }, { model: Question, as: 'question' }, 'sort_order', 'ASC'],
        [{ model: Answer, as: 'answers' }, 'created_at', 'ASC'],
      ],
    });

    if (!latestSubmission) {
      return res.json({
        success: true,
        submission: null,
      });
    }

    return res.json({
      success: true,
      submission: latestSubmission.get({ plain: true }),
    });
  } catch (err) {
    logWarn('Forms', 'Get latest submission error', { error: err.message, userId: req.auth?.userId });
    return res.status(500).json({ success: false, message: 'Failed to fetch latest submission' });
  }
}

export async function listUsersSubmissionAnalytics(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 20);
    if (!page || !limit) {
      return res.status(400).json({
        success: false,
        message: 'page and limit must be positive integers',
      });
    }
    if (limit > 100) {
      return res.status(400).json({
        success: false,
        message: 'limit cannot exceed 100',
      });
    }

    const fromDate = parseDateOnly(req.query.from_date);
    const toDate = parseDateOnly(req.query.to_date);
    if ((req.query.from_date !== undefined && !fromDate) || (req.query.to_date !== undefined && !toDate)) {
      return res.status(400).json({
        success: false,
        message: 'from_date and to_date must be in YYYY-MM-DD format',
      });
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({
        success: false,
        message: 'from_date cannot be after to_date',
      });
    }

    const search = (req.query.search || req.query.q || '').toString().trim();
    const userStatus = (req.query.status || '').toString().trim().toUpperCase();
    if (userStatus && !['ACTIVE', 'INACTIVE'].includes(userStatus)) {
      return res.status(400).json({
        success: false,
        message: 'status must be ACTIVE or INACTIVE',
      });
    }

    const userWhere = { role: 'USER' };
    if (search) {
      const likeTerm = `%${search}%`;
      userWhere[Op.or] = [
        { user_id: { [Op.iLike]: likeTerm } },
        { name: { [Op.iLike]: likeTerm } },
        { email: { [Op.iLike]: likeTerm } },
      ];
    }
    if (userStatus) {
      userWhere.status = userStatus;
    }

    const submissionWhere = {};
    if (fromDate && toDate) {
      submissionWhere.submission_date = { [Op.between]: [fromDate, toDate] };
    } else if (fromDate) {
      submissionWhere.submission_date = { [Op.gte]: fromDate };
    } else if (toDate) {
      submissionWhere.submission_date = { [Op.lte]: toDate };
    }

    const offset = (page - 1) * limit;
    const { rows, count } = await User.findAndCountAll({
      where: userWhere,
      attributes: [
        'id',
        'user_id',
        'name',
        'email',
        'status',
        'created_at',
        'crew_type',
        'head_quarter',
        'mobile',
        'profile_image_key',
      ],
      include: [
        {
          model: Submission,
          as: 'submissions',
          required: false,
          where: Object.keys(submissionWhere).length ? submissionWhere : undefined,
          attributes: ['id', 'submission_date', 'created_at'],
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    const users = await Promise.all(
      rows.map(async (user) => {
        const userData = user.get({ plain: true });
        const submissions = Array.isArray(userData.submissions) ? userData.submissions : [];
        const submissionDates = submissions.map((submission) => submission.submission_date).filter(Boolean);
        const latestSubmissionDate = submissionDates.length ? submissionDates.sort().at(-1) : null;

        const publicUser = await toUserResponse(user);
        return {
          id: publicUser.id,
          user_id: publicUser.user_id,
          name: publicUser.name,
          email: publicUser.email,
          status: publicUser.status,
          crew_type: publicUser.crew_type,
          head_quarter: publicUser.head_quarter,
          mobile: publicUser.mobile,
          profile_image_url: publicUser.profile_image_url,
          submission_count: submissions.length,
          latest_submission_date: latestSubmissionDate,
        };
      })
    );

    return res.json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total: count,
        total_pages: Math.ceil(count / limit),
      },
      filters: {
        search: search || null,
        status: userStatus || null,
        from_date: fromDate,
        to_date: toDate,
      },
    });
  } catch (err) {
    logWarn('Forms', 'List users submission analytics error', {
      error: err.message,
      adminUserId: req.auth?.userId,
    });
    return res.status(500).json({ success: false, message: 'Failed to fetch users analytics' });
  }
}

export async function getSubmissionAnalyticsSummary(req, res) {
  try {
    const fromDate = parseDateOnly(req.query.from_date);
    const toDate = parseDateOnly(req.query.to_date);
    if ((req.query.from_date !== undefined && !fromDate) || (req.query.to_date !== undefined && !toDate)) {
      return res.status(400).json({
        success: false,
        message: 'from_date and to_date must be in YYYY-MM-DD format',
      });
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({
        success: false,
        message: 'from_date cannot be after to_date',
      });
    }

    const { clause: dateClause, replacements } = submissionDateSqlForAliasS(fromDate, toDate);

    const [
      totalsRows,
      byStaffDuty,
      submissionsByDate,
      byStaffDutyByDate,
      byForm,
      participationRows,
    ] = await Promise.all([
      sequelize.query(
        `
        SELECT
          COUNT(s.id)::integer AS submission_count,
          COUNT(DISTINCT s.user_id)::integer AS distinct_user_count,
          MIN(s.submission_date)::text AS first_submission_date,
          MAX(s.submission_date)::text AS last_submission_date
        FROM submissions s
        INNER JOIN forms f ON f.id = s.form_id
        WHERE ${dateClause}
        `,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `
        SELECT
          f.staff_type AS staff_type,
          f.duty_type AS duty_type,
          COUNT(s.id)::integer AS submission_count,
          COUNT(DISTINCT s.user_id)::integer AS distinct_user_count
        FROM submissions s
        INNER JOIN forms f ON f.id = s.form_id
        WHERE ${dateClause}
        GROUP BY f.staff_type, f.duty_type
        ORDER BY f.staff_type ASC, f.duty_type ASC
        `,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `
        SELECT
          s.submission_date::text AS submission_date,
          COUNT(s.id)::integer AS submission_count,
          COUNT(DISTINCT s.user_id)::integer AS distinct_user_count
        FROM submissions s
        INNER JOIN forms f ON f.id = s.form_id
        WHERE ${dateClause}
        GROUP BY s.submission_date
        ORDER BY s.submission_date ASC
        `,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `
        SELECT
          s.submission_date::text AS submission_date,
          f.staff_type AS staff_type,
          f.duty_type AS duty_type,
          COUNT(s.id)::integer AS submission_count,
          COUNT(DISTINCT s.user_id)::integer AS distinct_user_count
        FROM submissions s
        INNER JOIN forms f ON f.id = s.form_id
        WHERE ${dateClause}
        GROUP BY s.submission_date, f.staff_type, f.duty_type
        ORDER BY s.submission_date ASC, f.staff_type ASC, f.duty_type ASC
        `,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `
        SELECT
          f.id::text AS form_id,
          f.title AS title,
          f.staff_type AS staff_type,
          f.duty_type AS duty_type,
          f.is_active AS is_active,
          COUNT(s.id)::integer AS submission_count,
          COUNT(DISTINCT s.user_id)::integer AS distinct_user_count
        FROM submissions s
        INNER JOIN forms f ON f.id = s.form_id
        WHERE ${dateClause}
        GROUP BY f.id, f.title, f.staff_type, f.duty_type, f.is_active
        ORDER BY f.staff_type ASC, f.duty_type ASC, f.title ASC
        `,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `
        SELECT
          (
            SELECT COUNT(*)::integer
            FROM users u
            WHERE u.role = 'USER' AND u.status = 'ACTIVE'
          ) AS active_roster_user_count,
          (
            SELECT COUNT(DISTINCT s2.user_id)::integer
            FROM submissions s2
            INNER JOIN users u2 ON u2.id = s2.user_id
            WHERE ${dateClause.replace(/s\./g, 's2.')}
              AND u2.role = 'USER'
              AND u2.status = 'ACTIVE'
          ) AS active_users_with_submission_count
        `,
        { replacements, type: QueryTypes.SELECT }
      ),
    ]);

    const totalsRow = totalsRows[0];
    const participationRow = participationRows[0];

    const totals = {
      submission_count: totalsRow?.submission_count ?? 0,
      distinct_user_count: totalsRow?.distinct_user_count ?? 0,
    };

    const roster = participationRow?.active_roster_user_count ?? 0;
    const activeSubmitters = participationRow?.active_users_with_submission_count ?? 0;
    const participation_rate =
      roster > 0 ? Math.round((activeSubmitters / roster) * 10000) / 10000 : null;
    const participation_percent =
      roster > 0 ? Math.round((activeSubmitters / roster) * 10000) / 100 : null;

    return res.json({
      success: true,
      filters: {
        from_date: fromDate,
        to_date: toDate,
      },
      meta: {
        first_submission_date: totalsRow?.first_submission_date ?? null,
        last_submission_date: totalsRow?.last_submission_date ?? null,
        days_with_submissions: submissionsByDate.length,
      },
      totals,
      by_staff_duty: byStaffDuty.map((row) => ({
        staff_type: row.staff_type,
        duty_type: row.duty_type,
        submission_count: row.submission_count,
        distinct_user_count: row.distinct_user_count,
      })),
      submissions_by_date: submissionsByDate.map((row) => ({
        submission_date: row.submission_date,
        submission_count: row.submission_count,
        distinct_user_count: row.distinct_user_count,
      })),
      by_staff_duty_by_date: byStaffDutyByDate.map((row) => ({
        submission_date: row.submission_date,
        staff_type: row.staff_type,
        duty_type: row.duty_type,
        submission_count: row.submission_count,
        distinct_user_count: row.distinct_user_count,
      })),
      by_form: byForm.map((row) => ({
        form_id: row.form_id,
        title: row.title,
        staff_type: row.staff_type,
        duty_type: row.duty_type,
        is_active: row.is_active,
        submission_count: row.submission_count,
        distinct_user_count: row.distinct_user_count,
      })),
      participation: {
        active_roster_user_count: roster,
        active_users_with_submission_count: activeSubmitters,
        participation_rate,
        participation_percent,
      },
    });
  } catch (err) {
    logWarn('Forms', 'Submission analytics summary error', {
      error: err.message,
      adminUserId: req.auth?.userId,
    });
    return res.status(500).json({ success: false, message: 'Failed to fetch submission analytics summary' });
  }
}

function makeStaffDutyKey(staffType, dutyType) {
  return `${staffType}__${dutyType}`;
}

function buildStaffDutyExportConfigs(formContext) {
  const dutyDisplay = {
    SIGN_ON: 'SIGN ON',
    SIGN_OFF: 'SIGN OFF',
  };
  const configs = [];
  for (const dutyType of DUTY_TYPES) {
    for (const staffType of STAFF_TYPES) {
      if (formContext && (formContext.staffType !== staffType || formContext.dutyType !== dutyType)) continue;
      configs.push({
        staffType,
        dutyType,
        key: makeStaffDutyKey(staffType, dutyType),
        sheetName: `${dutyDisplay[dutyType] || dutyType} ${staffType}`,
      });
    }
  }
  return configs;
}

function formatCellDate(value) {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return value === '' ? '' : String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function exportSubmissionAnalyticsXlsx(req, res) {
  try {
    const parsed = parseAnalyticsExportQuery(req.query);
    if (parsed.error) {
      return res.status(parsed.error.status).json({ success: false, message: parsed.error.message });
    }
    const { fromDate, toDate, search, userStatus, formContext } = parsed;

    const { clause: dateClause, replacements: dateReplacements } = submissionDateSqlForAliasS(fromDate, toDate);
    const formStaffDutyClause = formContext
      ? 'AND f.staff_type = :staffType AND f.duty_type = :dutyType'
      : '';
    const formReplacements = formContext
      ? { staffType: formContext.staffType, dutyType: formContext.dutyType }
      : {};

    let userSearchClause = '';
    const userSearchReplacements = {};
    if (search) {
      userSearchClause =
        'AND (u.user_id ILIKE :searchLike OR u.name ILIKE :searchLike OR u.email ILIKE :searchLike)';
      userSearchReplacements.searchLike = `%${search}%`;
    }

    let userStatusClause = '';
    const userStatusReplacements = {};
    if (userStatus) {
      userStatusClause = 'AND u.status = :userStatus';
      userStatusReplacements.userStatus = userStatus;
    }

    const baseReplacements = {
      ...dateReplacements,
      ...formReplacements,
      ...userSearchReplacements,
      ...userStatusReplacements,
    };

    const fillsCountSql = `
      SELECT COUNT(DISTINCT s.id)::integer AS submission_row_count
      FROM submissions s
      INNER JOIN users u ON u.id = s.user_id AND u.role = 'USER'
      INNER JOIN forms f ON f.id = s.form_id
      WHERE ${dateClause}
      ${formStaffDutyClause}
      ${userSearchClause}
      ${userStatusClause}
    `;

    const fillsSql = `
      SELECT
        s.id::text AS submission_id,
        u.id::text AS id,
        u.user_id,
        u.name,
        u.email,
        u.status,
        u.crew_type,
        u.head_quarter,
        u.mobile,
        u.created_at AS user_created_at,
        s.submission_date::text AS submission_date,
        s.created_at AS submission_created_at,
        f.title AS form_title,
        f.staff_type,
        f.duty_type,
        q.sort_order AS question_sort_order,
        q.prompt AS question_prompt,
        a.answer_text,
        a.created_at AS answer_created_at
      FROM submissions s
      INNER JOIN users u ON u.id = s.user_id AND u.role = 'USER'
      INNER JOIN forms f ON f.id = s.form_id
      LEFT JOIN answers a ON a.submission_id = s.id
      LEFT JOIN questions q ON q.id = a.question_id
      WHERE ${dateClause}
      ${formStaffDutyClause}
      ${userSearchClause}
      ${userStatusClause}
      ORDER BY u.user_id ASC, s.submission_date DESC, s.created_at DESC, q.sort_order ASC NULLS LAST
    `;

    const templateQuestionsSql = `
      SELECT
        f.staff_type,
        f.duty_type,
        q.prompt,
        q.sort_order
      FROM forms f
      INNER JOIN questions q ON q.form_id = f.id
      WHERE f.is_active = TRUE
      ${formStaffDutyClause}
      ORDER BY f.staff_type ASC, f.duty_type ASC, q.sort_order ASC, q.created_at ASC
    `;

    const maxRows = getFormsExportMaxRows();
    if (maxRows != null) {
      const [countRow] = await sequelize.query(fillsCountSql, {
        replacements: baseReplacements,
        type: QueryTypes.SELECT,
      });
      const submissionRowCount = countRow?.submission_row_count ?? 0;
      if (submissionRowCount > maxRows) {
        return res.status(400).json({
          success: false,
          message: `Export would exceed ${maxRows} rows (${submissionRowCount}). Narrow the date range or filters and try again.`,
        });
      }
    }

    const [fillRows, templateQuestionRows] = await Promise.all([
      sequelize.query(fillsSql, { replacements: baseReplacements, type: QueryTypes.SELECT }),
      sequelize.query(templateQuestionsSql, { replacements: baseReplacements, type: QueryTypes.SELECT }),
    ]);

    const exportedAt = new Date();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Kiosk Monitor - Forms analytics';
    workbook.lastModifiedBy = 'Kiosk Monitor - Forms analytics';
    workbook.title = EXPORT_WORKBOOK_TITLE;
    workbook.subject = 'Roster users and per-answer submission export';
    workbook.created = exportedAt;
    workbook.modified = exportedAt;

    const exportInfoSheet = workbook.addWorksheet('Export info', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    exportInfoSheet.columns = [
      { header: 'field', key: 'field', width: 30 },
      { header: 'value', key: 'value', width: 56 },
    ];
    exportInfoSheet.getRow(1).font = { bold: true };
    for (const row of [
      { field: 'export_generated_at', value: formatCellDate(exportedAt) },
      { field: 'workbook_title', value: EXPORT_WORKBOOK_TITLE },
      { field: 'filter_from_date', value: fromDate || '' },
      { field: 'filter_to_date', value: toDate || '' },
      { field: 'filter_search', value: search || '' },
      { field: 'filter_status', value: userStatus || '' },
      { field: 'filter_staff_type', value: formContext?.staffType || '' },
      { field: 'filter_duty_type', value: formContext?.dutyType || '' },
    ]) {
      exportInfoSheet.addRow(row);
    }

    const staffDutyConfigs = buildStaffDutyExportConfigs(formContext);
    const questionsByStaffDuty = new Map();
    for (const row of templateQuestionRows) {
      const key = makeStaffDutyKey(row.staff_type, row.duty_type);
      if (!questionsByStaffDuty.has(key)) {
        questionsByStaffDuty.set(key, []);
      }
      questionsByStaffDuty.get(key).push({
        prompt: row.prompt,
        sort_order: row.sort_order,
      });
    }

    const groupedSubmissions = new Map();
    for (const row of fillRows) {
      const staffDutyKey = makeStaffDutyKey(row.staff_type, row.duty_type);
      if (!groupedSubmissions.has(staffDutyKey)) groupedSubmissions.set(staffDutyKey, new Map());
      const submissionMap = groupedSubmissions.get(staffDutyKey);
      if (!submissionMap.has(row.submission_id)) {
        submissionMap.set(row.submission_id, {
          submission_id: row.submission_id,
          user_id: row.user_id,
          name: row.name,
          staff_type: row.staff_type,
          duty_type: row.duty_type,
          submission_date: row.submission_date,
          submission_created_at: row.submission_created_at,
          answers: new Map(),
        });
      }
      if (row.question_prompt) {
        submissionMap.get(row.submission_id).answers.set(row.question_prompt, row.answer_text ?? '');
      }
    }

    for (const config of staffDutyConfigs) {
      const sheet = workbook.addWorksheet(config.sheetName, {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      const configuredQuestions = questionsByStaffDuty.get(config.key) || [];
      const fallbackPromptOrder = new Map();
      const sheetSubmissionMap = groupedSubmissions.get(config.key) || new Map();
      for (const submission of sheetSubmissionMap.values()) {
        for (const prompt of submission.answers.keys()) {
          if (!fallbackPromptOrder.has(prompt)) {
            fallbackPromptOrder.set(prompt, fallbackPromptOrder.size);
          }
        }
      }

      const dynamicQuestions = [];
      const seenPrompts = new Set();
      for (const q of configuredQuestions) {
        if (seenPrompts.has(q.prompt)) continue;
        seenPrompts.add(q.prompt);
        dynamicQuestions.push(q.prompt);
      }
      for (const prompt of fallbackPromptOrder.keys()) {
        if (seenPrompts.has(prompt)) continue;
        seenPrompts.add(prompt);
        dynamicQuestions.push(prompt);
      }

      const dynamicColumns = dynamicQuestions.map((prompt, idx) => ({
        header: prompt,
        key: `q_${idx + 1}`,
        width: Math.max(20, Math.min(56, String(prompt).length + 6)),
      }));
      sheet.columns = dynamicColumns;
      sheet.getRow(1).font = { bold: true };

      const rows = Array.from(sheetSubmissionMap.values()).sort((a, b) => {
        const aDate = a.submission_created_at ? new Date(a.submission_created_at).getTime() : 0;
        const bDate = b.submission_created_at ? new Date(b.submission_created_at).getTime() : 0;
        return bDate - aDate;
      });

      rows.forEach((submission) => {
        const rowData = {};
        dynamicQuestions.forEach((prompt, promptIdx) => {
          rowData[`q_${promptIdx + 1}`] = submission.answers.get(prompt) || '';
        });
        sheet.addRow(rowData);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = buildExportFilename(fromDate, toDate, exportedAt);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    logWarn('Forms', 'Export submission analytics XLSX error', {
      error: err.message,
      adminUserId: req.auth?.userId,
    });
    return res.status(500).json({ success: false, message: 'Failed to export submission analytics' });
  }
}

export async function getMySubmissionHistory(req, res) {
  try {
    const parsed = parseSubmissionHistoryQuery(req.query);
    if (parsed.error) {
      return res.status(parsed.error.status).json({ success: false, message: parsed.error.message });
    }
    const { page, limit, fromDate, toDate } = parsed;

    const user = await User.findByPk(req.auth.userId, {
      attributes: [
        'id',
        'user_id',
        'name',
        'email',
        'status',
        'crew_type',
        'head_quarter',
        'mobile',
        'profile_image_key',
      ],
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { history, total } = await fetchSubmissionHistoryPage(user.id, { page, limit, fromDate, toDate });

    return res.json({
      success: true,
      user: await toUserResponse(user),
      history,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
      filters: {
        from_date: fromDate,
        to_date: toDate,
      },
    });
  } catch (err) {
    logWarn('Forms', 'Get my submission history error', { error: err.message, userId: req.auth?.userId });
    return res.status(500).json({ success: false, message: 'Failed to fetch submission history' });
  }
}

export async function getUserSubmissionHistory(req, res) {
  try {
    const { userId } = req.params;

    const parsed = parseSubmissionHistoryQuery(req.query);
    if (parsed.error) {
      return res.status(parsed.error.status).json({ success: false, message: parsed.error.message });
    }
    const { page, limit, fromDate, toDate } = parsed;

    const userWhere = { role: 'USER' };
    if (isValidUuid(userId)) {
      userWhere.id = userId;
    } else {
      userWhere.user_id = userId;
    }

    const user = await User.findOne({
      where: userWhere,
      attributes: [
        'id',
        'user_id',
        'name',
        'email',
        'status',
        'crew_type',
        'head_quarter',
        'mobile',
        'profile_image_key',
      ],
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { history, total } = await fetchSubmissionHistoryPage(user.id, { page, limit, fromDate, toDate });

    return res.json({
      success: true,
      user: await toUserResponse(user),
      history,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
      filters: {
        from_date: fromDate,
        to_date: toDate,
      },
    });
  } catch (err) {
    logWarn('Forms', 'Get user submission history error', {
      error: err.message,
      targetUserId: req.params?.userId,
      adminUserId: req.auth?.userId,
    });
    return res.status(500).json({ success: false, message: 'Failed to fetch user history' });
  }
}

export async function createTemplate(req, res) {
  try {
    const { payload, error } = parseTemplatePayload(req.body || {});
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const template = await Form.create(payload);
    logInfo('Forms', 'Template created', {
      templateId: template.id,
      staffType: template.staff_type,
      dutyType: template.duty_type,
      createdBy: req.auth.userId,
    });

    return res.status(201).json({ success: true, template: template.get({ plain: true }) });
  } catch (err) {
    logWarn('Forms', 'Create template error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to create template' });
  }
}

export async function listTemplates(req, res) {
  try {
    const where = {};
    if (req.query.staffType !== undefined || req.query.dutyType !== undefined) {
      const { context, error } = parseFormContext(req.query, { source: 'query' });
      if (error) {
        return res.status(400).json({ success: false, message: error });
      }
      where.staff_type = context.staffType;
      where.duty_type = context.dutyType;
    }

    if (req.query.isActive !== undefined) {
      const value = String(req.query.isActive).trim().toLowerCase();
      if (!['true', 'false'].includes(value)) {
        return res.status(400).json({ success: false, message: 'query.isActive must be true or false' });
      }
      where.is_active = value === 'true';
    }

    const templates = await Form.findAll({
      where,
      include: [
        {
          model: Question,
          as: 'questions',
          attributes: ['id'],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    return res.json({
      success: true,
      templates: templates.map((template) => {
        const plain = template.get({ plain: true });
        return {
          ...plain,
          question_count: Array.isArray(plain.questions) ? plain.questions.length : 0,
        };
      }),
    });
  } catch (err) {
    logWarn('Forms', 'List templates error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to list templates' });
  }
}

export async function publishTemplate(req, res) {
  const tx = await sequelize.transaction();
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) {
      await tx.rollback();
      return res.status(400).json({ success: false, message: 'Invalid template id' });
    }

    const template = await Form.findByPk(id, { transaction: tx, lock: tx.LOCK.UPDATE });
    if (!template) {
      await tx.rollback();
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    await Form.update(
      { is_active: false },
      {
        where: {
          staff_type: template.staff_type,
          duty_type: template.duty_type,
          id: { [Op.ne]: template.id },
        },
        transaction: tx,
      }
    );

    await template.update({ is_active: true }, { transaction: tx });
    await tx.commit();

    logInfo('Forms', 'Template published', {
      templateId: template.id,
      staffType: template.staff_type,
      dutyType: template.duty_type,
      publishedBy: req.auth.userId,
    });

    return res.json({ success: true, template: template.get({ plain: true }) });
  } catch (err) {
    await tx.rollback();
    logWarn('Forms', 'Publish template error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to publish template' });
  }
}

async function getTemplateById(templateId) {
  if (!isValidUuid(templateId)) {
    return { error: { status: 400, message: 'Invalid template id' } };
  }
  const template = await Form.findByPk(templateId);
  if (!template) {
    return { error: { status: 404, message: 'Template not found' } };
  }
  return { template };
}

async function getTemplateQuestion(templateId, questionId) {
  const { template, error: templateError } = await getTemplateById(templateId);
  if (templateError) return { error: templateError };
  if (!isValidUuid(questionId)) {
    return { error: { status: 400, message: 'Invalid question id' } };
  }

  const question = await Question.findOne({ where: { id: questionId, form_id: template.id } });
  if (!question) {
    return { error: { status: 404, message: 'Question not found for template' } };
  }
  return { template, question };
}

export async function createTemplateQuestion(req, res) {
  try {
    const { template, error } = await getTemplateById(req.params.templateId);
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const { updates, error: payloadError } = parseQuestionPayload(req.body || {});
    if (payloadError) {
      return res.status(400).json({ success: false, message: payloadError });
    }

    const question = await Question.create({ ...updates, form_id: template.id });
    return res.status(201).json({ success: true, question: question.get({ plain: true }) });
  } catch (err) {
    logWarn('Forms', 'Create template question error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to create template question' });
  }
}

export async function listTemplateQuestions(req, res) {
  try {
    const { template, error } = await getTemplateById(req.params.templateId);
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const questions = await Question.findAll({
      where: { form_id: template.id },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
    });

    return res.json({ success: true, questions });
  } catch (err) {
    logWarn('Forms', 'List template questions error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to list template questions' });
  }
}

export async function updateTemplateQuestion(req, res) {
  try {
    const { question, error } = await getTemplateQuestion(req.params.templateId, req.params.questionId);
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const { updates, error: payloadError } = parseQuestionPayload(req.body || {}, { partial: true });
    if (payloadError) {
      return res.status(400).json({ success: false, message: payloadError });
    }

    await question.update(updates);
    return res.json({ success: true, question: question.get({ plain: true }) });
  } catch (err) {
    logWarn('Forms', 'Update template question error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to update template question' });
  }
}

export async function deleteTemplateQuestion(req, res) {
  try {
    const { question, error } = await getTemplateQuestion(req.params.templateId, req.params.questionId);
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    await question.destroy();
    return res.json({ success: true, message: 'Question deleted successfully' });
  } catch (err) {
    logWarn('Forms', 'Delete template question error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to delete template question' });
  }
}
