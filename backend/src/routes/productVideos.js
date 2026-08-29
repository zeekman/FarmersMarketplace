'use strict';

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const multer = require('multer');
const auth = require('../middleware/auth');
const db = require('../db/schema');
const { err } = require('../middleware/error');
const { rewriteImageUrl } = require('../utils/cdn');

const MAX_BYTES = parseInt(process.env.MAX_VIDEO_SIZE_MB || '100', 10) * 1024 * 1024;
const MAX_DURATION_SECS = 120;
const MAX_VIDEOS_PER_PRODUCT = 3;
const ALLOWED = ['video/mp4', 'video/webm'];

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
      return cb(
        Object.assign(new Error('Only MP4 and WebM videos are allowed'), { code: 'INVALID_TYPE' })
      );
    }
    cb(null, true);
  },
});

function probeDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
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

// POST /api/products/:id/videos — upload a video for a product
router.post('/:id/videos', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can upload videos', 'forbidden');

  upload.single('video')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE')
        return err(res, 400, `Video must be ${MAX_BYTES / 1024 / 1024} MB or smaller`, 'file_too_large');
      if (uploadErr.code === 'INVALID_TYPE')
        return err(res, 415, uploadErr.message, 'unsupported_media_type');
      return err(res, 400, 'Upload failed', 'upload_error');
    }

    if (!req.file) return err(res, 400, 'No video file provided', 'no_file');

    try {
      // Ownership check
      const ownerQ = db.isPostgres
        ? 'SELECT id FROM products WHERE id = $1 AND farmer_id = $2'
        : 'SELECT id FROM products WHERE id = ? AND farmer_id = ?';
      const { rows: ownerRows } = await db.query(ownerQ, [req.params.id, req.user.id]);
      if (!ownerRows[0]) {
        fs.unlinkSync(req.file.path);
        return err(res, 404, 'Product not found or not yours', 'not_found');
      }

      // 3-video-per-product limit
      const countQ = db.isPostgres
        ? 'SELECT COUNT(*) AS cnt FROM product_videos WHERE product_id = $1'
        : 'SELECT COUNT(*) AS cnt FROM product_videos WHERE product_id = ?';
      const { rows: countRows } = await db.query(countQ, [req.params.id]);
      const existing = parseInt(countRows[0]?.cnt ?? countRows[0]?.['COUNT(*)'] ?? 0, 10);
      if (existing >= MAX_VIDEOS_PER_PRODUCT) {
        fs.unlinkSync(req.file.path);
        return err(res, 409, `Products may have at most ${MAX_VIDEOS_PER_PRODUCT} videos`, 'video_limit_exceeded');
      }

      // Duration check
      const duration = await probeDurationSeconds(req.file.path);
      if (duration > MAX_DURATION_SECS) {
        fs.unlinkSync(req.file.path);
        return err(res, 400, `Video must be ${MAX_DURATION_SECS} seconds or shorter`, 'video_too_long');
      }

      // CDN rewrite before storing
      const rawUrl = `/uploads/videos/${req.file.filename}`;
      const videoUrl = rewriteImageUrl(rawUrl);

      const insertQ = db.isPostgres
        ? 'INSERT INTO product_videos (product_id, video_url) VALUES ($1, $2) RETURNING id'
        : 'INSERT INTO product_videos (product_id, video_url) VALUES (?, ?)';
      const { rows: insertRows } = await db.query(insertQ, [req.params.id, videoUrl]);
      const id = insertRows[0]?.id ?? insertRows[0]?.lastID;

      return res.status(201).json({ success: true, id, videoUrl });
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch (_) { /* already deleted */ }
      return res.status(400).json({ success: false, message: e.message, code: 'video_validation_failed' });
    }
  });
});

// GET /api/products/:id/videos — list all video URLs for a product
router.get('/:id/videos', async (req, res) => {
  try {
    const q = db.isPostgres
      ? 'SELECT id, video_url, created_at FROM product_videos WHERE product_id = $1 ORDER BY created_at ASC'
      : 'SELECT id, video_url, created_at FROM product_videos WHERE product_id = ? ORDER BY created_at ASC';
    const { rows } = await db.query(q, [req.params.id]);
    return res.json({ success: true, videos: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
