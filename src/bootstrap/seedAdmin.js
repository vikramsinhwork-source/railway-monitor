/**
 * Seed static ADMIN user.
 * Only one ADMIN: user_id=admin, email=admin@gmail.com, password=admin123.
 * Call after sequelize.sync().
 */

import bcrypt from 'bcrypt';
import User from '../modules/users/user.model.js';
import { logInfo, logWarn } from '../utils/logger.js';

const ADMIN_USER_ID = 'admin';
const ADMIN_EMAIL = 'admin@gmail.com';
const ADMIN_PASSWORD = 'admin123';

export async function seedAdmin() {
  try {
    const existing = await User.findOne({ where: { role: 'ADMIN' } });
    if (existing) {
      logInfo('Seed', 'ADMIN user already exists', { user_id: existing.user_id });
      return;
    }

    const password_hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.create({
      user_id: ADMIN_USER_ID,
      name: 'Admin',
      email: ADMIN_EMAIL,
      password_hash,
      role: 'ADMIN',
      status: 'ACTIVE',
      created_by: null,
    });

    logInfo('Seed', 'Static ADMIN user created', {
      user_id: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      logWarn('Seed', 'ADMIN user already exists (unique constraint)', { user_id: ADMIN_USER_ID });
      return;
    }
    throw err;
  }
}
