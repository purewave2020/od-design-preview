// Library i18n on vue-i18n.
//
// The preview's dictionaries are flat (`'fileViewer.preview'`) and use the
// upstream `{name}` placeholder syntax; upstream wording also contains
// characters vue-i18n's default message syntax treats specially (`|`, `@`,
// `{…}` that are not placeholders). So the library runs its own vue-i18n
// instance with a flat-key resolver and a message compiler that formats
// exactly like Open Design (`{name}` → value, unknown placeholders kept),
// instead of relying on the host app's message syntax. The host app keeps
// its own vue-i18n instance; `createDesignPreview({ i18n })` keeps the two
// locales in sync.
import { getCurrentInstance, inject, provide, type InjectionKey, type Ref } from 'vue';
import { createI18n, type MessageCompiler } from 'vue-i18n';
import { appEn, appZhCN } from './app-strings';
import { upstreamEn, upstreamZhCN } from './upstream-strings';

export type Locale = 'en' | 'zh-CN';
export type TranslateVars = Record<string, string | number>;
export type TranslateFn = (key: string, vars?: TranslateVars) => string;

export const PREVIEW_LOCALES: Locale[] = ['en', 'zh-CN'];

/** Library dictionaries (upstream wording wins on key collisions). */
export const previewMessages: Record<Locale, Record<string, string>> = {
  en: { ...appEn, ...upstreamEn },
  'zh-CN': { ...appZhCN, ...upstreamZhCN },
};

const STORAGE_KEY = 'od-preview:locale';

export function formatMessage(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== undefined ? String(vars[name]) : match,
  );
}

/** Upstream-compatible formatter: `{name}` placeholders only, everything else literal. */
const messageCompiler: MessageCompiler = (message, { key }) => {
  if (typeof message === 'string') {
    return (ctx: unknown) => formatMessage(message, (ctx as { values?: Record<string, unknown> }).values);
  }
  return () => key;
};

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en';
  return null;
}

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const fromQuery = new URLSearchParams(window.location.search).get('lang');
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  return normalizeLocale(fromQuery) ?? normalizeLocale(stored) ?? normalizeLocale(navigator.language) ?? 'en';
}

/** The library's own vue-i18n instance (composition API, never installed on an app). */
export const previewI18n = createI18n({
  legacy: false,
  globalInjection: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: previewMessages,
  // Keys are flat strings with dots in them, not paths.
  messageResolver: (obj: unknown, path: string) => {
    const value = (obj as Record<string, unknown> | null)?.[path];
    return typeof value === 'string' ? value : null;
  },
  messageCompiler,
  missingWarn: false,
  fallbackWarn: false,
  warnHtmlMessage: false,
});

const composer = previewI18n.global;

export function getLocale(): Locale {
  return composer.locale.value as Locale;
}

/** Switch the preview language (persisted, mirrored on <html lang>). */
export function setLocale(next: Locale, options: { persist?: boolean } = {}): void {
  if (composer.locale.value !== next) composer.locale.value = next;
  if (options.persist !== false) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked */
    }
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** Plain translation (reactive inside render / computed: it reads the locale ref). */
export function translate(key: string, vars?: TranslateVars): string {
  return composer.t(key, (vars ?? {}) as Record<string, unknown>) as string;
}

// --- translation scopes ------------------------------------------------------
// Key remaps for vendored surfaces: lets this app relabel an upstream control
// (the Mark tool's chat "Send" → "Save as comment") without forking it.
const TranslationScopeKey: InjectionKey<Record<string, string>> = Symbol('od-translation-scope');

export function provideTranslationScope(remap: Record<string, string>): void {
  provide(TranslationScopeKey, remap);
}

/** Translator for components; honours an enclosing translation scope. */
export function useT(): TranslateFn {
  // Callable outside setup too (the Excalidraw React island, host code).
  const remap = getCurrentInstance() ? inject(TranslationScopeKey, null) : null;
  if (!remap) return translate;
  return (key, vars) => translate(remap[key] ?? key, vars);
}

export function useLocale(): { locale: Ref<string>; setLocale: (next: Locale) => void } {
  return { locale: composer.locale, setLocale };
}
