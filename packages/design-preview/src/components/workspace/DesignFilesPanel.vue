<!--
  "Design Files" tab — port of apps/web/src/components/DesignFilesPanel.tsx:
  breadcrumbs, category tabs (Folders / Pages / Stylesheets / Scripts /
  Documents / Images / …), live page-card thumbnails, image masonry, file rows,
  row menu and batch ZIP download. Rename, delete and agent actions belong to
  Open Design and are left out.
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { copyText, relativeTime } from '../../lib/util';
import { buildBinaryZip, downloadBlob } from '../../lib/zip-binary';
import { useT } from '../../locales';
import { baseName, humanSize } from '../../sources/file-kind';
import type { PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import { useToast } from '../../ui/toast';
import Icon from '../../vendor/open-design/components/Icon.vue';
import RemixIcon from '../../vendor/open-design/components/RemixIcon.vue';
import AnchoredPopover from '../ui/AnchoredPopover.vue';
import DesignFileImageThumb from './DesignFileImageThumb.vue';
import HtmlCardThumbnail from './HtmlCardThumbnail.vue';
import { fileCategory, kindGlyph, kindLabel, SECTION_ORDER, sectionLabel, type FileCategory } from './design-files';

const props = withDefaults(
  defineProps<{
    source: PreviewSource;
    files: ProjectFile[];
    loading: boolean;
    error: string | null;
    refreshKey: number;
    /** Show the empty-state starters (upstream df-empty-actions); off on read-only sources. */
    canCreate?: boolean;
  }>(),
  { canCreate: false },
);
const emit = defineEmits<{
  retry: [];
  openFile: [name: string];
  newSketch: [];
  newDocument: [];
  upload: [];
}>();

const t = useT();
const toast = useToast();
const currentDir = ref('');
const activeTab = ref<string | null>(null);
const selected = shallowRef<Set<string>>(new Set());
const query = ref('');
const menuFor = ref<string | null>(null);
const menuAnchor = shallowRef<HTMLElement | null>(null);

watch(
  () => props.source.id,
  () => {
    currentDir.value = '';
    activeTab.value = null;
    selected.value = new Set();
    query.value = '';
  },
);
watch(currentDir, () => {
  selected.value = new Set();
  activeTab.value = null;
});

// Climb to the nearest surviving ancestor when the current folder vanishes.
watch(
  () => [props.files, currentDir.value] as const,
  ([files, dir]) => {
    if (dir === '') return;
    if (files.some((f) => f.name.startsWith(`${dir}/`))) return;
    const parts = dir.split('/');
    for (let i = parts.length - 1; i > 0; i--) {
      const ancestor = parts.slice(0, i).join('/');
      if (files.some((f) => f.name.startsWith(`${ancestor}/`))) {
        currentDir.value = ancestor;
        return;
      }
    }
    currentDir.value = '';
  },
);

const searching = computed(() => query.value.trim().length > 0);
const listing = computed(() => {
  const prefix = currentDir.value ? `${currentDir.value}/` : '';
  const dirs = new Set<string>();
  const local: ProjectFile[] = [];
  const counts = new Map<string, number>();
  const q = query.value.trim().toLowerCase();
  for (const file of props.files) {
    if (q) {
      if (file.name.toLowerCase().includes(q)) local.push(file);
      continue;
    }
    if (!file.name.startsWith(prefix)) continue;
    const rest = file.name.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) local.push(file);
    else {
      const dir = rest.slice(0, slash);
      dirs.add(dir);
      const full = prefix + dir;
      counts.set(full, (counts.get(full) ?? 0) + 1);
    }
  }
  return {
    dirsAtCurrentDir: [...dirs].sort((a, b) => a.localeCompare(b)),
    filesAtCurrentDir: local,
    descendantCount: counts,
  };
});

const sections = computed(() => {
  const grouped = new Map<FileCategory, ProjectFile[]>();
  for (const f of listing.value.filesAtCurrentDir) {
    const category = fileCategory(f);
    const bucket = grouped.get(category) ?? [];
    bucket.push(f);
    grouped.set(category, bucket);
  }
  for (const bucket of grouped.values()) bucket.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  return SECTION_ORDER.filter((c) => grouped.has(c)).map((c) => [c, grouped.get(c)!] as const);
});

const availableTabs = computed(() => {
  const tabs: Array<{ id: string; label: string; count: number }> = [];
  if (listing.value.dirsAtCurrentDir.length > 0) {
    tabs.push({ id: 'folders', label: t('designFiles.sectionFolders'), count: listing.value.dirsAtCurrentDir.length });
  }
  for (const [category, sectionFiles] of sections.value) {
    tabs.push({ id: `cat:${category}`, label: sectionLabel(category, t), count: sectionFiles.length });
  }
  return tabs;
});
const resolvedTab = computed(() => {
  const tabs = availableTabs.value;
  if (activeTab.value && tabs.some((tab) => tab.id === activeTab.value)) return activeTab.value;
  const pages = tabs.find((tab) => tab.id === 'cat:html');
  return (pages ?? tabs[0])?.id ?? null;
});

const displayName = (f: ProjectFile) => (searching.value || currentDir.value === '' ? f.name : f.name.slice(currentDir.value.length + 1));
function toggleSelect(name: string) {
  const next = new Set(selected.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  selected.value = next;
}

async function handleBatchDownload() {
  const names = [...selected.value];
  if (!names.length) return;
  try {
    const entries = (await Promise.all(names.map(async (name) => ({ path: name, data: await props.source.readBlob(name) })))).filter(
      (e): e is { path: string; data: Blob } => e.data !== null,
    );
    downloadBlob(await buildBinaryZip(entries), `${props.source.label.replace(/[^\w.-]+/g, '-') || 'project'}.zip`);
  } catch (err) {
    toast.show(t('app.exportFailed', { message: err instanceof Error ? err.message : String(err) }), { tone: 'error' });
  }
}

function openMenu(name: string, anchor: HTMLElement) {
  menuAnchor.value = anchor;
  menuFor.value = menuFor.value === name ? null : name;
}
function onMenuKey(event: KeyboardEvent, name: string) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openMenu(name, event.currentTarget as HTMLElement);
}
function onCheckKey(event: KeyboardEvent, name: string) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleSelect(name);
}

const crumbs = computed(() =>
  currentDir.value
    .split('/')
    .filter(Boolean)
    .map((segment, idx, parts) => ({ segment, path: parts.slice(0, idx + 1).join('/'), isLast: idx === parts.length - 1 })),
);
const dirPath = (dirName: string) => (currentDir.value === '' ? dirName : `${currentDir.value}/${dirName}`);

const menuFile = computed(() => (menuFor.value ? props.files.find((f) => f.name === menuFor.value) ?? null : null));
const isEmpty = computed(() => props.files.length === 0);
const openLabel = (f: ProjectFile) => `${t('designFiles.previewOpen')} ${f.name}`;

function menuOpen(name: string) {
  menuFor.value = null;
  emit('openFile', name);
}
function menuCopyPath(name: string) {
  menuFor.value = null;
  void copyText(name).then(() => toast.show(t('designFiles.copiedPath'), { tone: 'success' }));
}
</script>

<template>
  <div :class="['df-panel', { 'has-selection': selected.size > 0 }]" data-testid="design-files-panel">
    <div v-if="loading && isEmpty" class="df-reloading-overlay" data-testid="design-files-reloading">
      <span class="loading-spinner">
        <Icon name="spinner" :size="16" />
        <span class="loading-spinner-label">{{ t('common.loading') }}</span>
      </span>
    </div>
    <div class="df-main">
      <div class="df-topbar">
        <div class="df-topbar-left">
          <nav class="df-breadcrumbs" :aria-label="t('designFiles.crumbs')">
            <span v-if="currentDir === ''" class="df-breadcrumb-current">{{ source.label }}</span>
            <button v-else type="button" class="df-breadcrumb-btn" @click="currentDir = ''">{{ source.label }}</button>
            <span v-for="crumb in crumbs" :key="crumb.path" class="df-breadcrumb-segment">
              <span class="df-breadcrumb-sep" aria-hidden="true">/</span>
              <span v-if="crumb.isLast" class="df-breadcrumb-current">{{ crumb.segment }}</span>
              <button v-else type="button" class="df-breadcrumb-btn" @click="currentDir = crumb.path">{{ crumb.segment }}</button>
            </span>
          </nav>
        </div>
        <div class="df-topbar-right">
          <div class="df-actions">
            <label class="odp-df-search">
              <RemixIcon name="search-line" :size="13" />
              <input
                v-model="query"
                type="search"
                :placeholder="t('designFiles.searchPlaceholder')"
                :aria-label="t('designFiles.searchPlaceholder')"
              />
            </label>
            <button type="button" :title="t('designFiles.refresh')" data-testid="design-files-refresh" @click="emit('retry')">
              <Icon name="refresh" :size="13" />
              <span>{{ t('designFiles.refresh') }}</span>
            </button>
          </div>
        </div>
      </div>
      <div class="df-body">
        <div v-if="error" class="df-upload-banner" role="alert">
          <span>{{ t('app.filesError', { message: error }) }}</span>
          <button type="button" @click="emit('retry')">{{ t('app.retry') }}</button>
        </div>
        <div v-if="selected.size > 0" class="df-batch-bar" data-testid="design-files-batch-bar">
          <span class="df-batch-count">{{ t('designFiles.downloadSelected', { n: selected.size }) }}</span>
          <div class="df-batch-actions">
            <button type="button" @click="void handleBatchDownload()">
              <Icon name="download" :size="13" />
              <span>{{ t('designFiles.download') }}</span>
            </button>
            <button type="button" class="df-batch-clear" @click="selected = new Set()">{{ t('designFiles.clearSelection') }}</button>
          </div>
        </div>
        <div v-if="isEmpty && !loading" class="df-empty" data-testid="design-files-empty">
          <div class="df-empty-pill">
            <span class="df-empty-title">{{ error ? t('fileViewer.previewUnavailable') : t('designFiles.empty') }}</span>
            <div v-if="!error && canCreate" class="df-empty-actions">
              <button
                type="button"
                class="df-empty-cta df-empty-cta-primary"
                data-testid="design-files-empty-new-sketch"
                :title="t('designFiles.newSketch')"
                @click="emit('newSketch')"
              >
                <Icon name="pencil" :size="13" />
                <span>{{ t('designFiles.newSketch') }}</span>
              </button>
              <button
                type="button"
                class="df-empty-cta df-empty-cta-doc"
                data-testid="design-files-empty-new-document"
                :title="t('designFiles.newDocumentTitle')"
                @click="emit('newDocument')"
              >
                <Icon name="file" :size="13" />
                <span>{{ t('designFiles.newDocument') }}</span>
              </button>
              <button
                type="button"
                class="df-empty-cta df-empty-cta-upload"
                data-testid="design-files-upload-trigger"
                :title="t('designFiles.upload.title')"
                @click="emit('upload')"
              >
                <Icon name="upload" :size="13" />
                <span>{{ t('designFiles.upload.label') }}</span>
              </button>
            </div>
          </div>
        </div>
        <template v-else>
          <div v-if="availableTabs.length > 0" class="df-tabs" role="tablist" data-testid="design-files-tabs">
            <button
              v-for="tab in availableTabs"
              :key="tab.id"
              type="button"
              role="tab"
              :aria-selected="resolvedTab === tab.id"
              :class="['df-tab', { active: resolvedTab === tab.id }]"
              :data-testid="`design-files-tab-${tab.id}`"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
              <span class="df-tab-count">{{ tab.count }}</span>
            </button>
          </div>
          <div v-if="resolvedTab === 'folders'" class="df-section">
            <div v-for="dirName in listing.dirsAtCurrentDir" :key="dirName" class="df-row df-dir-row" @click="currentDir = dirPath(dirName)">
              <span class="df-row-check" aria-hidden="true" />
              <span class="df-row-icon" data-kind="folder" aria-hidden="true">
                <Icon name="folder" :size="14" />
              </span>
              <div class="df-row-name-wrap">
                <button type="button" class="df-row-name-btn" @click.stop="currentDir = dirPath(dirName)">
                  <span class="df-row-name-wrap">
                    <span class="df-row-name" :title="dirName">{{ dirName }}</span>
                    <span class="df-row-sub">{{ t('designFiles.folderCount', { n: listing.descendantCount.get(dirPath(dirName)) ?? 0 }) }}</span>
                  </span>
                </button>
              </div>
              <span class="df-row-size" />
              <span class="df-row-time" />
              <span class="df-row-menu df-row-menu-placeholder" aria-hidden="true" />
            </div>
          </div>
          <template v-for="[category, sectionFiles] in sections" :key="category">
            <div v-if="resolvedTab === `cat:${category}`" class="df-section">
              <div v-if="category === 'html'" class="df-card-grid">
                <div
                  v-for="f in sectionFiles"
                  :key="f.name"
                  :data-testid="`design-file-row-${f.name}`"
                  :class="['df-card', { selected: selected.has(f.name) }]"
                >
                  <span
                    class="df-card-check"
                    role="checkbox"
                    :aria-checked="selected.has(f.name)"
                    tabindex="0"
                    @click.stop="toggleSelect(f.name)"
                    @keydown="onCheckKey($event, f.name)"
                  >
                    <RemixIcon :name="selected.has(f.name) ? 'checkbox-line' : 'checkbox-blank-line'" :size="14" />
                  </span>
                  <button type="button" class="df-card-thumb" :title="openLabel(f)" :aria-label="openLabel(f)" @click="emit('openFile', f.name)">
                    <HtmlCardThumbnail :source="source" :file="f" :refresh-key="refreshKey" />
                  </button>
                  <div class="df-card-meta">
                    <div class="df-card-meta-text">
                      <button type="button" class="df-card-name-btn" :title="openLabel(f)" @click="emit('openFile', f.name)">
                        <span class="df-card-name" :title="displayName(f)">{{ displayName(f) }}</span>
                      </button>
                      <span class="df-card-sub">{{ kindLabel(category, t) }}{{ f.mtime ? ` · ${relativeTime(f.mtime, t)}` : '' }}</span>
                    </div>
                    <span
                      :data-testid="`design-file-menu-${f.name}`"
                      class="df-row-menu"
                      role="button"
                      tabindex="0"
                      :aria-label="t('designFiles.rowMenu')"
                      @click.stop="openMenu(f.name, $event.currentTarget as HTMLElement)"
                      @keydown="onMenuKey($event, f.name)"
                      >⋯</span
                    >
                  </div>
                </div>
              </div>
              <div v-else-if="category === 'image'" class="df-image-masonry" data-testid="design-files-image-masonry">
                <div
                  v-for="f in sectionFiles"
                  :key="f.name"
                  :data-testid="`design-file-row-${f.name}`"
                  :class="['df-card', 'df-card--image', { selected: selected.has(f.name) }]"
                >
                  <span
                    class="df-card-check"
                    role="checkbox"
                    :aria-checked="selected.has(f.name)"
                    tabindex="0"
                    @click.stop="toggleSelect(f.name)"
                    @keydown="onCheckKey($event, f.name)"
                  >
                    <RemixIcon :name="selected.has(f.name) ? 'checkbox-line' : 'checkbox-blank-line'" :size="14" />
                  </span>
                  <DesignFileImageThumb :src="source.fileUrl(f.name, f.mtime)" :title="openLabel(f)" @open="emit('openFile', f.name)" />
                  <span
                    :data-testid="`design-file-menu-${f.name}`"
                    class="df-row-menu df-card-menu-overlay"
                    role="button"
                    tabindex="0"
                    :aria-label="t('designFiles.rowMenu')"
                    @click.stop="openMenu(f.name, $event.currentTarget as HTMLElement)"
                    @keydown="onMenuKey($event, f.name)"
                    >⋯</span
                  >
                </div>
              </div>
              <template v-else>
                <div
                  v-for="f in sectionFiles"
                  :key="f.name"
                  :data-testid="`design-file-row-${f.name}`"
                  :class="['df-row', 'df-file-row', { selected: selected.has(f.name) }]"
                >
                  <span
                    class="df-row-check"
                    role="checkbox"
                    :aria-checked="selected.has(f.name)"
                    tabindex="0"
                    @click.stop="toggleSelect(f.name)"
                    @keydown="onCheckKey($event, f.name)"
                  >
                    <RemixIcon :name="selected.has(f.name) ? 'checkbox-line' : 'checkbox-blank-line'" :size="14" />
                  </span>
                  <span class="df-row-icon df-row-openable" :data-kind="category" aria-hidden="true" @click="emit('openFile', f.name)">{{
                    kindGlyph(category)
                  }}</span>
                  <div class="df-row-name-wrap">
                    <button type="button" class="df-row-name-btn" @click="emit('openFile', f.name)">
                      <span class="df-row-name-wrap">
                        <span class="df-row-name" :title="f.name">{{ displayName(f) }}</span>
                        <span class="df-row-sub">{{ kindLabel(category, t) }}</span>
                      </span>
                    </button>
                  </div>
                  <span class="df-row-size df-row-openable" @click="emit('openFile', f.name)">{{ humanSize(f.size) }}</span>
                  <span class="df-row-time df-row-openable" @click="emit('openFile', f.name)">{{ f.mtime ? relativeTime(f.mtime, t) : '' }}</span>
                  <span
                    :data-testid="`design-file-menu-${f.name}`"
                    class="df-row-menu"
                    role="button"
                    tabindex="0"
                    :aria-label="t('designFiles.rowMenu')"
                    @click.stop="openMenu(f.name, $event.currentTarget as HTMLElement)"
                    @keydown="onMenuKey($event, f.name)"
                    >⋯</span
                  >
                </div>
              </template>
            </div>
          </template>
        </template>
      </div>
    </div>
    <AnchoredPopover :anchor="menuAnchor" :open="menuFile !== null" class-name="df-row-popover" align="end" @close="menuFor = null">
      <template v-if="menuFile">
        <button type="button" @click="menuOpen(menuFile.name)">{{ t('designFiles.openInTab') }}</button>
        <button type="button" @click="menuCopyPath(menuFile.name)">{{ t('designFiles.copyPath') }}</button>
        <a
          :href="source.fileUrl(menuFile.name, menuFile.mtime)"
          :download="baseName(menuFile.name)"
          style="text-decoration: none"
          @click="menuFor = null"
        >
          <button type="button">{{ t('designFiles.download') }}</button>
        </a>
        <a
          :href="source.fileUrl(menuFile.name, menuFile.mtime)"
          target="_blank"
          rel="noreferrer noopener"
          style="text-decoration: none"
          @click="menuFor = null"
        >
          <button type="button">{{ t('common.openInNewTab') }}</button>
        </a>
      </template>
    </AnchoredPopover>
  </div>
</template>
