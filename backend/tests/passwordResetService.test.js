jest.mock('../src/db/schema', () => ({ query: jest.fn() }));

const db = require('../src/db/schema');
const { createResetToken, consumeResetToken } = require('../src/services/passwordResetService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('passwordResetService', () => {
  it('creates a reset token using the shared database adapter', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 7, email: 'user@example.com' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await createResetToken('USER@example.com');

    expect(result.user).toEqual({ id: 7, email: 'user@example.com' });
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.query.mock.calls[0][0]).toMatch(/SELECT id, email FROM users/);
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE password_reset_tokens/);
    expect(db.query.mock.calls[2][0]).toMatch(/INSERT INTO password_reset_tokens/);
  });

  it('rejects an invalid or expired token without updating a user', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(consumeResetToken('invalid-token', 'NewPassword123!')).resolves.toEqual({
      ok: false,
      error: 'Token is invalid or expired.',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('claims a valid token and updates the user password', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 12, user_id: 7 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(consumeResetToken('valid-token', 'NewPassword123!')).resolves.toEqual({ ok: true });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0][0]).toMatch(/UPDATE password_reset_tokens/);
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE users SET password_hash/);
  });
});
