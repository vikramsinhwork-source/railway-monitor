/**
 * Seed static users for local/dev bootstrap.
 * Call after sequelize.sync().
 */

import bcrypt from 'bcrypt';
import User from '../modules/users/user.model.js';
import Division from '../modules/divisions/division.model.js';
import Lobby from '../modules/divisions/lobby.model.js';
import { logInfo, logWarn } from '../utils/logger.js';

const SEEDED_USERS = [
  // Keep primary admin credentials used by tests.
  { user_id: 'admin', name: 'Admin', password: 'admin123', role: 'SUPER_ADMIN', email: 'admin@gmail.com' },
  { user_id: 'admin2', name: 'Admin 2', password: 'admin2123', role: 'SUPER_ADMIN', email: 'admin2@users.local' },
  { user_id: 'admin3', name: 'Admin 3', password: 'admin3123', role: 'SUPER_ADMIN', email: 'admin3@users.local' },
  { user_id: 'admin4', name: 'Admin 4', password: 'admin4123', role: 'SUPER_ADMIN', email: 'admin4@users.local' },
  { user_id: 'admin5', name: 'Admin 5', password: 'admin5123', role: 'SUPER_ADMIN', email: 'admin5@users.local' },
  {
    user_id: 'LOBBY',
    name: 'BOTAD LOBBY',
    password: '12345678',
    role: 'USER',
    email: 'lobby@users.local',
    divisionName: 'Bhavnagar',
    lobby: { name: 'Botad', station_name: 'Botad', city: 'Bhavnagar' },
  },
  {
    user_id: 'ahmedabad_admin',
    name: 'Ahmedabad Admin',
    password: 'ChangeMe@123',
    role: 'DIVISION_ADMIN',
    email: 'ahmedabad.admin@example.com',
    divisionName: 'Ahmedabad',
  },
  {
    user_id: 'VATVA',
    name: 'VATVA LOBBY',
    password: '12345678',
    role: 'USER',
    email: 'vatva@users.local',
    divisionName: 'Ahmedabad',
    lobby: { name: 'Vatva Lobby', station_name: 'Vatva', city: 'Ahmedabad' },
  },
  { user_id: 'vp', name: 'vp', password: '12345', role: 'USER', email: 'vp@users.local' },
];

async function resolveDivisionId(divisionName) {
  if (!divisionName) return null;
  const division = await Division.findOne({ where: { name: divisionName } });
  if (!division) {
    logWarn('Seed', 'Division not found for user seed', { divisionName });
    return null;
  }
  return division.id;
}

async function ensureLobby(divisionId, lobby) {
  if (!divisionId || !lobby?.name || !lobby?.station_name) return;
  const [row, created] = await Lobby.findOrCreate({
    where: {
      division_id: divisionId,
      name: lobby.name,
      station_name: lobby.station_name,
    },
    defaults: {
      city: lobby.city || null,
      status: true,
    },
  });
  if (created) {
    logInfo('Seed', 'Lobby created', {
      name: row.name,
      station_name: row.station_name,
    });
  }
}

export async function seedAdmin() {
  for (const entry of SEEDED_USERS) {
    const division_id = await resolveDivisionId(entry.divisionName);
    await ensureLobby(division_id, entry.lobby);

    const existing = await User.findOne({ where: { user_id: entry.user_id } });
    if (existing) {
      if (division_id && existing.division_id !== division_id) {
        await existing.update({ division_id, status: 'ACTIVE' });
        logInfo('Seed', 'User division updated', {
          user_id: existing.user_id,
          division: entry.divisionName,
        });
      } else {
        logInfo('Seed', 'User already exists', {
          user_id: existing.user_id,
          role: existing.role,
        });
      }
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
      division_id,
    });

    logInfo('Seed', 'Static user created', {
      user_id: entry.user_id,
      role: entry.role,
      division: entry.divisionName || null,
    });
  }
}
