import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { safeStorage } from '../utils/safeStorage';
import en from './en.json';

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

const localeLoaders = {
  sw: () => import('./sw.json'),
  ar: () => import('./ar.json'),
};

// Use safeStorage for language preference (defaults to 'en' if not set or storage fails)
const initialLng = safeStorage.get('lang') || 'en';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  // Keep the English fallback synchronous so the first render never shows keys.
  initImmediate: false,
  interpolation: { escapeValue: false },
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (lngs, ns, key, fallbackValue) => {
    if (import.meta.env.DEV) {
      console.warn(`Missing i18n key: ${key}`);
    }
  },
});

export async function changeAppLanguage(lng) {
  const loadLocale = localeLoaders[lng];
  if (loadLocale && !i18n.hasResourceBundle(lng, 'translation')) {
    const { default: translation } = await loadLocale();
    i18n.addResourceBundle(lng, 'translation', translation, true, true);
  }
  return i18n.changeLanguage(lng);
}

i18n.on('languageChanged', (lng) => {
  safeStorage.set('lang', lng);
  // Apply dir attribute to document root whenever the language changes
  const dir = getLocaleDirection(lng);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lng);
});

// Apply direction on initial load
document.documentElement.setAttribute('dir', getLocaleDirection(initialLng));
document.documentElement.setAttribute('lang', initialLng);
if (initialLng !== 'en') void changeAppLanguage(initialLng);

export default i18n;
