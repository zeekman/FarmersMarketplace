'use strict';

/**
 * Rewrite a local upload path to a CDN URL in production.
 * In development / when CDN_URL is not set, returns the original URL unchanged.
 */
function rewriteImageUrl(url) {
  if (!url) return url;
  const base = process.env.CDN_URL;
  if (!base) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${base.replace(/\/$/, '')}${url}`;
}

module.exports = { rewriteImageUrl };
