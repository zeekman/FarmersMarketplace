/**
 * HTTPS enforcement middleware.
 *
 * - In production: redirects plain HTTP requests to HTTPS.
 * - Adds HSTS header so browsers remember to always use HTTPS.
 * - Skipped entirely in development/test to avoid breaking local workflows.
 */

const HSTS_MAX_AGE = 31536000; // 1 year in seconds

function enforceHttps(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  // Trust X-Forwarded-Proto set by reverse proxies (Nginx, Heroku, etc.)
  const proto = req.headers['x-forwarded-proto'] || req.protocol;

  if (proto !== 'https') {
    const httpsUrl = `https://${req.headers.host}${req.originalUrl}`;
    return res.redirect(301, httpsUrl);
  }

  next();
}

function hsts(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  res.setHeader('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE}; includeSubDomains; preload`);

  next();
}

module.exports = { enforceHttps, hsts };
