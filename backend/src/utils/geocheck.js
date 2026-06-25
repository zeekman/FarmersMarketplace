/**
 * Geo-fencing helper.
 *
 * Resolution order for buyer country:
 *   1. buyer.location field (stored as ISO-3166-1 alpha-2, e.g. "KE")
 *   2. IP geolocation via ip-api.com (free, no key required, ~45 req/min)
 *   3. If unavailable → skip check (fail-open)
 *
 * Coordinate-based geo-fencing:
 *   When a product has geo_fencing_enabled=1 and valid lat/lng/radius_km,
 *   the buyer's delivery address coordinates are checked via Haversine formula.
 */

const https = require('https');
const { get, set } = require('../cache');
const config = require('../config');

/**
 * Haversine great-circle distance between two lat/lng points.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} distance in kilometres
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Check coordinate-based geo-fence for a product.
 * Only applies when product.geo_fencing_enabled is truthy and all fence
 * parameters (lat, lng, radius_km) are valid numbers.
 *
 * @param {object} product  - product row
 * @param {number|null} deliveryLat - buyer delivery latitude
 * @param {number|null} deliveryLng - buyer delivery longitude
 * @returns {{ checked: boolean, allowed: boolean, distanceKm: number|null }}
 */
function checkCoordinateGeoFence(product, deliveryLat, deliveryLng) {
  if (!product.geo_fencing_enabled) {
    return { checked: false, allowed: true, distanceKm: null, reason: null };
  }

  const fenceLat = parseFloat(product.geo_fence_lat);
  const fenceLng = parseFloat(product.geo_fence_lng);
  const radiusKm = parseFloat(product.geo_fence_radius_km);

  if (
    !Number.isFinite(fenceLat) ||
    !Number.isFinite(fenceLng) ||
    !Number.isFinite(radiusKm) ||
    radiusKm <= 0
  ) {
    // Incomplete fence config → fail-open (don't block orders)
    return { checked: false, allowed: true, distanceKm: null, reason: null };
  }

  const buyerLat = parseFloat(deliveryLat);
  const buyerLng = parseFloat(deliveryLng);

  if (!Number.isFinite(buyerLat) || !Number.isFinite(buyerLng)) {
    // Missing buyer coordinates → reject (coordinates required when fence is active)
    return { checked: true, allowed: false, distanceKm: null, reason: 'coordinates_required' };
  }

  const distanceKm = haversineKm(fenceLat, fenceLng, buyerLat, buyerLng);
  return {
    checked: true,
    allowed: distanceKm <= radiusKm,
    distanceKm,
    reason: distanceKm <= radiusKm ? null : 'outside_delivery_area',
  };
}

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

module.exports = { checkGeoFence, resolveCountry, checkCoordinateGeoFence, haversineKm };
