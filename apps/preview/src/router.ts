import { createRouter, createWebHistory } from 'vue-router';
import PreviewPage from './views/PreviewPage.vue';

// One page; the project / file / view state lives in the query string (see
// url-state.ts), so links stay shareable and embeddable.
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'preview', component: PreviewPage },
    { path: '/:pathMatch(.*)*', redirect: (to) => ({ path: '/', query: to.query }) },
  ],
});
