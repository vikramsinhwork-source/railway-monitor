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
import {
  putAvatarObject,
  deleteAvatarObject,
  isAvatarStorageConfigured,
} from '../../services/s3Avatar.js';
import {
  isFaceEnrollmentConfigured,
  collectionId,
  countFacesInS3,
  indexFaceFromS3,
  deleteFacesFromCollection,
} from '../../services/rekognitionFace.js';
import { normalizeRole } from '../../middleware/rbac.middleware.js';

const USER_RESPONSE_ATTRIBUTES = [
  'id',
  'user_id',
  'name',
  'email',
  'role',
  'division_id',
  'status',
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
      const validStatus = ['ACTIVE', 'INACTIVE'].includes(status.toUpperCase()) ? status.toUpperCase() : null;
      if (validStatus) where.status = validStatus;
    }

    if (isDivisionAdmin(req)) {
      const divisionId = req.user?.division_id || req.auth?.division_id || null;
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

async function cleanupEnrollmentS3(key) {
  if (!key) return;
  try {
    await deleteAvatarObject(key);
  } catch (_) {
    /* best effort */
  }
}

function rekognitionHttpStatus(err) {
  const name = err && err.name;
  if (name === 'ResourceNotFoundException') {
    return { status: 503, message: 'Rekognition collection not found or not accessible' };
  }
  if (name === 'InvalidS3ObjectException' || name === 'InvalidImageFormatException') {
    return { status: 400, message: 'Image could not be read for face detection' };
  }
  if (name === 'AccessDeniedException') {
    return { status: 503, message: 'AWS denied access to S3 or Rekognition' };
  }
  return null;
}

export async function getMyFaceStatus(req, res) {
  try {
    const profile = await UserFaceProfile.findOne({
      where: { user_id: req.auth.userId },
    });
    if (!profile) {
      return res.json({
        success: true,
        status: 'none',
        last_error: null,
      });
    }
    return res.json({
      success: true,
      status: profile.status,
      last_error: profile.last_error || null,
    });
  } catch (err) {
    logWarn('Users', 'Face status error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to load face enrollment status' });
  }
}

export async function enrollMyFace(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Image file is required (field name: image)' });
    }
    const maxBytes = 5 * 1024 * 1024;
    if (req.file.size > maxBytes) {
      return res.status(400).json({ success: false, message: 'Image must be 5MB or smaller' });
    }

    if (!isAvatarStorageConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Face enrollment requires S3 (AWS_S3_BUCKET and AWS_REGION)',
      });
    }
    if (!isFaceEnrollmentConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Face enrollment requires AWS_REKOGNITION_COLLECTION_ID (and S3)',
      });
    }

    const user = await User.findByPk(req.auth.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const ext = extFromMime(req.file.mimetype);
    if (!ext) {
      return res.status(400).json({ success: false, message: 'Image must be JPEG, PNG, WebP, or GIF' });
    }

    const bucket = process.env.AWS_S3_BUCKET;
    const coll = collectionId();
    const key = `face-enrollment/${user.id}/${crypto.randomUUID()}.${ext}`;

    let profile = await UserFaceProfile.findOne({ where: { user_id: user.id } });
    const previousFaceId = profile && profile.rekognition_face_id;
    const previousS3Key = profile && profile.s3_key;

    if (!profile) {
      profile = await UserFaceProfile.create({
        user_id: user.id,
        status: 'pending',
        rekognition_face_id: null,
        s3_key: null,
        last_error: null,
      });
    } else {
      await profile.update({ status: 'pending', last_error: null });
    }

    if (previousS3Key && previousS3Key !== key) {
      await cleanupEnrollmentS3(previousS3Key);
    }

    try {
      await putAvatarObject(key, req.file.buffer, req.file.mimetype);
    } catch (e) {
      logWarn('Users', 'Face enroll S3 upload failed', { error: e.message });
      await profile.update({
        status: 'failed',
        s3_key: null,
        last_error: 'Failed to upload image',
      });
      return res.status(502).json({ success: false, message: 'Failed to upload image' });
    }

    await profile.update({ s3_key: key });

    try {
      const faceCount = await countFacesInS3(bucket, key);
      if (faceCount === 0) {
        await cleanupEnrollmentS3(key);
        await profile.update({
          status: 'failed',
          s3_key: null,
          last_error: 'No face detected in image',
        });
        return res.status(400).json({
          success: false,
          message: 'No face detected. Use a clear photo with your face visible.',
        });
      }
      if (faceCount > 1) {
        await cleanupEnrollmentS3(key);
        await profile.update({
          status: 'failed',
          s3_key: null,
          last_error: 'Multiple faces detected',
        });
        return res.status(400).json({
          success: false,
          message: 'Multiple faces detected. Use a photo with only one face.',
        });
      }

      if (previousFaceId) {
        try {
          await deleteFacesFromCollection(coll, [previousFaceId]);
        } catch (delErr) {
          logWarn('Users', 'Rekognition delete old face failed (continuing)', { error: delErr.message });
        }
      }

      const { faceId } = await indexFaceFromS3(coll, bucket, key, user.id);

      await cleanupEnrollmentS3(key);
      await profile.update({
        status: 'active',
        rekognition_face_id: faceId,
        s3_key: null,
        last_error: null,
      });

      logInfo('Users', 'Face enrolled', { user_id: user.user_id });
      return res.json({
        success: true,
        status: 'active',
        message: 'Face enrolled successfully',
      });
    } catch (err) {
      await cleanupEnrollmentS3(key);
      const mapped = rekognitionHttpStatus(err);
      const message = mapped
        ? mapped.message
        : err.code === 'NO_INDEXED_FACE'
          ? 'Face could not be indexed (quality or pose). Try another photo.'
          : err.message || 'Face enrollment failed';

      await profile.update({
        status: 'failed',
        s3_key: null,
        last_error: message,
      });

      if (mapped) {
        return res.status(mapped.status).json({ success: false, message });
      }
      if (err.code === 'NO_INDEXED_FACE' || err.code === 'NO_FACE_ID') {
        return res.status(400).json({ success: false, message });
      }
      logWarn('Users', 'Face enroll error', { error: err.message, name: err.name });
      return res.status(502).json({ success: false, message: 'Face enrollment failed' });
    }
  } catch (err) {
    logWarn('Users', 'Face enroll unexpected error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Face enrollment failed' });
  }
}
