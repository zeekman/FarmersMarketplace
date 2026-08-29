'use strict';

/**
 * Reconcile orphaned upload files.
 *
 * Scans backend/uploads/ (images) and backend/uploads/videos/ (videos) and
 * removes any files that have no matching record in:
 *   - products.image_url
 *   - product_images.url
 *   - product_videos.video_url
 *
 * Files younger than gracePeriodSeconds are skipped to protect files that have
 * been uploaded but whose DB record hasn't been committed yet.
 *
 * #1025
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const db = require('../db/schema');
const logger = require('../logger');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);

const DEFAULT_UPLOADS_DIR = path.join(__dirname, '../../uploads');
const DEFAULT_GRACE_SECONDS = parseInt(process.env.UPLOAD_ORPHAN_GRACE_SECONDS || '3600', 10);

/**
 * Extract the file basename from a stored URL.
 * Handles:
 *   - Local paths:   /uploads/abc.jpg            → abc.jpg
 *   - Video paths:   /uploads/videos/abc.mp4     → abc.mp4
 *   - CDN URLs:      https://cdn.example.com/uploads/abc.jpg → abc.jpg
 */
function extractBasename(url) {
  if (!url) return null;
  // Strip query string / fragment
  const clean = url.split('?')[0].split('#')[0];
  return path.basename(clean);
}

/**
 * Collect all files (non-recursively) in a directory with the given extensions.
 * Returns an array of { basename, fullPath, mtime }.
 */
function collectFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return extensions.has(ext) && name !== '.gitkeep';
    })
    .map((name) => {
      const fullPath = path.join(dir, name);
      let mtime;
      try {
        mtime = fs.statSync(fullPath).mtime;
      } catch {
        mtime = new Date(0);
      }
      return { basename: name, fullPath, mtime };
    });
}

/**
 * Build the set of referenced basenames from the database.
 */
async function getReferencedBasenames() {
  const [productImages, galleryImages, videos] = await Promise.all([
    db.query('SELECT image_url FROM products WHERE image_url IS NOT NULL', []),
    db.query('SELECT url FROM product_images WHERE url IS NOT NULL', []),
    db.query('SELECT video_url FROM product_videos WHERE video_url IS NOT NULL', []),
  ]);

  const referenced = new Set();

  for (const row of productImages.rows) {
    const bn = extractBasename(row.image_url);
    if (bn) referenced.add(bn);
  }
  for (const row of galleryImages.rows) {
    const bn = extractBasename(row.url);
    if (bn) referenced.add(bn);
  }
  for (const row of videos.rows) {
    const bn = extractBasename(row.video_url);
    if (bn) referenced.add(bn);
  }

  return referenced;
}

/**
 * Reconcile orphaned uploads.
 *
 * @param {object} options
 * @param {boolean} [options.dryRun=true]  When true, no files are deleted.
 * @param {string}  [options.uploadsDir]   Root uploads directory (for testing).
 * @param {number}  [options.gracePeriodSeconds]  Files newer than this age are kept.
 * @returns {Promise<{orphaned: string[], kept: string[], deleted: number}>}
 */
async function reconcileOrphanedUploads({
  dryRun = true,
  uploadsDir = DEFAULT_UPLOADS_DIR,
  gracePeriodSeconds = DEFAULT_GRACE_SECONDS,
} = {}) {
  const now = Date.now();
  const graceMs = gracePeriodSeconds * 1000;

  const imagesDir = uploadsDir;
  const videosDir = path.join(uploadsDir, 'videos');

  // Collect all on-disk files
  const imageFiles = collectFiles(imagesDir, IMAGE_EXTENSIONS);
  const videoFiles = collectFiles(videosDir, VIDEO_EXTENSIONS);
  const allFiles = [...imageFiles, ...videoFiles];

  logger.info('[orphan-uploads] Scanned files', {
    images: imageFiles.length,
    videos: videoFiles.length,
  });

  // Get referenced basenames from DB
  let referenced;
  try {
    referenced = await getReferencedBasenames();
  } catch (err) {
    logger.error('[orphan-uploads] Failed to query DB for referenced uploads', { error: err.message });
    throw err;
  }

  logger.info('[orphan-uploads] DB references', { count: referenced.size });

  const orphaned = [];
  const kept = [];
  let deleted = 0;

  for (const file of allFiles) {
    if (referenced.has(file.basename)) {
      kept.push(file.basename);
      continue;
    }

    // Grace period: skip files that were uploaded recently
    const ageMs = now - file.mtime.getTime();
    if (ageMs < graceMs) {
      logger.debug('[orphan-uploads] Skipping recent file (within grace period)', {
        file: file.basename,
        ageSeconds: Math.floor(ageMs / 1000),
      });
      kept.push(file.basename);
      continue;
    }

    orphaned.push(file.basename);

    if (!dryRun) {
      try {
        fs.unlinkSync(file.fullPath);
        deleted++;
        logger.info('[orphan-uploads] Deleted orphaned file', { file: file.basename });
      } catch (unlinkErr) {
        logger.error('[orphan-uploads] Failed to delete file', {
          file: file.basename,
          error: unlinkErr.message,
        });
      }
    } else {
      logger.info('[orphan-uploads] DRY-RUN: would delete', { file: file.basename });
    }
  }

  logger.info('[orphan-uploads] Reconciliation complete', {
    dryRun,
    orphanedCount: orphaned.length,
    keptCount: kept.length,
    deleted,
  });

  return { orphaned, kept, deleted };
}

/**
 * Start the scheduled orphaned-upload cleanup job.
 * Runs on ORPHAN_CLEANUP_CRON (default: daily at 03:00 UTC).
 */
function startOrphanedUploadsCleanupJob() {
  const schedule = process.env.ORPHAN_CLEANUP_CRON || '0 3 * * *';
  const gracePeriodSeconds = parseInt(process.env.UPLOAD_ORPHAN_GRACE_SECONDS || '3600', 10);

  cron.schedule(schedule, () => {
    reconcileOrphanedUploads({ dryRun: false, gracePeriodSeconds }).catch((err) =>
      logger.error('[orphan-uploads] Job error', { error: err.message })
    );
  });

  logger.info('[orphan-uploads] Cleanup job scheduled', {
    schedule,
    gracePeriodSeconds,
    mode: 'live',
  });
}

module.exports = { reconcileOrphanedUploads, startOrphanedUploadsCleanupJob };
