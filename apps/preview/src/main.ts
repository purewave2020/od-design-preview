import { createDesignPreview } from '@od-design/preview';
import '@od-design/preview/styles';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { apiCenter } from './http';
import { i18n } from './i18n';
import { router } from './router';
import './styles/app-shell.scss';

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.use(router);
// Library wiring: its HTTP goes through the platform Axios instance, its
// language follows the app's vue-i18n locale (and is remembered like the app's).
app.use(createDesignPreview({ http: apiCenter, i18n, persistLocale: true }));

void router.isReady().then(() => app.mount('#app'));
