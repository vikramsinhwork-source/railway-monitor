import sequelize from '../../config/sequelize.js';
import { logInfo, logWarn, logError } from '../../utils/logger.js';
import { parseFormContext } from '../forms/formSubmission.service.js';
import {
  parseRespondent,
  parseIdempotencyKey,
  getPublicContexts,
  getCurrentPublicForm,
  submitPublicForm,
} from './publicForm.service.js';

export async function listContexts(req, res) {
  try {
    const contexts = await getPublicContexts();
    return res.json({
      success: true,
      contexts,
      submission_date: new Date().toISOString().slice(0, 10),
    });
  } catch (err) {
    logError('PublicForms', 'List contexts error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to load form contexts' });
  }
}

export async function getCurrentForm(req, res) {
  try {
    const { context, error } = parseFormContext(req.query, { source: 'query' });
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const result = await getCurrentPublicForm(context);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    return res.json({
      success: true,
      ...result.data,
    });
  } catch (err) {
    logError('PublicForms', 'Get current form error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to fetch public form' });
  }
}

export async function submitForm(req, res) {
  try {
    const { context, error: contextError } = parseFormContext(req.body, { source: 'body' });
    if (contextError) {
      return res.status(400).json({ success: false, message: contextError });
    }

    const { respondent, error: respondentError } = parseRespondent(req.body?.respondent);
    if (respondentError) {
      return res.status(400).json({ success: false, message: respondentError });
    }

    const { idempotencyKey, error: keyError } = parseIdempotencyKey(
      req.body?.idempotency_key ?? req.body?.idempotencyKey
    );
    if (keyError) {
      return res.status(400).json({ success: false, message: keyError });
    }

    const result = await submitPublicForm(
      {
        context,
        respondent,
        idempotencyKey,
        answers: req.body?.answers,
      },
      sequelize
    );

    if (result.error) {
      const payload = {
        success: false,
        message: result.error.message,
      };
      if (result.error.code) payload.code = result.error.code;
      if (result.error.missing_required_question_ids) {
        payload.missing_required_question_ids = result.error.missing_required_question_ids;
      }
      return res.status(result.error.status).json(payload);
    }

    logInfo('PublicForms', 'Public submission created', {
      submissionId: result.data.submission_id,
      staffType: result.data.staff_type,
      dutyType: result.data.duty_type,
      userCreated: result.data.user_created,
      idempotentReplay: result.data.idempotent_replay,
    });

    const status = result.data.idempotent_replay ? 200 : 201;
    return res.status(status).json({
      success: true,
      ...result.data,
    });
  } catch (err) {
    logWarn('PublicForms', 'Submit public form error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to submit public form' });
  }
}
