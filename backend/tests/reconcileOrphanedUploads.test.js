'use strict';

/**
 * Tests for the orphaned-upload reconciliation job (#1025).
 */

const fs = require('fs');
const path = require('path');

// Mock db/schema before requiring the job
jest.mock('../src/db/schema', () => ({
  query: jest.fn(),
  isPostgres: false,
}));

// Mock fs so we don't touch the real filesystem
jest.mock('fs');

// Mock logger
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const db = require('../src/db/schema');
const { reconcileOrphanedUploads } = require('../src/jobs/reconcileOrphanedUploads');

// Helper to build a fake stat with mtime
function makeStat(ageSeconds) {
  return { mtime: new Date(Date.now() - ageSeconds * 1000) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reconcileOrphanedUploads — dry-run mode', () => {
  it('returns orphaned files without deleting them', async () => {
    // On-disk: two images, one video
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dir) => {
      if (dir.endsWith('videos')) return ['old-video.mp4'];
      return ['referenced.jpg', 'orphan.png'];
    });
    fs.statSync.mockImplementation(() => makeStat(7200)); // 2 hours old

    // DB references only referenced.jpg
    db.query.mockResolvedValueOnce({ rows: [{ image_url: '/uploads/referenced.jpg' }] }); // products
    db.query.mockResolvedValueOnce({ rows: [] }); // product_images
    db.query.mockResolvedValueOnce({ rows: [] }); // product_videos

    const report = await reconcileOrphanedUploads({ dryRun: true });

    expect(report.orphaned).toContain('orphan.png');
    expect(report.orphaned).toContain('old-video.mp4');
    expect(report.kept).toContain('referenced.jpg');
    expect(report.deleted).toBe(0);
    // Should NOT have called unlink in dry-run mode
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('handles CDN-prefixed URLs correctly', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dir) => {
      if (dir.endsWith('videos')) return [];
      return ['abc123.webp'];
    });
    fs.statSync.mockReturnValue(makeStat(7200));

    // DB stores CDN-prefixed URL
    db.query.mockResolvedValueOnce({ rows: [{ image_url: 'https://cdn.example.com/uploads/abc123.webp' }] });
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const report = await reconcileOrphanedUploads({ dryRun: true });

    expect(report.kept).toContain('abc123.webp');
    expect(report.orphaned).toHaveLength(0);
  });

  it('handles product_images.url references', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dir) => {
      if (dir.endsWith('videos')) return [];
      return ['gallery-img.jpg'];
    });
    fs.statSync.mockReturnValue(makeStat(7200));

    db.query.mockResolvedValueOnce({ rows: [] }); // products — no image_url
    db.query.mockResolvedValueOnce({ rows: [{ url: '/uploads/gallery-img.jpg' }] }); // product_images
    db.query.mockResolvedValueOnce({ rows: [] });

    const report = await reconcileOrphanedUploads({ dryRun: true });

    expect(report.kept).toContain('gallery-img.jpg');
    expect(report.orphaned).toHaveLength(0);
  });
});

describe('reconcileOrphanedUploads — live mode', () => {
  it('deletes orphaned files and returns correct count', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dir) => {
      if (dir.endsWith('videos')) return ['orphan-video.mp4'];
      return ['good.jpg', 'orphan.png'];
    });
    fs.statSync.mockReturnValue(makeStat(7200));
    fs.unlinkSync.mockImplementation(() => {}); // no-op

    db.query.mockResolvedValueOnce({ rows: [{ image_url: '/uploads/good.jpg' }] });
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const report = await reconcileOrphanedUploads({ dryRun: false });

    expect(report.deleted).toBe(2); // orphan.png + orphan-video.mp4
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    expect(report.orphaned).toContain('orphan.png');
    expect(report.orphaned).toContain('orphan-video.mp4');
    expect(report.kept).toContain('good.jpg');
  });

  it('continues if a single unlink fails', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dir) => {
      if (dir.endsWith('videos')) return [];
      return ['orphan1.jpg', 'orphan2.jpg'];
    });
    fs.statSync.mockReturnValue(makeStat(7200));
    // First unlink succeeds, second throws
    fs.unlinkSync
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('Permission denied'); });

    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const report = await reconcileOrphanedUploads({ dryRun: false });

    // Only 1 deleted successfully (second threw)
    expect(report.deleted).toBe(1);
  });
});

describe('reconcileOrphanedUploads — grace period', () => {
  it('keeps files newer than gracePeriodSeconds even if orphaned', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dir) => {
      if (dir.endsWith('videos')) return [];
      return ['brand-new.jpg'];
    });
    // File is only 30 seconds old
    fs.statSync.mockReturnValue(makeStat(30));

    db.query.mockResolvedValueOnce({ rows: [] }); // not referenced
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const report = await reconcileOrphanedUploads({
      dryRun: false,
      gracePeriodSeconds: 3600,
    });

    // File should be kept (within grace period), not deleted
    expect(report.deleted).toBe(0);
    expect(report.kept).toContain('brand-new.jpg');
    expect(report.orphaned).toHaveLength(0);
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('deletes files older than gracePeriodSeconds', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dir) => {
      if (dir.endsWith('videos')) return [];
      return ['old-orphan.jpg'];
    });
    // File is 2 hours old, grace is 1 hour
    fs.statSync.mockReturnValue(makeStat(7200));
    fs.unlinkSync.mockImplementation(() => {});

    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const report = await reconcileOrphanedUploads({
      dryRun: false,
      gracePeriodSeconds: 3600,
    });

    expect(report.deleted).toBe(1);
    expect(report.orphaned).toContain('old-orphan.jpg');
  });
});

describe('reconcileOrphanedUploads — missing directory', () => {
  it('returns empty report when uploads directory does not exist', async () => {
    fs.existsSync.mockReturnValue(false);

    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const report = await reconcileOrphanedUploads({ dryRun: true });

    expect(report.orphaned).toHaveLength(0);
    expect(report.kept).toHaveLength(0);
    expect(report.deleted).toBe(0);
  });
});

describe('reconcileOrphanedUploads — admin HTTP endpoint', () => {
  const { request, app, mockQuery } = require('./setup');
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';

  const adminToken = jwt.sign({ id: 99, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no files on disk, no DB records
    fs.existsSync.mockReturnValue(false);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/uploads/orphaned');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const res = await request(app)
      .get('/api/admin/uploads/orphaned')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  it('GET returns dry-run report for admin', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .get('/api/admin/uploads/orphaned')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(Array.isArray(res.body.orphaned)).toBe(true);
  });

  it('DELETE returns deletion report for admin', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete('/api/admin/uploads/orphaned')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.deleted).toBe('number');
  });
});
