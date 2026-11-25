<!-- Ported to Vue from nexu-io/open-design apps/web/src/components/DeckThumbnailRail.tsx `DeckIframeThumbnail` (Apache-2.0). -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { DeckThumbnailViewport } from './deck-thumbnails';

const props = defineProps<{
  label: string;
  srcDoc: string;
  previewViewport?: DeckThumbnailViewport | null;
}>();
const emit = defineEmits<{ ready: [] }>();

const hostRef = ref<HTMLDivElement | null>(null);
const frameRef = ref<HTMLIFrameElement | null>(null);

watch(
  () => [hostRef.value, frameRef.value, props.previewViewport?.width, props.previewViewport?.height] as const,
  ([host, frame], _prev, onCleanup) => {
    if (!host || !frame) return;
    const apply = () => {
      const hostWidth = host.clientWidth;
      const hostHeight = host.clientHeight;
      if (!hostWidth || !hostHeight) return;
      const viewport = props.previewViewport;
      const hasPreviewViewport =
        !!viewport && Number.isFinite(viewport.width) && viewport.width > 0 && Number.isFinite(viewport.height) && viewport.height > 0;
      const viewportWidth = hasPreviewViewport ? viewport!.width : hostWidth * 2;
      const viewportHeight = hasPreviewViewport ? viewport!.height : hostHeight * 2;
      const scale = Math.min(hostWidth / viewportWidth, hostHeight / viewportHeight);
      frame.style.width = `${viewportWidth}px`;
      frame.style.height = `${viewportHeight}px`;
      frame.style.transform = `scale(${scale})`;
      frame.style.left = `${(hostWidth - viewportWidth * scale) / 2}px`;
      frame.style.top = `${(hostHeight - viewportHeight * scale) / 2}px`;
    };
    apply();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    observer?.observe(host);
    onCleanup(() => observer?.disconnect());
  },
  { immediate: true, flush: 'post' },
);
</script>

<template>
  <div ref="hostRef" class="deck-thumbnail-iframe-host">
    <iframe ref="frameRef" :title="label" sandbox="allow-scripts allow-downloads" :srcdoc="srcDoc" tabindex="-1" @load="emit('ready')" />
  </div>
</template>
