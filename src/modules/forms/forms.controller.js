import { Op, UniqueConstraintError } from 'sequelize';
import sequelize from '../../config/sequelize.js';
import User from '../users/user.model.js';
import { toUserResponse } from '../users/userResponse.js';
import { Form, Question, Submission, Answer } from './index.js';
import { logInfo, logWarn } from '../../utils/logger.js';

function isValidUuid(value) {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

async function getActiveForm() {
  return Form.findOne({ where: { is_active: true } });
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
  return new Date().toISOString().slice(0, 10);
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
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
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
    const activeForm = await getActiveForm();
    if (!activeForm) {
      return res.json({ success: true, questions: [] });
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
      },
      questions,
      submission_date: getTodayDateOnly(),
    });
  } catch (err) {
    logWarn('Forms', 'Get today questions error', { error: err.message, userId: req.auth?.userId });
    return res.status(500).json({ success: false, message: 'Failed to fetch today questions' });
  }
}

export async function submitTodayAnswers(req, res) {
  const tx = await sequelize.transaction();
  try {
    const userId = req.auth?.userId;
    const submissionDate = getTodayDateOnly();
    const payloadAnswers = req.body?.answers;

    if (!Array.isArray(payloadAnswers) || payloadAnswers.length === 0) {
      await tx.rollback();
      return res.status(400).json({ success: false, message: 'answers must be a non-empty array' });
    }

    const activeForm = await getActiveForm();
    if (!activeForm) {
      await tx.rollback();
      return res.status(404).json({ success: false, message: 'No active form found for today' });
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
