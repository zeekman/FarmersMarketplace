/**
 * SQL fragments that differ between the PostgreSQL and SQLite adapters.
 * Values remain parameterized; these functions only return fixed SQL literals.
 */
function currentTimestamp(isPostgres) {
  return isPostgres ? 'NOW()' : "datetime('now')";
}

function sixMonthsAgo(isPostgres) {
  return isPostgres ? "NOW() - INTERVAL '6 months'" : "datetime('now', '-6 months')";
}

function monthBucket(column, isPostgres) {
  return isPostgres ? `TO_CHAR(${column}, 'YYYY-MM')` : `strftime('%Y-%m', ${column})`;
}

module.exports = { currentTimestamp, sixMonthsAgo, monthBucket };
