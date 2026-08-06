import { createI18n } from 'vue-i18n';
import en from './en.json';

// Locale is derived from the browser, never persisted or user-selectable
// today. fr.json lands in a later task (T19); until then vue-i18n silently
// falls back to `en` for any locale other than english.
const locale = navigator.language.startsWith('fr') ? 'fr' : 'en';

export const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en },
});
