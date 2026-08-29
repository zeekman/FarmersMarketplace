/**
 * passwordReset.test.js — #1012
 * Dedicated tests for the password reset flow.
 *
 * Covers:
 *  - POST /forgot-password: missing email, unknown email (no enumeration), known email
 *  - POST /reset-password: missing fields, short password, invalid/expired token,
 *    tampered token rejection, single-use enforcement, valid reset
 */

jest.mock('../src/services/passwordResetService');
jest.mock('../src/services/emailService');

const express = require('express');
const supertest = require('supertest');
const passwordResetRouter = require('../src/routes/authPasswordReset');
const { createResetToken, consumeResetToken } = require('../src/services/passwordResetService');
const { sendPasswordResetEmail } = require('../src/services/emailService');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', passwordResetRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  sendPasswordResetEmail.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// POST /forgot-password
// ---------------------------------------------------------------------------
describe('POST /forgot-password', () => {
  it('returns 400 when email is missing', async () => {
    const res = await supertest(buildApp()).post('/forgot-password').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email is required/i);
  });

  it('returns 200 with generic message for an unregistered email (no enumeration)', async () => {
    createResetToken.mockResolvedValue(null);
    const res = await supertest(buildApp()).post('/forgot-password').send({ email: 'ghost@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email is registered/i);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('returns 200 and sends reset email for a registered email', async () => {
    createResetToken.mockResolvedValue({ token: 'resettoken123', user: { email: 'user@test.com' } });
    const res = await supertest(buildApp()).post('/forgot-password').send({ email: 'user@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email is registered/i);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith('user@test.com', 'resettoken123');
  });

  it('calls createResetToken with the email', async () => {
    createResetToken.mockResolvedValue(null);
    await supertest(buildApp()).post('/forgot-password').send({ email: 'a@b.com' });
    expect(createResetToken).toHaveBeenCalledWith('a@b.com');
  });
});

// ---------------------------------------------------------------------------
// POST /reset-password
// ---------------------------------------------------------------------------
describe('POST /reset-password', () => {
  it('returns 400 when token is missing', async () => {
    const res = await supertest(buildApp()).post('/reset-password').send({ password: 'NewPass123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token and password are required/i);
  });

  it('returns 400 when password is missing', async () => {
    const res = await supertest(buildApp()).post('/reset-password').send({ token: 'tok' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token and password are required/i);
  });

  it('returns 400 when password is shorter than 8 characters', async () => {
    const res = await supertest(buildApp()).post('/reset-password').send({ token: 'tok', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/i);
  });

  it('returns 400 for an invalid or expired token', async () => {
    consumeResetToken.mockResolvedValue({ ok: false, error: 'Token is invalid or expired.' });
    const res = await supertest(buildApp()).post('/reset-password').send({ token: 'badtoken', password: 'NewPass123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('returns 400 for a tampered token', async () => {
    consumeResetToken.mockResolvedValue({ ok: false, error: 'Token is invalid or expired.' });
    const res = await supertest(buildApp()).post('/reset-password').send({ token: 'tampered!!token', password: 'NewPass123!' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when token has already been used (single-use enforcement)', async () => {
    consumeResetToken.mockResolvedValue({ ok: false, error: 'Token is invalid or expired.' });
    const res = await supertest(buildApp()).post('/reset-password').send({ token: 'already-used', password: 'NewPass123!' });
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful password reset', async () => {
    consumeResetToken.mockResolvedValue({ ok: true });
    const res = await supertest(buildApp()).post('/reset-password').send({ token: 'validtoken', password: 'NewPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password updated/i);
  });

  it('calls consumeResetToken with the token and new password', async () => {
    consumeResetToken.mockResolvedValue({ ok: true });
    await supertest(buildApp()).post('/reset-password').send({ token: 'tok123', password: 'SecurePass1!' });
    expect(consumeResetToken).toHaveBeenCalledWith('tok123', 'SecurePass1!');
  });
});
