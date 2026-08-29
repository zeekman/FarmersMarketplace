import { describe, it, expect } from 'vitest';
import { getLocaleDirection, LOCALE_DIRECTIONS } from '../i18n/index.js';

describe('RTL layout support (#1061)', () => {
  it('returns ltr for English', () => {
    expect(getLocaleDirection('en')).toBe('ltr');
  });

  it('returns ltr for Swahili', () => {
    expect(getLocaleDirection('sw')).toBe('ltr');
  });

  it('defaults to ltr for an unknown locale', () => {
    expect(getLocaleDirection('xx')).toBe('ltr');
  });

  it('LOCALE_DIRECTIONS map is defined and contains expected entries', () => {
    expect(LOCALE_DIRECTIONS).toBeDefined();
    expect(LOCALE_DIRECTIONS.en).toBe('ltr');
    expect(LOCALE_DIRECTIONS.sw).toBe('ltr');
  });

  it('returns rtl for Arabic when added to the config', () => {
    // This documents the expected behaviour once ar is enabled.
    // Temporarily patch LOCALE_DIRECTIONS to verify the lookup works.
    LOCALE_DIRECTIONS['ar'] = 'rtl';
    expect(getLocaleDirection('ar')).toBe('rtl');
    delete LOCALE_DIRECTIONS['ar'];
  });
});
