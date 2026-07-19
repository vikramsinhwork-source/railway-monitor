import { Op } from 'sequelize';
import { Register, RegisterQuestion } from './index.js';
import Question from '../forms/question.model.js';
import Form from '../forms/form.model.js';
import { logInfo, logWarn } from '../../utils/logger.js';

/**
 * Shell definitions for the six client registers.
 * Mapping is applied only when matching question keys exist on an active form.
 */
export const CLIENT_REGISTER_DEFINITIONS = [
  {
    name: 'Detonator Register',
    description: 'Track detonators issued to crew and their return.',
    keys: [
      { key: 'date', is_key_field: false },
      { key: 'train_no', is_key_field: false },
      { key: 'name', is_key_field: false },
      { key: 'designation', is_key_field: false },
      { key: 'detonator_no', is_key_field: true },
      { key: 'crew_sign', is_key_field: false },
      { key: 'return_yes_no', is_key_field: false },
      { key: 'bc_sign', is_key_field: false },
    ],
  },
  {
    name: 'Incident / Unusual Occurrence',
    description: 'Record abnormal events during a run.',
    keys: [
      { key: 'date', is_key_field: false },
      { key: 'incident_description', is_key_field: true },
      { key: 'section', is_key_field: false },
      { key: 'km_range', is_key_field: false },
      { key: 'time_range', is_key_field: false },
      { key: 'loco_no', is_key_field: false },
      { key: 'lp_name', is_key_field: false },
      { key: 'tm_name', is_key_field: false },
      { key: 'alp_name', is_key_field: false },
    ],
  },
  {
    name: 'ALP Duty Register',
    description: 'Record ALP on-duty and off-duty timings against a train.',
    staff_type: 'ALP',
    keys: [
      { key: 'date', is_key_field: false },
      { key: 'alp_name', is_key_field: false },
      { key: 'train_no', is_key_field: false },
      { key: 'on_duty_time', is_key_field: true },
      { key: 'off_duty_time', is_key_field: false },
      { key: 'crew_sign', is_key_field: false },
    ],
  },
  {
    name: 'BP/FP Air-Hose Pipe Change Register',
    description: 'Track BP/FP air-hose pipe replacement after CRO (Instruction No. 44).',
    keys: [
      { key: 'lp_name', is_key_field: false },
      { key: 'train_no', is_key_field: false },
      { key: 'loco_no', is_key_field: true },
      { key: 'cro_notified_to', is_key_field: false },
      { key: 'hose_given_to_sse', is_key_field: false },
      { key: 'hose_changed', is_key_field: false },
      { key: 'lp_sign', is_key_field: false },
      { key: 'depot_sign', is_key_field: false },
      { key: 'cw_sign', is_key_field: false },
      { key: 'remarks', is_key_field: false },
    ],
  },
  {
    name: 'Walkie-Talkie Register',
    description: 'Track walkie-talkie sets issued to and deposited by crew.',
    keys: [
      { key: 'issue_datetime', is_key_field: false },
      { key: 'name', is_key_field: false },
      { key: 'designation', is_key_field: false },
      { key: 'walkie_no', is_key_field: true },
      { key: 'train_no', is_key_field: false },
      { key: 'crew_sign', is_key_field: false },
      { key: 'deposit_datetime', is_key_field: false },
      { key: 'bc_sign', is_key_field: false },
      { key: 'remarks', is_key_field: false },
    ],
  },
  {
    name: 'Fog Safe Device Register',
    description: 'Track fog safety devices issued to and returned by ALP.',
    staff_type: 'ALP',
    keys: [
      { key: 'date', is_key_field: false },
      { key: 'train_no', is_key_field: false },
      { key: 'alp_name', is_key_field: false },
      { key: 'fog_no', is_key_field: true },
      { key: 'crew_sign', is_key_field: false },
      { key: 'returned', is_key_field: false },
    ],
  },
];

async function findQuestionsByKeys(keys) {
  if (!keys.length) return [];
  return Question.findAll({
    where: { key: { [Op.in]: keys } },
    include: [
      {
        model: Form,
        as: 'form',
        attributes: ['id', 'is_active', 'staff_type', 'duty_type'],
        required: false,
      },
    ],
    order: [['created_at', 'ASC']],
  });
}

function pickQuestionForKey(questions, key, preferredStaffType) {
  const matches = questions.filter((q) => q.key === key);
  if (matches.length === 0) return null;

  const active = matches.filter((q) => q.form?.is_active);
  const pool = active.length ? active : matches;

  if (preferredStaffType) {
    const staffMatch = pool.find((q) => q.form?.staff_type === preferredStaffType);
    if (staffMatch) return staffMatch;
  }

  return pool[0];
}

export async function seedClientRegisters({ forceRemap = false } = {}) {
  let created = 0;
  let updated = 0;
  let mapped = 0;

  for (const def of CLIENT_REGISTER_DEFINITIONS) {
    let register = await Register.findOne({ where: { name: def.name } });
    if (!register) {
      register = await Register.create({
        name: def.name,
        description: def.description,
        is_active: true,
        staff_type: def.staff_type || null,
        duty_type: def.duty_type || null,
      });
      created += 1;
      logInfo('Registers', 'Seeded register shell', { registerId: register.id, name: def.name });
    } else {
      updated += 1;
    }

    const existingMappings = await RegisterQuestion.count({
      where: { register_id: register.id },
    });
    if (existingMappings > 0 && !forceRemap) {
      continue;
    }

    const keys = def.keys.map((k) => k.key);
    const questions = await findQuestionsByKeys(keys);
    const mappings = [];

    def.keys.forEach((field, index) => {
      const question = pickQuestionForKey(questions, field.key, def.staff_type);
      if (!question) return;
      mappings.push({
        register_id: register.id,
        question_id: question.id,
        sort_order: index,
        column_label: null,
        is_key_field: !!field.is_key_field,
      });
    });

    if (mappings.length === 0) {
      logWarn('Registers', 'Register seeded without mappings (missing question keys)', {
        registerId: register.id,
        name: def.name,
        requiredKeys: keys,
      });
      continue;
    }

    await RegisterQuestion.destroy({ where: { register_id: register.id } });
    await RegisterQuestion.bulkCreate(mappings);
    mapped += 1;
    logInfo('Registers', 'Register mappings seeded', {
      registerId: register.id,
      name: def.name,
      mappedCount: mappings.length,
    });
  }

  return { created, updated, mapped };
}
