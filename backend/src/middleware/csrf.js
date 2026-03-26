const crypto = require('crypto');

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

// Routes that are exempt from CSRF validation (pre-auth endpoints)
const EXEMPT_PATHS = ['/api/auth/login', '/api/auth/register'];

/**
 * Generates a CSRF token, sets it as a readable cookie, and exposes it in the response.
 * GET /api/csrf-token
 */
function csrfTokenHandler(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,   // must be readable by JS so the client can send it as a header
    sameSite: 'Strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });
  res.json({ csrfToken: token });
}

/**
 * Middleware that validates the CSRF token on all state-changing requests.
 * Compares the X-CSRF-Token header against the csrf_token cookie.
 */
function csrfProtect(req, res, next) {
  const method = req.method.toUpperCase();

  // Only validate state-changing methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

  // Exempt pre-auth routes
  if (EXEMPT_PATHS.includes(req.path)) return next();

  const cookieHeader = req.headers.cookie || '';
  const cookieToken = parseCookie(cookieHeader, CSRF_COOKIE);
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  // Constant-time comparison to prevent timing attacks
  const cookieBuf = Buffer.from(cookieToken);
  const headerBuf = Buffer.from(headerToken);

  if (
    cookieBuf.length !== headerBuf.length ||
    !crypto.timingSafeEqual(cookieBuf, headerBuf)
  ) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }

  next();
}

/**
 * Minimal cookie parser — avoids adding a dependency just for this.
 */
function parseCookie(cookieStr, name) {
  for (const part of cookieStr.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key.trim() === name) return rest.join('=').trim();
  }
  return null;
}

module.exports = { csrfProtect, csrfTokenHandler };
