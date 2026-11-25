<!-- Ported to Vue from nexu-io/open-design apps/web/src/components/DeckThumbnailRail.tsx `DeckThumbnailItem` (Apache-2.0). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, toRef, watch } from 'vue';
import type { ParsedDeckThumbnails } from '../runtime/deck-thumbnail-parser';
import DeckIframeThumbnail from './DeckIframeThumbnail.vue';
import DeckSlideThumbnail from './DeckSlideThumbnail.vue';
import type { DeckThumbnailViewport } from './deck-thumbnails';
import { useInView } from './useInView';

const props = defineProps<{
  index: number;
  active: boolean;
  mounted: boolean;
  label: string;
  listEl: HTMLElement | null;
  /** Parsed deck for shadow-root rendering; null → full-deck iframe fallback. */
  parsedDeck: ParsedDeckThumbnails | null;
  previewViewport?: DeckThumbnailViewport | null;
  getSrcDoc: (index: number) => string;
}>();
const emit = defineEmits<{
  select: [index: number];
  visibility: [index: number, inView: boolean];
}>();

// `once: false` so scrolling a thumbnail far away releases its slot in the
// LRU window; the list is the observation root (its overflow clips).
const { ref: buttonRef, inView } = useInView<HTMLButtonElement>({
  once: false,
  rootMargin: '320px',
  root: toRef(props, 'listEl'),
});
watch(
  [() => props.index, inView],
  ([index, visible]) => emit('visibility', index, visible),
  { immediate: true },
);
onBeforeUnmount(() => emit('visibility', props.index, false));

// If the shadow build throws for this slide, drop to the iframe fallback;
// a new deck (or index) retries the cheap path.
const shadowFailed = ref(false);
watch(
  () => [props.parsedDeck, props.index],
  () => {
    shadowFailed.value = false;
  },
);
const useShadow = computed(() => props.parsedDeck !== null && !shadowFailed.value);

// Readiness is tied to the renderer currently mounted (source identity), so a
// new deck / fallback is synchronously not-ready and a late ready callback can
// only mark the source it belongs to.
const thumbnailSource = computed<unknown>(() => (useShadow.value ? props.parsedDeck : props.getSrcDoc));
const readySource = shallowRef<unknown>(null);
const thumbnailReady = computed(() => props.mounted && readySource.value === thumbnailSource.value);
watch(
  () => props.mounted,
  (mounted) => {
    if (!mounted) readySource.value = null;
  },
);

function handleReady(source: unknown) {
  if (source === thumbnailSource.value) readySource.value = source;
}
function handleShadowError() {
  readySource.value = null;
  shadowFailed.value = true;
}
</script>

<template>
  <button
    ref="buttonRef"
    type="button"
    :class="['deck-thumbnail-button', { active }]"
    :aria-current="active ? 'true' : undefined"
    :title="label"
    @click="emit('select', index)"
  >
    <span class="deck-thumbnail-number">{{ index + 1 }}</span>
    <span class="deck-thumbnail-frame" aria-hidden="true">
      <template v-if="mounted">
        <DeckSlideThumbnail
          v-if="useShadow && parsedDeck"
          :key="'shadow'"
          :parsed="parsedDeck"
          :index="index"
          @error="handleShadowError"
          @ready="handleReady(parsedDeck)"
        />
        <DeckIframeThumbnail
          v-else
          :key="'iframe'"
          :label="label"
          :src-doc="getSrcDoc(index)"
          :preview-viewport="previewViewport"
          @ready="handleReady(getSrcDoc)"
        />
      </template>
      <span v-if="mounted && !thumbnailReady" class="deck-thumbnail-loading" aria-hidden="true" />
    </span>
  </button>
</template>
