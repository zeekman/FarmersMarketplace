const jwt = require('jsonwebtoken');

const SECRET = 'test-secret';
process.env.JWT_SECRET = SECRET;

// Load middleware after setting env
const authMiddleware = require('../src/middleware/auth');

function makeReq(token) {
  return { headers: { authorization: token ? `Bearer ${token}` : undefined } };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; };
  return res;
}

describe('auth middleware', () => {
  it('calls next() and sets req.user for a valid token', () => {
    const token = jwt.sign({ id: 1, role: 'buyer' }, SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(1);
  });

  it('returns 401 missing_token when no Authorization header', () => {
    const req = makeReq(null);
    const res = makeRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._body.code).toBe('missing_token');
  });

  it('returns 401 token_expired for an expired token', () => {
    // iat/exp in the past — clockTolerance:30 should NOT save a token expired >30s ago
    const token = jwt.sign({ id: 2 }, SECRET, { expiresIn: -60 });
    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._body.code).toBe('token_expired');
  });

  it('returns 401 invalid_token for a tampered token', () => {
    const token = jwt.sign({ id: 3 }, 'wrong-secret');
    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._body.code).toBe('invalid_token');
  });

  it('accepts a token expired within the 30s clock-skew tolerance', () => {
    // Expired 10 seconds ago — within the 30s tolerance window
    const token = jwt.sign({ id: 4 }, SECRET, { expiresIn: -10 });
    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(4);
  });
});
