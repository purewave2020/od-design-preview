<!-- List-only disclosure: measure the rendered three-line clamp, never truncate saved data. -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { uniqueId } from '../../lib/util';
import type { TranslateFn } from '../../locales';

const props = defineProps<{ note: string; t: TranslateFn }>();
const bodyRef = ref<HTMLDivElement | null>(null);
const bodyId = uniqueId('odp-comment-body');
const expanded = ref(false);
const overflows = ref(false);

watch(
  [bodyRef, () => props.note, expanded],
  ([body], _prev, onCleanup) => {
    if (!body) return;
    const measure = () => {
      const wasClamped = body.classList.contains('is-clamped');
      if (!wasClamped) body.classList.add('is-clamped');
      const next = body.scrollHeight > body.clientHeight + 1;
      if (!wasClamped) body.classList.remove('is-clamped');
      if (overflows.value !== next) overflows.value = next;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    onCleanup(() => observer.disconnect());
  },
  { immediate: true, flush: 'post' },
);
</script>

<template>
  <div class="comment-side-body-wrap">
    <div :id="bodyId" ref="bodyRef" :class="['comment-side-body', { 'is-clamped': !expanded }]">{{ note }}</div>
    <button
      v-if="overflows"
      type="button"
      class="comment-side-expand"
      :aria-controls="bodyId"
      :aria-expanded="expanded"
      @click.stop="expanded = !expanded"
      @keydown.stop
    >
      {{ t(expanded ? 'chat.comments.collapseBody' : 'chat.comments.expandBody') }}
    </button>
  </div>
</template>
