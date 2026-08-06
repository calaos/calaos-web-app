import { createI18n } from 'vue-i18n';
import en from './en.json';
import fr from './fr.json';

// Locale is derived from the browser, never persisted or user-selectable
// today. Every other locale falls back to `en` (fallbackLocale below).
const locale = navigator.language.startsWith('fr') ? 'fr' : 'en';

export const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en, fr },
});
