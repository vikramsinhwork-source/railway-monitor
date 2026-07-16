import User from '../modules/users/user.model.js';
import { isSignupAutoApproveEnabled } from '../utils/signupApproval.js';
import { logInfo } from '../utils/logger.js';

/**
 * When the temporary auto-approve window is open, activate every pending user
 * so they can log in without waiting for an admin.
 */
export async function approvePendingUsersIfAutoApprove() {
  if (!isSignupAutoApproveEnabled()) return;

  const [count] = await User.update(
    {
      status: 'ACTIVE',
      approved_at: new Date(),
    },
    {
      where: { status: 'PENDING_APPROVAL' },
    }
  );

  if (count > 0) {
    logInfo('Auth', 'Auto-approved pending users', { count });
  }
}
