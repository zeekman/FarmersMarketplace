/**
 * Tests for issue #1160
 * #1160 — auth.js single jwt.verify with clockTolerance:30 and active-account check
 *
 * The #1159 adminAuth.js middleware no longer exists — those checks live in
 * auth.js + requireAdmin.js and are covered by the router tests.
 */

const jwt = require('jsonwebtoken');
const SECRET = 'test-secret-for-jest';

// ── auth middleware (issue #1160) ─────────────────────────────────────────
describe('#1160 — auth.js single verify with clockTolerance:30', () => {
  let auth, mockDb;

  beforeEach(() => {
    jest.resetModules();
    mockDb = { query: jest.fn() };
    jest.mock('../db/schema', () => mockDb);
    jest.mock('./error', () => ({ err: jest.fn((res, status, msg) => res.status(status).json({ error: msg })) }), { virtual: true });
    jest.mock('../middleware/error', () => ({ err: (res, status, msg) => res.status(status).json({ error: msg }) }));
    auth = require('../middleware/auth');
  });

  function makeReqRes(token) {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    return { req, res, next };
  }

  it('accepts a token expired ≤30s ago (clock tolerance)', async () => {
    const token = jwt.sign({ id: 1, role: 'farmer' }, SECRET, { expiresIn: -15 });
    const { req, res, next } = makeReqRes(token);
    mockDb.query.mockResolvedValue({ rows: [{ active: 1 }] });
    await auth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a token expired >30s ago', async () => {
    const token = jwt.sign({ id: 1, role: 'farmer' }, SECRET, { expiresIn: -60 });
    const { req, res, next } = makeReqRes(token);
    await auth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a deactivated account', async () => {
    const token = jwt.sign({ id: 2, role: 'farmer' }, SECRET);
    const { req, res, next } = makeReqRes(token);
    mockDb.query.mockResolvedValue({ rows: [{ active: 0 }] });
    await auth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when no token is provided', async () => {
    const req = { headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await auth(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a token signed with a different algorithm (alg confusion)', async () => {
    const token = jwt.sign({ id: 1, role: 'farmer' }, SECRET, { algorithm: 'HS512' });
    const { req, res, next } = makeReqRes(token);
    await auth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a stream-scoped token used as a Bearer access token (BE-10)', async () => {
    const streamToken = jwt.sign({ id: 1, scope: 'stream' }, SECRET, { expiresIn: '60s' });
    const { req, res, next } = makeReqRes(streamToken);
    await auth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a token minted with a non-access typ (BE-10)', async () => {
    const token = jwt.sign({ id: 1, typ: 'refresh' }, SECRET);
    const { req, res, next } = makeReqRes(token);
    await auth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── lint-style check: no hardcoded fallback secret anywhere ──────────────
describe('no process.env.JWT_SECRET fallback literal in codebase', () => {
  const fs = require('fs');
  const path = require('path');

  function grep(dir, pattern) {
    const hits = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory() && f.name !== 'node_modules' && f.name !== '__tests__') {
        hits.push(...grep(full, pattern));
      } else if (f.isFile() && f.name.endsWith('.js')) {
        if (pattern.test(fs.readFileSync(full, 'utf8'))) hits.push(full);
      }
    }
    return hits;
  }

  it('finds no JWT_SECRET || "<literal>" pattern in src/', () => {
    const srcDir = require('path').join(__dirname, '..');
    const hits = grep(srcDir, /JWT_SECRET\s*\|\|\s*['"`][^'"`]+['"`]/);
    expect(hits).toEqual([]);
  });
});
