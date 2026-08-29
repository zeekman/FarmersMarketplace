const db = require('../db/schema');
const { stripSensitiveFields } = require('../middleware/sanitize');
const { couponNowExpression } = require('../utils/couponTime');

describe('issues #1136 and #1137 security and database regressions', () => {
  afterEach(() => {
    db.isPostgres = false;
  });

  it('strips mnemonic and webhook secrets recursively from response data', () => {
    const response = {
      user: {
        stellar_secret_key: 'SSECRET',
        stellar_mnemonic: 'secret words',
        profile: { webhook_secret: 'whsec_test', display_name: 'Farmer' },
      },
      items: [{ password: 'pw', name: 'Apples' }],
    };

    expect(stripSensitiveFields(response)).toEqual({
      user: { profile: { display_name: 'Farmer' } },
      items: [{ name: 'Apples' }],
    });
  });

  it('uses SQLite datetime syntax for coupon lookups', () => {
    db.isPostgres = false;
    expect(couponNowExpression(db)).toBe("datetime('now')");
  });

  it('retains PostgreSQL NOW syntax for PostgreSQL coupon lookups', () => {
    db.isPostgres = true;
    expect(couponNowExpression(db)).toBe('NOW()');
  });
});
