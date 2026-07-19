import { Op, QueryTypes } from 'sequelize';
import ExcelJS from 'exceljs';
import sequelize from '../../config/sequelize.js';
import { Register, RegisterQuestion } from './index.js';
import Question from '../forms/question.model.js';

function toRegisterResponse(register, includeQuestions = false) {
  const plain = register.get ? register.get({ plain: true }) : register;
  const mapped = {
    id: plain.id,
    name: plain.name,
    description: plain.description,
    is_active: plain.is_active,
    staff_type: plain.staff_type,
    duty_type: plain.duty_type,
    created_at: plain.created_at,
    updated_at: plain.updated_at,
  };

  if (includeQuestions) {
    const rows = Array.isArray(plain.register_questions) ? plain.register_questions : [];
    mapped.questions = rows
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((row) => ({
        id: row.id,
        question_id: row.question_id,
        sort_order: row.sort_order,
        column_label: row.column_label,
        is_key_field: row.is_key_field,
        question: row.question
          ? {
              id: row.question.id,
              prompt: row.question.prompt,
              field_type: row.question.field_type,
              options: row.question.options,
              key: row.question.key,
              is_required: row.question.is_required,
              form_id: row.question.form_id,
            }
          : null,
      }));
    mapped.question_count = mapped.questions.length;
  }

  return mapped;
}

function mappingInclude() {
  return [
    {
      model: RegisterQuestion,
      as: 'register_questions',
      include: [
        {
          model: Question,
          as: 'question',
          attributes: [
            'id',
            'prompt',
            'field_type',
            'options',
            'key',
            'is_required',
            'form_id',
            'sort_order',
          ],
          paranoid: false,
        },
      ],
    },
  ];
}

export async function createRegister(payload) {
  const register = await Register.create(payload);
  return toRegisterResponse(register);
}

export async function listRegisters({ isActive, search, staffType, dutyType } = {}) {
  const where = {};
  if (isActive !== undefined) where.is_active = isActive;
  if (staffType) where.staff_type = staffType;
  if (dutyType) where.duty_type = dutyType;
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const registers = await Register.findAll({
    where,
    include: [
      {
        model: RegisterQuestion,
        as: 'register_questions',
        attributes: ['id'],
      },
    ],
    order: [['created_at', 'DESC']],
  });

  return registers.map((register) => {
    const plain = register.get({ plain: true });
    return {
      ...toRegisterResponse(register),
      question_count: Array.isArray(plain.register_questions)
        ? plain.register_questions.length
        : 0,
    };
  });
}

export async function getRegisterById(id) {
  const register = await Register.findByPk(id, {
    include: mappingInclude(),
    order: [
      [{ model: RegisterQuestion, as: 'register_questions' }, 'sort_order', 'ASC'],
    ],
  });
  if (!register) return null;
  return toRegisterResponse(register, true);
}

export async function updateRegister(id, updates) {
  const register = await Register.findByPk(id);
  if (!register) return null;
  await register.update(updates);
  return getRegisterById(id);
}

export async function deactivateRegister(id) {
  const register = await Register.findByPk(id);
  if (!register) return null;
  await register.update({ is_active: false });
  return toRegisterResponse(register);
}

export async function getRegisterQuestions(registerId) {
  const register = await Register.findByPk(registerId);
  if (!register) return { error: { status: 404, message: 'Register not found' } };

  const rows = await RegisterQuestion.findAll({
    where: { register_id: registerId },
    include: [
      {
        model: Question,
        as: 'question',
        attributes: [
          'id',
          'prompt',
          'field_type',
          'options',
          'key',
          'is_required',
          'form_id',
        ],
        paranoid: false,
      },
    ],
    order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
  });

  return {
    register: toRegisterResponse(register),
    questions: rows.map((row) => {
      const plain = row.get({ plain: true });
      return {
        id: plain.id,
        question_id: plain.question_id,
        sort_order: plain.sort_order,
        column_label: plain.column_label,
        is_key_field: plain.is_key_field,
        question: plain.question
          ? {
              id: plain.question.id,
              prompt: plain.question.prompt,
              field_type: plain.question.field_type,
              options: plain.question.options,
              key: plain.question.key,
              is_required: plain.question.is_required,
              form_id: plain.question.form_id,
            }
          : null,
      };
    }),
  };
}

export async function replaceRegisterQuestions(registerId, mappings) {
  const register = await Register.findByPk(registerId);
  if (!register) return { error: { status: 404, message: 'Register not found' } };

  const questionIds = mappings.map((m) => m.question_id);
  const questions = await Question.findAll({
    where: { id: { [Op.in]: questionIds } },
  });
  const foundIds = new Set(questions.map((q) => q.id));
  const missing = questionIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return {
      error: {
        status: 400,
        message: `Unknown or deleted question_id(s): ${missing.join(', ')}`,
      },
    };
  }

  const tx = await sequelize.transaction();
  try {
    await RegisterQuestion.destroy({ where: { register_id: registerId }, transaction: tx });
    if (mappings.length > 0) {
      await RegisterQuestion.bulkCreate(
        mappings.map((m) => ({
          register_id: registerId,
          question_id: m.question_id,
          sort_order: m.sort_order,
          column_label: m.column_label,
          is_key_field: m.is_key_field,
        })),
        { transaction: tx }
      );
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return getRegisterQuestions(registerId);
}

function buildColumns(registerQuestions) {
  return registerQuestions.map((row) => ({
    mapping_id: row.id,
    question_id: row.question_id,
    key: row.question?.key || null,
    label: row.column_label || row.question?.prompt || row.question_id,
    field_type: row.question?.field_type || 'TEXT',
    is_key_field: !!row.is_key_field,
  }));
}

function resolveAnswerValue(answersByQuestionId, answersByKey, column) {
  if (answersByQuestionId.has(column.question_id)) {
    return answersByQuestionId.get(column.question_id);
  }
  if (column.key && answersByKey.has(column.key)) {
    return answersByKey.get(column.key);
  }
  return '';
}

async function loadRegisterWithMappings(registerId) {
  const register = await Register.findByPk(registerId, {
    include: mappingInclude(),
  });
  if (!register) return null;

  const plain = register.get({ plain: true });
  const mappings = (plain.register_questions || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return { register: plain, mappings, columns: buildColumns(mappings) };
}

function buildEntriesSql({ register, mappings, fromDate, toDate, search, limit, offset }) {
  const keyMappings = mappings.filter((m) => m.is_key_field);
  const keyQuestionIds = keyMappings.map((m) => m.question_id);
  const keyKeys = keyMappings
    .map((m) => m.question?.key)
    .filter((k) => typeof k === 'string' && k.trim());

  const replacements = {
    limit,
    offset,
  };

  const formFilters = [];
  if (register.staff_type) {
    formFilters.push('f.staff_type = :staffType');
    replacements.staffType = register.staff_type;
  }
  if (register.duty_type) {
    formFilters.push('f.duty_type = :dutyType');
    replacements.dutyType = register.duty_type;
  }

  const dateFilters = [];
  if (fromDate) {
    dateFilters.push('s.submission_date >= :fromDate');
    replacements.fromDate = fromDate;
  }
  if (toDate) {
    dateFilters.push('s.submission_date <= :toDate');
    replacements.toDate = toDate;
  }

  const searchFilter = search
    ? `AND (u.user_id ILIKE :searchLike OR u.name ILIKE :searchLike OR u.email ILIKE :searchLike)`
    : '';
  if (search) replacements.searchLike = `%${search}%`;

  let visibilitySql = 'TRUE';
  if (keyQuestionIds.length > 0 || keyKeys.length > 0) {
    const parts = [];
    if (keyQuestionIds.length > 0) {
      replacements.keyQuestionIds = keyQuestionIds;
      parts.push(`
        EXISTS (
          SELECT 1
          FROM answers a_key
          WHERE a_key.submission_id = s.id
            AND a_key.question_id IN (:keyQuestionIds)
            AND NULLIF(BTRIM(a_key.answer_text), '') IS NOT NULL
        )
      `);
    }
    if (keyKeys.length > 0) {
      replacements.keyKeys = keyKeys;
      parts.push(`
        EXISTS (
          SELECT 1
          FROM answers a_key2
          INNER JOIN questions q_key ON q_key.id = a_key2.question_id
          WHERE a_key2.submission_id = s.id
            AND q_key.key IN (:keyKeys)
            AND NULLIF(BTRIM(a_key2.answer_text), '') IS NOT NULL
        )
      `);
    }
    visibilitySql = parts.join(' OR ');
  } else if (mappings.length > 0) {
    replacements.anyQuestionIds = mappings.map((m) => m.question_id);
    visibilitySql = `
      EXISTS (
        SELECT 1
        FROM answers a_any
        WHERE a_any.submission_id = s.id
          AND a_any.question_id IN (:anyQuestionIds)
          AND NULLIF(BTRIM(a_any.answer_text), '') IS NOT NULL
      )
    `;
  } else {
    visibilitySql = 'FALSE';
  }

  const whereSql = [
    ...formFilters,
    ...dateFilters,
    `(${visibilitySql})`,
  ]
    .filter(Boolean)
    .join(' AND ');

  const countSql = `
    SELECT COUNT(*)::integer AS total
    FROM submissions s
    INNER JOIN forms f ON f.id = s.form_id
    INNER JOIN users u ON u.id = s.user_id AND u.role = 'USER'
    WHERE ${whereSql || 'TRUE'}
    ${searchFilter}
  `;

  const listSql = `
    SELECT
      s.id::text AS submission_id,
      s.submission_date::text AS submission_date,
      s.created_at AS submission_created_at,
      u.id::text AS user_pk,
      u.user_id,
      u.name,
      u.email,
      u.crew_type,
      f.id::text AS form_id,
      f.staff_type,
      f.duty_type
    FROM submissions s
    INNER JOIN forms f ON f.id = s.form_id
    INNER JOIN users u ON u.id = s.user_id AND u.role = 'USER'
    WHERE ${whereSql || 'TRUE'}
    ${searchFilter}
    ORDER BY s.submission_date DESC, s.created_at DESC
    LIMIT :limit OFFSET :offset
  `;

  return { countSql, listSql, replacements };
}

export async function listRegisterEntries(registerId, query) {
  const loaded = await loadRegisterWithMappings(registerId);
  if (!loaded) return { error: { status: 404, message: 'Register not found' } };

  const { register, mappings, columns } = loaded;
  const { page, limit, fromDate, toDate, search } = query;
  const offset = (page - 1) * limit;

  const { countSql, listSql, replacements } = buildEntriesSql({
    register,
    mappings,
    fromDate,
    toDate,
    search,
    limit,
    offset,
  });

  const [countRow] = await sequelize.query(countSql, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const total = countRow?.total ?? 0;

  const rows = await sequelize.query(listSql, {
    replacements,
    type: QueryTypes.SELECT,
  });

  const submissionIds = rows.map((r) => r.submission_id);
  const answersBySubmission = new Map();

  if (submissionIds.length > 0) {
    const answerRows = await sequelize.query(
      `
      SELECT
        a.submission_id::text AS submission_id,
        a.question_id::text AS question_id,
        q.key AS question_key,
        a.answer_text
      FROM answers a
      INNER JOIN questions q ON q.id = a.question_id
      WHERE a.submission_id IN (:submissionIds)
      `,
      {
        replacements: { submissionIds },
        type: QueryTypes.SELECT,
      }
    );

    for (const answer of answerRows) {
      if (!answersBySubmission.has(answer.submission_id)) {
        answersBySubmission.set(answer.submission_id, {
          byQuestionId: new Map(),
          byKey: new Map(),
        });
      }
      const bucket = answersBySubmission.get(answer.submission_id);
      bucket.byQuestionId.set(answer.question_id, answer.answer_text ?? '');
      if (answer.question_key) {
        bucket.byKey.set(answer.question_key, answer.answer_text ?? '');
      }
    }
  }

  const entries = rows.map((row) => {
    const bucket = answersBySubmission.get(row.submission_id) || {
      byQuestionId: new Map(),
      byKey: new Map(),
    };
    const values = {};
    for (const column of columns) {
      values[column.question_id] = resolveAnswerValue(
        bucket.byQuestionId,
        bucket.byKey,
        column
      );
    }

    return {
      submission_id: row.submission_id,
      submission_date: row.submission_date,
      submission_created_at: row.submission_created_at,
      user: {
        id: row.user_pk,
        user_id: row.user_id,
        name: row.name,
        email: row.email,
        crew_type: row.crew_type,
      },
      form: {
        id: row.form_id,
        staff_type: row.staff_type,
        duty_type: row.duty_type,
      },
      values,
    };
  });

  return {
    register: {
      id: register.id,
      name: register.name,
      description: register.description,
      is_active: register.is_active,
      staff_type: register.staff_type,
      duty_type: register.duty_type,
    },
    columns,
    entries,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit) || 0,
    },
    filters: {
      from_date: fromDate,
      to_date: toDate,
      search,
    },
  };
}

export async function getRegisterAnalyticsSummary(registerId, { fromDate, toDate } = {}) {
  const loaded = await loadRegisterWithMappings(registerId);
  if (!loaded) return { error: { status: 404, message: 'Register not found' } };

  const pageData = await listRegisterEntries(registerId, {
    page: 1,
    limit: 100000,
    fromDate,
    toDate,
    search: null,
  });
  if (pageData.error) return pageData;

  const byDateMap = new Map();
  const userIds = new Set();
  for (const entry of pageData.entries) {
    userIds.add(entry.user.id);
    const date = entry.submission_date;
    if (!byDateMap.has(date)) {
      byDateMap.set(date, { submission_date: date, submission_count: 0, user_ids: new Set() });
    }
    const bucket = byDateMap.get(date);
    bucket.submission_count += 1;
    bucket.user_ids.add(entry.user.id);
  }

  return {
    register: pageData.register,
    filters: { from_date: fromDate || null, to_date: toDate || null },
    totals: {
      submission_count: pageData.pagination.total,
      distinct_user_count: userIds.size,
    },
    submissions_by_date: Array.from(byDateMap.values())
      .sort((a, b) => String(a.submission_date).localeCompare(String(b.submission_date)))
      .map((row) => ({
        submission_date: row.submission_date,
        submission_count: row.submission_count,
        distinct_user_count: row.user_ids.size,
      })),
  };
}

function formatCellDate(value) {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return value === '' ? '' : String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildExportFilename(registerName, fromDate, toDate, exportedAt) {
  const safeName = String(registerName || 'register')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'register';
  let range = 'all';
  if (fromDate && toDate) range = `${fromDate}_to_${toDate}`;
  else if (fromDate) range = `from_${fromDate}`;
  else if (toDate) range = `to_${toDate}`;
  const pad = (n) => String(n).padStart(2, '0');
  const x = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  const ts = `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}-${pad(x.getHours())}${pad(x.getMinutes())}${pad(x.getSeconds())}`;
  return `${safeName}-${range}-${ts}.xlsx`;
}

export async function buildRegisterExportWorkbookData(registerId, { fromDate, toDate, search } = {}) {
  const pageData = await listRegisterEntries(registerId, {
    page: 1,
    limit: 50000,
    fromDate,
    toDate,
    search: search || null,
  });
  if (pageData.error) return pageData;

  const exportedAt = new Date();
  const columns = [
    { key: 'user_id', header: 'User ID', width: 18 },
    { key: 'name', header: 'Name', width: 24 },
    { key: 'email', header: 'Email', width: 28 },
    { key: 'submission_date', header: 'Submission Date', width: 16 },
    { key: 'submission_created_at', header: 'Submitted At', width: 20 },
    { key: 'staff_type', header: 'Staff Type', width: 12 },
    { key: 'duty_type', header: 'Duty Type', width: 12 },
    ...pageData.columns.map((column, idx) => ({
      key: `q_${column.question_id}`,
      header: column.label,
      width: Math.max(18, Math.min(48, String(column.label).length + 6)),
      question_id: column.question_id,
      field_type: column.field_type,
      question_key: column.key,
      index: idx,
    })),
  ];

  const rows = pageData.entries.map((entry) => {
    const row = {
      user_id: entry.user.user_id || '',
      name: entry.user.name || '',
      email: entry.user.email || '',
      submission_date: entry.submission_date || '',
      submission_created_at: formatCellDate(entry.submission_created_at),
      staff_type: entry.form.staff_type || '',
      duty_type: entry.form.duty_type || '',
    };
    for (const column of pageData.columns) {
      row[`q_${column.question_id}`] = entry.values[column.question_id] || '';
    }
    return row;
  });

  return {
    register: pageData.register,
    exported_at: formatCellDate(exportedAt),
    filename: buildExportFilename(pageData.register.name, fromDate, toDate, exportedAt),
    filters: {
      from_date: fromDate || null,
      to_date: toDate || null,
      search: search || null,
    },
    columns,
    rows,
    row_count: rows.length,
    column_count: columns.length,
  };
}

export async function buildRegisterExportPreview(registerId, filters) {
  const data = await buildRegisterExportWorkbookData(registerId, filters);
  if (data.error) return data;

  return {
    title: `${data.register.name} export`,
    generated_at: data.exported_at,
    filename: data.filename,
    filters: data.filters,
    register: data.register,
    sheets: [
      {
        key: 'register_entries',
        name: data.register.name.slice(0, 31),
        columns: data.columns,
        rows: data.rows,
        row_count: data.row_count,
        column_count: data.column_count,
      },
    ],
  };
}

export async function buildRegisterExportXlsxBuffer(registerId, filters) {
  const data = await buildRegisterExportWorkbookData(registerId, filters);
  if (data.error) return data;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kiosk Monitor - Registers';
  workbook.title = `${data.register.name} export`;
  workbook.created = new Date();
  workbook.modified = new Date();

  const info = workbook.addWorksheet('Export info', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  info.columns = [
    { header: 'field', key: 'field', width: 28 },
    { header: 'value', key: 'value', width: 56 },
  ];
  info.getRow(1).font = { bold: true };
  info.addRow({ field: 'register_id', value: data.register.id });
  info.addRow({ field: 'register_name', value: data.register.name });
  info.addRow({ field: 'export_generated_at', value: data.exported_at });
  info.addRow({ field: 'filter_from_date', value: data.filters.from_date || '' });
  info.addRow({ field: 'filter_to_date', value: data.filters.to_date || '' });
  info.addRow({ field: 'filter_search', value: data.filters.search || '' });

  const sheet = workbook.addWorksheet(data.register.name.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = data.columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of data.rows) {
    sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    filename: data.filename,
  };
}
