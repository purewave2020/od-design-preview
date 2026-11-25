<!-- Port of upstream FileViewer.tsx `SvgViewer` (Preview / Source, reload). -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useFileText } from '../../composables/useFileText';
import { useT } from '../../locales';
import { baseName, humanSize } from '../../sources/file-kind';
import type { PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import Icon from '../../vendor/open-design/components/Icon.vue';

const props = defineProps<{ source: PreviewSource; file: ProjectFile; filesRefreshKey: number }>();
const t = useT();
const mode = ref<'preview' | 'source'>('preview');
const reloadKey = ref(0);
const { text, error } = useFileText(
  () => props.source,
  () => props.file,
  () => props.filesRefreshKey + reloadKey.value,
  () => mode.value === 'source',
);
const url = computed(() => props.source.fileUrl(props.file.name, props.file.mtime));
const imgSrc = computed(() => (reloadKey.value ? `${url.value}${url.value.includes('?') ? '&' : '?'}r=${reloadKey.value}` : url.value));
</script>

<template>
  <div class="viewer svg-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left">
        <span class="viewer-meta">{{ t('fileViewer.imageMeta', { size: humanSize(file.size) }) }}</span>
      </div>
      <div class="viewer-toolbar-actions">
        <div class="viewer-tabs">
          <button type="button" :class="['viewer-tab', { active: mode === 'preview' }]" :aria-pressed="mode === 'preview'" @click="mode = 'preview'">
            {{ t('fileViewer.preview') }}
          </button>
          <button type="button" :class="['viewer-tab', { active: mode === 'source' }]" :aria-pressed="mode === 'source'" @click="mode = 'source'">
            {{ t('fileViewer.source') }}
          </button>
        </div>
        <span class="viewer-divider" aria-hidden="true" />
        <button
          type="button"
          class="viewer-action od-tooltip"
          :title="t('fileViewer.reloadDisk')"
          :data-tooltip="t('fileViewer.reloadDisk')"
          data-tooltip-placement="bottom"
          @click="reloadKey += 1"
        >
          <Icon name="reload" :size="13" />
          <span>{{ t('fileViewer.reload') }}</span>
        </button>
        <a class="ghost-link" :href="url" :download="baseName(file.name)">{{ t('fileViewer.download') }}</a>
        <a class="ghost-link" :href="url" target="_blank" rel="noreferrer noopener">{{ t('fileViewer.open') }}</a>
      </div>
    </div>
    <div :class="['viewer-body', { 'image-body': mode === 'preview' }]">
      <img v-if="mode === 'preview'" :alt="file.name" :src="imgSrc" />
      <div v-else-if="text === null" class="viewer-empty">{{ t('fileViewer.loading') }}</div>
      <div v-else-if="error" class="viewer-empty">{{ t('fileViewer.previewUnavailable') }}</div>
      <pre v-else class="viewer-source">{{ text }}</pre>
    </div>
  </div>
</template>
