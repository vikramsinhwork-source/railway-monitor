import Form from '../modules/forms/form.model.js';
import Question from '../modules/forms/question.model.js';
import { logInfo, logWarn } from '../utils/logger.js';

const STAFF_TYPES = ['ALP', 'LP', 'TM'];
const DUTY_TYPES = ['SIGN_ON', 'SIGN_OFF'];

function starterTitle(staffType, dutyType) {
  return `${staffType} ${dutyType.replace(/_/g, ' ')} starter template`;
}

async function cloneQuestions(sourceFormId, targetFormId) {
  if (!sourceFormId) return 0;

  const sourceQuestions = await Question.findAll({
    where: { form_id: sourceFormId },
    order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
  });

  if (sourceQuestions.length === 0) return 0;

  await Question.bulkCreate(
    sourceQuestions.map((question) => ({
      form_id: targetFormId,
      prompt: question.prompt,
      is_required: question.is_required,
      sort_order: question.sort_order,
    }))
  );

  return sourceQuestions.length;
}

export async function seedRoleDutyTemplates() {
  const baselineForm = await Form.findOne({
    where: { is_active: true },
    order: [['created_at', 'ASC']],
  });

  for (const staffType of STAFF_TYPES) {
    for (const dutyType of DUTY_TYPES) {
      const existing = await Form.findOne({
        where: {
          staff_type: staffType,
          duty_type: dutyType,
        },
        order: [['created_at', 'ASC']],
      });

      if (existing) {
        logInfo('Seed', 'Role-duty starter template already exists', {
          templateId: existing.id,
          staffType,
          dutyType,
          isActive: existing.is_active,
        });
        continue;
      }

      const createdTemplate = await Form.create({
        title: starterTitle(staffType, dutyType),
        description: `Starter draft template for ${staffType} ${dutyType}`,
        staff_type: staffType,
        duty_type: dutyType,
        is_active: false,
      });

      const clonedCount = await cloneQuestions(baselineForm?.id, createdTemplate.id);
      logInfo('Seed', 'Role-duty starter template created', {
        templateId: createdTemplate.id,
        staffType,
        dutyType,
        clonedQuestions: clonedCount,
      });
    }
  }

  if (!baselineForm) {
    logWarn('Seed', 'No active baseline form found while seeding starter templates', {
      fallback: 'Created empty starter templates',
    });
  }
}
