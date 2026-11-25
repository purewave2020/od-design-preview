<!-- Viewer-only surface for `?embed=1&file=…` (no tab strip). -->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useT } from '../../locales';
import type { PreviewSource } from '../../sources/types';
import { usePreviewScope } from '../../theme';
import type { ProjectFile } from '../../types';
import { registerPreviewSource } from '../../vendor/open-design/shims/registry';
import FileViewer from '../viewer/FileViewer.vue';

const props = defineProps<{ source: PreviewSource; file: string }>();

const t = useT();
const scope = usePreviewScope();
const files = shallowRef<ProjectFile[] | null>(null);
const refreshKey = ref(0);

watch(
  () => props.source,
  (source, _prev, onCleanup) => {
    onCleanup(registerPreviewSource(source));
  },
  { immediate: true },
);
watch(
  () => [props.source, refreshKey.value] as const,
  ([source], _prev, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void source.listFiles().then(
      (next) => {
        if (!cancelled) files.value = next;
      },
      () => {
        if (!cancelled) files.value = [];
      },
    );
  },
  { immediate: true },
);
watch(
  () => props.source,
  (source, _prev, onCleanup) => {
    if (source.watch) onCleanup(source.watch(() => (refreshKey.value += 1)));
  },
  { immediate: true },
);

const target = computed(() => files.value?.find((f) => f.name === props.file) ?? null);
</script>

<template>
  <div v-bind="scope" class="workspace odp-workspace odp-embed" data-testid="embedded-viewer">
    <div class="ws-body">
      <template v-if="files !== null">
        <FileViewer
          v-if="target"
          :source="source"
          :file="target"
          :files-refresh-key="refreshKey"
          active
          :actions-host="null"
          :project-files="files"
          viewer-only
        />
        <div v-else class="viewer">
          <div class="viewer-body">
            <div class="viewer-empty">{{ t('app.fileMissing') }}</div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
