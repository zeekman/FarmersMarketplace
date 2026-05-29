/**
 * Geo-fencing helper.
 *
 * Resolution order for buyer country:
 *   1. buyer.location field (stored as ISO-3166-1 alpha-2, e.g. "KE")
 *   2. IP geolocation via ip-api.com (free, no key required, ~45 req/min)
 *   3. If unavailable → skip check (fail-open)
 */

const https = require('https');
const { get, set } = require('../cache');
const config = require('../config');

/**
 * Resolve the country code for a request.
 * @param {object} buyer  - user row (may have .location)
 * @param {string} ip     - client IP string
 * @returns {Promise<string|null>} ISO-3166-1 alpha-2 or null if unknown
 */
async function resolveCountry(buyer, ip) {
  // 1. Buyer profile location (two-letter code stored by the app)
  if (buyer?.location && /^[A-Z]{2}$/.test(buyer.location.trim().toUpperCase())) {
    return buyer.location.trim().toUpperCase();
  }

  // 2. IP geolocation (skip loopback / private ranges)
  if (!ip || /^(127\.|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) {
    return null;
  }

  // Check cache first
  const cacheKey = `geo:${ip}`;
  const cached = await get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Fetch from API
  const timeoutMs = config.GEO_API_TIMEOUT_MS || 2000;
  return new Promise((resolve) => {
    const req = https.get(
      `https://ip-api.com/json/${encodeURIComponent(ip)}?fields=countryCode,status`,
      { timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const country = data.status === 'success' ? data.countryCode : null;
            // Cache for 1 hour
            set(cacheKey, country, 3600);
            resolve(country);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Check whether a buyer is allowed to purchase a product.
 *
 * @param {object} product - product row (has .allowed_regions TEXT)
 * @param {object} buyer   - user row
 * @param {string} ip      - client IP
 * @returns {Promise<{ allowed: boolean, country: string|null }>}
 */
async function checkGeoFence(product, buyer, ip) {
  let regions = [];
  try {
    regions = product.allowed_regions ? JSON.parse(product.allowed_regions) : [];
  } catch {
    regions = [];
  }

  // No restriction
  if (!Array.isArray(regions) || regions.length === 0) {
    return { allowed: true, country: null };
  }

  const country = await resolveCountry(buyer, ip);

  // Geolocation unavailable → skip check (fail-open per spec)
  if (!country) {
    return { allowed: true, country: null };
  }

  const allowed = regions.map((c) => c.toUpperCase()).includes(country.toUpperCase());
  return { allowed, country };
}

module.exports = { checkGeoFence, resolveCountry };
