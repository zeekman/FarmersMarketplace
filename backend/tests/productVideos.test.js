'use strict';

/**
 * Tests for backend/src/routes/productVideos.js
 * Closes #1006
 */

const jwt = require('jsonwebtoken');
const path = require('path');
const { request, app, mockQuery, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

// Mock child_process.execFile so ffprobe never runs in tests
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: jest.fn(),
}));

const { execFile } = require('child_process');

// Helper: make ffprobe report a given duration (seconds)
function mockFfprobe(durationSecs) {
  execFile.mockImplementation((_bin, _args, cb) => cb(null, String(durationSecs), ''));
}

// Helper: make ffprobe fail (simulates missing binary)
function mockFfprobeError(message = 'ffprobe not found') {
  execFile.mockImplementation((_bin, _args, cb) => cb(new Error(message), '', ''));
}

// A tiny valid MP4 buffer (just needs to pass multer's mimetype check)
const DUMMY_VIDEO = Buffer.from('dummy-video-content');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  execFile.mockReset();
});

// ── GET /api/products/:id/videos ──────────────────────────────────────────────
describe('GET /api/products/:id/videos', () => {
  it('returns empty list when no videos exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/products/1/videos');
    expect(res.status).toBe(200);
    expect(res.body.videos).toEqual([]);
  });

  it('returns existing video entries', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, video_url: '/uploads/videos/test.mp4', created_at: '2026-01-01' }],
      rowCount: 1,
    });
    const res = await request(app).get('/api/products/1/videos');
    expect(res.status).toBe(200);
    expect(res.body.videos).toHaveLength(1);
    expect(res.body.videos[0].video_url).toBe('/uploads/videos/test.mp4');
  });
});

// ── POST /api/products/:id/videos ─────────────────────────────────────────────
describe('POST /api/products/:id/videos — auth & ownership', () => {
  it('returns 403 for buyers', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/1/videos')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .attach('video', DUMMY_VIDEO, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no file is attached', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/1/videos')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(400);
  });

  it('returns 415 for an unsupported file type', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/products/1/videos')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .attach('video', DUMMY_VIDEO, { filename: 'clip.avi', contentType: 'video/avi' });
    expect(res.status).toBe(415);
  });

  it('returns 404 when the product does not belong to the farmer', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockFfprobe(30); // duration fine, but ownership check fails
    // ownership query → no rows
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/products/1/videos')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .attach('video', DUMMY_VIDEO, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the product already has 3 videos', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockFfprobe(30);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })   // ownership OK
      .mockResolvedValueOnce({ rows: [{ cnt: 3 }], rowCount: 1 });  // count = 3

    const res = await request(app)
      .post('/api/products/1/videos')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .attach('video', DUMMY_VIDEO, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('video_limit_exceeded');
  });

  it('returns 400 when the video exceeds the 120-second limit', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockFfprobe(200); // 200 s > 120 s
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }], rowCount: 1 }); // count OK

    const res = await request(app)
      .post('/api/products/1/videos')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .attach('video', DUMMY_VIDEO, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('video_too_long');
  });

  it('uploads successfully and rewrites URL via CDN mock', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockFfprobe(60); // 60 s — within limit
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })              // ownership
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }], rowCount: 1 })              // count
      .mockResolvedValueOnce({ rows: [{ id: 9, lastID: 9 }], rowCount: 1 });  // INSERT

    const res = await request(app)
      .post('/api/products/1/videos')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr).set('X-CSRF-Token', csrf)
      .attach('video', DUMMY_VIDEO, { filename: 'clip.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.videoUrl).toMatch(/\/uploads\/videos\//);
  });
});
