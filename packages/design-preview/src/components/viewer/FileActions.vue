<script setup lang="ts">
import { computed } from 'vue';
import { useT } from '../../locales';
import { baseName } from '../../sources/file-kind';
import type { PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';

const props = defineProps<{ source: PreviewSource; file: ProjectFile }>();
const t = useT();
const url = computed(() => props.source.fileUrl(props.file.name, props.file.mtime));
</script>

<template>
  <div class="viewer-toolbar-actions">
    <a class="ghost-link" :href="url" :download="baseName(file.name)">{{ t('fileViewer.download') }}</a>
    <a class="ghost-link" :href="url" target="_blank" rel="noreferrer noopener">{{ t('fileViewer.open') }}</a>
  </div>
</template>
