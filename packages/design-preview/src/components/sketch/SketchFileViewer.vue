<!--
  Sketch files (`*.sketch.json`) — the role FileWorkspace's sketch tab plays
  upstream: load the document, hand its Excalidraw scene to the vendored
  SketchEditor, autosave edits shortly after they stop (same 800 ms as
  upstream), save on demand, and write "Export image" PNGs next to the sketch.
  Read-only surfaces (embed) render the vendored SketchPreview instead.
-->
<script setup lang="ts">
import '@excalidraw/excalidraw/index.css';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useT } from '../../locales';
import { baseDirFor } from '../../sources/file-kind';
import { canWrite, type PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import SketchEditor from '../../vendor/open-design/components/SketchEditor.vue';
import SketchPreview from '../../vendor/open-design/components/SketchPreview.vue';
import {
  parseSketchWorkspaceDocument,
  serializeExcalidrawSketchScene,
  type ExcalidrawSketchScene,
  type SketchItem,
} from '../../vendor/open-design/components/sketch-model';

const SKETCH_AUTOSAVE_DELAY_MS = 800;

interface LoadedSketch {
  scene: ExcalidrawSketchScene;
  items: SketchItem[];
  rawItemCount: number;
}

function base64ToBlob(base64: string, type: string): Blob {
  const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const bytes = atob(clean);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type });
}

const props = withDefaults(
  defineProps<{
    source: PreviewSource;
    file: ProjectFile;
    active: boolean;
    viewerOnly?: boolean;
  }>(),
  { viewerOnly: false },
);
const emit = defineEmits<{ openFile: [name: string] }>();

const t = useT();
const editable = computed(() => canWrite(props.source) && !props.viewerOnly);
const loaded = shallowRef<LoadedSketch | null>(null);
const failed = ref(false);
const dirty = ref(false);
const saving = ref(false);
const savedAt = ref<number | undefined>(undefined);
let currentScene: ExcalidrawSketchScene | null = null;
let dirtyFlag = false;
let savingRun: Promise<boolean> | null = null;
let lastWritten: string | null = null;
let timer: number | null = null;

// Load once per file; later disk changes only reload when nothing is pending
// (and they are not the echo of our own save).
watch(
  () => [props.source, props.file.name, props.file.mtime] as const,
  ([source, name], _prev, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void source.readText(name, { fresh: true }).then(
      (text) => {
        if (cancelled) return;
        if (text !== null && text === lastWritten) return;
        if (dirtyFlag || savingRun) return;
        const doc = parseSketchWorkspaceDocument(text);
        currentScene = doc.scene;
        loaded.value = { scene: doc.scene, items: doc.items, rawItemCount: doc.rawItems.length };
        failed.value = false;
      },
      () => {
        if (!cancelled) failed.value = true;
      },
    );
  },
  { immediate: true },
);

async function save(scene?: ExcalidrawSketchScene): Promise<boolean> {
  const target = scene ?? currentScene;
  const source = props.source;
  const fileName = props.file.name;
  if (!target || !source.writeFile) return false;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (savingRun) await savingRun;
  const run = (async () => {
    saving.value = true;
    const text = serializeExcalidrawSketchScene(target, fileName);
    try {
      lastWritten = text;
      await source.writeFile!(fileName, text);
      if (currentScene === target) {
        dirtyFlag = false;
        dirty.value = false;
      }
      savedAt.value = Date.now();
      return true;
    } catch {
      return false;
    } finally {
      saving.value = false;
    }
  })();
  savingRun = run;
  try {
    return await run;
  } finally {
    if (savingRun === run) savingRun = null;
  }
}

// Flush a pending autosave when the tab is closed / the file switches.
onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
    if (dirtyFlag) void save();
  }
});

function onSceneChange(scene: ExcalidrawSketchScene, options?: { markDirty?: boolean; discardLegacyItems?: boolean }) {
  currentScene = scene;
  // Keep the prop current (the editor is keyed by file, so this does not
  // re-mount it): its Save / Export image / Clear menu items read it.
  const prev = loaded.value;
  if (prev) loaded.value = { ...prev, scene, items: options?.discardLegacyItems ? [] : prev.items };
  if (options?.markDirty === false) return;
  dirtyFlag = true;
  dirty.value = true;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void save();
  }, SKETCH_AUTOSAVE_DELAY_MS);
}

function onClear() {
  const prev = loaded.value;
  if (!prev) return;
  const empty = { ...prev.scene, elements: [], files: {} } as ExcalidrawSketchScene;
  currentScene = empty;
  loaded.value = { scene: empty, items: [], rawItemCount: 0 };
  dirtyFlag = true;
  dirty.value = true;
  void save(empty);
}

async function onExportImage(base64: string, fileName: string) {
  const source = props.source;
  if (!source.writeFile) return false as const;
  const target = `${baseDirFor(props.file.name)}${fileName}`;
  try {
    const written = await source.writeFile(target, base64ToBlob(base64, 'image/png'));
    return { fileName: written.name };
  } catch {
    return false as const;
  }
}
</script>

<template>
  <div v-if="failed" class="viewer">
    <div class="viewer-body">
      <div class="viewer-empty">{{ t('fileViewer.previewUnavailable') }}</div>
    </div>
  </div>
  <div v-else-if="!editable" class="viewer image-viewer sketch-viewer">
    <div class="viewer-body image-body">
      <SketchPreview :project-id="source.id" :file="file" class-name="viewer-sketch-preview" />
    </div>
  </div>
  <div v-else-if="!loaded" class="viewer">
    <div class="viewer-body">
      <div class="viewer-empty">{{ t('workspace.loadingSketch') }}</div>
    </div>
  </div>
  <div v-else class="viewer sketch-file-viewer" data-testid="sketch-file-viewer" :style="active ? undefined : { visibility: 'hidden' }">
    <SketchEditor
      :key="file.name"
      :file-name="file.name"
      :scene="loaded.scene"
      :legacy-items="loaded.items"
      :has-preserved-raw-items="loaded.rawItemCount > loaded.items.length"
      :on-scene-change="onSceneChange"
      :on-clear="onClear"
      :on-save="(scene?: ExcalidrawSketchScene) => save(scene)"
      :on-export-image="onExportImage"
      :on-open-exported-image="(name: string) => emit('openFile', name)"
      :saving="saving"
      :dirty="dirty"
      :saved-at="savedAt"
    />
  </div>
</template>
