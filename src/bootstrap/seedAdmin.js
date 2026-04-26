/**
 * Seed static users for local/dev bootstrap.
 * Call after sequelize.sync().
 */

import bcrypt from 'bcrypt';
import User from '../modules/users/user.model.js';
import { logInfo } from '../utils/logger.js';

const SEEDED_USERS = [
  // Keep primary admin credentials used by tests.
  { user_id: 'admin', name: 'Admin', password: 'admin123', role: 'SUPER_ADMIN', email: 'admin@gmail.com' },
  { user_id: 'admin2', name: 'Admin 2', password: 'admin2123', role: 'SUPER_ADMIN', email: null },
  { user_id: 'admin3', name: 'Admin 3', password: 'admin3123', role: 'SUPER_ADMIN', email: null },
  { user_id: 'admin4', name: 'Admin 4', password: 'admin4123', role: 'SUPER_ADMIN', email: null },
  { user_id: 'admin5', name: 'Admin 5', password: 'admin5123', role: 'SUPER_ADMIN', email: null },
  { user_id: 'LOBBY', name: 'BOTAD LOBBY', password: '12345678', role: 'USER', email: null },
  { user_id: 'vp', name: 'vp', password: '12345', role: 'USER', email: null },
];

export async function seedAdmin() {
  for (const entry of SEEDED_USERS) {
    const existing = await User.findOne({ where: { user_id: entry.user_id } });
    if (existing) {
      logInfo('Seed', 'User already exists', {
        user_id: existing.user_id,
        role: existing.role,
      });
      continue;
    }

    const password_hash = await bcrypt.hash(entry.password, 10);
    await User.create({
      user_id: entry.user_id,
      name: entry.name,
      email: entry.email,
      password_hash,
      role: entry.role,
      status: 'ACTIVE',
      created_by: null,
    });

    logInfo('Seed', 'Static user created', {
      user_id: entry.user_id,
      role: entry.role,
    });
  }
}
