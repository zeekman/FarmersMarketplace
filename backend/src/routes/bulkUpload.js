/**
 * routes/bulkUpload.js  — DEPRECATED ALIAS
 *
 * This router now forwards all requests to the unified import pipeline at
 * POST /api/products/import.  It sets Deprecation + Sunset headers so
 * clients can migrate.
 *
 * Migration guide
 * ───────────────
 *   Old:  POST /api/products/bulk          (multipart/form-data, field: file)
 *   New:  POST /api/products/import        (same multipart body, + query params)
 *
 * The /template endpoint is kept for backwards compatibility and redirects to
 * the canonical template URL.
 */

'use strict';

const router = require('express').Router();

// Deprecation sunset date: six months after the feature was merged (2026-10-26).
const DEPRECATION_DATE = 'Mon, 26 Oct 2026 00:00:00 GMT';
const SUNSET_DATE = 'Mon, 26 Apr 2027 00:00:00 GMT';

/**
 * Inject Deprecation / Sunset / Link headers on every /products/bulk response.
 * The handler then forwards to the /products/import sub-router.
 */
router.use((req, res, next) => {
  res.setHeader('Deprecation', DEPRECATION_DATE);
  res.setHeader('Sunset', SUNSET_DATE);
  res.setHeader(
    'Link',
    '</api/products/import>; rel="successor-version"'
  );
  next();
});

// GET /api/products/bulk/template  →  redirect to canonical template
router.get('/template', (_req, res) => {
  res.redirect(301, '/api/products/import/template');
});

// Forward POST and all other verbs to the canonical import router.
// The import router is already mounted at /products/import; here we
// re-require it so the same middleware chain runs without duplication.
router.use('/', require('./productImport'));

module.exports = router;
