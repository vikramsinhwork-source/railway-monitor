import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { UniqueConstraintError } from 'sequelize';
import User from '../users/user.model.js';
import { Submission } from '../forms/index.js';
import {
  getActiveFormByContext,
  loadOrderedFormQuestions,
  listActiveFormContexts,
  toPublicFormPayload,
  validateAndNormalizeAnswers,
  createSubmissionWithAnswers,
  getTodayDateOnly,
  isValidUuid,
  uniqueConstraintTouches,
} from '../forms/formSubmission.service.js';

export const PUBLIC_FORM_COMMON_PASSWORD = '12345678';
export const PUBLIC_FORM_ACCOUNT_ORIGIN = 'PUBLIC_FORM';
export const MAX_SIGNATURE_ANSWER_LENGTH = 250_000;

function trimString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function normalizePublicUserId(value) {
  return trimString(value).toUpperCase();
}

export function normalizePublicMobile(value) {
  if (typeof value !== 'string') return '';
  const compact = value.trim().replace(/[\s()-]/g, '');
  return compact;
}

export function parseRespondent(respondent) {
  if (!respondent || typeof respondent !== 'object' || Array.isArray(respondent)) {
    return { error: 'respondent is required and must be an object' };
  }

  const userId = normalizePublicUserId(respondent.user_id ?? respondent.userId);
  const name = trimString(respondent.name);
  const mobile = normalizePublicMobile(respondent.mobile);

  if (!userId) {
    return { error: 'respondent.user_id is required' };
  }
  if (userId.length > 100) {
    return { error: 'respondent.user_id must be at most 100 characters' };
  }
  if (!name || name.length < 2) {
    return { error: 'respondent.name must be at least 2 characters' };
  }
  if (name.length > 150) {
    return { error: 'respondent.name must be at most 150 characters' };
  }
  if (!mobile || mobile.length < 7 || mobile.length > 20) {
    return { error: 'respondent.mobile must be 7–20 characters after normalization' };
  }
  if (!/^\+?[0-9]+$/.test(mobile)) {
    return { error: 'respondent.mobile must contain only digits and an optional leading +' };
  }

  return {
    respondent: {
      user_id: userId,
      name,
      mobile,
    },
  };
}

export function parseIdempotencyKey(value) {
  if (value == null || value === '') {
    return { error: 'idempotency_key is required' };
  }
  if (!isValidUuid(String(value))) {
    return { error: 'idempotency_key must be a valid UUID' };
  }
  return { idempotencyKey: String(value).toLowerCase() };
}

function generatePublicEmail() {
  return `public-${randomUUID()}@public-form.invalid`;
}

/**
 * Find an existing user by business user_id or create a PUBLIC_FORM account.
 * Runs inside the caller's transaction.
 */
export async function findOrCreatePublicUser(respondent, transaction) {
  const existing = await User.scope(null).findOne({
    where: { user_id: respondent.user_id },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (existing) {
    if (existing.account_origin === PUBLIC_FORM_ACCOUNT_ORIGIN) {
      let dirty = false;
      if (respondent.name && existing.name !== respondent.name) {
        existing.name = respondent.name;
        dirty = true;
      }
      if (respondent.mobile && existing.mobile !== respondent.mobile) {
        existing.mobile = respondent.mobile;
        dirty = true;
      }
      if (dirty) {
        await existing.save({ transaction });
      }
    }
    return { user: existing, created: false };
  }

  const password_hash = await bcrypt.hash(PUBLIC_FORM_COMMON_PASSWORD, 10);

  try {
    const user = await User.create(
      {
        user_id: respondent.user_id,
        name: respondent.name,
        email: generatePublicEmail(),
        password_hash,
        role: 'USER',
        status: 'ACTIVE',
        mobile: respondent.mobile,
        account_origin: PUBLIC_FORM_ACCOUNT_ORIGIN,
        created_by: null,
        approved_at: new Date(),
      },
      { transaction }
    );
    return { user, created: true };
  } catch (err) {
    if (err instanceof UniqueConstraintError || uniqueConstraintTouches(err, ['user_id'])) {
      const winner = await User.scope(null).findOne({
        where: { user_id: respondent.user_id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (winner) {
        return { user: winner, created: false };
      }
    }
    throw err;
  }
}

export async function getPublicContexts() {
  return listActiveFormContexts();
}

export async function getCurrentPublicForm({ staffType, dutyType }) {
  const activeForm = await getActiveFormByContext({ staffType, dutyType });
  if (!activeForm) {
    return {
      error: {
        status: 404,
        message: `No active form found for staffType=${staffType} and dutyType=${dutyType}`,
      },
    };
  }

  const questions = await loadOrderedFormQuestions(activeForm.id);
  return {
    data: toPublicFormPayload(activeForm, questions, getTodayDateOnly()),
  };
}

function answersExceedSignatureLimit(answers) {
  if (!Array.isArray(answers)) return false;
  return answers.some((answer) => {
    const text = typeof answer?.answer_text === 'string' ? answer.answer_text : '';
    return text.length > MAX_SIGNATURE_ANSWER_LENGTH;
  });
}

/**
 * Submit a public form: find/create user, enforce daily uniqueness & idempotency.
 */
export async function submitPublicForm(
  {
    context,
    respondent,
    idempotencyKey,
    answers: payloadAnswers,
  },
  sequelize
) {
  if (answersExceedSignatureLimit(payloadAnswers)) {
    return {
      error: {
        status: 400,
        message: `One or more answers exceed the maximum length of ${MAX_SIGNATURE_ANSWER_LENGTH} characters`,
      },
    };
  }

  const submissionDate = getTodayDateOnly();
  const tx = await sequelize.transaction();

  try {
    const existingByKey = await Submission.findOne({
      where: { idempotency_key: idempotencyKey },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (existingByKey) {
      await tx.commit();
      return {
        data: {
          submission_id: existingByKey.id,
          submission_date: existingByKey.submission_date,
          staff_type: existingByKey.staff_type,
          duty_type: existingByKey.duty_type,
          form_id: existingByKey.form_id,
          user_created: false,
          idempotent_replay: true,
          message: 'Submission already recorded for this idempotency key',
        },
      };
    }

    const activeForm = await getActiveFormByContext(context, { transaction: tx });
    if (!activeForm) {
      await tx.rollback();
      return {
        error: {
          status: 404,
          message: `No active form found for staffType=${context.staffType} and dutyType=${context.dutyType}`,
        },
      };
    }

    const questions = await loadOrderedFormQuestions(activeForm.id, {
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });

    const validated = validateAndNormalizeAnswers(payloadAnswers, questions);
    if (validated.error) {
      await tx.rollback();
      return { error: validated.error };
    }

    const { user, created: userCreated } = await findOrCreatePublicUser(respondent, tx);

    const duplicateToday = await Submission.findOne({
      where: {
        user_id: user.id,
        staff_type: context.staffType,
        duty_type: context.dutyType,
        submission_date: submissionDate,
        submission_source: 'PUBLIC',
      },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (duplicateToday) {
      await tx.rollback();
      return {
        error: {
          status: 409,
          message: 'Already submitted today for this staff type and duty type',
          code: 'ALREADY_SUBMITTED_TODAY',
        },
      };
    }

    let submission;
    let answers;
    try {
      ({ submission, answers } = await createSubmissionWithAnswers(
        {
          userId: user.id,
          formId: activeForm.id,
          submissionDate,
          staffType: context.staffType,
          dutyType: context.dutyType,
          submissionSource: 'PUBLIC',
          idempotencyKey,
          normalizedAnswers: validated.normalizedAnswers,
        },
        tx
      ));
    } catch (err) {
      if (uniqueConstraintTouches(err, ['idempotency_key'])) {
        const replay = await Submission.findOne({
          where: { idempotency_key: idempotencyKey },
          transaction: tx,
        });
        await tx.commit();
        if (replay) {
          return {
            data: {
              submission_id: replay.id,
              submission_date: replay.submission_date,
              staff_type: replay.staff_type,
              duty_type: replay.duty_type,
              form_id: replay.form_id,
              user_created: false,
              idempotent_replay: true,
              message: 'Submission already recorded for this idempotency key',
            },
          };
        }
      }
      if (
        uniqueConstraintTouches(err, ['user_id', 'staff_type', 'duty_type', 'submission_date']) ||
        String(err.message || err.parent?.message || '')
          .toLowerCase()
          .includes('submissions_public_daily_unique_idx')
      ) {
        await tx.rollback();
        return {
          error: {
            status: 409,
            message: 'Already submitted today for this staff type and duty type',
            code: 'ALREADY_SUBMITTED_TODAY',
          },
        };
      }
      throw err;
    }

    await tx.commit();

    return {
      data: {
        submission_id: submission.id,
        submission_date: submission.submission_date,
        staff_type: context.staffType,
        duty_type: context.dutyType,
        form: {
          id: activeForm.id,
          title: activeForm.title,
          staff_type: activeForm.staff_type,
          duty_type: activeForm.duty_type,
        },
        user: {
          id: user.id,
          user_id: user.user_id,
          name: user.name,
          created: userCreated,
        },
        answer_count: answers.length,
        user_created: userCreated,
        idempotent_replay: false,
        message: 'Form submitted successfully',
      },
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // already committed/rolled back
    }
    throw err;
  }
}
