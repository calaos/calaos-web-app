import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/500.css';
import '@fontsource/ubuntu/700.css';
import './styles/theme.css';
import './styles/base.css';
import './styles/animations.css';
import { i18n } from './i18n';
import App from './App.vue';

// The websocket is NOT started here: services/calaos.ts exposes
// getCalaosService().start(), which T06 calls from the app shell once the
// router exists (pinia must be installed first — the service resolves the
// stores when it is created).
createApp(App).use(createPinia()).use(i18n).mount('#app');
