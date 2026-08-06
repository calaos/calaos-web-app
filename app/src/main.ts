import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/500.css';
import '@fontsource/ubuntu/700.css';
import './styles/theme.css';
import './styles/base.css';
import './styles/animations.css';
import { i18n } from './i18n';
import { createAppRouter, startNavigationIntents } from './router';
import { getCalaosService } from './services/calaos';
import App from './App.vue';

const app = createApp(App);
const router = createAppRouter();

// Pinia first: the router's guard and the navigation-intent watcher both
// resolve stores, and getCalaosService() resolves all three.
app.use(createPinia());
app.use(i18n);
app.use(router);

// auth.pendingNavigation → router.push. The auth store deliberately knows
// nothing about vue-router; see router/index.ts.
startNavigationIntents(router);

app.mount('#app');

// Connect last, so the shell is on screen before the socket starts dialling.
// Construction is network-free; start() is what opens the websocket. No login
// frame goes out until the user submits credentials.
getCalaosService().start();
