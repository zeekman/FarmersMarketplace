'use strict';

const bcrypt = require('bcryptjs');
const { createResetToken, consumeResetToken } = require('../services/passwordResetService');

function makeDb({ user = null, record = null } = {}) {
  return { query: jest.fn().mockImplementation((sql) => {
    if (sql.startsWith('SELECT id, email')) return Promise.resolve({ rows: user ? [user] : [], rowCount: user ? 1 : 0 });
    if (sql.startsWith('SELECT id, user_id')) return Promise.resolve({ rows: record ? [record] : [], rowCount: record ? 1 : 0 });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }) };
}

describe('password reset service', () => {
  it('creates a reset token for an existing user', async () => {
    const db = makeDb({ user: { id: 3, email: 'buyer@example.com' } });
    const result = await createResetToken(db, 'BUYER@EXAMPLE.COM');
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.user.id).toBe(3);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO password_reset_tokens'), [
      3,
      expect.any(String),
      expect.any(Date),
    ]);
  });

  it('rejects unknown, expired, or invalid tokens', async () => {
    await expect(createResetToken(makeDb(), 'missing@example.com')).resolves.toBeNull();
    await expect(consumeResetToken(makeDb(), 'invalid', 'strong-password')).resolves.toEqual({
      ok: false,
      error: 'Token is invalid or expired.',
    });
  });

  it('rejects weak passwords', async () => {
    const db = makeDb({ record: { id: 1, user_id: 3 } });
    await expect(consumeResetToken(db, 'valid', 'short')).resolves.toEqual({
      ok: false,
      error: 'Password must be at least 8 characters.',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('updates the password and consumes a valid token', async () => {
    const db = makeDb({ record: { id: 1, user_id: 3 } });
    await expect(consumeResetToken(db, 'valid', 'strong-password')).resolves.toEqual({ ok: true });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), [
      expect.any(String),
      3,
    ]);
    const passwordHash = db.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'))[1][0];
    await expect(bcrypt.compare('strong-password', passwordHash)).resolves.toBe(true);
  });
});
