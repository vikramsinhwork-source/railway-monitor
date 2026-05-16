// src/services/rekognitionFace.js
import {
  RekognitionClient,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
  CreateCollectionCommand,
  ListCollectionsCommand,
} from '@aws-sdk/client-rekognition';

const client = new RekognitionClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const COLLECTION_ID = process.env.AWS_REKOGNITION_COLLECTION_ID;

/**
 * Called once at server startup.
 * Creates the Rekognition collection if it does not already exist.
 */
export async function ensureCollection() {
  if (!COLLECTION_ID?.trim()) {
    console.warn('[Rekognition] AWS_REKOGNITION_COLLECTION_ID not set; skipping collection setup.');
    return;
  }
  try {
    const existing = await client.send(new ListCollectionsCommand({}));
    const ids = existing.CollectionIds || [];
    if (ids.includes(COLLECTION_ID)) {
      console.log(`[Rekognition] Collection "${COLLECTION_ID}" is ready.`);
      return;
    }
    await client.send(new CreateCollectionCommand({ CollectionId: COLLECTION_ID }));
    console.log(`[Rekognition] Collection "${COLLECTION_ID}" created.`);
  } catch (err) {
    console.error('[Rekognition] Collection setup error:', err.message);
  }
}

/**
 * Indexes a face image into the Rekognition collection.
 * @param {Buffer} imageBuffer - Raw image bytes
 * @param {string|number} userId - Your DB user ID (stored as ExternalImageId)
 * @returns {{ faceId, confidence, externalImageId }}
 */
export async function enrollFace(imageBuffer, userId) {
  const response = await client.send(new IndexFacesCommand({
    CollectionId: COLLECTION_ID,
    Image: { Bytes: imageBuffer },
    ExternalImageId: String(userId),
    DetectionAttributes: ['DEFAULT'],
    MaxFaces: 1,
    QualityFilter: 'AUTO',
  }));

  if (!response.FaceRecords?.length) {
    throw new Error('No face detected in the image. Please use a clear, well-lit photo.');
  }

  const face = response.FaceRecords[0].Face;
  return {
    faceId: face.FaceId,
    confidence: face.Confidence,
    externalImageId: face.ExternalImageId,
  };
}

/**
 * Searches the collection for a matching face.
 * @param {Buffer} imageBuffer - Raw image bytes from camera frame
 * @param {number} threshold - Minimum similarity % (default 80)
 * @returns {{ matched, matches?, topMatch?, reason? }}
 */
export async function recognizeFace(imageBuffer, threshold = 80) {
  try {
    const response = await client.send(new SearchFacesByImageCommand({
      CollectionId: COLLECTION_ID,
      Image: { Bytes: imageBuffer },
      MaxFaces: 5,
      FaceMatchThreshold: threshold,
    }));

    if (!response.FaceMatches?.length) {
      return { matched: false };
    }

    const matches = response.FaceMatches
      .sort((a, b) => b.Similarity - a.Similarity)
      .map((m) => ({
        userId: m.Face.ExternalImageId,
        faceId: m.Face.FaceId,
        confidence: parseFloat(m.Similarity.toFixed(2)),
      }));

    return { matched: true, matches, topMatch: matches[0] };
  } catch (err) {
    if (err.name === 'InvalidParameterException') {
      return { matched: false, reason: 'No face detected in the provided image.' };
    }
    throw err;
  }
}

/**
 * Removes a face from the Rekognition collection.
 * Call this when a user is deleted or re-enrolls.
 * @param {string} faceId - The Rekognition FaceId to delete
 */
export async function deleteFace(faceId) {
  if (!faceId) return;
  await client.send(new DeleteFacesCommand({
    CollectionId: COLLECTION_ID,
    FaceIds: [faceId],
  }));
}
