// Carbon footprint estimation utilities

// Default carbon estimates by category (kg CO2 per unit)
const CATEGORY_DEFAULTS = {
  vegetables: 0.4,
  fruits: 0.5,
  grains: 0.6,
  dairy: 1.2,
  meat: 5.0,
  eggs: 1.5,
  other: 0.8,
};

// Supermarket multiplier (typically 2-3x due to supply chain)
const SUPERMARKET_MULTIPLIER = 2.5;

/**
 * Estimate carbon footprint for a product
 * @param {Object} product - Product with category and optional carbon_kg_per_unit
 * @param {number} quantity - Quantity ordered
 * @param {number} distanceKm - Distance from farm to buyer (optional)
 * @returns {Object} { carbonKg, supermarketCarbonKg, savingsPercent }
 */
function estimateCarbonFootprint(product, quantity, distanceKm = 0) {
  // Use farmer-provided value or category default
  const baseCarbon =
    product.carbon_kg_per_unit || CATEGORY_DEFAULTS[product.category] || CATEGORY_DEFAULTS.other;

  // Add transport emissions (0.1 kg CO2 per km per unit, simplified)
  const transportCarbon = distanceKm > 0 ? (distanceKm * 0.1) / quantity : 0;

  const carbonKg = (baseCarbon + transportCarbon) * quantity;
  const supermarketCarbonKg = carbonKg * SUPERMARKET_MULTIPLIER;
  const savingsPercent = Math.round(((supermarketCarbonKg - carbonKg) / supermarketCarbonKg) * 100);

  return {
    carbonKg: parseFloat(carbonKg.toFixed(2)),
    supermarketCarbonKg: parseFloat(supermarketCarbonKg.toFixed(2)),
    savingsPercent,
  };
}

/**
 * Calculate distance between two lat/lng points (Haversine formula)
 * @param {number} lat1 - Latitude 1
 * @param {number} lng1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lng2 - Longitude 2
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = {
  estimateCarbonFootprint,
  calculateDistance,
  CATEGORY_DEFAULTS,
};
