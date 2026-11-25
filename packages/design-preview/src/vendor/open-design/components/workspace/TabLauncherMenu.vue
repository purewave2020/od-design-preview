<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/workspace/TabLauncherMenu.tsx (Apache-2.0).

  Command-palette dropdown for the tab strip's "+" button. Teleported to
  <body> with fixed positioning so no ancestor `overflow` clips it. Searches
  the project's files (open in a new tab), the open tabs, and lists the
  registry-driven "Create new" actions.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useT } from '../../shims/i18n';
import Icon from '../Icon.vue';
import type { IconName } from '../Icon';
import type { ProjectFile, ProjectFileKind } from '../../shims/types';
import type { WorkspaceContextItem } from '../../contracts/index';
import type { TabLauncherClickProps } from '../../shims/analytics';
import type { LauncherAction, LauncherContext } from './tab-launcher';
import styles from './TabLauncherMenu.module.css';
import { usePreviewScope } from '../../../../theme';

const scope = usePreviewScope();

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

// Create-new rows cycle through a small hue palette (one color per row).
const ACTION_ICON_COLORS = [styles.iconBlue, styles.iconGreen, styles.iconAmber, styles.iconRed];

export type TabLauncherTrackInput = Omit<TabLauncherClickProps, 'page_name' | 'area' | 'project_id'>;

const props = withDefaults(
  defineProps<{
    /** The "+" button the menu is anchored to (for fixed positioning). */
    anchor: HTMLElement | null;
    /** Project files to search. */
    files: ProjectFile[];
    /** Open workspace tabs to search and focus. */
    workspaceContexts?: WorkspaceContextItem[];
    /** Tab names already open, so matching rows can show an "open" marker. */
    openTabNames: string[];
    /** "Create new" actions from the launcher registry. */
    actions: LauncherAction[];
    /** Context the registry actions run against. */
    launcherContext: LauncherContext;
  }>(),
  { workspaceContexts: () => [] },
);
const emit = defineEmits<{
  openFile: [name: string];
  openTab: [tabId: string];
  track: [input: TabLauncherTrackInput];
  close: [];
}>();

const t = useT() as TranslateFn;
const menuRef = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const query = ref('');
const kindFilter = ref<ProjectFileKind | 'all'>('all');
const selected = ref(0);
const pos = shallowRef<{ top: number; left: number } | null>(null);

// Position from the anchor's rect; keep it pinned to the button's right edge.
function updatePosition() {
  const anchor = props.anchor;
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const width = 340;
  const left = Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12));
  pos.value = { top: r.bottom + 6, left };
}

watch(
  () => props.anchor,
  (anchor, _prev, onCleanup) => {
    if (!anchor) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    onCleanup(() => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    });
  },
  { immediate: true },
);

// Outside-click / Escape to dismiss.
function onDocumentMouseDown(e: MouseEvent) {
  const target = e.target as Node;
  if (props.anchor?.contains(target)) return;
  if (menuRef.value?.contains(target)) return;
  emit('close');
}
function onDocumentKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown);
  document.addEventListener('keydown', onDocumentKeyDown);
  // Fire once when the launcher opens (the menu mounts only while open).
  emit('track', { element: 'open' });
  void nextTick(() => inputRef.value?.focus());
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown);
  document.removeEventListener('keydown', onDocumentKeyDown);
});

// The set of kinds present, in a stable order, for the filter chips.
const presentKinds = computed(() => {
  const seen = new Set<ProjectFileKind>();
  for (const f of props.files) seen.add(f.kind);
  return [...seen];
});

const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.files.filter((f) => {
    if (kindFilter.value !== 'all' && f.kind !== kindFilter.value) return false;
    if (!q) return true;
    return f.name.toLowerCase().includes(q);
  });
});

const tabResults = computed(() => {
  if (kindFilter.value !== 'all') return [] as WorkspaceContextItem[];
  const q = query.value.trim().toLowerCase();
  return props.workspaceContexts
    .filter((item) => item.tabId)
    .filter((item) => !q || workspaceContextSearchText(item).toLowerCase().includes(q))
    .slice(0, 20);
});

const selectableCount = computed(() => results.value.length + tabResults.value.length);

// Clamp the selection whenever the result set shrinks.
watch(selectableCount, (count) => {
  selected.value = count === 0 ? 0 : Math.min(selected.value, count - 1);
});

// Keep the keyboard-selected row visible as arrow keys move past the edges.
watch(
  [selected, selectableCount],
  () => {
    const el = menuRef.value?.querySelector<HTMLElement>(`[data-selectable-idx="${selected.value}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  },
  { flush: 'post' },
);

const openSet = computed(() => new Set(props.openTabNames));

function chooseFile(file: ProjectFile) {
  emit('track', { element: 'open_file', file_kind: file.kind });
  emit('openFile', file.name);
  emit('close');
}

function chooseTab(item: WorkspaceContextItem) {
  emit('track', { element: 'open_tab', tab_kind: item.kind });
  if (item.tabId) emit('openTab', item.tabId);
  emit('close');
}

function runLauncherAction(action: LauncherAction) {
  emit('track', { element: 'create', action_id: action.id });
  action.run(props.launcherContext);
  emit('close');
}

function setKindFilter(kind: ProjectFileKind | 'all') {
  emit('track', { element: 'filter', kind_filter: kind });
  kindFilter.value = kind;
}

function onInputKeyDown(e: KeyboardEvent) {
  const count = selectableCount.value;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selected.value = count === 0 ? 0 : (selected.value + 1) % count;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selected.value = count === 0 ? 0 : (selected.value - 1 + count) % count;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const file = results.value[selected.value] ?? null;
    if (file) {
      chooseFile(file);
      return;
    }
    const tab = tabResults.value[selected.value - results.value.length] ?? null;
    if (tab) chooseTab(tab);
    else if (props.actions[0]) {
      // No file matches but "Create new" actions exist — Enter runs the first.
      runLauncherAction(props.actions[0]);
    }
  }
}

// --- local helpers (same wording contract as DesignFilesPanel) ---------------

function kindIconName(kind: ProjectFileKind): IconName {
  if (kind === 'html') return 'file-code';
  if (kind === 'image') return 'image';
  if (kind === 'sketch') return 'pencil';
  if (kind === 'code') return 'file-code';
  return 'file';
}

function kindLabel(kind: ProjectFileKind, translate: TranslateFn): string {
  if (kind === 'html') return translate('designFiles.kindHtml');
  if (kind === 'image') return translate('designFiles.kindImage');
  if (kind === 'sketch') return translate('designFiles.kindSketch');
  if (kind === 'text') return translate('designFiles.kindText');
  if (kind === 'code') return translate('designFiles.kindCode');
  if (kind === 'pdf') return translate('designFiles.kindPdf');
  if (kind === 'document') return translate('designFiles.kindDocument');
  if (kind === 'presentation') return translate('designFiles.kindPresentation');
  if (kind === 'spreadsheet') return translate('designFiles.kindSpreadsheet');
  return translate('designFiles.kindBinary');
}

function workspaceContextIconName(kind: WorkspaceContextItem['kind']): IconName {
  if (kind === 'browser') return 'globe';
  if (kind === 'design-files' || kind === 'folder') return 'folder';
  if (kind === 'project') return 'folder';
  if (kind === 'local-code') return 'terminal';
  if (kind === 'design-system') return 'blocks';
  if (kind === 'terminal') return 'terminal';
  if (kind === 'side-chat') return 'comment';
  if (kind === 'live-artifact') return 'file-code';
  return 'file';
}

function workspaceContextSearchText(item: WorkspaceContextItem): string {
  return [item.id, item.kind, item.label, item.tabId ?? '', item.path ?? '', item.absolutePath ?? '', item.url ?? '', item.title ?? ''].join(' ');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="pos"
      ref="menuRef"
      v-bind="scope"
      :class="styles.menu"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
      role="dialog"
      :aria-label="t('workspace.newTab')"
      data-testid="tab-launcher-menu"
    >
      <div :class="styles.searchRow">
        <span :class="styles.searchIcon" aria-hidden="true">
          <Icon name="search" :size="15" />
        </span>
        <input
          ref="inputRef"
          v-model="query"
          :class="styles.searchInput"
          type="text"
          :placeholder="t('workspace.searchFilesPlaceholder')"
          data-testid="tab-launcher-search"
          @keydown="onInputKeyDown"
        />
      </div>

      <div v-if="presentKinds.length > 0" :class="styles.chips">
        <button type="button" :class="[styles.chip, kindFilter === 'all' ? styles.chipActive : '']" @click="setKindFilter('all')">
          {{ t('workspace.allFiles') }}
        </button>
        <button
          v-for="kind in presentKinds"
          :key="kind"
          type="button"
          :class="[styles.chip, kindFilter === kind ? styles.chipActive : '']"
          @click="setKindFilter(kind)"
        >
          {{ kindLabel(kind, t) }}
        </button>
      </div>

      <div :class="styles.scrollBody" data-testid="tab-launcher-scroll-body">
        <section v-if="actions.length > 0" :class="styles.section">
          <div :class="styles.sectionHeader">{{ t('workspace.createNew') }}</div>
          <ul :class="styles.list">
            <li v-for="(action, index) in actions" :key="action.id">
              <button type="button" :class="styles.row" @click="runLauncherAction(action)">
                <span :class="[styles.rowIcon, ACTION_ICON_COLORS[index % ACTION_ICON_COLORS.length]]" aria-hidden="true">
                  <Icon :name="action.iconName" :size="15" />
                </span>
                <span :class="styles.rowBody">
                  <span :class="styles.rowName">{{ t(action.labelKey) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="results.length > 0" :class="styles.section">
          <div :class="styles.sectionHeader">{{ t('workspace.openFile') }}</div>
          <ul :class="styles.list">
            <li v-for="(file, index) in results" :key="file.name">
              <button
                type="button"
                :class="[styles.row, index === selected ? styles.rowSelected : '']"
                :data-selectable-idx="index"
                data-testid="tab-launcher-result"
                @mouseenter="selected = index"
                @click="chooseFile(file)"
              >
                <span :class="styles.rowIcon" aria-hidden="true">
                  <Icon :name="kindIconName(file.kind)" :size="15" />
                </span>
                <span :class="styles.rowBody">
                  <span :class="styles.rowName">{{ file.name }}</span>
                </span>
                <span v-if="openSet.has(file.name)" :class="styles.rowOpen">{{ t('workspace.tabOpen') }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="tabResults.length > 0" :class="styles.section">
          <div :class="styles.sectionHeader">{{ t('workspace.openTabs') }}</div>
          <ul :class="styles.list">
            <li v-for="(item, index) in tabResults" :key="item.id">
              <button
                type="button"
                :class="[styles.row, results.length + index === selected ? styles.rowSelected : '']"
                :data-selectable-idx="results.length + index"
                data-testid="tab-launcher-tab-result"
                @mouseenter="selected = results.length + index"
                @click="chooseTab(item)"
              >
                <span :class="styles.rowIcon" aria-hidden="true">
                  <Icon :name="workspaceContextIconName(item.kind)" :size="15" />
                </span>
                <span :class="styles.rowBody">
                  <span :class="styles.rowName">{{ item.label }}</span>
                </span>
                <span :class="styles.rowOpen">{{ t('workspace.tabOpen') }}</span>
              </button>
            </li>
          </ul>
        </section>

        <div v-if="results.length === 0 && tabResults.length === 0" :class="styles.empty" data-testid="tab-launcher-empty">
          {{ t('workspace.noFilesMatch') }}
        </div>
      </div>
    </div>
  </Teleport>
</template>
