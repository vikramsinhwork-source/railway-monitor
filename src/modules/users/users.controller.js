/**
 * Users controller: create (admin), list (admin), deactivate (admin), me.
 */

import bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import User from './user.model.js';
import { logInfo, logWarn } from '../../utils/logger.js';

export async function createUser(req, res) {
  try {
    const { user_id, name, password } = req.body;
    if (!user_id || !name || !password) {
      return res.status(400).json({
        success: false,
        message: 'user_id, name, and password are required',
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      user_id,
      name,
      password_hash,
      role: 'USER',
      status: 'ACTIVE',
      created_by: req.auth.userId,
    });

    logInfo('Users', 'User created', { user_id: user.user_id, created_by: req.auth.userId });

    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: 'user_id or email already exists',
      });
    }
    logWarn('Users', 'Create user error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to create user' });
  }
}

export async function listUsers(req, res) {
  try {
    const { search, q, role, status } = req.query;

    const where = {};

    // Text search: q or search - matches user_id, name, email (case-insensitive)
    const searchTerm = (search || q || '').trim();
    if (searchTerm) {
      const likeTerm = `%${searchTerm}%`;
      where[Op.or] = [
        { user_id: { [Op.iLike]: likeTerm } },
        { name: { [Op.iLike]: likeTerm } },
        { email: { [Op.iLike]: likeTerm } },
      ];
    }

    // Filter by role (ADMIN | USER)
    if (role) {
      const validRole = ['ADMIN', 'USER'].includes(role.toUpperCase()) ? role.toUpperCase() : null;
      if (validRole) where.role = validRole;
    }

    // Filter by status (ACTIVE | INACTIVE)
    if (status) {
      const validStatus = ['ACTIVE', 'INACTIVE'].includes(status.toUpperCase()) ? status.toUpperCase() : null;
      if (validStatus) where.status = validStatus;
    }

    // Op.or uses Symbol key - Object.keys() ignores it. Check if we have any filters.
    const hasFilters = !!(
      searchTerm ||
      (role && ['ADMIN', 'USER'].includes((role || '').toString().toUpperCase())) ||
      (status && ['ACTIVE', 'INACTIVE'].includes((status || '').toString().toUpperCase()))
    );

    const users = await User.findAll({
      attributes: ['id', 'user_id', 'name', 'email', 'role', 'status', 'created_at'],
      where: hasFilters ? where : undefined,
      order: [['created_at', 'DESC']],
    });

    return res.json({ success: true, users });
  } catch (err) {
    logWarn('Users', 'List users error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to list users' });
  }
}

export async function getUserById(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id, {
      attributes: ['id', 'user_id', 'name', 'email', 'role', 'status', 'created_at', 'updated_at'],
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, user: user.get({ plain: true }) });
  } catch (err) {
    logWarn('Users', 'Get user by ID error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to get user' });
  }
}

export async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { name, email, password } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Prevent updating ADMIN
    if (user.role === 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Cannot update ADMIN user' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email || null;
    if (password !== undefined && password.trim()) {
      updates.password_hash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update. Provide name, email, or password.',
      });
    }

    await user.update(updates);

    logInfo('Users', 'User updated', { user_id: user.user_id, updatedBy: req.auth.userId });

    return res.json({
      success: true,
      user: {
        id: user.id,
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        updated_at: user.updated_at,
      },
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: 'email or user_id already exists',
      });
    }
    logWarn('Users', 'Update user error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to update user' });
  }
}

export async function deactivateUser(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.role === 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Cannot deactivate ADMIN' });
    }
    await user.update({ status: 'INACTIVE' });
    logInfo('Users', 'User deactivated', { user_id: user.user_id });
    return res.json({
      success: true,
      user: {
        id: user.id,
        user_id: user.user_id,
        name: user.name,
        role: user.role,
        status: user.status,
      },
    });
  } catch (err) {
    logWarn('Users', 'Deactivate user error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to deactivate user' });
  }
}

export async function me(req, res) {
  try {
    const user = await User.findByPk(req.auth.userId, {
      attributes: ['id', 'user_id', 'name', 'email', 'role', 'status', 'created_at'],
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, user: user.get({ plain: true }) });
  } catch (err) {
    logWarn('Users', 'Me error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
}
