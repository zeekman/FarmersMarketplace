'use strict';

jest.mock('../db/schema', () => ({ query: jest.fn() }));
jest.mock('../services/objectStorage', () => ({
  configured: true,
  listObjects: jest.fn(),
  deleteObject: jest.fn(),
}));
jest.mock('../logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const db = require('../db/schema');
const objectStorage = require('../services/objectStorage');
const { reconcileOrphanedUploads } = require('../jobs/reconcileOrphanedUploads');
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  jest.clearAllMocks();
  db.query
    .mockResolvedValueOnce({ rows: [{ image_url: 'https://cdn.example.test/assets/uploads/used.jpg' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  objectStorage.listObjects.mockResolvedValue([
    { key: 'uploads/used.jpg', lastModified: new Date('2025-01-01') },
    { key: 'uploads/orphan.png', lastModified: new Date('2025-01-01') },
  ]);
  objectStorage.deleteObject.mockResolvedValue(true);
});

afterAll(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('production orphan upload reconciliation', () => {
  it('lists object-storage keys and preserves referenced keys', async () => {
    const report = await reconcileOrphanedUploads({ dryRun: true, gracePeriodSeconds: 0 });

    expect(objectStorage.listObjects).toHaveBeenCalledWith();
    expect(report.kept).toContain('uploads/used.jpg');
    expect(report.orphaned).toContain('uploads/orphan.png');
    expect(report.deleted).toBe(0);
    expect(objectStorage.deleteObject).not.toHaveBeenCalled();
  });

  it('deletes orphaned objects in live mode', async () => {
    const report = await reconcileOrphanedUploads({ dryRun: false, gracePeriodSeconds: 0 });

    expect(objectStorage.deleteObject).toHaveBeenCalledTimes(1);
    expect(objectStorage.deleteObject).toHaveBeenCalledWith('uploads/orphan.png');
    expect(report.deleted).toBe(1);
  });
});
