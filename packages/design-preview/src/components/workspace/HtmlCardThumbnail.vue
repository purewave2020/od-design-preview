<!-- Live page-card thumbnail: a scaled srcdoc iframe, prepared lazily near the viewport. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { prepareHtmlForPreview } from '../../sources/prepare';
import type { PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import { buildSrcdoc } from '../../vendor/open-design/runtime/srcdoc';
import {
  acquireThumbnailSlot,
  HTML_THUMBNAIL_INLINE_MAX_BYTES,
  kindGlyph,
  PAGE_THUMB_LAYOUT_HEIGHT,
  PAGE_THUMB_LAYOUT_WIDTH,
} from './design-files';

const props = defineProps<{ source: PreviewSource; file: ProjectFile; refreshKey: number }>();

const hostRef = ref<HTMLDivElement | null>(null);
const srcDoc = ref<string | null>(null);
const scale = ref<number | null>(null);
const near = ref(false);
const tooLarge = computed(() => props.file.size > HTML_THUMBNAIL_INLINE_MAX_BYTES);

let intersection: IntersectionObserver | null = null;
let resize: ResizeObserver | null = null;

onMounted(() => {
  const host = hostRef.value;
  if (!host) return;
  const update = () => {
    const width = host.clientWidth;
    if (width > 0) scale.value = width / PAGE_THUMB_LAYOUT_WIDTH;
  };
  update();
  if (typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(update);
    resize.observe(host);
  }
  if (typeof IntersectionObserver === 'undefined') {
    near.value = true;
    return;
  }
  intersection = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        near.value = true;
        intersection?.disconnect();
        intersection = null;
      }
    },
    { rootMargin: '0px 0px 800px 0px' },
  );
  intersection.observe(host);
});

onBeforeUnmount(() => {
  intersection?.disconnect();
  resize?.disconnect();
});

watch(
  () => [near.value, tooLarge.value, props.source, props.file.name, props.file.mtime, props.refreshKey] as const,
  ([isNear, large, source, name], _prev, onCleanup) => {
    if (!isNear || large) return;
    let cancelled = false;
    const abandon = acquireThumbnailSlot((release) => {
      void (async () => {
        try {
          const text = await source.readText(name);
          if (cancelled || text === null) return;
          const prepared = await prepareHtmlForPreview(source, name, text);
          if (!cancelled) srcDoc.value = buildSrcdoc(prepared.html, { baseHref: prepared.baseHref, freezeMotion: false });
        } catch {
          if (!cancelled) srcDoc.value = null;
        } finally {
          release();
        }
      })();
    });
    onCleanup(() => {
      cancelled = true;
      abandon();
    });
  },
  { immediate: true },
);

const frameStyle = computed(() => ({
  width: `${PAGE_THUMB_LAYOUT_WIDTH}px`,
  height: `${PAGE_THUMB_LAYOUT_HEIGHT}px`,
  ...(scale.value ? { transform: `scale(${scale.value})`, transformOrigin: '0 0' } : {}),
}));
</script>

<template>
  <div ref="hostRef" class="df-thumb-scale-host">
    <div v-if="tooLarge || srcDoc === null" class="df-preview-placeholder">{{ kindGlyph('html') }}</div>
    <iframe
      v-else
      :title="file.name"
      :srcdoc="srcDoc"
      sandbox="allow-scripts allow-downloads"
      loading="lazy"
      tabindex="-1"
      :style="frameStyle"
    />
  </div>
</template>
