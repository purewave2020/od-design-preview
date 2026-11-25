<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/SketchEditor.tsx (Apache-2.0).

  The Excalidraw sketch editor (草图). State, save / export / clear, the
  save-state badge labels, toasts and the Excalidraw DOM enhancements
  (tooltips, zh-CN overrides, simplified context menu) are Vue; Excalidraw
  itself is a React component, rendered as a small React island
  (sketch/excalidraw-island.ts) inside `.sketch-excalidraw-wrap`.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue';
import { exportToBlob } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { useI18n } from '../shims/i18n';
import Toast from './Toast.vue';
import { emptySketchScene, sanitizeExcalidrawAppState, sketchSceneHasContent, type ExcalidrawSketchScene, type SketchItem } from './sketch-model';
import {
  EXPORTED_IMAGE_MIME_TYPE,
  SAVED_VISIBLE_MS,
  applySketchContextMenuSimplification,
  applySketchDomI18nOverrides,
  applySketchEditorTooltips,
  blobToBase64,
  buildInitialData,
  enhanceSketchExcalidrawPortals,
  excalidrawLangCode,
  exportedImageFileName,
  exportedImageResultFileName,
  handleSketchPortalCommandEnter,
  isNonDeletedExcalidrawElement,

  rewriteExcalidrawUnableToEmbedToasts,
  sceneContentSignature,
  sceneFromExcalidraw,
  type SketchExportImageResult,
  type SketchSceneChangeOptions,
  type SketchToastState,
  type SketchTooltipLabels,
} from './sketch/editor-helpers';
import { mountExcalidrawIsland, type ExcalidrawIsland } from './sketch/excalidraw-island';
import { getPreviewTheme, previewTheme } from '../../../theme';

const props = withDefaults(
  defineProps<{
    scene: ExcalidrawSketchScene;
    legacyItems?: SketchItem[];
    hasPreservedRawItems?: boolean;
    onSceneChange: (scene: ExcalidrawSketchScene, options?: SketchSceneChangeOptions) => void;
    onClear?: () => void;
    onSave: (scene?: ExcalidrawSketchScene) => Promise<boolean | void> | boolean | void;
    onExportImage?: (base64: string, fileName: string, scene: ExcalidrawSketchScene) => Promise<SketchExportImageResult> | SketchExportImageResult;
    onOpenExportedImage?: (fileName: string) => void;
    saving?: boolean;
    dirty?: boolean;
    savedAt?: number;
    fileName: string;
  }>(),
  {
    legacyItems: () => [],
    hasPreservedRawItems: false,
    onClear: undefined,
    onExportImage: undefined,
    onOpenExportedImage: undefined,
    saving: false,
    dirty: false,
    savedAt: undefined,
  },
);

const i18n = useI18n();
const t = i18n.t;
const locale = computed(() => i18n.locale);
let api: ExcalidrawImperativeAPI | null = null;
const resetNonce = ref(0);
const showSaved = ref(false);
const exporting = ref(false);
// Follows the library theme (theme.ts) rather than <html data-theme>, so a
// host app can theme the preview independently of its own document.
const theme = ref(getPreviewTheme());
const toast = shallowRef<SketchToastState | null>(null);
let savedTimer: ReturnType<typeof setTimeout> | undefined;
const canvasWrapRef = ref<HTMLDivElement | null>(null);
const island = shallowRef<ExcalidrawIsland | null>(null);

// Per editor instance (file + clear nonce): the hydration change is skipped and
// the initial data is built once from the scene at that moment.
let skipHydrationChange = true;
let lastContentSignature: string | null = null;
let initialDataEntry: { key: string; value: ExcalidrawInitialDataState } | null = null;
const editorInstanceKey = computed(() => `${props.fileName}:${resetNonce.value}`);
function initialDataFor(key: string): ExcalidrawInitialDataState {
  if (!initialDataEntry || initialDataEntry.key !== key) {
    skipHydrationChange = true;
    lastContentSignature = null;
    initialDataEntry = { key, value: buildInitialData(props.scene, props.legacyItems, props.fileName) };
  }
  return initialDataEntry.value;
}

let stopThemeWatch: (() => void) | null = null;

const handleSystemThemeChange = () => {
  theme.value = getPreviewTheme();
};

watch(
  () => props.dirty,
  (dirty) => {
    if (dirty) {
      clearTimeout(savedTimer);
      showSaved.value = false;
    }
  },
);

watch(
  [() => props.dirty, () => props.savedAt, () => props.saving],
  ([dirty, savedAt, saving]) => {
    if (!savedAt || dirty || saving) return;
    showSaved.value = true;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      showSaved.value = false;
    }, SAVED_VISIBLE_MS);
  },
);

const sketchTooltipLabels = computed<SketchTooltipLabels>(() => ({
  mainMenu: t('sketch.tooltipMainMenu'),
  lock: t('sketch.tooltipLock'),
  hand: t('sketch.tooltipHand'),
  selection: t('sketch.tooltipSelection'),
  rectangle: t('sketch.tooltipRectangle'),
  diamond: t('sketch.tooltipDiamond'),
  ellipse: t('sketch.tooltipEllipse'),
  arrow: t('sketch.tooltipArrow'),
  line: t('sketch.tooltipLine'),
  freedraw: t('sketch.tooltipFreedraw'),
  text: t('sketch.tooltipText'),
  image: t('sketch.tooltipImage'),
  eraser: t('sketch.tooltipEraser'),
  frame: t('sketch.tooltipFrame'),
  embeddable: t('sketch.tooltipEmbeddable'),
  laser: t('sketch.tooltipLaser'),
  moreTools: t('sketch.tooltipMoreTools'),
}));

function closeActiveSketchDialog() {
  api?.updateScene({ appState: { openDialog: null } });
}

watch(
  [canvasWrapRef, locale, sketchTooltipLabels],
  ([root, currentLocale, labels], _prev, onCleanup) => {
    if (!root) return;
    let frame: number | null = null;
    const applyEnhancements = () => {
      frame = null;
      applySketchEditorTooltips(root, labels);
      applySketchDomI18nOverrides(root, currentLocale);
      applySketchContextMenuSimplification(root, root);
      applySketchContextMenuSimplification(document.body, root);
      rewriteExcalidrawUnableToEmbedToasts(root, labels.embeddable);
      rewriteExcalidrawUnableToEmbedToasts(document.body, labels.embeddable);
      enhanceSketchExcalidrawPortals(currentLocale, closeActiveSketchDialog);
    };
    const scheduleEnhancements = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(applyEnhancements);
    };
    scheduleEnhancements();

    const observer = new MutationObserver(scheduleEnhancements);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!document.querySelector('.od-sketch-modal .Modal')) return;
      event.preventDefault();
      event.stopPropagation();
      closeActiveSketchDialog();
    };
    const handleCommandEnter = (event: KeyboardEvent) => handleSketchPortalCommandEnter(event);
    document.addEventListener('keydown', handleEscape, true);
    document.addEventListener('keydown', handleCommandEnter, true);
    onCleanup(() => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleEscape, true);
      document.removeEventListener('keydown', handleCommandEnter, true);
    });
  },
  { flush: 'post' },
);

function handleChange(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) {
  const contentSignature = sceneContentSignature(elements, appState, files);
  if (skipHydrationChange) {
    skipHydrationChange = false;
    lastContentSignature = contentSignature;
    return;
  }
  if (lastContentSignature === contentSignature) return;
  lastContentSignature = contentSignature;
  props.onSceneChange(sceneFromExcalidraw(elements, appState, files), { markDirty: true, discardLegacyItems: true });
}

function currentScene(): ExcalidrawSketchScene {
  if (!api) return props.scene;
  return sceneFromExcalidraw(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles());
}

function handleClear() {
  if (props.onClear) props.onClear();
  else props.onSceneChange(emptySketchScene(props.fileName), { markDirty: true, discardLegacyItems: true });
  resetNonce.value += 1;
}

async function handleSave() {
  const ok = await props.onSave(currentScene());
  if (ok === false) {
    clearTimeout(savedTimer);
    showSaved.value = false;
    return;
  }
  showSaved.value = true;
  toast.value = { message: t('sketch.saved'), tone: 'success' };
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    showSaved.value = false;
  }, SAVED_VISIBLE_MS);
}

async function handleExportImage() {
  const exportHandler = props.onExportImage;
  if (!exportHandler || exporting.value) return;
  const exportedScene = currentScene();
  const exportedElements = exportedScene.elements.filter(isNonDeletedExcalidrawElement) as Parameters<typeof exportToBlob>[0]['elements'];
  const exportedAppState = {
    ...sanitizeExcalidrawAppState(exportedScene.appState),
    exportBackground: true,
    viewBackgroundColor:
      typeof exportedScene.appState?.viewBackgroundColor === 'string' ? exportedScene.appState.viewBackgroundColor : '#ffffff',
  } as Parameters<typeof exportToBlob>[0]['appState'];
  exporting.value = true;
  try {
    const blob = await exportToBlob({
      elements: exportedElements,
      appState: exportedAppState,
      files: exportedScene.files as Parameters<typeof exportToBlob>[0]['files'],
      mimeType: EXPORTED_IMAGE_MIME_TYPE,
      exportPadding: 16,
    });
    const base64 = await blobToBase64(blob);
    const requestedFileName = exportedImageFileName(props.fileName);
    const result = await exportHandler(base64, requestedFileName, exportedScene);
    if (result === false) return;
    const savedFileName = exportedImageResultFileName(result, requestedFileName);
    toast.value = { message: t('fileViewer.exportImageSaved'), details: savedFileName, tone: 'success', actionFileName: savedFileName };
  } catch (err) {
    console.warn('[SketchEditor] export image failed', err);
    window.alert(t('common.exportImageFailed'));
  } finally {
    exporting.value = false;
  }
}

const canClear = computed(() => sketchSceneHasContent(props.scene) || props.legacyItems.length > 0 || props.hasPreservedRawItems);
const canSave = computed(() => props.dirty || sketchSceneHasContent(props.scene) || props.legacyItems.length > 0 || props.hasPreservedRawItems);

function openExportedImage() {
  const name = toast.value?.actionFileName;
  if (!name) return;
  props.onOpenExportedImage?.(name);
  toast.value = null;
}

onMounted(() => {
  stopThemeWatch = watch(previewTheme, handleSystemThemeChange);
  if (canvasWrapRef.value) island.value = mountExcalidrawIsland(canvasWrapRef.value);
});

// Re-render the React island whenever anything it shows changes.
watchEffect(
  () => {
    const current = island.value;
    if (!current) return;
    const key = editorInstanceKey.value;
    current.render({
      editorKey: key,
      initialData: initialDataFor(key),
      langCode: excalidrawLangCode(locale.value),
      theme: theme.value,
      fileName: props.fileName,
      saving: props.saving,
      dirty: props.dirty,
      showSaved: showSaved.value,
      exporting: exporting.value,
      canSave: canSave.value,
      canClear: canClear.value,
      canExport: sketchSceneHasContent(props.scene),
      hasExport: Boolean(props.onExportImage),
      labels: {
        saving: t('sketch.saving'),
        dirty: t('sketch.tooltipDirty'),
        saved: t('sketch.saved'),
        save: t('common.save'),
        exporting: t('fileViewer.exportImageSaving'),
        exportImage: t('common.exportImage'),
        clear: t('sketch.clear'),
      },
      onApi: (next) => {
        api = next;
      },
      onChange: handleChange,
      onSave: () => void handleSave(),
      onExportImage: () => void handleExportImage(),
      onClear: handleClear,
    });
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  clearTimeout(savedTimer);
  stopThemeWatch?.();
  const current = island.value;
  island.value = null;
  api = null;
  // Unmount after Vue's own teardown of this subtree.
  queueMicrotask(() => current?.unmount());
});
</script>

<template>
  <div class="sketch-editor">
    <div ref="canvasWrapRef" class="sketch-canvas-wrap sketch-excalidraw-wrap" data-testid="sketch-excalidraw-editor" />
    <Toast
      v-if="toast"
      :message="toast.message"
      :details="toast.details"
      :tone="toast.tone"
      :ttl-ms="toast.actionFileName ? 5000 : 2200"
      :action-label="toast.actionFileName ? t('workspace.openFile') : undefined"
      :on-action="toast.actionFileName ? openExportedImage : undefined"
      :on-dismiss="() => (toast = null)"
    />
  </div>
</template>
