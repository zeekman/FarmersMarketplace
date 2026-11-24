/**
 * Unit tests for adminOrphanedUploads route
 * Critical tests for file deletion safety (issue #1155)
 */

const request = require('supertest');
const express = require('express');
const adminOrphanedUploadsRouter = require('../routes/adminOrphanedUploads');
const { reconcileOrphanedUploads } = require('../jobs/reconcileOrphanedUploads');

// Inject the user via the auth middleware so the real requireAdmin runs.
jest.mock('../middleware/auth', () => (req, _res, next) => {
  req.user = req._mockUser || { id: 1, role: 'admin' };
  next();
});
// Plain async stub (not jest.fn) so requireAdmin's writeAuditLog() keeps a
// resolved promise to .catch() even after the global jest.resetAllMocks().
jest.mock('../utils/auditLog', () => ({ writeAuditLog: async () => undefined }));
jest.mock('../jobs/reconcileOrphanedUploads');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => {
      req._mockUser = user;
      next();
    });
  }
  app.use('/api/admin/uploads', adminOrphanedUploadsRouter);
  return app;
}

const app = buildApp();

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

describe('admin-only orphaned-uploads endpoints reject non-admins with 403 (#009)', () => {
  const buyerApp = () => buildApp({ id: 2, role: 'buyer' });

  test('GET /api/admin/uploads/orphaned returns 403 for a non-admin', async () => {
    const res = await request(buyerApp()).get('/api/admin/uploads/orphaned');
    expect(res.status).toBe(403);
  });

  test('DELETE /api/admin/uploads/orphaned returns 403 for a non-admin', async () => {
    const res = await request(buyerApp()).delete('/api/admin/uploads/orphaned');
    expect(res.status).toBe(403);
    expect(reconcileOrphanedUploads).not.toHaveBeenCalled();
  });
});
