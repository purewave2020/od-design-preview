<!-- Ported to Vue from nexu-io/open-design apps/web/src/components/BoardComposerPopover.tsx `AnnotationStyleSummary` (Apache-2.0). -->
<script setup lang="ts">
import { computed } from 'vue';
import type { PreviewCommentSnapshot } from '../comments';
import { annotationStyleRows } from './board-composer';

const props = withDefaults(defineProps<{ target: PreviewCommentSnapshot; testId?: string }>(), {
  testId: 'annotation-style-summary',
});
const rows = computed(() => annotationStyleRows(props.target));
</script>

<template>
  <div v-if="rows.length > 0" class="annotation-style-summary" :data-testid="testId">
    <div v-for="row in rows" :key="row.label" class="annotation-style-row">
      <span>{{ row.label }}</span>
      <strong :title="row.value">
        <i v-if="row.swatch" aria-hidden="true" :style="{ backgroundColor: row.swatch }" />
        {{ row.value }}
      </strong>
    </div>
  </div>
</template>
