/**
 * Two-way mapping between Marketplace filters and the URL query string, so
 * searches can be shared, bookmarked and restored with back/forward.
 *
 * Parsing is defensive: any param that is missing, malformed or out of range
 * falls back to its default instead of throwing.
 */

export const SORT_VALUES = ['newest', 'price_asc', 'price_desc', 'popular', 'freshest'];
export const GRADE_VALUES = ['A', 'B', 'C', 'Ungraded'];
export const ALLERGEN_VALUES = ['gluten', 'nuts', 'dairy', 'eggs', 'soy', 'shellfish'];

const MAX_TEXT_LENGTH = 100;

function text(v) {
  return typeof v === 'string' ? v.slice(0, MAX_TEXT_LENGTH) : '';
}

function nonNegativeNumber(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? String(n) : '';
}

function coordinate(v, limit) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? String(n) : '';
}

function slug(v) {
  return typeof v === 'string' && /^[a-z0-9-]{1,50}$/.test(v) ? v : '';
}

/**
 * @param {URLSearchParams} params
 * @param {object} defaults EMPTY_FILTERS from the page
 */
export function filtersFromParams(params, defaults) {
  const get = (k) => params.get(k);
  const f = { ...defaults };

  f.search = text(get('q'));
  f.seller = text(get('seller'));
  f.category = slug(get('category'));

  f.minPrice = nonNegativeNumber(get('min'));
  f.maxPrice = nonNegativeNumber(get('max'));
  if (f.minPrice && f.maxPrice && Number(f.minPrice) > Number(f.maxPrice)) {
    f.minPrice = '';
    f.maxPrice = '';
  }

  const available = get('available');
  if (available === 'true' || available === 'false' || available === '') f.available = available;
  else if (available === 'all') f.available = '';

  const sort = get('sort');
  if (SORT_VALUES.includes(sort)) f.sort = sort;

  const grade = get('grade');
  f.grade = GRADE_VALUES.includes(grade) ? grade : '';

  const allergens = (get('exclude') || '').split(',').filter((a) => ALLERGEN_VALUES.includes(a));
  f.excludeAllergens = [...new Set(allergens)];

  f.lat = coordinate(get('lat'), 90);
  f.lng = coordinate(get('lng'), 180);
  if (!f.lat || !f.lng) {
    f.lat = '';
    f.lng = '';
  }
  f.radius = f.lat ? nonNegativeNumber(get('radius')) : '';

  return f;
}

/** Only non-default values are written, so a clean page has a clean URL. */
export function filtersToParams(f, defaults) {
  const p = new URLSearchParams();
  const put = (key, value, def = '') => {
    if (value !== undefined && value !== null && value !== def) p.set(key, String(value));
  };
  put('q', (f.search || '').trim());
  put('seller', (f.seller || '').trim());
  put('category', f.category);
  put('min', f.minPrice);
  put('max', f.maxPrice);
  if (f.available !== defaults.available) p.set('available', f.available === '' ? 'all' : f.available);
  put('sort', f.sort, defaults.sort);
  put('grade', f.grade);
  if (f.excludeAllergens?.length) p.set('exclude', [...f.excludeAllergens].sort().join(','));
  if (f.lat && f.lng) {
    p.set('lat', f.lat);
    p.set('lng', f.lng);
    put('radius', f.radius);
  }
  return p;
}
