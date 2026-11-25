<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/BoardComposerPopover.tsx
  `AnnotationHoverPopover` (Apache-2.0).

  The card floats over the preview iframe at the cursor. Moving onto it pulls
  the pointer off the iframe; the host pins the card while it is hovered
  (mouseenter / mouseleave) so it does not flicker and stays selectable.
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { PreviewCommentSnapshot } from '../comments';
import { px } from '../../../lib/style';
import AnnotationStyleSummary from './AnnotationStyleSummary.vue';
import { annotationHoverAnchorStyle, type PopoverBounds, type PopoverOffset, type PopoverSize } from './board-composer';

const props = defineProps<{
  target: PreviewCommentSnapshot;
  scale: number;
  /** Preview viewport rect, so the card clamps inside the visible canvas. */
  bounds?: PopoverBounds;
  offset?: PopoverOffset;
}>();
defineEmits<{ mouseenter: [event: MouseEvent]; mouseleave: [event: MouseEvent] }>();

const cardRef = ref<HTMLDivElement | null>(null);
const cardSize = shallowRef<PopoverSize | undefined>(undefined);

watch(
  cardRef,
  (node, _prev, onCleanup) => {
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const next = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      if (next.width <= 0 || next.height <= 0) return;
      const current = cardSize.value;
      if (current?.width === next.width && current.height === next.height) return;
      cardSize.value = next;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    onCleanup(() => observer.disconnect());
  },
  { flush: 'post', immediate: true },
);

const style = computed(() => px(annotationHoverAnchorStyle(props.target, props.scale, props.bounds, props.offset, cardSize.value)));
</script>

<template>
  <div
    ref="cardRef"
    class="comment-popover annotation-hover-popover"
    data-testid="annotation-hover-popover"
    role="tooltip"
    :style="style"
    @mouseenter="$emit('mouseenter', $event)"
    @mouseleave="$emit('mouseleave', $event)"
  >
    <AnnotationStyleSummary :target="target" test-id="annotation-hover-style-summary" />
  </div>
</template>
