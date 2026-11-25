<!--
  The right-hand workspace pane, standalone. Port of the parts of
  apps/web/src/components/FileWorkspace.tsx that make up the preview surface:
  the `ws-tabs-shell` strip (Design Files tab + closable file tabs + the "+"
  tab launcher + the file-actions slot), the Design Files panel and retained
  file viewers (hidden-not-unmounted, so switching tabs never reloads a
  preview), plus the project-level pieces the review tools need: the shared
  comment state and the floating comments-card host (upstream ProjectView's
  `comment-float-host`).

  Slots: `leading` (left of the tab strip, e.g. a project switcher) and
  `trailing` (far right of the strip).
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type CSSProperties } from 'vue';
import { usePersistentState } from '../../composables/hooks';
import { useT } from '../../locales';
import { provideComments } from '../../review/comments';
import { kindFor } from '../../sources/file-kind';
import { canWrite, type PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import { usePreviewScope } from '../../theme';
import { useToast } from '../../ui/toast';
import Icon from '../../vendor/open-design/components/Icon.vue';
import { emptySketchScene, serializeExcalidrawSketchScene } from '../../vendor/open-design/components/sketch-model';
import TabLauncherMenu from '../../vendor/open-design/components/workspace/TabLauncherMenu.vue';
import { buildLauncherActions, type LauncherContext } from '../../vendor/open-design/components/workspace/tab-launcher';
import type { WorkspaceContextItem } from '../../vendor/open-design/contracts';
import { registerPreviewSource } from '../../vendor/open-design/shims/registry';
import FileViewer from '../viewer/FileViewer.vue';
import DesignFilesPanel from './DesignFilesPanel.vue';
import { DESIGN_FILES_TAB, MAX_RETAINED_VIEWERS } from './constants';
import { diffChangedFiles, initialMarkdownDocument, isStringArray, uniqueName } from './design-files';
import WorkspaceTab from './WorkspaceTab.vue';

const RETAINED_VIEWER_INACTIVE_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
};

const props = withDefaults(
  defineProps<{
    source: PreviewSource;
    /** Deep link (?file=…): opened once the listing knows the file. */
    initialFile?: string | null;
    /**
     * Folder / file drop handler. Declared as a prop (bind it with
     * `@drop-files`) so the drop overlay only appears when someone handles it.
     */
    onDropFiles?: (dataTransfer: DataTransfer) => void;
  }>(),
  { initialFile: null, onDropFiles: undefined },
);
const emit = defineEmits<{
  /** The active file (null = Design Files), for URL sync. */
  activeFileChange: [name: string | null];
}>();
defineSlots<{ leading?: () => unknown; trailing?: () => unknown }>();

const t = useT();
const toast = useToast();
const scope = usePreviewScope();
provideComments(() => props.source);
const writable = computed(() => canWrite(props.source));

const files = shallowRef<ProjectFile[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const assetRefreshKey = ref(0);
const listingKey = ref(0);
const persistKey = computed(() => (props.source.kind === 'local' ? null : `od-preview:tabs:${props.source.id}`));
const tabs = usePersistentState<string[]>(persistKey, [], isStringArray);
const activeTab = ref<string>(DESIGN_FILES_TAB);
const retained = ref<string[]>([]);
const actionsHost = ref<HTMLDivElement | null>(null);
const commentHost = ref<HTMLDivElement | null>(null);
const launcherOpen = ref(false);
const launcherBtnRef = ref<HTMLButtonElement | null>(null);
const uploadInputRef = ref<HTMLInputElement | null>(null);
const tabsBarRef = ref<HTMLDivElement | null>(null);
const dragging = ref(false);
let dragDepth = 0;
let initialApplied: string | null = null;

watch(
  () => props.source,
  (source, _prev, onCleanup) => {
    onCleanup(registerPreviewSource(source));
  },
  { immediate: true },
);

// Source switch: reset the view (runs before the listing watcher below).
watch(
  () => props.source,
  () => {
    files.value = [];
    activeTab.value = DESIGN_FILES_TAB;
    retained.value = [];
    initialApplied = null;
  },
);

// --- listing + change feed ---------------------------------------------------
watch(
  () => [props.source, listingKey.value] as const,
  ([source], _prev, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    loading.value = true;
    void source
      .listFiles(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        const changed = files.value.length ? diffChangedFiles(files.value, next) : [];
        // Any non-HTML change (stylesheet, image, script) can affect every
        // page, so HTML previews reload; an HTML file's own mtime already
        // reloads just that viewer. Sketches and documents never do.
        if (changed.some((name) => kindFor(name) !== 'html' && !/\.(sketch\.json|md|markdown)$/i.test(name))) assetRefreshKey.value += 1;
        files.value = next;
        error.value = null;
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        error.value = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) loading.value = false;
      });
  },
  { immediate: true },
);

watch(
  () => props.source,
  (source, _prev, onCleanup) => {
    if (!source.watch) return;
    onCleanup(source.watch(() => (listingKey.value += 1)));
  },
  { immediate: true },
);


const fileByName = computed(() => new Map(files.value.map((f) => [f.name, f])));

/** Show a file this app just wrote without waiting for the next listing. */
function adoptWrittenFile(file: ProjectFile) {
  files.value = [...files.value.filter((f) => f.name !== file.name), file];
}

// --- tabs ------------------------------------------------------------------------
function openFile(name: string) {
  if (!tabs.value.includes(name)) tabs.value = [...tabs.value, name];
  activeTab.value = name;
}
function closeTab(name: string) {
  const index = tabs.value.indexOf(name);
  const next = tabs.value.filter((n) => n !== name);
  tabs.value = next;
  if (activeTab.value === name) activeTab.value = next[Math.min(index, next.length - 1)] ?? DESIGN_FILES_TAB;
  retained.value = retained.value.filter((n) => n !== name);
}

// Deep link (?file=…) once the listing knows the file.
watch(
  () => [props.initialFile, fileByName.value] as const,
  ([initial, byName]) => {
    if (!initial || initialApplied === initial) return;
    if (!byName.has(initial)) return;
    initialApplied = initial;
    openFile(initial);
  },
  { immediate: true },
);

// Drop tabs whose files disappeared (after a successful listing).
watch([fileByName, loading, error], ([byName, isLoading, err]) => {
  if (isLoading || err) return;
  const next = tabs.value.filter((name) => byName.has(name));
  if (next.length !== tabs.value.length) tabs.value = next;
});
watch(
  () => [tabs.value, activeTab.value] as const,
  ([list, active]) => {
    if (active !== DESIGN_FILES_TAB && !list.includes(active)) activeTab.value = DESIGN_FILES_TAB;
  },
);

watch(
  activeTab,
  (active) => {
    emit('activeFileChange', active === DESIGN_FILES_TAB ? null : active);
  },
  { immediate: true },
);

watch(
  activeTab,
  async (active) => {
    if (active === DESIGN_FILES_TAB) return;
    retained.value = [active, ...retained.value.filter((n) => n !== active)].slice(0, MAX_RETAINED_VIEWERS);
    await nextTick();
    tabsBarRef.value?.querySelector<HTMLElement>('.ws-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
  { immediate: true },
);

// Keyboard: Ctrl+Tab / Ctrl+Shift+Tab cycle tabs (when focus is on the host).
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    const order = [DESIGN_FILES_TAB, ...tabs.value];
    const i = order.indexOf(activeTab.value);
    activeTab.value = order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]!;
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

// --- create / upload (upstream startNewSketch / createMarkdownDocument) -----------
const takenNames = () => new Set(files.value.map((f) => f.name.toLowerCase()));
async function writeAndOpen(name: string, content: string | Blob, open = true): Promise<ProjectFile | null> {
  const source = props.source;
  if (!source.writeFile) return null;
  try {
    const written = await source.writeFile(name, content);
    adoptWrittenFile(written);
    if (open) openFile(written.name);
    return written;
  } catch (err) {
    toast.show(t('app.writeFailed', { message: err instanceof Error ? err.message : String(err) }), { tone: 'error', ttlMs: 6000 });
    return null;
  }
}

function createSketch() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = uniqueName(`sketch-${stamp}.sketch.json`, takenNames());
  void writeAndOpen(name, serializeExcalidrawSketchScene(emptySketchScene(name), name));
}

function createDocument() {
  const name = uniqueName('document.md', takenNames());
  void writeAndOpen(name, initialMarkdownDocument(name, t));
}

async function uploadFiles(list: File[]) {
  if (!list.length) return;
  const taken = takenNames();
  let last: ProjectFile | null = null;
  for (const file of list) {
    const name = uniqueName(file.name, taken);
    taken.add(name.toLowerCase());
    last = (await writeAndOpen(name, file, false)) ?? last;
  }
  if (last) {
    toast.show(t('app.uploaded', { n: list.length }), { tone: 'success' });
    if (list.length === 1) openFile(last.name);
  }
}

function openTab(tabId: string) {
  if (tabId === DESIGN_FILES_TAB) activeTab.value = DESIGN_FILES_TAB;
  else openFile(tabId);
}

const launcherContext = computed<LauncherContext>(() => ({
  projectId: props.source.id,
  openTab,
  ...(writable.value
    ? {
        createSketch,
        createDocument,
        uploadDesignFiles: () => uploadInputRef.value?.click(),
      }
    : {}),
}));
const launcherActions = computed(() => buildLauncherActions(launcherContext.value));
const workspaceContexts = computed<WorkspaceContextItem[]>(() => [
  { id: 'workspace:design-files', kind: 'design-files', label: t('workspace.designFiles'), tabId: DESIGN_FILES_TAB },
  ...tabs.value.map((name) => ({
    id: `file:${name}`,
    kind: 'file' as const,
    label: name.slice(name.lastIndexOf('/') + 1),
    tabId: name,
    path: name,
  })),
]);

const designFilesActive = computed(() => activeTab.value === DESIGN_FILES_TAB);
const viewerFileActive = computed(() => !designFilesActive.value && fileByName.value.has(activeTab.value));
const mountedViewers = computed(() => retained.value.filter((name) => fileByName.value.has(name)));

function retainedStyle(isActive: boolean): CSSProperties {
  return {
    display: 'flex',
    flex: isActive ? '1 1 auto' : undefined,
    flexDirection: 'column',
    minHeight: 0,
    ...(isActive ? {} : RETAINED_VIEWER_INACTIVE_STYLE),
  };
}

// --- drag & drop -----------------------------------------------------------------
const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'));
function onDragEnter(e: DragEvent) {
  if (!props.onDropFiles || !hasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  dragging.value = true;
}
function onDragOver(e: DragEvent) {
  if (props.onDropFiles && hasFiles(e)) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }
}
function onDragLeave(e: DragEvent) {
  if (!props.onDropFiles) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0 || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
    dragDepth = 0;
    dragging.value = false;
  }
}
function onDrop(e: DragEvent) {
  if (!props.onDropFiles || !hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dragging.value = false;
  props.onDropFiles(e.dataTransfer!);
}

function onTabsWheel(event: WheelEvent) {
  const el = event.currentTarget as HTMLElement;
  if (el.scrollWidth <= el.clientWidth) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  el.scrollLeft += event.deltaY;
}

function onUploadChange(e: Event) {
  const input = e.currentTarget as HTMLInputElement;
  const list = input.files ? Array.from(input.files) : [];
  input.value = '';
  void uploadFiles(list);
}

const tabLabel = (name: string) => name.slice(name.lastIndexOf('/') + 1);
</script>

<template>
  <div
    v-bind="scope"
    class="workspace odp-workspace"
    data-testid="file-workspace"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="ws-tabs-shell">
      <div v-if="$slots.leading" class="ws-tabs-project-dock odp-project-dock"><slot name="leading" /></div>
      <div ref="tabsBarRef" class="ws-tabs-bar" role="tablist" :aria-label="t('workspace.pages')" @wheel="onTabsWheel">
        <button
          type="button"
          :class="['ws-tab', 'design-files-tab', { active: designFilesActive }]"
          role="tab"
          :aria-selected="designFilesActive"
          :aria-label="t('workspace.designFiles')"
          data-testid="design-files-tab"
          :title="t('workspace.designFiles')"
          @click="activeTab = DESIGN_FILES_TAB"
        >
          <span class="tab-icon" aria-hidden="true">
            <Icon name="grid" :size="14" />
          </span>
          <span class="ws-tab-label">{{ t('workspace.designFiles') }}</span>
        </button>
        <WorkspaceTab
          v-for="name in tabs"
          :key="name"
          :label="tabLabel(name)"
          :title="name"
          :kind="fileByName.get(name)?.kind ?? kindFor(name)"
          :active="activeTab === name"
          :close-label="t('workspace.closeTab')"
          @activate="activeTab = name"
          @close="closeTab(name)"
        />
      </div>
      <div class="ws-add-tab">
        <button
          ref="launcherBtnRef"
          type="button"
          class="icon-only ws-tab-add od-tooltip"
          data-testid="workspace-add-tab"
          aria-haspopup="dialog"
          :aria-expanded="launcherOpen"
          :title="t('workspace.newTab')"
          :data-tooltip="t('workspace.newTab')"
          data-tooltip-placement="bottom"
          :aria-label="t('workspace.newTab')"
          @click="launcherOpen = !launcherOpen"
        >
          <Icon name="plus" :size="15" />
        </button>
      </div>
      <div class="ws-tabs-actions">
        <div ref="actionsHost" class="ws-tabs-file-actions" data-app-chrome-file-actions="true" :hidden="!viewerFileActive" />
        <slot name="trailing" />
      </div>
    </div>
    <TabLauncherMenu
      v-if="launcherOpen"
      :anchor="launcherBtnRef"
      :files="files"
      :workspace-contexts="workspaceContexts"
      :open-tab-names="tabs"
      :actions="launcherActions"
      :launcher-context="launcherContext"
      @open-file="openFile"
      @open-tab="openTab"
      @close="launcherOpen = false"
    />
    <div class="ws-body">
      <DesignFilesPanel
        v-if="designFilesActive"
        :source="source"
        :files="files"
        :loading="loading"
        :error="error"
        :refresh-key="assetRefreshKey"
        :can-create="writable"
        @retry="listingKey += 1"
        @open-file="openFile"
        @new-sketch="createSketch"
        @new-document="createDocument"
        @upload="uploadInputRef?.click()"
      />
      <div v-if="!designFilesActive && !viewerFileActive && !loading" class="viewer">
        <div class="viewer-body">
          <div class="viewer-empty">{{ t('app.fileMissing') }}</div>
        </div>
      </div>
      <div
        v-for="name in mountedViewers"
        :key="name"
        data-testid="retained-file-viewer"
        :data-file-name="name"
        :aria-hidden="activeTab === name ? undefined : 'true'"
        :inert="activeTab !== name"
        :style="retainedStyle(activeTab === name)"
      >
        <FileViewer
          :source="source"
          :file="fileByName.get(name)!"
          :files-refresh-key="assetRefreshKey"
          :active="activeTab === name"
          :actions-host="actionsHost"
          :comment-host="commentHost"
          :project-files="files"
          @open-file="openFile"
        />
      </div>
      <div v-if="dragging" class="df-drop-overlay" aria-hidden="true">
        <div class="df-drop-overlay-card">
          <Icon name="upload" :size="22" />
          <span class="label">{{ t('app.dropToOpen') }}</span>
          <span class="desc">{{ t('app.dropToOpenDesc') }}</span>
        </div>
      </div>
    </div>
    <!-- Floating comments card (upstream ProjectView `comment-float-host`):
         pre-mounted so a viewer can teleport into it the moment comments open;
         `:empty` hides it otherwise. -->
    <div ref="commentHost" class="comment-float-host" data-testid="comment-float-host" />
    <input ref="uploadInputRef" type="file" multiple hidden data-testid="workspace-upload-input" @change="onUploadChange" />
  </div>
</template>
