<!-- Port of upstream FileViewer.tsx `FileViewerLoadingSkeleton`. -->
<script setup lang="ts">
import { useT } from '../../locales';

const t = useT();
</script>

<template>
  <div class="viewer-loading" role="status" aria-busy="true" :aria-label="t('fileViewer.loading')">
    <div class="viewer-loading-stage" aria-hidden="true">
      <span class="viewer-loading-card viewer-loading-card-back viewer-loading-card-back-two" />
      <span class="viewer-loading-card viewer-loading-card-back viewer-loading-card-back-one" />
      <span class="viewer-loading-card viewer-loading-card-main">
        <span class="viewer-loading-kicker" />
        <span class="viewer-loading-title" />
        <span class="viewer-loading-title viewer-loading-title-short" />
        <span class="viewer-loading-rule" />
        <span class="viewer-loading-content">
          <span class="viewer-loading-copy">
            <span class="viewer-loading-line" />
            <span class="viewer-loading-line viewer-loading-line-medium" />
            <span class="viewer-loading-line viewer-loading-line-short" />
          </span>
          <span class="viewer-loading-chart">
            <span class="viewer-loading-bar viewer-loading-bar-one" />
            <span class="viewer-loading-bar viewer-loading-bar-two" />
            <span class="viewer-loading-bar viewer-loading-bar-three" />
          </span>
        </span>
      </span>
    </div>
  </div>
</template>
