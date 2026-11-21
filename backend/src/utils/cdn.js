'use strict';

/**
 * Rewrite a local upload path to the configured public object-storage/CDN URL.
 * In development / when no public URL is set, returns the original URL unchanged.
 */
function rewriteImageUrl(url) {
  if (!url) return url;
  const base = process.env.OBJECT_STORAGE_PUBLIC_URL || process.env.CDN_URL || process.env.S3_PUBLIC_URL;
  if (!base) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${base.replace(/\/$/, '')}${normalizedPath}`;
}

module.exports = { rewriteImageUrl };
