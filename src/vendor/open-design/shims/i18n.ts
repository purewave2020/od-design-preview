// Hand-written adapter (not vendored): vendored components call `useT()` /
// `useI18n()` from the upstream i18n module; route them to this app's
// translator. `useT` honours <TranslationScope> key remaps so a vendored
// surface can relabel a control without forking its source (e.g. the Mark
// tool's chat-oriented "Send" becomes "Save as comment" here).
import { useCallback, useContext } from 'react';
import { TranslationScopeContext, useLocale, useT as useAppT, type TranslateFn } from '../../../i18n';

/** Full upstream locale union (apps/web/src/i18n/types.ts) so locale maps type-check. */
export type Locale =
  | 'en' | 'id' | 'de' | 'zh-CN' | 'zh-TW' | 'pt-BR' | 'es-ES' | 'ru' | 'fa' | 'ar'
  | 'ja' | 'ko' | 'pl' | 'hu' | 'fr' | 'uk' | 'tr' | 'th' | 'it';

export function useT(): TranslateFn {
  const t = useAppT();
  const remap = useContext(TranslationScopeContext);
  return useCallback<TranslateFn>((key, vars) => t(remap?.[key] ?? key, vars), [t, remap]);
}

export function useI18n(): { t: TranslateFn; locale: Locale } {
  const t = useT();
  const { locale } = useLocale();
  return { t, locale };
}
