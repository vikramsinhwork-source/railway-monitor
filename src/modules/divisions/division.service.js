import { Op } from 'sequelize';
import Division from './division.model.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';
import { createAuditLog } from '../audit/audit.service.js';

function canViewAll(role) {
  return normalizeRole(role) === 'SUPER_ADMIN';
}

function toDivisionResponse(division) {
  return {
    id: division.id,
    name: division.name,
    code: division.code,
    description: division.description,
    status: division.status,
    created_at: division.created_at,
    updated_at: division.updated_at,
  };
}

export async function listDivisionsForUser(user, filters = {}) {
  const where = {};
  if (filters.status !== undefined) {
    where.status = filters.status;
  }
  if (filters.search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${filters.search}%` } },
      { code: { [Op.iLike]: `%${filters.search}%` } },
    ];
  }

  if (!canViewAll(user.role)) {
    if (!user.division_id) return [];
    where.id = user.division_id;
  }

  const divisions = await Division.findAndCountAll({
    where,
    limit: filters.limit,
    offset: filters.offset,
    order: [[filters.sortField || 'name', filters.sortDirection || 'ASC']],
  });
  return {
    rows: divisions.rows.map(toDivisionResponse),
    count: divisions.count,
  };
}

export async function getDivisionByIdForUser(id, user) {
  const division = await Division.findByPk(id);
  if (!division) return null;

  if (!canViewAll(user.role) && user.division_id !== division.id) {
    return { forbidden: true };
  }

  return { division: toDivisionResponse(division) };
}

export async function createDivision(data, actor) {
  const division = await Division.create({
    name: data.name,
    code: data.code,
    description: data.description,
    status: true,
  });

  await createAuditLog({
    userId: actor.id,
    action: 'DIVISION_CREATE',
    entityType: 'division',
    entityId: division.id,
    oldData: null,
    newData: toDivisionResponse(division),
  });

  return toDivisionResponse(division);
}

export async function updateDivision(id, updates, actor) {
  const division = await Division.findByPk(id);
  if (!division) return null;

  const before = toDivisionResponse(division);
  await division.update(updates);
  await division.reload();
  const after = toDivisionResponse(division);

  await createAuditLog({
    userId: actor.id,
    action: 'DIVISION_UPDATE',
    entityType: 'division',
    entityId: division.id,
    oldData: before,
    newData: after,
  });

  return after;
}
