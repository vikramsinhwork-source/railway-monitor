/**
 * Serialize User for API responses: never expose password_hash or profile_image_key;
 * add profile_image_url (public base or presigned GET).
 */

import { getProfileImageUrl } from '../../services/s3Avatar.js';

/**
 * @param {import('sequelize').Model | Record<string, unknown>} user
 * @returns {Promise<Record<string, unknown>>}
 */
export async function toUserResponse(user) {
  const plain = user?.get ? user.get({ plain: true }) : { ...user };
  const imageKey = plain.profile_image_key;
  delete plain.password_hash;
  delete plain.profile_image_key;
  plain.profile_image_url = await getProfileImageUrl(imageKey);
  return plain;
}

/**
 * @param {import('sequelize').Model[]} users
 */
export async function toUserResponses(users) {
  return Promise.all(users.map((u) => toUserResponse(u)));
}
