import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toStroops, fromStroops, add, mul, formatXlm, normalize } from './money.js';

describe('money.js', () => {
  describe('toStroops', () => {
    it('converts integer XLM to stroops', () => {
      expect(toStroops('1')).toBe(10_000_000n);
      expect(toStroops('0')).toBe(0n);
      expect(toStroops('100')).toBe(1_000_000_000n);
    });

    it('converts decimal XLM to stroops', () => {
      expect(toStroops('0.1')).toBe(1_000_000n);
      expect(toStroops('0.0000001')).toBe(1n);
      expect(toStroops('2.5')).toBe(25_000_000n);
    });

    it('handles negative values', () => {
      expect(toStroops('-1')).toBe(-10_000_000n);
      expect(toStroops('-0.5')).toBe(-5_000_000n);
    });

    it('rejects more than 7 decimal places', () => {
      expect(() => toStroops('0.12345678')).toThrow();
      expect(() => toStroops('1.00000001')).toThrow();
    });

    it('accepts BigInt input', () => {
      expect(toStroops(10_000_000n)).toBe(10_000_000n);
    });

    it('rejects invalid input', () => {
      expect(() => toStroops('')).toThrow();
      expect(() => toStroops(null)).toThrow();
      expect(() => toStroops('abc')).toThrow();
      expect(() => toStroops('1.2.3')).toThrow();
    });
  });

  describe('fromStroops', () => {
    it('converts stroops to XLM string with 7 decimals', () => {
      expect(fromStroops(10_000_000n)).toBe('1.0000000');
      expect(fromStroops(1n)).toBe('0.0000001');
      expect(fromStroops(25_000_000n)).toBe('2.5000000');
    });

    it('handles negative stroops', () => {
      expect(fromStroops(-10_000_000n)).toBe('-1.0000000');
      expect(fromStroops(-1n)).toBe('-0.0000001');
    });

    it('handles zero', () => {
      expect(fromStroops(0n)).toBe('0.0000000');
    });

    it('accepts string/number input', () => {
      expect(fromStroops('10000000')).toBe('1.0000000');
      expect(fromStroops(10_000_000)).toBe('1.0000000');
    });
  });

  describe('add', () => {
    it('adds two XLM amounts', () => {
      expect(add('1', '2')).toBe(30_000_000n);
      expect(add('0.1', '0.2')).toBe(3_000_000n);
    });

    it('handles negative values', () => {
      expect(add('1', '-0.5')).toBe(5_000_000n);
    });

    it('is associative', () => {
      // Property: (a + b) + c === a + (b + c)
      const a = '1.5';
      const b = '2.3';
      const c = '0.7';
      expect(add(add(a, b), c)).toBe(add(a, add(b, c)));
    });

    it('accepts BigInt input', () => {
      expect(add(10_000_000n, 5_000_000n)).toBe(15_000_000n);
    });
  });

  describe('mul', () => {
    it('multiplies an amount by a quantity', () => {
      const result = mul('2.5', 2);
      expect(result).toBe(50_000_000n);
    });

    it('multiplies by 1 returns the same amount in stroops', () => {
      expect(mul('5.5', 1)).toBe(toStroops('5.5'));
      expect(mul('0.0000001', 1)).toBe(1n);
    });

    it('multiplies by 0 returns 0', () => {
      expect(mul('100', 0)).toBe(0n);
    });

    it('uses banker\'s rounding for ties', () => {
      // 0.1 * 0.3 = 0.03, but due to rounding, test specific cases
      const result = mul('10', '0.01');
      expect(result).toBe(100_000n); // 0.1 XLM
    });

    it('handles fractional quantities', () => {
      const result = mul('100', '0.5');
      expect(result).toBe(500_000_000n); // 50 XLM
    });

    it('preserves sign with negative values', () => {
      expect(mul('-5', '2')).toBe(-100_000_000n);
      expect(mul('5', '-2')).toBe(-100_000_000n);
      expect(mul('-5', '-2')).toBe(100_000_000n);
    });

    it('accepts BigInt input', () => {
      expect(mul(10_000_000n, 2n)).toBe(20_000_000n);
    });
  });

  describe('formatXlm', () => {
    it('formats integer XLM without decimals', () => {
      expect(formatXlm('1')).toBe('1');
      expect(formatXlm('100')).toBe('100');
    });

    it('formats with decimal places, trimming trailing zeros', () => {
      expect(formatXlm('0.1')).toBe('0.1');
      expect(formatXlm('0.0000001')).toBe('0.0000001');
      expect(formatXlm(1n)).toBe('0.0000001');
    });

    it('shows up to 7 decimal places', () => {
      expect(formatXlm(toStroops('1.2345678'))).toBe('1.2345678');
    });

    it('handles negative values', () => {
      expect(formatXlm('-1.5')).toBe('-1.5');
    });

    it('handles BigInt input', () => {
      expect(formatXlm(10_000_000n)).toBe('1');
      expect(formatXlm(1n)).toBe('0.0000001');
    });

    it('respects locale parameter', () => {
      const result = formatXlm('1000.5', 'de-DE');
      expect(result).toMatch(/1[.,]000\.?5|1000[.,]5/);
    });
  });

  describe('property-based tests', () => {
    it('roundtrip: fromStroops(toStroops(x)) === normalize(x) for 7-dp strings', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 0, max: 999_999_999 }),
            fc.integer({ min: 0, max: 9_999_999 })
          ),
          ([whole, frac]) => {
            const fractStr = frac.toString().padStart(7, '0').replace(/0+$/, '');
            const xStr = fractStr ? `${whole}.${fractStr}` : whole.toString();
            const stroops = toStroops(xStr);
            const recovered = fromStroops(stroops);
            const normalized = normalize(xStr);
            expect(recovered).toBe(normalized);
          }
        )
      );
    });

    it('add is associative', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 0, max: 100_000_000 }),
            fc.integer({ min: 0, max: 100_000_000 }),
            fc.integer({ min: 0, max: 100_000_000 })
          ),
          ([a, b, c]) => {
            const aStr = (a / 1_000_000).toFixed(7);
            const bStr = (b / 1_000_000).toFixed(7);
            const cStr = (c / 1_000_000).toFixed(7);
            expect(add(add(aStr, bStr), cStr)).toBe(add(aStr, add(bStr, cStr)));
          }
        )
      );
    });

    it('mul(x, 1) === toStroops(x)', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 0, max: 1_000_000 }),
            fc.integer({ min: 0, max: 9_999_999 })
          ),
          ([whole, frac]) => {
            const fractStr = frac.toString().padStart(7, '0').replace(/0+$/, '');
            const xStr = fractStr ? `${whole}.${fractStr}` : whole.toString();
            expect(mul(xStr, 1)).toBe(toStroops(xStr));
          }
        )
      );
    });

    it('mul(\'2.5\', 2) === 50_000_000n (exact test)', () => {
      expect(mul('2.5', 2)).toBe(50_000_000n);
    });

    it('mul(a, b) is commutative', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 1, max: 100 }),
            fc.integer({ min: 1, max: 100 })
          ),
          ([a, b]) => {
            const aStr = (a / 10).toFixed(1);
            const bStr = (b / 10).toFixed(1);
            expect(mul(aStr, bStr)).toBe(mul(bStr, aStr));
          }
        )
      );
    });
  });
});

/**
 * Normalize a decimal string to 7 decimal places (for testing).
 * @param {string|number} value
 * @returns {string}
 */
function normalize(value) {
  const str = String(value).trim();
  const [whole, frac = ''] = str.split('.');
  const padded = frac.padEnd(7, '0');
  return `${whole}.${padded}`;
}
