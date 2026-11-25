<!--
  Non-HTML viewers for images / sketches-as-images, video, audio, binaries and
  documents. Ports of upstream FileViewer.tsx ImageViewer / VideoViewer /
  AudioViewer / BinaryViewer / DocumentPreviewViewer with the daemon fetches
  replaced by the PreviewSource contract. PDFs render natively in an <object>.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { useT } from '../../locales';
import { humanSize } from '../../sources/file-kind';
import type { PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import Icon from '../../vendor/open-design/components/Icon.vue';
import FileActions from './FileActions.vue';

const props = defineProps<{
  source: PreviewSource;
  file: ProjectFile;
  filesRefreshKey: number;
  variant: 'image' | 'video' | 'audio' | 'binary' | 'document';
}>();
const t = useT();
const url = computed(() => props.source.fileUrl(props.file.name, props.file.mtime));
const documentMetaKey = computed(() =>
  props.file.kind === 'pdf'
    ? 'fileViewer.pdfMeta'
    : props.file.kind === 'presentation'
      ? 'fileViewer.presentationMeta'
      : props.file.kind === 'spreadsheet'
        ? 'fileViewer.spreadsheetMeta'
        : 'fileViewer.documentMeta',
);
</script>

<template>
  <div v-if="variant === 'image'" class="viewer image-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left">
        <span class="viewer-meta">
          {{
            file.kind === 'sketch'
              ? t('fileViewer.sketchMeta', { size: humanSize(file.size) })
              : t('fileViewer.imageMeta', { size: humanSize(file.size) })
          }}
        </span>
      </div>
      <FileActions :source="source" :file="file" />
    </div>
    <div class="viewer-body image-body">
      <img :alt="file.name" :src="url" />
    </div>
  </div>

  <div v-else-if="variant === 'video'" class="viewer video-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left">
        <span class="viewer-meta">{{ t('fileViewer.videoMeta', { size: humanSize(file.size) }) }}</span>
      </div>
      <FileActions :source="source" :file="file" />
    </div>
    <div class="viewer-body video-body">
      <video :src="url" controls playsinline preload="metadata" />
    </div>
  </div>

  <div v-else-if="variant === 'audio'" class="viewer audio-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left">
        <span class="viewer-meta">{{ t('fileViewer.audioMeta', { size: humanSize(file.size) }) }}</span>
      </div>
      <FileActions :source="source" :file="file" />
    </div>
    <div class="viewer-body audio-body">
      <div class="audio-card">
        <Icon name="mic" :size="28" />
        <div class="audio-card-name">{{ file.name }}</div>
        <audio :src="url" controls preload="metadata" />
      </div>
    </div>
  </div>

  <div v-else-if="variant === 'document'" class="viewer document-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left">
        <span class="viewer-meta">{{ t(documentMetaKey) }} · {{ humanSize(file.size) }}</span>
      </div>
      <FileActions :source="source" :file="file" />
    </div>
    <div class="viewer-body">
      <object v-if="file.kind === 'pdf'" class="odp-pdf-object" :data="url" type="application/pdf" :aria-label="file.name">
        <div class="viewer-empty">{{ t('fileViewer.previewUnavailable') }}</div>
      </object>
      <div v-else class="viewer-empty">{{ t('fileViewer.previewUnavailable') }}</div>
    </div>
  </div>

  <div v-else class="viewer binary-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left">
        <span class="viewer-meta">{{ t('fileViewer.binaryMeta', { size: humanSize(file.size) }) }}</span>
      </div>
      <FileActions :source="source" :file="file" />
    </div>
    <div class="viewer-body">
      <div class="viewer-empty">{{ t('fileViewer.binaryNote', { size: file.size }) }}</div>
    </div>
  </div>
</template>
