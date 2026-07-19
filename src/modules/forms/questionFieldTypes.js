import { QUESTION_FIELD_TYPES } from './question.model.js';

const KEY_REGEX = /^[a-z][a-z0-9_]{0,79}$/;

export function normalizeQuestionKey(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

export function parseQuestionFieldExtras(body, { partial = false } = {}) {
  const updates = {};
  const errors = [];

  if (!partial || body.field_type !== undefined) {
    if (body.field_type !== undefined) {
      const fieldType =
        typeof body.field_type === 'string' ? body.field_type.trim().toUpperCase() : null;
      if (!fieldType || !QUESTION_FIELD_TYPES.includes(fieldType)) {
        errors.push(`field_type must be one of ${QUESTION_FIELD_TYPES.join(', ')}`);
      } else {
        updates.field_type = fieldType;
      }
    } else if (!partial) {
      updates.field_type = 'TEXT';
    }
  }

  if (!partial || body.options !== undefined) {
    if (body.options === undefined) {
      if (!partial) updates.options = null;
    } else if (body.options === null) {
      updates.options = null;
    } else if (!Array.isArray(body.options)) {
      errors.push('options must be an array of strings or null');
    } else {
      const options = body.options
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
      updates.options = options.length ? options : null;
    }
  }

  if (!partial || body.key !== undefined) {
    if (body.key === undefined) {
      if (!partial) updates.key = null;
    } else {
      const key = normalizeQuestionKey(body.key);
      if (body.key !== null && body.key !== '' && key === null) {
        errors.push('key must be a non-empty string or null');
      } else if (key && !KEY_REGEX.test(key)) {
        errors.push('key must be a lowercase slug (letters, numbers, underscore)');
      } else {
        updates.key = key;
      }
    }
  }

  const fieldType = updates.field_type;
  const options = updates.options;
  if (fieldType === 'DROPDOWN' && options !== undefined && (!options || options.length === 0)) {
    errors.push('options are required when field_type is DROPDOWN');
  }

  return { updates, errors };
}

export function validateAnswerForFieldType(fieldType, answerText, options = null) {
  const value = typeof answerText === 'string' ? answerText.trim() : '';
  if (!value) return 'answer_text is required';

  switch (fieldType) {
    case 'NUMBER': {
      if (!/^-?\d+(\.\d+)?$/.test(value)) return 'answer_text must be a valid number';
      return null;
    }
    case 'DATE': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'answer_text must be YYYY-MM-DD';
      const [y, m, d] = value.split('-').map((n) => Number.parseInt(n, 10));
      const parsed = new Date(y, m - 1, d);
      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.getFullYear() !== y ||
        parsed.getMonth() !== m - 1 ||
        parsed.getDate() !== d
      ) {
        return 'answer_text must be a valid date';
      }
      return null;
    }
    case 'TIME': {
      if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) {
        return 'answer_text must be HH:MM or HH:MM:SS';
      }
      return null;
    }
    case 'DATETIME': {
      if (!/^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) {
        return 'answer_text must be YYYY-MM-DD HH:MM or YYYY-MM-DDTHH:MM';
      }
      return null;
    }
    case 'YES_NO': {
      const normalized = value.toLowerCase();
      if (!['yes', 'no', 'true', 'false', '1', '0'].includes(normalized)) {
        return 'answer_text must be Yes/No';
      }
      return null;
    }
    case 'DROPDOWN': {
      if (Array.isArray(options) && options.length > 0 && !options.includes(value)) {
        return `answer_text must be one of: ${options.join(', ')}`;
      }
      return null;
    }
    default:
      return null;
  }
}
