import { createI18n } from 'vue-i18n';
import { messages } from './messages';

// Locale is derived from the browser, never persisted or user-selectable
// today. Every other locale falls back to `en` (fallbackLocale below).
const locale = navigator.language.startsWith('fr') ? 'fr' : 'en';

export const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages,
});
