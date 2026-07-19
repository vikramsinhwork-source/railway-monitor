import {
  parseFormContext,
  STAFF_TYPES,
  DUTY_TYPES,
} from '../forms/formSubmission.service.js';

export function parsePublicCurrentFormQuery(query = {}) {
  return parseFormContext(
    {
      staffType: query.staffType ?? query.staff_type,
      dutyType: query.dutyType ?? query.duty_type,
    },
    { source: 'query' }
  );
}

export function parsePublicSubmitBody(body = {}) {
  const { context, error: contextError } = parseFormContext(
    {
      staffType: body.staffType ?? body.staff_type,
      dutyType: body.dutyType ?? body.duty_type,
    },
    { source: 'body' }
  );
  if (contextError) {
    return { error: contextError };
  }

  return {
    context,
    staffTypes: STAFF_TYPES,
    dutyTypes: DUTY_TYPES,
  };
}
