const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const multer = require('multer');
const auth = require('../middleware/auth');
const db = require('../db/schema');
const { err } = require('../middleware/error');

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = ['video/mp4'];
const uploadsDir = path.join(__dirname, '../../uploads/videos');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp4').toLowerCase() || '.mp4';
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Only MP4 videos are allowed'), { code: 'INVALID_TYPE' }));
    }
    cb(null, true);
  },
});

function probeDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      (error, stdout) => {
        if (error) return reject(new Error('ffprobe is required to validate video duration'));
        const duration = Number.parseFloat((stdout || '').trim());
        if (!Number.isFinite(duration)) return reject(new Error('Could not read video duration'));
        resolve(duration);
      }
    );
  });
}

router.post('/:id/video', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can upload videos', 'forbidden');

  upload.single('video')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE')
        return err(res, 400, 'Video must be 50 MB or smaller', 'file_too_large');
      if (uploadErr.code === 'INVALID_TYPE')
        return err(res, 400, uploadErr.message, 'invalid_file_type');
      return err(res, 400, 'Upload failed', 'upload_error');
    }

    if (!req.file) return err(res, 400, 'No video file provided', 'no_file');

    try {
      const ownerQuery = db.isPostgres
        ? 'SELECT id FROM products WHERE id = $1 AND farmer_id = $2'
        : 'SELECT id FROM products WHERE id = ? AND farmer_id = ?';
      const { rows } = await db.query(ownerQuery, [req.params.id, req.user.id]);
      if (!rows[0]) {
        fs.unlinkSync(req.file.path);
        return err(res, 404, 'Product not found or not yours', 'not_found');
      }

      const duration = await probeDurationSeconds(req.file.path);
      if (duration > 30) {
        fs.unlinkSync(req.file.path);
        return err(res, 400, 'Video must be 30 seconds or shorter', 'video_too_long');
      }

      const videoUrl = `/uploads/videos/${req.file.filename}`;
      const updateQuery = db.isPostgres
        ? 'UPDATE products SET video_url = $1 WHERE id = $2'
        : 'UPDATE products SET video_url = ? WHERE id = ?';
      await db.query(updateQuery, [videoUrl, req.params.id]);

      return res.status(201).json({ success: true, videoUrl });
    } catch (e) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (error) {
        // file might already be deleted
      }
      return res
        .status(400)
        .json({ success: false, message: e.message, code: 'video_validation_failed' });
    }
  });
});

module.exports = router;
