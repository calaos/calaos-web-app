import { createApp } from 'vue';
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/500.css';
import '@fontsource/ubuntu/700.css';
import './styles/theme.css';
import './styles/base.css';
import './styles/animations.css';
import { i18n } from './i18n';
import App from './App.vue';

createApp(App).use(i18n).mount('#app');
