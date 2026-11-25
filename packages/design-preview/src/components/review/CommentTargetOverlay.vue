<!-- Port of upstream FileViewer.tsx `CommentTargetOverlay`: the hovered / selected target outline. -->
<script setup lang="ts">
import { computed } from 'vue';
import { overlayBoundsFromSnapshot, type PreviewCommentSnapshot } from '../../vendor/open-design/comments';

const props = withDefaults(
  defineProps<{
    snapshot: PreviewCommentSnapshot;
    scale: number;
    offset?: { x: number; y: number };
    selected: boolean;
  }>(),
  { offset: () => ({ x: 0, y: 0 }) },
);

function podDisplayMembers(snapshot: PreviewCommentSnapshot): PreviewCommentSnapshot[] {
  if (snapshot.selectionKind !== 'pod' || !Array.isArray(snapshot.podMembers)) return [];
  return snapshot.podMembers.map((member) => ({
    filePath: snapshot.filePath,
    elementId: member.elementId,
    selector: member.selector,
    label: member.label,
    text: member.text,
    position: member.position,
    htmlHint: member.htmlHint,
    selectionKind: 'element' as const,
  }));
}

const members = computed(() => podDisplayMembers(props.snapshot));
const items = computed(() =>
  (members.value.length > 0 ? members.value : [props.snapshot]).map((item) => ({
    item,
    bounds: overlayBoundsFromSnapshot(item, props.scale, props.offset),
  })),
);
</script>

<template>
  <div
    v-for="{ item, bounds } in items"
    :key="item.elementId"
    :class="['comment-target-overlay', { 'comment-target-overlay--member': members.length > 0, selected }]"
    :style="{ left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` }"
    data-testid="comment-target-overlay"
  >
    <span class="comment-target-overlay-label">{{ item.elementId }}</span>
  </div>
</template>
