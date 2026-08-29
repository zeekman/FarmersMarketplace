jest.mock('../src/db/schema', () => ({ query: jest.fn() }));
jest.mock('../src/services/emailVerificationService');
jest.mock('../src/services/emailService');

const express = require('express');
const supertest = require('supertest');
const db = require('../src/db/schema');
const emailVerificationRouter = require('../src/routes/emailVerification');
const { verifyEmail, issueVerificationToken } = require('../src/services/emailVerificationService');
const { sendVerificationEmail } = require('../src/services/emailService');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', emailVerificationRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  sendVerificationEmail.mockResolvedValue(undefined);
  issueVerificationToken.mockResolvedValue('new-token');
});

describe('email verification routes', () => {
  it('verifies an email through the service without req.db', async () => {
    verifyEmail.mockResolvedValue({ ok: true, userId: 3 });

    const res = await supertest(buildApp()).get('/verify-email?token=valid-token');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified successfully/i);
    expect(verifyEmail).toHaveBeenCalledWith('valid-token');
  });

  it('resends verification through the shared db adapter', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 3, email: 'user@example.com', email_verified_at: null }],
      rowCount: 1,
    });

    const res = await supertest(buildApp())
      .post('/resend-verification')
      .send({ email: 'USER@EXAMPLE.COM' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/resent/i);
    expect(db.query).toHaveBeenCalledWith(expect.stringMatching(/SELECT id, email, email_verified_at\s+FROM users/), [
      'user@example.com',
    ]);
    expect(issueVerificationToken).toHaveBeenCalledWith(3);
    expect(sendVerificationEmail).toHaveBeenCalledWith('user@example.com', 'new-token');
  });
});
