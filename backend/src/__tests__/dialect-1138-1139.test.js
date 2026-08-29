const {
  currentTimestamp,
  sixMonthsAgo,
  monthBucket,
} = require('../db/dialect');

describe('database dialect helpers for 1138 and 1139', () => {
  test('uses SQLite date functions without PostgreSQL-only syntax', () => {
    expect(currentTimestamp(false)).toBe("datetime('now')");
    expect(sixMonthsAgo(false)).toBe("datetime('now', '-6 months')");
    expect(monthBucket('o.created_at', false)).toBe("strftime('%Y-%m', o.created_at)");
    expect(currentTimestamp(false)).not.toContain('NOW');
    expect(sixMonthsAgo(false)).not.toContain('INTERVAL');
    expect(monthBucket('o.created_at', false)).not.toContain('TO_CHAR');
  });

  test('retains PostgreSQL expressions for PostgreSQL deployments', () => {
    expect(currentTimestamp(true)).toBe('NOW()');
    expect(sixMonthsAgo(true)).toBe("NOW() - INTERVAL '6 months'");
    expect(monthBucket('o.created_at', true)).toBe("TO_CHAR(o.created_at, 'YYYY-MM')");
  });
});
