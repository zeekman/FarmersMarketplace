/**
 * Return the SQL expression used to compare coupon expiry timestamps.
 *
 * SQLite and PostgreSQL expose different current-time function names. Resolve
 * the adapter at call time so runtime configuration and tests are respected.
 */
function couponNowExpression(db) {
  return db.isPostgres ? 'NOW()' : "datetime('now')";
}

module.exports = { couponNowExpression };
