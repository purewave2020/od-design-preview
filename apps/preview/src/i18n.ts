// App vue-i18n instance (shell strings). The preview library follows its
// locale through `createDesignPreview({ i18n })` (see main.ts).
import { detectLocale } from '@od-design/preview';
import { createI18n } from 'vue-i18n';
import en from './locales/en';
import zhCN from './locales/zh-CN';

export type AppLocale = 'en' | 'zh-CN';

const LOCALE_KEY = 'od-preview:locale';

export const i18n = createI18n({
  legacy: false,
  // ?lang= → saved choice → browser language (same rules as the library).
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, 'zh-CN': zhCN },
});

export function setAppLocale(next: AppLocale): void {
  i18n.global.locale.value = next;
  try {
    window.localStorage.setItem(LOCALE_KEY, next);
  } catch {
    /* storage blocked */
  }
}
