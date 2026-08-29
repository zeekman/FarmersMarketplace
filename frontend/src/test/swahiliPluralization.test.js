import { describe, it, expect, beforeAll } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/en.json';
import sw from '../i18n/sw.json';

let testI18n;

beforeAll(async () => {
  testI18n = i18n.createInstance();
  await testI18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      sw: { translation: sw },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

describe('Swahili pluralization (#1062)', () => {
  describe('English locale', () => {
    it('renders singular for count=1', () => {
      testI18n.changeLanguage('en');
      expect(testI18n.t('pagination.resultCount', { count: 1 })).toBe('1 result');
    });

    it('renders plural for count=0', () => {
      testI18n.changeLanguage('en');
      expect(testI18n.t('pagination.resultCount', { count: 0 })).toBe('0 results');
    });

    it('renders plural for count=many (e.g. 42)', () => {
      testI18n.changeLanguage('en');
      expect(testI18n.t('pagination.resultCount', { count: 42 })).toBe('42 results');
    });
  });

  describe('Swahili locale', () => {
    it('renders singular (tokeo) for count=1', () => {
      testI18n.changeLanguage('sw');
      expect(testI18n.t('pagination.resultCount', { count: 1 })).toBe('tokeo 1');
    });

    it('renders plural (matokeo) for count=0', () => {
      testI18n.changeLanguage('sw');
      expect(testI18n.t('pagination.resultCount', { count: 0 })).toBe('matokeo 0');
    });

    it('renders plural (matokeo) for count=many (e.g. 10)', () => {
      testI18n.changeLanguage('sw');
      expect(testI18n.t('pagination.resultCount', { count: 10 })).toBe('matokeo 10');
    });
  });

  describe('Key parity', () => {
    it('en.json and sw.json both have pagination.resultCount plural keys', () => {
      expect(en.pagination).toBeDefined();
      expect(en.pagination.resultCount_one).toBeDefined();
      expect(en.pagination.resultCount_other).toBeDefined();
      expect(sw.pagination).toBeDefined();
      expect(sw.pagination.resultCount_one).toBeDefined();
      expect(sw.pagination.resultCount_other).toBeDefined();
    });
  });
});
