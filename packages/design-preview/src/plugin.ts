// `app.use(createDesignPreview({ … }))` — wires the library into a host app.
//
//  - http:   the platform's Axios instance (apiCenter). Every daemon / static /
//            comments request the library makes goes through it, so the host's
//            interceptors (auth headers, gateway prefix, error reporting) apply.
//  - i18n:   the host app's vue-i18n instance. The library keeps its own
//            dictionaries (see locales/index.ts) and follows the host locale.
//  - locale: a fixed starting locale when there is no host i18n to follow.
import type { AxiosInstance } from 'axios';
import { effectScope, isRef, watch, type App, type Plugin, type Ref } from 'vue';
import { setPreviewHttpClient } from './http/request';
import { normalizeLocale, setLocale, type Locale } from './locales';

/** The part of a vue-i18n instance the library reads (composition or legacy mode). */
export interface HostI18nLike {
  global: { locale: Ref<string> | string };
}

export interface DesignPreviewOptions {
  http?: AxiosInstance;
  i18n?: HostI18nLike;
  locale?: Locale;
  /** Persist the followed locale under `od-preview:locale` (default false when following a host). */
  persistLocale?: boolean;
}

export function createDesignPreview(options: DesignPreviewOptions = {}): Plugin {
  return {
    install(app: App) {
      if (options.http) setPreviewHttpClient(options.http);
      if (options.locale) setLocale(options.locale, { persist: options.persistLocale ?? false });
      const host = options.i18n;
      if (!host) return;
      const scope = effectScope(true);
      scope.run(() => {
        watch(
          () => {
            const value = host.global.locale;
            return isRef(value) ? value.value : value;
          },
          (value) => {
            const next = normalizeLocale(value);
            if (next) setLocale(next, { persist: options.persistLocale ?? false });
          },
          { immediate: true },
        );
      });
      const unmount = app.unmount.bind(app);
      app.unmount = () => {
        scope.stop();
        unmount();
      };
    },
  };
}
