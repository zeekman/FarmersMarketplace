// Money utilities for XLM amounts.
//
// XLM has 7 decimal places (1 XLM = 10,000,000 stroops). Doing arithmetic with
// JavaScript floats produces rounding errors (e.g. 0.1 + 0.2 = 0.30000000000000004),
// so all amount math is performed on integer stroops using BigInt.

const STROOPS_PER_XLM = 100000000n;
const XLM_DECIMALS = 7;

/**
 * Parse a decimal string/number into integer stroops (BigInt).
 * Accepts up to 7 decimal places; throws on invalid input or excess precision.
 * @param {string|number|bigint} value
 * @returns {bigint}
 */
export function toStroops(value) {
  if (typeof value === 'bigint') return value;
  if (value === null || value === undefined || value === '') {
    throw new Error('Invalid amount: empty value');
  }

  const str = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid amount: ${value}`);
  }

  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [whole, fraction = ''] = unsigned.split('.');

  if (fraction.length > XLM_DECIMALS) {
    throw new Error(`Amount has more than ${XLM_DECIMALS} decimal places: ${value}`);
  }

  const paddedFraction = fraction.padEnd(XLM_DECIMALS, '0');
  const stroops = BigInt(whole) * STROOPS_PER_XLM + BigInt(paddedFraction || '0');
  return negative ? -stroops : stroops;
}

/**
 * Convert integer stroops (BigInt) back to a decimal string in XLM.
 * @param {bigint|string|number} stroops
 * @returns {string}
 */
export function fromStroops(stroops) {
  const value = typeof stroops === 'bigint' ? stroops : toStroops(stroops);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / STROOPS_PER_XLM;
  const fraction = (abs % STROOPS_PER_XLM).toString().padStart(XLM_DECIMALS, '0');
  const result = `${whole}.${fraction}`;
  return negative ? `-${result}` : result;
}

/**
 * Add two amounts (in stroops or XLM) and return stroops.
 * @param {bigint|string|number} a
 * @param {bigint|string|number} b
 * @returns {bigint}
 */
export function add(a, b) {
  return toStroops(a) + toStroops(b);
}

/**
 * Multiply an amount by a quantity and return stroops.
 * @param {bigint|string|number} value
 * @param {bigint|string|number} qty
 * @returns {bigint}
 */
export function mul(value, qty) {
  const qtyStroops = toStroops(qty);
  return toStroops(value) * qtyStroops / STROOPS_PER_XLM;
}

/**
 * Format an amount as XLM with up to 7 decimal places, trimming trailing zeros.
 * @param {bigint|string|number} value
 * @param {string} [locale]
 * @returns {string}
 */
export function formatXlm(value, locale) {
  const stroops = typeof value === 'bigint' ? value : toStroops(value);
  const decimal = fromStroops(stroops);
  const [whole, fraction = ''] = decimal.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const wholeFormatted = Number(whole).toLocaleString(locale);
  return trimmed ? `${wholeFormatted}.${trimmed}` : wholeFormatted;
}

/**
 * Format a fiat amount with 2 decimal places.
 * @param {number|string} value
 * @param {string} [locale]
 * @param {string} [currency]
 * @returns {string}
 */
export function formatFiat(value, locale, currency = 'USD') {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
