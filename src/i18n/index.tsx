import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { appEn, appZhCN } from './app-strings';
import { upstreamEn, upstreamZhCN } from './upstream-strings';

export type Locale = 'en' | 'zh-CN';
export type TranslateVars = Record<string, string | number>;
export type TranslateFn = (key: string, vars?: TranslateVars) => string;

const DICTS: Record<Locale, Record<string, string>> = {
  en: { ...appEn, ...upstreamEn },
  'zh-CN': { ...appZhCN, ...upstreamZhCN },
};

const STORAGE_KEY = 'od-preview:locale';

function format(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function detectLocale(): Locale {
  const fromQuery = new URLSearchParams(window.location.search).get('lang');
  const pick = (value: string | null | undefined): Locale | null => {
    if (!value) return null;
    if (value.toLowerCase().startsWith('zh')) return 'zh-CN';
    if (value.toLowerCase().startsWith('en')) return 'en';
    return null;
  };
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  return pick(fromQuery) ?? pick(stored) ?? pick(navigator.language) ?? 'en';
}

export function translate(locale: Locale, key: string, vars?: TranslateVars): string {
  const template = DICTS[locale][key] ?? DICTS.en[key] ?? key;
  return format(template, vars);
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key, vars) => translate('en', key, vars),
});

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale());
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked */
    }
    document.documentElement.lang = next;
  }, []);
  const t = useCallback<TranslateFn>((key, vars) => translate(locale, key, vars), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): TranslateFn {
  return useContext(I18nContext).t;
}

export function useLocale(): Pick<I18nValue, 'locale' | 'setLocale'> {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}

/**
 * Key remaps for vendored components (read by vendor/open-design/shims/i18n).
 * Lets this app relabel an upstream control — e.g. the Mark tool's chat
 * "Send" → "Save as comment" — without editing the vendored source.
 */
export const TranslationScopeContext = createContext<Record<string, string> | null>(null);

export function TranslationScope({ remap, children }: { remap: Record<string, string>; children: ReactNode }) {
  return <TranslationScopeContext.Provider value={remap}>{children}</TranslationScopeContext.Provider>;
}
