import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import sw from './sw.json';
import ar from './ar.json';

/**
 * Per-locale text-direction configuration.
 * Add new locales here as they are introduced.
 * RTL locales (Arabic, Hebrew, etc.) should be listed with 'rtl'.
 */
export const LOCALE_DIRECTIONS = {
  en: 'ltr',
  sw: 'ltr',
  ar: 'rtl',
};

/** Returns the text direction for the given locale code, defaulting to 'ltr'. */
export function getLocaleDirection(lng) {
  return LOCALE_DIRECTIONS[lng] ?? 'ltr';
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, sw: { translation: sw }, ar: { translation: ar } },
  lng: localStorage.getItem('lang') || 'en',
  fallbackLng: 'en',
  // Resources are statically bundled — no network fetch occurs.
  // initImmediate:false makes init synchronous so the bundled fallback
  // is always available before the first render, preventing raw key display.
  initImmediate: false,
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('lang', lng);
  // Apply dir attribute to document root whenever the language changes
  const dir = getLocaleDirection(lng);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lng);
});

// Apply direction on initial load
const initialLng = localStorage.getItem('lang') || 'en';
document.documentElement.setAttribute('dir', getLocaleDirection(initialLng));
document.documentElement.setAttribute('lang', initialLng);

export default i18n;
