import multer from 'multer';

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(
      (file.mimetype || '').toLowerCase()
    );
    if (ok) cb(null, true);
    else cb(new Error('INVALID_IMAGE_TYPE'));
  },
});

export const avatarUploadSingle = upload.single('image');

export function handleAvatarUploadError(err, req, res, next) {
  if (err?.message === 'INVALID_IMAGE_TYPE') {
    return res.status(400).json({ success: false, message: 'Image must be JPEG, PNG, WebP, or GIF' });
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Image must be 5MB or smaller' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  return next(err);
}
