<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/DeckThumbnailRail.tsx (Apache-2.0).

  Virtualized deck thumbnail rail (film strip):
  - srcdoc strings are built lazily, once per slide, and cached until
    `buildThumbSrcDoc` identity changes (the deck source changed);
  - only thumbnails near the rail viewport hold a live renderer; once seen a
    slide stays mounted inside the recently-visible LRU window (cap bounds
    100-slide decks); the active slide is always mounted;
  - thumbnail documents are built by the host with `freezeMotion`.
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useT } from '../shims/i18n';
import type { ParsedDeckThumbnails } from '../runtime/deck-thumbnail-parser';
import DeckThumbnailItem from './DeckThumbnailItem.vue';
import { nextMountedThumbnails, type DeckThumbnailViewport } from './deck-thumbnails';

const props = withDefaults(
  defineProps<{
    /** Number of slides to list. */
    count: number;
    /** Active slide index (highlighted + always mounted). */
    activeIndex: number;
    /** Display total for the per-slide accessibility label. */
    labelTotal: number;
    /** Build the per-slide thumbnail document (iframe fallback); identity = cache key. */
    buildThumbSrcDoc: (index: number) => string;
    /** Parsed deck for shadow-root thumbnails; null → iframe fallback. */
    parsedDeck?: ParsedDeckThumbnails | null;
    /** Live preview iframe viewport, so responsive fallbacks wrap identically. */
    previewViewport?: DeckThumbnailViewport | null;
  }>(),
  { parsedDeck: null, previewViewport: null },
);
const emit = defineEmits<{ select: [index: number] }>();

const t = useT();
const listRef = ref<HTMLDivElement | null>(null);
const visible = shallowRef<ReadonlySet<number>>(new Set());
const mountedOrder = shallowRef<readonly number[]>([]);

function onVisibilityChange(index: number, inView: boolean) {
  const prev = visible.value;
  if (prev.has(index) === inView) return;
  const next = new Set(prev);
  if (inView) next.add(index);
  else next.delete(index);
  visible.value = next;
}

watch(
  [visible, () => props.activeIndex, () => props.count],
  () => {
    mountedOrder.value = nextMountedThumbnails(mountedOrder.value, visible.value, props.activeIndex, props.count);
  },
  { immediate: true },
);

// One srcdoc per slide per deck source, shared across LRU mount churn.
const getSrcDoc = computed(() => {
  const build = props.buildThumbSrcDoc;
  const cache = new Map<number, string>();
  return (index: number) => {
    let doc = cache.get(index);
    if (doc === undefined) {
      doc = build(index);
      cache.set(index, doc);
    }
    return doc;
  };
});

const mounted = computed(() => new Set(mountedOrder.value));
</script>

<template>
  <aside class="deck-thumbnail-rail" aria-label="Slides">
    <div ref="listRef" class="deck-thumbnail-list">
      <DeckThumbnailItem
        v-for="index in count"
        :key="index - 1"
        :index="index - 1"
        :active="index - 1 === activeIndex"
        :mounted="mounted.has(index - 1)"
        :label="t('fileViewer.speakerNotesSlide', { current: index, total: labelTotal })"
        :list-el="listRef"
        :parsed-deck="parsedDeck"
        :preview-viewport="previewViewport"
        :get-src-doc="getSrcDoc"
        @select="emit('select', $event)"
        @visibility="onVisibilityChange"
      />
    </div>
  </aside>
</template>
