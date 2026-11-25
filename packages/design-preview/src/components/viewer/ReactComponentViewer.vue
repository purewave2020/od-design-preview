<!--
  Port of upstream FileViewer.tsx `ReactComponentViewer`: renders a .jsx/.tsx
  artifact through the vendored `buildReactComponentSrcdoc` (React 18 + Babel
  from unpkg, inside the sandboxed frame — not this app) in the same sandbox as
  HTML previews.
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useT } from '../../locales';
import { baseName } from '../../sources/file-kind';
import type { PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import Icon from '../../vendor/open-design/components/Icon.vue';
import RemixIcon from '../../vendor/open-design/components/RemixIcon.vue';
import { exportReactComponentAsHtml } from '../../vendor/open-design/runtime/exports';
import { buildReactComponentSrcdoc } from '../../vendor/open-design/runtime/react-component';
import { HTML_PREVIEW_SANDBOX } from '../../viewer/sandbox';
import CodeWithLines from './CodeWithLines.vue';

const props = defineProps<{ source: PreviewSource; file: ProjectFile; filesRefreshKey: number }>();
const t = useT();
const mode = ref<'preview' | 'source'>('preview');
const reloadKey = ref(0);
const text = shallowRef<string | null>(null);
const title = computed(() => baseName(props.file.name).replace(/\.[^.]+$/, ''));

watch(
  () => [props.source, props.file.name, props.file.mtime, props.filesRefreshKey, reloadKey.value] as const,
  ([source, name], _prev, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void source.readText(name, { fresh: true }).then((next) => {
      if (!cancelled) text.value = next ?? '';
    });
  },
  { immediate: true },
);

const srcDoc = computed(() =>
  text.value === null
    ? ''
    : buildReactComponentSrcdoc(text.value, { title: title.value }).replace(/(<html\b)/i, `$1 data-od-reload-key="${reloadKey.value}"`),
);

const tabs = computed(
  () =>
    [
      ['preview', t('fileViewer.preview'), 'eye-line'],
      ['source', t('fileViewer.source'), 'code-s-slash-line'],
    ] as const,
);
</script>

<template>
  <div class="viewer html-viewer react-component-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left">
        <button
          type="button"
          class="icon-only od-tooltip"
          :title="`${t('fileViewer.reload')} ${t('fileViewer.preview')}`"
          :data-tooltip="`${t('fileViewer.reload')} ${t('fileViewer.preview')}`"
          data-tooltip-placement="bottom"
          :aria-label="`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`"
          @click="reloadKey += 1"
        >
          <Icon name="reload" :size="14" />
        </button>
        <div class="viewer-tabs viewer-mode-tabs" role="tablist" aria-label="View mode">
          <button
            v-for="[id, label, icon] in tabs"
            :key="id"
            type="button"
            role="tab"
            :class="['viewer-tab', { active: mode === id }]"
            :aria-selected="mode === id"
            @click="mode = id"
          >
            <RemixIcon :name="icon" :size="14" class="viewer-tab-icon" />
            <span class="viewer-tab-label">{{ label }}</span>
          </button>
        </div>
        <span class="viewer-meta">{{ t('app.reactNote') }}</span>
      </div>
      <div class="viewer-toolbar-actions">
        <button
          type="button"
          class="viewer-action od-tooltip"
          :data-tooltip="t('fileViewer.exportHtml')"
          data-tooltip-placement="bottom"
          :disabled="text === null"
          @click="text !== null && exportReactComponentAsHtml(text, title)"
        >
          <RemixIcon name="file-code-line" :size="14" />
          <span>{{ t('fileViewer.exportHtml') }}</span>
        </button>
      </div>
    </div>
    <div class="viewer-body">
      <div v-if="text === null" class="viewer-empty">{{ t('fileViewer.loading') }}</div>
      <div v-else-if="mode === 'preview'" class="comment-preview-layer preview-viewport preview-viewport-desktop">
        <div class="comment-preview-canvas">
          <div class="comment-frame-clip">
            <div style="width: 100%; height: 100%">
              <div class="artifact-preview-transport-stack">
                <iframe :title="file.name" :sandbox="HTML_PREVIEW_SANDBOX" :srcdoc="srcDoc" data-od-active="true" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <CodeWithLines v-else :text="text" />
    </div>
  </div>
</template>
