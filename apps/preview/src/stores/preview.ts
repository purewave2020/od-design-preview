// App state (Pinia): the open project source, the deep-linked file, and the
// theme preference. Sources are class instances marked raw in their
// constructors, so Pinia stores them as-is (no proxy).
import { setPreviewTheme, type PreviewSource, type PreviewTheme } from '@od-design/preview';
import { defineStore } from 'pinia';
import { computed, shallowRef, ref, watch } from 'vue';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'od-preview:theme';

function isThemePref(value: unknown): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark';
}

function initialThemePref(): ThemePref {
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (isThemePref(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (isThemePref(stored)) return stored;
  } catch {
    /* storage blocked */
  }
  return 'system';
}

export const usePreviewStore = defineStore('od-preview', () => {
  const source = shallowRef<PreviewSource | null>(null);
  /** Deep link (?file=…) applied once the workspace lists the file. */
  const initialFile = ref<string | null>(null);
  /** Active file of the workspace (null = Design Files). */
  const activeFile = ref<string | null>(null);

  const themePref = ref<ThemePref>(initialThemePref());
  const systemDark = ref(window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    systemDark.value = event.matches;
  });
  const theme = computed<PreviewTheme>(() => (themePref.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themePref.value));

  watch(
    theme,
    (next) => {
      // The library scopes its theme to its own roots; the page mirrors it so
      // the shell (and anything else on the page) can follow.
      setPreviewTheme(next);
      document.documentElement.setAttribute('data-theme', next);
      document.documentElement.style.colorScheme = next;
    },
    { immediate: true },
  );
  watch(themePref, (next) => {
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked */
    }
  });

  function setSource(next: PreviewSource, file: string | null = null) {
    source.value = next;
    initialFile.value = file;
    activeFile.value = file;
  }

  return { source, initialFile, activeFile, themePref, theme, setSource };
});
