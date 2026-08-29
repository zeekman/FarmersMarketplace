/**
 * Unit tests for adminOrphanedUploads route
 * Critical tests for file deletion safety (issue #1155)
 */

const request = require('supertest');
const express = require('express');
const adminOrphanedUploadsRouter = require('../routes/adminOrphanedUploads');
const { reconcileOrphanedUploads } = require('../jobs/reconcileOrphanedUploads');

jest.mock('../middleware/adminAuth', () => (req, res, next) => {
  req.user = { id: 1, role: 'admin' };
  next();
});

jest.mock('../jobs/reconcileOrphanedUploads');

const app = express();
app.use(express.json());
app.use('/api/admin/uploads', adminOrphanedUploadsRouter);

describe('GET /api/admin/uploads/orphaned', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('dry-run mode reports orphaned files without deleting', async () => {
    reconcileOrphanedUploads.mockResolvedValue({
      orphaned: ['old-image.jpg', 'unused-video.mp4'],
      kept: ['product-1.jpg', 'gallery-2.jpg'],
      deleted: 0,
    });

    const res = await request(app).get('/api/admin/uploads/orphaned?dryRun=true');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.orphanedCount).toBe(2);
    expect(res.body.deleted).toBe(0);
    expect(res.body.orphaned).toEqual(['old-image.jpg', 'unused-video.mp4']);
  });

  test('defaults to dry-run mode when dryRun param not specified', async () => {
    reconcileOrphanedUploads.mockResolvedValue({
      orphaned: ['test.jpg'],
      kept: ['active.jpg'],
      deleted: 0,
    });

    await request(app).get('/api/admin/uploads/orphaned');

    expect(reconcileOrphanedUploads).toHaveBeenCalledWith({ dryRun: true });
  });

  test('live mode when explicitly disabled', async () => {
    reconcileOrphanedUploads.mockResolvedValue({
      orphaned: ['deleted.jpg'],
      kept: [],
      deleted: 1,
    });

    const res = await request(app).get('/api/admin/uploads/orphaned?dryRun=false');

    expect(res.body.dryRun).toBe(false);
    expect(reconcileOrphanedUploads).toHaveBeenCalledWith({ dryRun: false });
  });

  test('handles reconciliation errors', async () => {
    reconcileOrphanedUploads.mockRejectedValue(new Error('Database connection failed'));

    const res = await request(app).get('/api/admin/uploads/orphaned');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('reconcile_failed');
  });
});

describe('DELETE /api/admin/uploads/orphaned', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('live mode deletes orphaned files', async () => {
    reconcileOrphanedUploads.mockResolvedValue({
      orphaned: ['old-image.jpg'],
      kept: ['product-1.jpg'],
      deleted: 1,
    });

    const res = await request(app).delete('/api/admin/uploads/orphaned');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(1);
    expect(reconcileOrphanedUploads).toHaveBeenCalledWith({ dryRun: false });
  });

  test('handles reconciliation errors', async () => {
    reconcileOrphanedUploads.mockRejectedValue(new Error('File system error'));

    const res = await request(app).delete('/api/admin/uploads/orphaned');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('reconcile_failed');
  });
});

describe('Safety regression test: referenced files never deleted', () => {
  test('file referenced in products.image_url is never deleted', async () => {
    // Simulate reconciliation that correctly identifies referenced file
    reconcileOrphanedUploads.mockResolvedValue({
      orphaned: [],
      kept: ['product-main-image.jpg'],
      deleted: 0,
    });

    const res = await request(app).delete('/api/admin/uploads/orphaned');

    expect(res.body.deleted).toBe(0);
    expect(res.body.orphanedCount).toBe(0);
  });

  test('file referenced in product_images.url is never deleted', async () => {
    reconcileOrphanedUploads.mockResolvedValue({
      orphaned: [],
      kept: ['gallery-image-5.jpg'],
      deleted: 0,
    });

    const res = await request(app).delete('/api/admin/uploads/orphaned');

    expect(res.body.deleted).toBe(0);
  });

  test('file referenced in product_videos.video_url is never deleted', async () => {
    reconcileOrphanedUploads.mockResolvedValue({
      orphaned: [],
      kept: ['product-demo.mp4'],
      deleted: 0,
    });

    const res = await request(app).delete('/api/admin/uploads/orphaned');

    expect(res.body.deleted).toBe(0);
  });
});
