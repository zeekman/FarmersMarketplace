'use strict';

const { issueVerificationToken, verifyEmail } = require('../services/emailVerificationService');

function makeDb(user = null) {
  return { query: jest.fn().mockImplementation((sql) => {
    if (sql.startsWith('SELECT')) return Promise.resolve({ rows: user ? [user] : [], rowCount: user ? 1 : 0 });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }) };
}

describe('email verification service', () => {
  it('issues a token and persists its expiry', async () => {
    const db = makeDb();
    const token = await issueVerificationToken(db, 7);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), [
      token,
      expect.any(Date),
      7,
    ]);
  });

  it('verifies a valid token', async () => {
    const db = makeDb({ id: 7 });
    await expect(verifyEmail(db, 'token')).resolves.toEqual({ ok: true, userId: 7 });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('email_verified_at'), [
      expect.any(Date),
      7,
    ]);
  });

  it('rejects expired or invalid tokens', async () => {
    await expect(verifyEmail(makeDb(), 'expired')).resolves.toEqual({
      ok: false,
      error: 'Token is invalid or expired.',
    });
  });

  it('treats an already verified account as invalid', async () => {
    await expect(verifyEmail(makeDb(), 'already-verified')).resolves.toEqual({
      ok: false,
      error: 'Token is invalid or expired.',
    });
  });
});
