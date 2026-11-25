// Theme + style scope for the library.
//
// The upstream stylesheet is compiled into `upstream.scoped.css`, where every
// rule only applies inside an element carrying `.odp-scope` (or to that
// element itself), and the design tokens upstream puts on `:root` live on the
// scope element instead. So the preview never restyles the host app (its
// `button` / `input` / `*` resets, body typography, CSS variables), and every
// root the library renders — the workspace, and each layer it teleports to
// <body> (menus, toasts, tooltips, the presentation overlay) — carries the
// scope class and the current `data-theme`.
import { computed, shallowRef, type ComputedRef } from 'vue';

export type PreviewTheme = 'light' | 'dark';

export const PREVIEW_SCOPE_CLASS = 'odp-scope';

function initialTheme(): PreviewTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Current preview theme (reactive). */
export const previewTheme = shallowRef<PreviewTheme>(initialTheme());

export function setPreviewTheme(theme: PreviewTheme): void {
  previewTheme.value = theme;
}

export function getPreviewTheme(): PreviewTheme {
  return previewTheme.value;
}

export interface PreviewScopeAttrs {
  class: string;
  'data-theme': PreviewTheme;
}

/** Attributes for a library root element: `<div v-bind="scope">`. */
export function usePreviewScope(): ComputedRef<PreviewScopeAttrs> {
  return computed(() => ({ class: PREVIEW_SCOPE_CLASS, 'data-theme': previewTheme.value }));
}
