// @od-design/preview — Open Design preview workspace as a Vue 3 business
// component library. Source-distributed: the host's Vite + vue plugin compile
// the .vue / .ts files directly (no build step), like the other packages of a
// pnpm workspace component library.
//
//   import { createDesignPreview, DesignPreviewProvider, PreviewWorkspace, StaticSource } from '@od-design/preview';
//   import '@od-design/preview/styles';
//
// See README.md for integration (apiCenter Axios, vue-i18n, Vite settings).

// --- plugin ------------------------------------------------------------------------
export { createDesignPreview, type DesignPreviewOptions, type HostI18nLike } from './plugin';

// --- components --------------------------------------------------------------------
export { default as DesignPreviewProvider } from './components/DesignPreviewProvider.vue';
export { default as ErrorBoundary } from './components/ErrorBoundary.vue';
export { default as PreviewWorkspace } from './components/workspace/PreviewWorkspace.vue';
export { default as EmbeddedViewer } from './components/workspace/EmbeddedViewer.vue';
export { default as DesignFilesPanel } from './components/workspace/DesignFilesPanel.vue';
export { default as FileViewer } from './components/viewer/FileViewer.vue';
export { default as HtmlViewer } from './components/viewer/HtmlViewer.vue';
export { default as MarkdownViewer } from './components/viewer/MarkdownViewer.vue';
export { default as AnchoredPopover } from './components/ui/AnchoredPopover.vue';
export { DESIGN_FILES_TAB, MAX_RETAINED_VIEWERS } from './components/workspace/constants';
export { default as Icon } from './vendor/open-design/components/Icon.vue';
export { default as RemixIcon } from './vendor/open-design/components/RemixIcon.vue';
export type { IconName } from './vendor/open-design/components/Icon';

// --- theme / style scope ----------------------------------------------------------
export {
  getPreviewTheme,
  PREVIEW_SCOPE_CLASS,
  previewTheme,
  setPreviewTheme,
  usePreviewScope,
  type PreviewScopeAttrs,
  type PreviewTheme,
} from './theme';

// --- sources ---------------------------------------------------------------------
export { StaticSource } from './sources/static-source';
export { DaemonSource, listDaemonProjects, normalizeDaemonOrigin, type DaemonProjectSummary } from './sources/daemon-source';
export { LocalSource, localSourceFromDrop } from './sources/local-source';
export { canWrite, type PreparedHtml, type PreviewSource, type PreviewSourceKind, type PreviewWriteMode } from './sources/types';
export { kindFor, baseName, baseDirFor, humanSize } from './sources/file-kind';

// --- review ------------------------------------------------------------------------
export { provideComments, useComments, type CommentsApi, type CommentsLoadState, type CommentSaveInput } from './review/comments';
export { commentStoreFor, type CommentStore } from './review/comment-store';

// --- http --------------------------------------------------------------------------
export {
  getPreviewHttpClient,
  httpRequest,
  setPreviewHttpClient,
  type PreviewHttpRequest,
  type PreviewHttpResponse,
} from './http/request';

// --- i18n --------------------------------------------------------------------------
export {
  detectLocale,
  formatMessage,
  getLocale,
  normalizeLocale,
  PREVIEW_LOCALES,
  previewI18n,
  previewMessages,
  setLocale,
  translate,
  useLocale,
  useT,
  type Locale,
  type TranslateFn,
  type TranslateVars,
} from './locales';

// --- ui / composables ------------------------------------------------------------
export { dismissToast, showToast, useToast, type ToastApi, type ToastOptions, type ToastTone } from './ui/toast';
export { useDismiss, useElementSize, usePersistentState } from './composables/hooks';
export { copyText } from './lib/util';

// --- types -------------------------------------------------------------------------
export type { ArtifactManifestLike, PreviewViewportId, ProjectFile, ProjectFileKind } from './types';
