<!--
  Canvas overlays for comments: saved pins over their elements, the hover /
  selected target outline, and the pin of the comment being written. Ported
  from upstream FileViewer.tsx `CommentPreviewOverlays` + `CommentTargetOverlay`
  (same classes), without the team drift ladder.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { TranslateFn } from '../../locales';
import { commentAuthorAvatarColor } from '../../review/comment-utils';
import {
  commentTargetDisplayName,
  commentVisibleOnDeckSlide,
  liveSnapshotForComment,
  overlayBoundsFromSnapshot,
  type PreviewCommentSnapshot,
} from '../../vendor/open-design/comments';
import { commentUsesIdentity, resolveOwnerCommentAnchor } from '../../vendor/open-design/comments/owner-anchor';
import type { PreviewComment } from '../../vendor/open-design/contracts/api/comments';
import CommentBadgeFace from './CommentBadgeFace.vue';
import CommentTargetOverlay from './CommentTargetOverlay.vue';

const props = defineProps<{
  /** Open comments of this file, in creation order. */
  comments: PreviewComment[];
  pinNumbers: Map<string, number>;
  provisionalPinNumber: number;
  liveTargets: Map<string, PreviewCommentSnapshot>;
  hoveredTarget: PreviewCommentSnapshot | null;
  activeTarget: PreviewCommentSnapshot | null;
  activeExistingCommentId: string | null;
  showActivePin: boolean;
  scale: number;
  activeSlideIndex: number | null;
  t: TranslateFn;
}>();
const emit = defineEmits<{ openComment: [comment: PreviewComment, snapshot: PreviewCommentSnapshot] }>();

const offset = { x: 0, y: 0 };

const visible = computed(() =>
  props.comments
    .map((comment) => {
      // New comment identities need a unique current target; legacy element
      // ids fall back to the live snapshot map (or a free pin).
      const resolution = commentUsesIdentity(comment) ? resolveOwnerCommentAnchor(comment, props.liveTargets) : null;
      const snapshot = resolution ? (resolution.state === 'lost' ? null : resolution.snapshot) : liveSnapshotForComment(comment, props.liveTargets);
      return { comment, snapshot };
    })
    .filter((item): item is { comment: PreviewComment; snapshot: PreviewCommentSnapshot } => Boolean(item.snapshot))
    .filter(({ comment }) => commentVisibleOnDeckSlide(comment, props.activeSlideIndex)),
);

const markers = computed(() =>
  visible.value.map(({ comment, snapshot }) => {
    const number = props.pinNumbers.get(comment.id) ?? 0;
    const bounds = overlayBoundsFromSnapshot(snapshot, props.scale, offset);
    const color = commentAuthorAvatarColor(comment.authorKey ?? '');
    const label = commentTargetDisplayName(comment);
    return { comment, snapshot, number, bounds, color, label, tooltip: `${number}. ${label}: ${comment.note}` };
  }),
);

const activeSaved = computed(() =>
  props.activeExistingCommentId ? props.comments.find((comment) => comment.id === props.activeExistingCommentId) : undefined,
);
const activeColor = computed(() => (activeSaved.value ? commentAuthorAvatarColor(activeSaved.value.authorKey ?? '') : undefined));
const activeNumber = computed(() =>
  activeSaved.value ? props.pinNumbers.get(activeSaved.value.id) ?? props.provisionalPinNumber : props.provisionalPinNumber,
);
const targetOverlay = computed(() => props.activeTarget ?? props.hoveredTarget);
const activePinStyle = computed(() => {
  const target = props.activeTarget;
  if (!target) return {};
  const safeScale = Number.isFinite(props.scale) && props.scale > 0 ? props.scale : 1;
  const anchor = target.hoverPoint ?? { x: target.position.x, y: target.position.y };
  return {
    left: `${Math.round(offset.x + anchor.x * safeScale)}px`,
    top: `${Math.round(offset.y + anchor.y * safeScale)}px`,
    ...(activeColor.value ? { background: activeColor.value.bg, color: activeColor.value.fg } : {}),
  };
});
</script>

<template>
  <div class="comment-overlay-layer" aria-hidden="false">
    <div
      v-for="marker in markers"
      :key="marker.comment.id"
      class="comment-saved-marker"
      :style="{ left: `${marker.bounds.left}px`, top: `${marker.bounds.top}px`, width: `${marker.bounds.width}px`, height: `${marker.bounds.height}px` }"
      :data-testid="`comment-saved-marker-${marker.comment.elementId}`"
      :data-pin-number="marker.number"
      @click="emit('openComment', marker.comment, marker.snapshot)"
    >
      <div class="comment-saved-outline" />
      <button
        type="button"
        class="comment-saved-pin"
        :style="{ background: marker.color.bg, color: marker.color.fg }"
        :title="marker.tooltip"
        :aria-label="`${t('chat.tabComments')} ${marker.number}: ${marker.label}`"
        @click.stop="emit('openComment', marker.comment, marker.snapshot)"
      >
        <CommentBadgeFace :comment="marker.comment" :number="marker.number" />
      </button>
    </div>
    <CommentTargetOverlay v-if="targetOverlay" :snapshot="targetOverlay" :scale="scale" :offset="offset" :selected="Boolean(activeTarget)" />
    <div
      v-if="showActivePin && activeTarget"
      class="comment-active-pin"
      :style="activePinStyle"
      data-testid="comment-active-pin"
      :data-pin-number="activeNumber"
      aria-hidden="true"
    >
      <CommentBadgeFace v-if="activeSaved" :comment="activeSaved" :number="activeNumber" />
      <template v-else>{{ activeNumber }}</template>
    </div>
  </div>
</template>
