/**
 * Avatar storage: S3 PutObject and profile image URLs (public base or presigned GET).
 * Requires AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY for uploads.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let _client;

function getClient() {
  if (_client) return _client;
  const region = process.env.AWS_REGION;
  if (!region) return null;
  _client = new S3Client({
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return _client;
}

export function isAvatarStorageConfigured() {
  return !!(process.env.AWS_S3_BUCKET && process.env.AWS_REGION);
}

function bucket() {
  return process.env.AWS_S3_BUCKET || '';
}

/**
 * @param {string} key
 * @param {Buffer} body
 * @param {string} contentType
 */
export async function putAvatarObject(key, body, contentType) {
  if (!isAvatarStorageConfigured()) {
    throw new Error('S3 avatar storage is not configured');
  }
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteAvatarObject(key) {
  if (!key || !isAvatarStorageConfigured()) return;
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket(),
      Key: key,
    })
  );
}

/**
 * @param {string | null | undefined} key
 * @returns {Promise<string | null>}
 */
export async function getProfileImageUrl(key) {
  if (!key || typeof key !== 'string') return null;

  const publicBase = (process.env.PROFILE_IMAGE_PUBLIC_BASE_URL || '').trim();
  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }

  if (!isAvatarStorageConfigured()) return null;

  const client = getClient();
  if (!client) return null;

  const seconds = parseInt(process.env.PROFILE_IMAGE_PRESIGN_SECONDS || '900', 10);
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
  });
  return getSignedUrl(client, cmd, { expiresIn: Math.min(Math.max(seconds, 60), 86400) });
}
