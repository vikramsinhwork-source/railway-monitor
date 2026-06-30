/**
 * Users controller: create (admin), list (admin), deactivate (admin), me, patch me, avatars.
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import User from './user.model.js';
import UserFaceProfile from './userFaceProfile.model.js';
import { logInfo, logWarn } from '../../utils/logger.js';
import { toUserResponse, toUserResponses } from './userResponse.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  putAvatarObject,
  deleteAvatarObject,
  isAvatarStorageConfigured,
} from '../../services/s3Avatar.js';
import { enrollFace, deleteFace, recognizeFace } from '../../services/rekognitionFace.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';

const USER_RESPONSE_ATTRIBUTES = [
  'id',
  'user_id',
  'name',
  'email',
  'role',
  'division_id',
  'status',
  'approved_by',
  'approved_at',
  'created_at',
  'updated_at',
  'crew_type',
  'head_quarter',
  'mobile',
];

const USER_ROLES = ['SUPER_ADMIN', 'DIVISION_ADMIN', 'MONITOR', 'USER'];
const PROTECTED_ADMIN_ROLES = new Set(['SUPER_ADMIN', 'DIVISION_ADMIN']);

function currentRole(req) {
  return normalizeRole(req.user?.role || req.auth?.role);
}

function isDivisionAdmin(req) {
  return currentRole(req) === 'DIVISION_ADMIN';
}

function adminDivisionId(req) {
  return req.user?.division_id || req.auth?.division_id || null;
}

async function findPendingUserForAdmin(req, id) {
  const user = await User.findByPk(id);
  if (!user) {
    return { error: { status: 404, message: 'User not found' } };
  }
  if (user.status !== 'PENDING_APPROVAL') {
    return { error: { status: 400, message: 'User is not pending approval' } };
  }
  if (isDivisionAdmin(req)) {
    const divisionId = adminDivisionId(req);
    if (!divisionId) {
      return { error: { status: 400, message: 'Division admin missing division mapping' } };
    }
    if (user.division_id !== divisionId) {
      return { error: { status: 403, message: 'Division access denied' } };
    }
  }
  return { user };
}

/** List endpoint historically omitted updated_at */
const LIST_USER_RESPONSE_ATTRIBUTES = USER_RESPONSE_ATTRIBUTES.filter((a) => a !== 'updated_at');

const FORBIDDEN_PATCH_ME_KEYS = new Set(['role', 'status', 'user_id', 'profile_image_key', 'created_by']);

function extFromMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  return null;
}

export async function createUser(req, res) {
  try {
    const { user_id, name, password, email, crew_type, head_quarter, mobile } = req.body;
    if (!user_id || !name || !password) {
      return res.status(400).json({
        success: false,
        message: 'user_id, name, and password are required',
      });
    }

    let division_id = req.body?.division_id || null;
    if (isDivisionAdmin(req)) {
      division_id = req.user?.division_id || req.auth?.division_id || null;
      if (!division_id) {
        return res.status(400).json({
          success: false,
          message: 'Division admin must be mapped to a division',
        });
      }
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      user_id,
      name,
      email: email !== undefined ? email || null : null,
      password_hash,
      role: 'USER',
      status: 'ACTIVE',
      created_by: req.auth.userId,
      crew_type: crew_type !== undefined ? crew_type || null : null,
      head_quarter: head_quarter !== undefined ? head_quarter || null : null,
      mobile: mobile !== undefined ? mobile || null : null,
      division_id,
    });

    logInfo('Users', 'User created', { user_id: user.user_id, created_by: req.auth.userId });

    return res.status(201).json({
      success: true,
      user: await toUserResponse(user),
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

    const searchTerm = (search || q || '').trim();
    if (searchTerm) {
      const likeTerm = `%${searchTerm}%`;
      where[Op.or] = [
        { user_id: { [Op.iLike]: likeTerm } },
        { name: { [Op.iLike]: likeTerm } },
        { email: { [Op.iLike]: likeTerm } },
      ];
    }

    if (role) {
      const validRole = USER_ROLES.includes(normalizeRole(role.toUpperCase())) ? normalizeRole(role.toUpperCase()) : null;
      if (validRole) where.role = validRole;
    }

    if (status) {
      const validStatus = ['ACTIVE', 'INACTIVE', 'PENDING_APPROVAL'].includes(status.toUpperCase())
        ? status.toUpperCase()
        : null;
      if (validStatus) where.status = validStatus;
    }

    if (isDivisionAdmin(req)) {
      const divisionId = adminDivisionId(req);
      if (!divisionId) {
        return res.status(400).json({ success: false, message: 'Division admin missing division mapping' });
      }
      where.division_id = divisionId;
    }

    const whereHasConstraints =
      Object.keys(where).length > 0 || Object.getOwnPropertySymbols(where).length > 0;

    const users = await User.findAll({
      attributes: [...LIST_USER_RESPONSE_ATTRIBUTES, 'profile_image_key'],
      where: whereHasConstraints ? where : undefined,
      order: [['created_at', 'DESC']],
    });

    return res.json({ success: true, users: await toUserResponses(users) });
  } catch (err) {
    logWarn('Users', 'List users error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to list users' });
  }
}

export async function listPendingUsers(req, res) {
  try {
    const where = { status: 'PENDING_APPROVAL' };

    if (isDivisionAdmin(req)) {
      const divisionId = adminDivisionId(req);
      if (!divisionId) {
        return res.status(400).json({ success: false, message: 'Division admin missing division mapping' });
      }
      where.division_id = divisionId;
    }

    const users = await User.findAll({
      attributes: [...LIST_USER_RESPONSE_ATTRIBUTES, 'profile_image_key'],
      where,
      order: [['created_at', 'DESC']],
    });

    return res.json({ success: true, users: await toUserResponses(users) });
  } catch (err) {
    logWarn('Users', 'List pending users error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to list pending users' });
  }
}

export async function approveUser(req, res) {
  try {
    const { id } = req.params;
    const result = await findPendingUserForAdmin(req, id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const adminId = req.auth.userId;
    await result.user.update({
      status: 'ACTIVE',
      approved_by: adminId,
      approved_at: new Date(),
    });
    await result.user.reload();

    logInfo('Users', 'User approved', { user_id: result.user.user_id, approved_by: adminId });

    return res.json({
      success: true,
      user: await toUserResponse(result.user),
    });
  } catch (err) {
    logWarn('Users', 'Approve user error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to approve user' });
  }
}

export async function rejectUser(req, res) {
  try {
    const { id } = req.params;
    const result = await findPendingUserForAdmin(req, id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const adminId = req.auth.userId;
    await result.user.update({
      status: 'INACTIVE',
      approved_by: adminId,
      approved_at: new Date(),
    });
    await result.user.reload();

    logInfo('Users', 'User rejected', { user_id: result.user.user_id, rejected_by: adminId });

    return res.json({
      success: true,
      user: await toUserResponse(result.user),
    });
  } catch (err) {
    logWarn('Users', 'Reject user error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to reject user' });
  }
}

export async function getUserById(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id, {
      attributes: [...USER_RESPONSE_ATTRIBUTES, 'profile_image_key'],
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (isDivisionAdmin(req) && user.division_id !== (req.user?.division_id || req.auth?.division_id || null)) {
      return res.status(403).json({ success: false, message: 'Division access denied' });
    }
    return res.json({ success: true, user: await toUserResponse(user) });
  } catch (err) {
    logWarn('Users', 'Get user by ID error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to get user' });
  }
}

export async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { name, email, password, crew_type, head_quarter, mobile, profile_image_key } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (PROTECTED_ADMIN_ROLES.has(normalizeRole(user.role))) {
      return res.status(403).json({ success: false, message: 'Cannot update admin user' });
    }
    if (isDivisionAdmin(req) && user.division_id !== (req.user?.division_id || req.auth?.division_id || null)) {
      return res.status(403).json({ success: false, message: 'Division access denied' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email || null;
    if (password !== undefined && password.trim()) {
      updates.password_hash = await bcrypt.hash(password, 10);
    }
    if (crew_type !== undefined) updates.crew_type = crew_type || null;
    if (head_quarter !== undefined) updates.head_quarter = head_quarter || null;
    if (mobile !== undefined) updates.mobile = mobile || null;
    if (profile_image_key !== undefined) {
      if (profile_image_key === null && user.profile_image_key) {
        await deleteAvatarObject(user.profile_image_key);
      }
      updates.profile_image_key = profile_image_key || null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message:
          'No valid fields to update. Provide name, email, password, crew_type, head_quarter, mobile, or profile_image_key.',
      });
    }

    await user.update(updates);
    await user.reload();

    logInfo('Users', 'User updated', { user_id: user.user_id, updatedBy: req.auth.userId });

    return res.json({
      success: true,
      user: await toUserResponse(user),
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
    const user = await User.findByPk(id, {
      attributes: [...USER_RESPONSE_ATTRIBUTES, 'profile_image_key'],
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (PROTECTED_ADMIN_ROLES.has(normalizeRole(user.role))) {
      return res.status(403).json({ success: false, message: 'Cannot deactivate admin user' });
    }
    if (isDivisionAdmin(req) && user.division_id !== (req.user?.division_id || req.auth?.division_id || null)) {
      return res.status(403).json({ success: false, message: 'Division access denied' });
    }
    await user.update({ status: 'INACTIVE' });
    logInfo('Users', 'User deactivated', { user_id: user.user_id });
    return res.json({
      success: true,
      user: await toUserResponse(user),
    });
  } catch (err) {
    logWarn('Users', 'Deactivate user error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to deactivate user' });
  }
}

export async function me(req, res) {
  try {
    const user = await User.findByPk(req.auth.userId, {
      attributes: [...USER_RESPONSE_ATTRIBUTES, 'profile_image_key'],
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, user: await toUserResponse(user) });
  } catch (err) {
    logWarn('Users', 'Me error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
}

export async function patchMe(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const forbidden = Object.keys(body).filter((k) => FORBIDDEN_PATCH_ME_KEYS.has(k));
    if (forbidden.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot update fields: ${forbidden.join(', ')}`,
      });
    }

    const { name, email, password, crew_type, head_quarter, mobile } = body;

    const user = await User.findByPk(req.auth.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email || null;
    if (password !== undefined && String(password).trim()) {
      updates.password_hash = await bcrypt.hash(password, 10);
    }
    if (crew_type !== undefined) updates.crew_type = crew_type || null;
    if (head_quarter !== undefined) updates.head_quarter = head_quarter || null;
    if (mobile !== undefined) updates.mobile = mobile || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update. Provide name, email, password, crew_type, head_quarter, or mobile.',
      });
    }

    await user.update(updates);
    const fresh = await User.findByPk(req.auth.userId, {
      attributes: [...USER_RESPONSE_ATTRIBUTES, 'profile_image_key'],
    });

    logInfo('Users', 'Profile self-update', { user_id: user.user_id });

    return res.json({
      success: true,
      user: await toUserResponse(fresh),
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: 'email already exists',
      });
    }
    logWarn('Users', 'Patch me error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
}

async function saveAvatarForUser(user, file) {
  const ext = extFromMime(file.mimetype);
  if (!ext) {
    return { error: { status: 400, message: 'Image must be JPEG, PNG, WebP, or GIF' } };
  }
  if (!isAvatarStorageConfigured()) {
    return {
      error: {
        status: 503,
        message: 'Avatar storage is not configured (set AWS_S3_BUCKET and AWS_REGION; credentials via env or IAM)',
      },
    };
  }

  const key = `avatars/${user.id}/${crypto.randomUUID()}.${ext}`;
  try {
    await putAvatarObject(key, file.buffer, file.mimetype);
  } catch (e) {
    logWarn('Users', 'S3 avatar upload failed', { error: e.message });
    return { error: { status: 502, message: 'Failed to upload avatar' } };
  }

  const previousKey = user.profile_image_key;
  await user.update({ profile_image_key: key });
  if (previousKey && previousKey !== key) {
    await deleteAvatarObject(previousKey);
  }
  const fresh = await User.findByPk(user.id, {
    attributes: [...USER_RESPONSE_ATTRIBUTES, 'profile_image_key'],
  });
  return { user: fresh };
}

export async function uploadMyAvatar(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Image file is required (field name: image)' });
    }
    const maxBytes = 5 * 1024 * 1024;
    if (req.file.size > maxBytes) {
      return res.status(400).json({ success: false, message: 'Image must be 5MB or smaller' });
    }

    const user = await User.findByPk(req.auth.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = await saveAvatarForUser(user, req.file);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    logInfo('Users', 'Avatar uploaded', { user_id: user.user_id, self: true });
    return res.json({
      success: true,
      user: await toUserResponse(result.user),
    });
  } catch (err) {
    logWarn('Users', 'Upload avatar error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to upload avatar' });
  }
}

export async function uploadUserAvatar(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Image file is required (field name: image)' });
    }
    const maxBytes = 5 * 1024 * 1024;
    if (req.file.size > maxBytes) {
      return res.status(400).json({ success: false, message: 'Image must be 5MB or smaller' });
    }

    const { id } = req.params;
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (PROTECTED_ADMIN_ROLES.has(normalizeRole(user.role))) {
      return res.status(403).json({ success: false, message: 'Cannot set avatar for admin user' });
    }
    if (isDivisionAdmin(req) && user.division_id !== (req.user?.division_id || req.auth?.division_id || null)) {
      return res.status(403).json({ success: false, message: 'Division access denied' });
    }

    const result = await saveAvatarForUser(user, req.file);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    logInfo('Users', 'Avatar uploaded', { user_id: user.user_id, byAdmin: req.auth.userId });
    return res.json({
      success: true,
      user: await toUserResponse(result.user),
    });
  } catch (err) {
    logWarn('Users', 'Admin upload avatar error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to upload avatar' });
  }
}

// ── POST /api/users/me/face/enroll ──────────────────────────────────────────
export async function enrollMyFace(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Image file is required. Send as multipart/form-data with field name "image".',
      });
    }

    const userId = req.user.id ?? req.user.userId ?? req.auth.userId;
    const imageBuffer = req.file.buffer;

    if (!process.env.AWS_S3_BUCKET?.trim()) {
      return res.status(503).json({
        success: false,
        message: 'Face enrollment requires AWS_S3_BUCKET',
      });
    }
    if (!process.env.AWS_REKOGNITION_COLLECTION_ID?.trim()) {
      return res.status(503).json({
        success: false,
        message: 'Face enrollment requires AWS_REKOGNITION_COLLECTION_ID',
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // If user already has a face enrolled, remove the old one from Rekognition first
    const existing = await UserFaceProfile.findOne({ where: { user_id: userId } });
    if (existing?.rekognition_face_id) {
      await deleteFace(existing.rekognition_face_id).catch((e) =>
        console.warn('[Rekognition] Could not delete old face:', e.message)
      );
    }

    // Upload face image to S3 for audit/record keeping
    const s3Key = `faces/${userId}_${Date.now()}.jpg`;
    const s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: s3Key,
      Body: imageBuffer,
      ContentType: req.file.mimetype || 'image/jpeg',
    }));

    // Index face in AWS Rekognition
    const { faceId, confidence } = await enrollFace(imageBuffer, userId);

    // Save or update face profile in DB (schema: user_face_profiles)
    if (existing) {
      await existing.update({
        rekognition_face_id: faceId,
        s3_key: s3Key,
        status: 'active',
        last_error: null,
      });
    } else {
      await UserFaceProfile.create({
        user_id: userId,
        rekognition_face_id: faceId,
        s3_key: s3Key,
        status: 'active',
        last_error: null,
      });
    }

    logInfo('Users', 'Face enrolled', { user_id: user.user_id });

    return res.status(200).json({
      success: true,
      message: 'Face enrolled successfully.',
      data: {
        faceId,
        confidence: parseFloat(Number(confidence).toFixed(2)),
        enrolledAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[enrollMyFace] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/users/me/face/status ───────────────────────────────────────────
export async function getMyFaceStatus(req, res) {
  try {
    const userId = req.user.id ?? req.user.userId ?? req.auth.userId;
    const profile = await UserFaceProfile.findOne({ where: { user_id: userId } });

    const active = profile?.status === 'active';

    return res.status(200).json({
      success: true,
      data: {
        enrolled: active,
        enrolledAt: active ? (profile.updatedAt ? profile.updatedAt.toISOString() : null) : null,
        isActive: active,
      },
    });
  } catch (err) {
    console.error('[getMyFaceStatus] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /api/face/recognize (internal / monitor use) ───────────────────────
export async function recognizeFaceFromFrame(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image file is required.' });
    }

    const result = await recognizeFace(req.file.buffer);

    if (!result.matched) {
      return res.status(200).json({
        success: true,
        matched: false,
        reason: result.reason ?? 'No match found in collection.',
      });
    }

    const topUserId = result.topMatch.userId;
    const user = await User.findByPk(topUserId, {
      attributes: ['id', 'name', 'user_id', 'role', 'division_id'],
    });

    return res.status(200).json({
      success: true,
      matched: true,
      topMatch: {
        ...result.topMatch,
        user: user ?? null,
      },
      allMatches: result.matches,
    });
  } catch (err) {
    console.error('[recognizeFaceFromFrame] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}
