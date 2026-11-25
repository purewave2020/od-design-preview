<!--
  Port of upstream FileViewer.tsx `MarkdownViewer`: Source / Split / Preview
  workbench (`markdown-workbench`, `markdown-rendered`), rendered through the
  vendored micromark+GFM pipeline. Relative images resolve against the
  project; links to other project files open as tabs. On a writable source the
  editor autosaves 700 ms after typing stops ("Saving… / Auto-saved · time").
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { usePersistentState } from '../../composables/hooks';
import { copyText } from '../../lib/util';
import { useLocale, useT } from '../../locales';
import { baseName } from '../../sources/file-kind';
import { resolveProjectPath } from '../../sources/inline-assets';
import { canWrite, type PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import { renderMarkdownToSafeHtml } from '../../vendor/open-design/artifacts/markdown';
import Icon from '../../vendor/open-design/components/Icon.vue';
import RemixIcon from '../../vendor/open-design/components/RemixIcon.vue';
import { exportAsMd } from '../../vendor/open-design/runtime/exports';

type Mode = 'edit' | 'split' | 'preview';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 700;

function isMode(value: unknown): value is Mode {
  return value === 'edit' || value === 'split' || value === 'preview';
}

const props = withDefaults(
  defineProps<{
    source: PreviewSource;
    file: ProjectFile;
    filesRefreshKey: number;
    projectFiles: ProjectFile[];
    viewerOnly?: boolean;
  }>(),
  { viewerOnly: false },
);
const emit = defineEmits<{ openFile: [name: string] }>();

const t = useT();
const { locale } = useLocale();
const editable = computed(() => canWrite(props.source) && !props.viewerOnly);
const mode = usePersistentState<Mode>('od-preview:markdown-mode', editable.value ? 'split' : 'preview', isMode);
const text = shallowRef<string | null>(null);
const copied = ref(false);
const saveState = ref<SaveState>('idle');
const savedAt = ref<number | null>(null);
const known = computed(() => new Set(props.projectFiles.map((f) => f.name)));
let currentText = '';
let lastSaved: string | null = null;
let timer: number | null = null;
let inFlight: Promise<void> | null = null;

watch(
  () => [props.source, props.file.name, props.file.mtime, props.filesRefreshKey] as const,
  ([source, name], _prev, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void source.readText(name, { fresh: true }).then((next) => {
      if (cancelled) return;
      const value = next ?? '';
      // Keep unsaved typing; ignore the echo of our own save.
      if (lastSaved !== null && currentText !== lastSaved) return;
      if (value === lastSaved && currentText === value) return;
      lastSaved = value;
      currentText = value;
      text.value = value;
    });
  },
  { immediate: true },
);

async function save(value: string): Promise<void> {
  const source = props.source;
  if (!editable.value || !source.writeFile) return;
  if (inFlight) await inFlight;
  if (value === lastSaved) return;
  const name = props.file.name;
  const run = (async () => {
    saveState.value = 'saving';
    try {
      await source.writeFile!(name, value);
      lastSaved = value;
      savedAt.value = Date.now();
      saveState.value = currentText === value ? 'saved' : 'idle';
    } catch {
      saveState.value = 'error';
    }
  })();
  inFlight = run;
  try {
    await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

function onChangeText(value: string) {
  currentText = value;
  text.value = value;
  if (saveState.value === 'saved') saveState.value = 'idle';
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void save(currentText);
  }, AUTOSAVE_DELAY_MS);
}

// Flush on unmount (tab closed / file switched).
onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearTimeout(timer);
    void save(currentText);
  }
});

const html = computed(() => {
  if (text.value === null) return null;
  const rendered = renderMarkdownToSafeHtml(text.value);
  // Point relative <img src> at the project's own bytes.
  return rendered.replace(/(<img\b[^>]*?\ssrc=")([^"]+)(")/gi, (match, lead: string, src: string, tail: string) => {
    const path = resolveProjectPath(props.file.name, src);
    if (!path || !known.value.has(path)) return match;
    const target = props.projectFiles.find((f) => f.name === path);
    return `${lead}${props.source.fileUrl(path, target?.mtime)}${tail}`;
  });
});

function onArticleClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement).closest('a');
  const href = anchor?.getAttribute('href');
  if (!anchor || !href) return;
  const path = resolveProjectPath(props.file.name, href);
  if (path && known.value.has(path)) {
    event.preventDefault();
    emit('openFile', path);
    return;
  }
  if (/^https?:/i.test(href)) {
    event.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

function copy() {
  if (text.value === null) return;
  void copyText(text.value).then((ok) => {
    if (!ok) return;
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  });
}

const showEditor = computed(() => mode.value !== 'preview');
const showPreview = computed(() => mode.value !== 'edit');
const autoSaveTime = computed(() =>
  savedAt.value != null ? new Date(savedAt.value).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }) : null,
);
const autoSaveLabel = computed(() =>
  saveState.value === 'error'
    ? t('fileViewer.markdownSaveFailed')
    : saveState.value === 'saving'
      ? t('fileViewer.markdownSaving')
      : savedAt.value != null && autoSaveTime.value
        ? t('fileViewer.markdownAutoSaved', { time: autoSaveTime.value })
        : t('fileViewer.markdownAutoSaveHint'),
);
const autoSaveStatus = computed(() =>
  saveState.value === 'error' ? 'error' : saveState.value === 'saving' ? 'saving' : savedAt.value != null ? 'saved' : 'idle',
);
const modes = ['edit', 'split', 'preview'] as const;
function modeLabel(item: Mode): string {
  return item === 'edit' ? t('fileViewer.source') : item === 'split' ? t('fileViewer.split') : t('fileViewer.preview');
}
</script>

<template>
  <div class="viewer text-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left">
        <div class="viewer-tabs markdown-mode-tabs" role="tablist" :aria-label="t('fileViewer.markdownViewMode')">
          <button
            v-for="item in modes"
            :key="item"
            type="button"
            role="tab"
            :aria-selected="mode === item"
            :class="['viewer-tab', { active: mode === item }]"
            :data-testid="`markdown-mode-${item}`"
            @click="mode = item"
          >
            {{ modeLabel(item) }}
          </button>
        </div>
      </div>
      <div class="viewer-toolbar-actions">
        <template v-if="editable">
          <button
            v-if="autoSaveStatus === 'error'"
            type="button"
            class="viewer-action markdown-autosave markdown-autosave-error od-tooltip"
            :title="t('fileViewer.save')"
            :data-tooltip="t('fileViewer.save')"
            data-tooltip-placement="bottom"
            @click="text !== null && void save(text)"
          >
            <Icon name="alert-triangle" :size="13" />
            <span>{{ autoSaveLabel }}</span>
          </button>
          <span v-else :class="['viewer-meta', 'markdown-autosave', `markdown-autosave-${autoSaveStatus}`]" data-testid="markdown-autosave">
            <Icon v-if="autoSaveStatus === 'saving'" name="spinner" :size="13" class="icon-spin" />
            <Icon v-else-if="autoSaveStatus === 'saved'" name="check" :size="13" />
            <span>{{ autoSaveLabel }}</span>
          </span>
        </template>
        <button
          type="button"
          class="viewer-action od-tooltip"
          :title="t('fileViewer.copyTitle')"
          :data-tooltip="t('fileViewer.copyTitle')"
          data-tooltip-placement="bottom"
          @click="copy"
        >
          <Icon :name="copied ? 'check' : 'copy'" :size="13" />
          <span>{{ copied ? t('fileViewer.copied') : t('fileViewer.copy') }}</span>
        </button>
        <button
          type="button"
          class="viewer-action od-tooltip"
          :data-tooltip="t('fileViewer.exportMd')"
          data-tooltip-placement="bottom"
          :disabled="text === null"
          @click="text !== null && exportAsMd(text, baseName(file.name).replace(/\.[^.]+$/, ''))"
        >
          <RemixIcon name="download-line" :size="14" />
          <span>{{ t('fileViewer.download') }}</span>
        </button>
      </div>
    </div>
    <div :class="['viewer-body', 'markdown-workbench', `markdown-workbench-${mode}`]">
      <div v-if="text === null || html === null" class="viewer-empty">{{ t('fileViewer.loading') }}</div>
      <template v-else>
        <section v-if="showEditor" class="markdown-editor-pane" :aria-label="t('fileViewer.markdownEditor')">
          <textarea
            class="markdown-editor"
            :value="text"
            :readonly="!editable"
            :aria-label="t('fileViewer.markdownEditor')"
            :placeholder="editable ? t('fileViewer.markdownEditorPlaceholder') : undefined"
            :spellcheck="editable"
            data-testid="markdown-editor"
            @input="onChangeText(($event.target as HTMLTextAreaElement).value)"
          />
        </section>
        <div v-if="showPreview" class="markdown-preview-pane-wrap">
          <section class="markdown-preview-pane" :aria-label="t('fileViewer.markdownPreview')">
            <!-- Safe by contract: renderMarkdownToSafeHtml escapes raw HTML and rejects unsafe link protocols. -->
            <article class="markdown-rendered" @click="onArticleClick" v-html="html" />
          </section>
        </div>
      </template>
    </div>
  </div>
</template>
