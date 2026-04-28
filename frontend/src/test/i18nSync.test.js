import { describe, it, expect } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/en.json';
import sw from '../i18n/sw.json';

// Initialize a test i18n instance with fallbackLng: 'en'
const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  resources: { en: { translation: en }, sw: { translation: sw } },
  lng: 'sw',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

describe('i18n translation sync (#435)', () => {
  it('sw.json has all keys from en.json', () => {
    function getKeys(obj, prefix = '') {
      return Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null
          ? getKeys(v, prefix ? `${prefix}.${k}` : k)
          : [prefix ? `${prefix}.${k}` : k]
      );
    }
    const missing = getKeys(en).filter(k => !new Set(getKeys(sw)).has(k));
    expect(missing).toEqual([]);
  });

  it('falls back to English text for a missing Swahili key', async () => {
    // Create instance with sw missing a key
    const partialSw = { ...sw, common: { ...sw.common } };
    delete partialSw.common.loading;

    const fallbackI18n = i18n.createInstance();
    await fallbackI18n.use(initReactI18next).init({
      resources: { en: { translation: en }, sw: { translation: partialSw } },
      lng: 'sw',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    });

    // Should fall back to English value, not the key string
    expect(fallbackI18n.t('common.loading')).toBe(en.common.loading);
    expect(fallbackI18n.t('common.loading')).not.toBe('common.loading');
  });
});
