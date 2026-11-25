<!--
  The comments panel ("评论"). Rewritten from upstream FileViewer.tsx
  `CommentSidePanel` + `CommentSideDock` with the same DOM and class names,
  minus team collaboration (authors, sync banner). The batch "Send to chat"
  becomes "Resolve" and "Copy for agent" — the latter copies exactly the
  context block Open Design would attach to an agent message.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { uniqueId } from '../../lib/util';
import type { TranslateFn } from '../../locales';
import type { CommentsLoadState } from '../../review/comments';
import {
  commentAuthorAvatarColor,
  commentCreatedAt,
  commentDisplayLabel,
  formatAbsoluteDateTime,
  formatCommentTime,
  reorderPreviewCommentIds,
  type CommentSideDropEdge,
} from '../../review/comment-utils';
import type { PreviewComment, PreviewCommentAttachment } from '../../vendor/open-design/contracts/api/comments';
import Icon from '../../vendor/open-design/components/Icon.vue';
import RemixIcon from '../../vendor/open-design/components/RemixIcon.vue';
import Button from '../../vendor/open-design/ui-components/Button.vue';
import CommentBadgeFace from './CommentBadgeFace.vue';
import CommentListBody from './CommentListBody.vue';

const DRAG_MIME = 'application/x-open-design-preview-comment';

interface DragState {
  draggingId: string;
  overId: string | null;
  edge: CommentSideDropEdge | null;
}

const props = defineProps<{
  /** Open comments for the file, in display order (newest first by sortKey). */
  comments: PreviewComment[];
  /** Resolved comments for the file, shown on demand. */
  resolvedComments: PreviewComment[];
  /** Pin number per comment id (shared with the canvas pins). */
  pinNumbers: Map<string, number>;
  loadState: CommentsLoadState;
  selectedIds: Set<string>;
  activeCommentId: string | null;
  collapsed: boolean;
  attachmentUrl: (attachment: PreviewCommentAttachment) => string;
  deckSlideCount?: number;
  sending: boolean;
  onCreateComment: (note: string) => Promise<boolean>;
  t: TranslateFn;
}>();
const emit = defineEmits<{
  retry: [];
  collapsedChange: [collapsed: boolean];
  dismiss: [];
  toggleSelect: [commentId: string];
  selectAll: [];
  clearSelection: [];
  reorder: [orderedIds: string[], draggedId: string];
  reply: [comment: PreviewComment];
  resolveSelected: [];
  reopen: [comment: PreviewComment];
  copySelected: [];
}>();

const newCommentDraft = ref('');
const dragState = shallowRef<DragState | null>(null);
const showResolved = ref(false);
const clock = ref(Date.now());
const showAge = computed(() => !props.collapsed && props.comments.length + props.resolvedComments.length > 0);
let clockTimer: number | null = null;
watch(
  showAge,
  (on, _prev, onCleanup) => {
    if (!on) return;
    clock.value = Date.now();
    clockTimer = window.setInterval(() => {
      clock.value = Date.now();
    }, 60_000);
    onCleanup(() => {
      if (clockTimer !== null) window.clearInterval(clockTimer);
      clockTimer = null;
    });
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (clockTimer !== null) window.clearInterval(clockTimer);
});

const visibleSelectedIds = computed(() => new Set(props.comments.filter((c) => props.selectedIds.has(c.id)).map((c) => c.id)));
const selectedCount = computed(() => visibleSelectedIds.value.size);
const allSelected = computed(() => props.comments.length > 0 && selectedCount.value === props.comments.length);
const commentsLabel = computed(() => props.t('chat.tabComments'));
const canCreate = computed(() => newCommentDraft.value.trim().length > 0 && !props.sending);
const canReorder = computed(() => props.comments.length > 1);
const collapsedRailRef = ref<HTMLButtonElement | null>(null);
const expandedToggleRef = ref<HTMLButtonElement | null>(null);
let pendingFocus: 'collapsed' | 'expanded' | null = null;
const panelId = uniqueId('odp-comment-panel');

watch(
  () => props.collapsed,
  async () => {
    await nextTick();
    const target = pendingFocus === 'collapsed' ? collapsedRailRef.value : pendingFocus === 'expanded' ? expandedToggleRef.value : null;
    if (!target) return;
    pendingFocus = null;
    target.focus();
  },
);

function toggleCollapsed(next: boolean, focus: 'collapsed' | 'expanded') {
  pendingFocus = focus;
  emit('collapsedChange', next);
}

async function submitNewComment() {
  const note = newCommentDraft.value.trim();
  if (!note) return;
  if (await props.onCreateComment(note)) newCommentDraft.value = '';
}

function dropEdgeForEvent(event: DragEvent): CommentSideDropEdge {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function handleDragStart(event: DragEvent, comment: PreviewComment) {
  if (!canReorder.value || !event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(DRAG_MIME, comment.id);
  event.dataTransfer.setData('text/plain', comment.id);
  dragState.value = { draggingId: comment.id, overId: comment.id, edge: null };
}
function handleDragOver(event: DragEvent, targetId: string) {
  if (!canReorder.value) return;
  const current = dragState.value;
  const draggingId = current?.draggingId || event.dataTransfer?.getData(DRAG_MIME);
  if (!draggingId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (draggingId === targetId) {
    if (current?.overId !== targetId || current.edge !== null) dragState.value = { draggingId, overId: targetId, edge: null };
    return;
  }
  const edge = dropEdgeForEvent(event);
  if (current?.draggingId !== draggingId || current.overId !== targetId || current.edge !== edge) {
    dragState.value = { draggingId, overId: targetId, edge };
  }
}
function handleDrop(event: DragEvent, targetId: string) {
  if (!canReorder.value) return;
  event.preventDefault();
  const current = dragState.value;
  const draggingId = current?.draggingId || event.dataTransfer?.getData(DRAG_MIME) || event.dataTransfer?.getData('text/plain');
  if (!draggingId || draggingId === targetId) {
    dragState.value = null;
    return;
  }
  const edge = current?.overId === targetId && current.edge ? current.edge : dropEdgeForEvent(event);
  const nextIds = reorderPreviewCommentIds(props.comments, draggingId, targetId, edge);
  if (nextIds.join('\0') !== props.comments.map((comment) => comment.id).join('\0')) emit('reorder', nextIds, draggingId);
  dragState.value = null;
}
function onListDragLeave(event: DragEvent) {
  const related = event.relatedTarget;
  if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) return;
  dragState.value = null;
}

interface ItemView {
  comment: PreviewComment;
  resolved: boolean;
  selected: boolean;
  active: boolean;
  number: number;
  avatar: { bg: string; fg: string };
  className: string;
  authorName: string | undefined;
}

function itemView(comment: PreviewComment, index: number, resolved: boolean): ItemView {
  const selected = !resolved && visibleSelectedIds.value.has(comment.id);
  const active = comment.id === props.activeCommentId;
  const drag = dragState.value;
  const isDragging = drag?.draggingId === comment.id;
  const dropClass = drag?.overId === comment.id && drag.draggingId !== comment.id && drag.edge ? ` comment-side-item-drop-${drag.edge}` : '';
  return {
    comment,
    resolved,
    selected,
    active,
    number: props.pinNumbers.get(comment.id) ?? index + 1,
    avatar: commentAuthorAvatarColor(comment.authorKey ?? ''),
    className: `comment-side-item${selected ? ' selected' : ''}${active ? ' active' : ''}${isDragging ? ' dragging' : ''}${dropClass}${resolved ? ' odp-comment-resolved' : ''}`,
    authorName: comment.authorDisplayName?.trim(),
  };
}

const items = computed(() => [
  ...(props.comments.length === 0 && props.loadState === 'success' ? [] : props.comments.map((c, i) => itemView(c, i, false))),
  ...(showResolved.value ? props.resolvedComments.map((c, i) => itemView(c, i, true)) : []),
]);

function onItemKeyDown(event: KeyboardEvent, view: ItemView) {
  if (view.resolved || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  emit('reply', view.comment);
}
function onPanelKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  emit('dismiss');
}
function onNewKeyDown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    void submitNewComment();
  }
}
</script>

<template>
  <div v-if="collapsed" class="comment-side-dock collapsed" data-testid="comment-side-dock">
    <button
      ref="collapsedRailRef"
      type="button"
      class="comment-side-rail"
      data-testid="comment-side-collapsed-rail"
      :aria-label="t('preview.showSidebar', { label: commentsLabel })"
      :aria-expanded="false"
      :title="t('preview.showSidebar', { label: commentsLabel })"
      @click="toggleCollapsed(false, 'expanded')"
    >
      <RemixIcon name="message-3-line" :size="15" />
      <span>{{ commentsLabel }}</span>
      <strong v-if="comments.length > 0">{{ comments.length }}</strong>
    </button>
  </div>
  <div v-else class="comment-side-dock" data-testid="comment-side-dock">
    <aside :id="panelId" class="comment-side-panel" data-testid="comment-side-panel" :aria-label="commentsLabel" @keydown="onPanelKeyDown">
      <div class="comment-side-header">
        <div class="comment-side-title">
          <RemixIcon name="message-3-line" :size="15" />
          <span>{{ commentsLabel }}</span>
        </div>
        <div class="comment-side-header-actions">
          <button
            ref="expandedToggleRef"
            type="button"
            class="comment-side-collapse"
            :aria-label="t('preview.hideSidebar', { label: commentsLabel })"
            :aria-controls="panelId"
            aria-expanded="true"
            :title="t('preview.hideSidebar', { label: commentsLabel })"
            @click="toggleCollapsed(true, 'collapsed')"
          >
            <Icon name="chevron-right" :size="14" />
          </button>
        </div>
      </div>
      <div v-if="comments.length > 0 || resolvedComments.length > 0" class="comment-side-toolbar">
        <button v-if="comments.length > 0" type="button" class="comment-side-select-all" :disabled="allSelected" @click="emit('selectAll')">
          {{ t('chat.comments.selectAll') }}
        </button>
        <button
          v-if="resolvedComments.length > 0"
          type="button"
          class="comment-side-select-all odp-comment-resolved-toggle"
          :aria-pressed="showResolved"
          data-testid="comment-show-resolved"
          @click="showResolved = !showResolved"
        >
          {{ t(showResolved ? 'app.commentsHideResolved' : 'app.commentsShowResolved', { n: resolvedComments.length }) }}
        </button>
      </div>
      <div class="comment-side-list" @dragleave="onListDragLeave">
        <div v-if="loadState === 'loading'" role="status">{{ t('common.loading') }}</div>
        <div v-if="loadState === 'error'" role="alert">
          {{ t('chat.comments.loadFailed') }}
          <Button variant="ghost" @click="emit('retry')">{{ t('preview.retry') }}</Button>
        </div>
        <div v-if="comments.length === 0 && loadState === 'success'" class="comment-side-empty">{{ t('chat.comments.emptySaved') }}</div>
        <div
          v-for="view in items"
          :key="`${view.resolved ? 'r' : 'o'}:${view.comment.id}`"
          :class="view.className"
          data-testid="comment-side-item"
          :data-comment-id="view.comment.id"
          :data-comment-status="view.comment.status"
          :aria-current="view.active ? 'true' : undefined"
          role="button"
          tabindex="0"
          @dragover="view.resolved ? undefined : handleDragOver($event, view.comment.id)"
          @drop="view.resolved ? undefined : handleDrop($event, view.comment.id)"
          @click="view.resolved ? undefined : emit('reply', view.comment)"
          @keydown="onItemKeyDown($event, view)"
        >
          <div class="comment-side-item-head">
            <button
              v-if="!view.resolved"
              type="button"
              class="comment-side-drag-handle"
              :title="t('chat.queuedReorder')"
              :aria-label="t('chat.queuedReorder')"
              :draggable="canReorder"
              :disabled="!canReorder"
              @click.stop
              @dragstart="handleDragStart($event, view.comment)"
              @dragend="dragState = null"
            >
              <Icon name="grip-vertical" :size="13" />
            </button>
            <span class="comment-side-author" :data-author-kind="view.comment.authorKind ?? 'member'">
              <span class="comment-side-avatar" :style="{ background: view.avatar.bg, color: view.avatar.fg }" aria-hidden="true">
                <CommentBadgeFace :comment="view.comment" :number="view.number" />
              </span>
              <span class="comment-side-author-copy">
                <strong>{{ `${view.number}. ${commentDisplayLabel(view.comment, t)}` }}</strong>
                <small v-if="view.authorName">{{ view.authorName }}</small>
              </span>
            </span>
            <span v-if="typeof view.comment.slideIndex === 'number' && deckSlideCount && deckSlideCount > 0" class="comment-side-slide">
              {{ t('fileViewer.speakerNotesSlide', { current: view.comment.slideIndex + 1, total: deckSlideCount }) }}
            </span>
            <span class="comment-side-time" :title="formatAbsoluteDateTime(commentCreatedAt(view.comment) || undefined)">
              {{ formatCommentTime(commentCreatedAt(view.comment), clock, t) }}
            </span>
            <button
              v-if="view.resolved"
              type="button"
              class="odp-comment-reopen"
              data-testid="comment-reopen"
              @click.stop="emit('reopen', view.comment)"
            >
              {{ t('app.commentsReopen') }}
            </button>
            <button
              v-else
              type="button"
              :class="['comment-side-check', { checked: view.selected }]"
              :aria-label="view.selected ? t('chat.comments.deselect') : t('chat.comments.select')"
              :aria-pressed="view.selected"
              data-testid="comment-side-check"
              @click.stop="emit('toggleSelect', view.comment.id)"
            >
              <Icon v-if="view.selected" name="check" :size="11" />
            </button>
          </div>
          <CommentListBody :key="view.comment.note" :note="view.comment.note" :t="t" />
          <div v-if="view.comment.attachments && view.comment.attachments.length > 0" class="comment-side-attachments">
            <a
              v-for="attachment in view.comment.attachments"
              :key="attachment.path"
              class="comment-side-attachment"
              data-testid="comment-side-attachment"
              :href="attachmentUrl(attachment) || undefined"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="attachment.name"
              :title="attachment.name"
              @click.stop
            >
              <img v-if="attachmentUrl(attachment)" :src="attachmentUrl(attachment)" :alt="attachment.name" />
            </a>
          </div>
        </div>
      </div>
      <div v-if="selectedCount > 0" class="comment-side-selectbar" data-testid="comment-side-selectbar">
        <span class="comment-side-selectcount">{{ t('chat.comments.nSelected', { n: selectedCount }) }}</span>
        <Button variant="ghost" @click="emit('clearSelection')">{{ t('chat.comments.clear') }}</Button>
        <Button variant="ghost" data-testid="comment-side-resolve" :disabled="sending" @click="emit('resolveSelected')">
          {{ t('app.commentsResolve') }}
        </Button>
        <Button variant="primary" data-testid="comment-side-copy" :disabled="sending" @click="emit('copySelected')">
          {{ t('app.commentsCopyForAgent') }}
        </Button>
      </div>
      <div v-if="$slots.composer" class="comment-side-composer"><slot name="composer" /></div>
      <form class="comment-side-new-comment composer" @submit.prevent="submitNewComment">
        <div class="composer-shell comment-side-new-comment-shell">
          <div class="composer-input-wrap">
            <div class="composer-textarea-layer">
              <textarea
                v-model="newCommentDraft"
                :placeholder="t('chat.comments.placeholder')"
                :aria-label="t('chat.comments.placeholder')"
                data-testid="comment-side-new-input"
                @keydown="onNewKeyDown"
              />
            </div>
          </div>
          <div class="composer-row comment-side-new-comment-actions">
            <span class="composer-spacer" />
            <button type="submit" :class="['composer-send', { 'is-sending': sending }]" :disabled="!canCreate" data-testid="comment-side-new-submit">
              <Icon name="send" :size="13" />
              <span>{{ sending ? t('chat.comments.sending') : t('app.commentsPost') }}</span>
            </button>
          </div>
        </div>
      </form>
    </aside>
  </div>
</template>
