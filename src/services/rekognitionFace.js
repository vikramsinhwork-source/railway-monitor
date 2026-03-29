/**
 * Amazon Rekognition: detect faces in S3 object, index into collection, delete indexed faces.
 * Requires AWS_REGION, AWS_REKOGNITION_COLLECTION_ID, S3 bucket credentials (same as avatar).
 */

import {
  RekognitionClient,
  DetectFacesCommand,
  IndexFacesCommand,
  DeleteFacesCommand,
} from '@aws-sdk/client-rekognition';

let _client;

function getClient() {
  if (_client) return _client;
  const region = process.env.AWS_REGION;
  if (!region) return null;
  _client = new RekognitionClient({
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

export function isFaceEnrollmentConfigured() {
  return !!(
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_REGION &&
    (process.env.AWS_REKOGNITION_COLLECTION_ID || '').trim()
  );
}

export function collectionId() {
  return (process.env.AWS_REKOGNITION_COLLECTION_ID || '').trim();
}

/**
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<number>} number of faces detected
 */
export async function countFacesInS3(bucket, key) {
  const client = getClient();
  if (!client) throw new Error('Rekognition client not available');
  const out = await client.send(
    new DetectFacesCommand({
      Image: { S3Object: { Bucket: bucket, Name: key } },
      Attributes: ['DEFAULT'],
    })
  );
  return (out.FaceDetails && out.FaceDetails.length) || 0;
}

/**
 * @param {string} collId
 * @param {string} bucket
 * @param {string} key
 * @param {string} externalImageId Rekognition external ID (user UUID)
 * @returns {Promise<{ faceId: string }>}
 */
export async function indexFaceFromS3(collId, bucket, key, externalImageId) {
  const client = getClient();
  if (!client) throw new Error('Rekognition client not available');
  const out = await client.send(
    new IndexFacesCommand({
      CollectionId: collId,
      Image: { S3Object: { Bucket: bucket, Name: key } },
      ExternalImageId: externalImageId,
      MaxFaces: 1,
      QualityFilter: 'AUTO',
      DetectionAttributes: [],
    })
  );
  const records = out.FaceRecords || [];
  if (records.length === 0) {
    const reasons = (out.UnindexedFaces || [])
      .map((f) => (f.Reasons || []).join(','))
      .filter(Boolean)
      .join('; ');
    const err = new Error(reasons || 'Face could not be indexed');
    err.code = 'NO_INDEXED_FACE';
    throw err;
  }
  const faceId = records[0].Face && records[0].Face.FaceId;
  if (!faceId) {
    const err = new Error('Missing FaceId from Rekognition');
    err.code = 'NO_FACE_ID';
    throw err;
  }
  return { faceId };
}

/**
 * @param {string} collId
 * @param {string[]} faceIds
 */
export async function deleteFacesFromCollection(collId, faceIds) {
  const ids = (faceIds || []).filter(Boolean);
  if (ids.length === 0) return;
  const client = getClient();
  if (!client) return;
  await client.send(
    new DeleteFacesCommand({
      CollectionId: collId,
      FaceIds: ids,
    })
  );
}
