// Hand-written adapter (not vendored): vendored components call `useT()` /
// `useI18n()` from the upstream i18n module; route them to this library's
// vue-i18n translator. `useT` honours translation-scope key remaps so a
// vendored surface can relabel a control without forking its source (e.g. the
// Mark tool's chat-oriented "Send" becomes "Save as comment" here).
import { computed } from 'vue';
import { useLocale, useT as useAppT, type TranslateFn } from '../../../locales';

/** Full upstream locale union (apps/web/src/i18n/types.ts) so locale maps type-check. */
export type Locale =
  | 'en' | 'id' | 'de' | 'zh-CN' | 'zh-TW' | 'pt-BR' | 'es-ES' | 'ru' | 'fa' | 'ar'
  | 'ja' | 'ko' | 'pl' | 'hu' | 'fr' | 'uk' | 'tr' | 'th' | 'it';

export function useT(): TranslateFn {
  return useAppT();
}

export function useI18n(): { t: TranslateFn; locale: Locale } {
  const t = useT();
  const { locale } = useLocale();
  const current = computed(() => locale.value as Locale);
  return {
    t,
    get locale() {
      return current.value;
    },
  };
}
