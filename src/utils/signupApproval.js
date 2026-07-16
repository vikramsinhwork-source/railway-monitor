/**
 * Temporary self-signup auto-approval window.
 *
 * AUTO_APPROVE_SIGNUPS=true           → always auto-approve
 * AUTO_APPROVE_SIGNUPS_UNTIL=YYYY-MM-DD → auto-approve until end of that UTC day
 */

export function isSignupAutoApproveEnabled(now = new Date()) {
  if (String(process.env.AUTO_APPROVE_SIGNUPS || '').toLowerCase() === 'true') {
    return true;
  }

  const until = process.env.AUTO_APPROVE_SIGNUPS_UNTIL?.trim();
  if (!until) return false;

  const end = new Date(`${until}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) return false;
  return now.getTime() <= end.getTime();
}

export function resolveSignupStatus(now = new Date()) {
  return isSignupAutoApproveEnabled(now) ? 'ACTIVE' : 'PENDING_APPROVAL';
}
