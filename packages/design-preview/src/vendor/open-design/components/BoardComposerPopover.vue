<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/BoardComposerPopover.tsx (Apache-2.0).

  The comment composer bubble (评论气泡): element style summary, pod members,
  queued notes, attached images, the note textarea and the action row. Same
  DOM / classes / test ids as upstream. Callbacks are function props (as
  upstream) so optional actions can be detected by presence; Vue listeners
  (`@save-comment="…"`) bind to them too.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import type { PreviewCommentSnapshot } from '../comments';
import type { Dict } from '../shims/i18n-types';
import type { PreviewComment } from '../shims/types';
import { isImeComposing } from '../utils/imeComposing';
import Button from '../ui-components/Button.vue';
import Textarea from '../ui-components/Textarea.vue';
import { px } from '../../../lib/style';
import Icon from './Icon.vue';
import AnnotationStyleSummary from './AnnotationStyleSummary.vue';
import {
  clampPopoverPositionStyle,
  numericStyleValue,
  popoverAnchorStyle,
  popoverSizeForPositioning,
  summarizeMember,
  type PopoverBounds,
  type PopoverOffset,
  type PopoverPosition,
  type PopoverSize,
} from './board-composer';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

const props = withDefaults(
  defineProps<{
    target: PreviewCommentSnapshot;
    existing: PreviewComment | null;
    draft: string;
    notes: string[];
    onDraft: (value: string) => void;
    onAddDraft: () => void;
    onRemoveQueuedNote: (index: number) => void;
    onClose: () => void;
    onSaveComment: () => void | Promise<void>;
    onSendBatch: () => void | Promise<void>;
    onRemoveMember: (elementId: string) => void;
    onHoverMember?: (elementId: string | null) => void;
    onDeleteComment?: (commentId: string) => void | Promise<boolean | void>;
    /** Opens the all-comments side panel without closing this popover. */
    onViewAllComments?: (returnFocusTarget?: HTMLElement | null) => void;
    /** Object-URL thumbnails for images the user attached to this comment. */
    images?: { file: File; url: string }[];
    /** Already-saved attachment thumbnails (read-only) for a re-opened comment. */
    existingImages?: { url: string; name: string }[];
    onAttachImages?: (files: File[]) => void;
    onRemoveImage?: (index: number) => void;
    onPreviewImage?: (index: number) => void;
    sending: boolean;
    queueOnSend?: boolean;
    sendDisabled?: boolean;
    sendDisabledReason?: string;
    /** Team-collab permission gates for an existing comment's actions. */
    canEditComment?: boolean;
    canDeleteComment?: boolean;
    canSendToAgent?: boolean;
    allowSendToChat?: boolean;
    t: TranslateFn;
    scale?: number;
    bounds?: PopoverBounds;
    offset?: PopoverOffset;
    docked?: boolean;
    commenting?: boolean;
    /** A pick was held back to protect unsent work; the next pick discards it. */
    discardPending?: boolean;
  }>(),
  {
    onHoverMember: undefined,
    onDeleteComment: undefined,
    onViewAllComments: undefined,
    images: () => [],
    existingImages: () => [],
    onAttachImages: undefined,
    onRemoveImage: undefined,
    onPreviewImage: undefined,
    queueOnSend: false,
    sendDisabled: false,
    sendDisabledReason: undefined,
    canEditComment: true,
    canDeleteComment: true,
    canSendToAgent: true,
    allowSendToChat: true,
    scale: 1,
    bounds: undefined,
    offset: undefined,
    docked: false,
    commenting: true,
    discardPending: false,
  },
);

const pendingCount = computed(() => props.notes.length + (props.draft.trim() ? 1 : 0));
const podMembers = computed(() => props.target.podMembers ?? []);
let composing = false;
const setComposing = (value: boolean) => {
  composing = value;
};
const imageInputRef = ref<HTMLInputElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const textareaRef = ref<InstanceType<typeof Textarea> | null>(null);
const popoverSize = shallowRef<PopoverSize | undefined>(undefined);
const manualPosition = shallowRef<PopoverPosition | null>(null);
const dragging = ref(false);

const targetPlacementKey = computed(() =>
  [
    props.target.filePath,
    props.target.elementId,
    props.target.selector,
    props.target.selectionKind,
    props.target.position.x,
    props.target.position.y,
    props.target.position.width,
    props.target.position.height,
    props.target.hoverPoint?.x,
    props.target.hoverPoint?.y,
    props.bounds?.width,
    props.bounds?.height,
    props.bounds?.scrollLeft,
    props.bounds?.scrollTop,
    props.offset?.x,
    props.offset?.y,
  ].join('\0'),
);
watch([targetPlacementKey, () => props.docked], () => {
  manualPosition.value = null;
});

// Measure the card (keyed on `commenting`, which mounts / unmounts the compose
// section); content-driven size changes come from the ResizeObserver.
watch(
  [popoverRef, () => props.commenting],
  ([node], _prev, onCleanup) => {
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const next = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      if (next.width <= 0 || next.height <= 0) return;
      const current = popoverSize.value;
      if (current?.width === next.width && current.height === next.height) return;
      popoverSize.value = next;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    onCleanup(() => observer.disconnect());
  },
  { immediate: true, flush: 'post' },
);

onMounted(() => {
  if (props.canEditComment) void nextTick(() => textareaRef.value?.focus());
});

const measuredPopover = computed(() => popoverSizeForPositioning(props.commenting, popoverSize.value));
const popoverStyle = computed(() => {
  if (props.docked) return undefined;
  if (manualPosition.value) {
    return clampPopoverPositionStyle(manualPosition.value.left, manualPosition.value.top, props.bounds, measuredPopover.value);
  }
  return popoverAnchorStyle(props.target, props.scale, props.bounds, props.offset, props.commenting, popoverSize.value);
});

function startPopoverDrag(event: PointerEvent) {
  if (props.docked) return;
  event.preventDefault();
  event.stopPropagation();
  const node = popoverRef.value;
  if (!node) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const style = popoverStyle.value ?? {};
  const startLeft = manualPosition.value?.left ?? numericStyleValue(style, 'left') ?? node.offsetLeft;
  const startTop = manualPosition.value?.top ?? numericStyleValue(style, 'top') ?? node.offsetTop;
  const ownerDocument = node.ownerDocument;
  const handle = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  const previousUserSelect = ownerDocument.body.style.userSelect;
  ownerDocument.body.style.userSelect = 'none';
  handle.setPointerCapture?.(pointerId);
  dragging.value = true;
  const move = (moveEvent: PointerEvent) => {
    const clamped = clampPopoverPositionStyle(
      startLeft + moveEvent.clientX - startX,
      startTop + moveEvent.clientY - startY,
      props.bounds,
      measuredPopover.value,
    );
    manualPosition.value = {
      left: numericStyleValue(clamped, 'left') ?? startLeft,
      top: numericStyleValue(clamped, 'top') ?? startTop,
    };
  };
  const up = () => {
    ownerDocument.body.style.userSelect = previousUserSelect;
    handle.releasePointerCapture?.(pointerId);
    dragging.value = false;
    ownerDocument.removeEventListener('pointermove', move);
    ownerDocument.removeEventListener('pointerup', up);
    ownerDocument.removeEventListener('pointercancel', up);
  };
  ownerDocument.addEventListener('pointermove', move);
  ownerDocument.addEventListener('pointerup', up);
  ownerDocument.addEventListener('pointercancel', up);
}

const trimmedDraft = computed(() => props.draft.trim());
const existingNote = computed(() => props.existing?.note.trim() ?? '');
const hasFreshImage = computed(() => props.images.length > 0);
// An attached image alone is enough to send.
const hasAnyImage = computed(() => hasFreshImage.value || props.existingImages.length > 0);
const sendBlocked = computed(() => (pendingCount.value === 0 && !hasAnyImage.value) || props.sending || props.sendDisabled);
const isPodSelection = computed(() => props.target.selectionKind === 'pod');
const hasSaveContent = computed(() => Boolean(trimmedDraft.value) || hasAnyImage.value);
const existingChanged = computed(() => (props.existing ? trimmedDraft.value !== existingNote.value || hasFreshImage.value : true));
const saveDisabled = computed(() => !hasSaveContent.value || !existingChanged.value || props.sending);
const primaryLabel = computed(() =>
  props.sending ? props.t('chat.comments.sending') : props.queueOnSend ? props.t('chat.annotationQueue') : props.t('chat.comments.sendToChat'),
);

function pickImages(list: FileList | null) {
  const imgs = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
  if (imgs.length > 0) props.onAttachImages?.(imgs);
}
function onImageInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  pickImages(input.files);
  input.value = '';
}
function onComposerPaste(e: ClipboardEvent) {
  const files = e.clipboardData?.files;
  if (!files || files.length === 0) return;
  const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (imgs.length === 0) return;
  e.preventDefault();
  props.onAttachImages?.(imgs);
}
function onTextareaKeyDown(event: KeyboardEvent) {
  if (isImeComposing(event, composing)) return;
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    // Enter triggers the primary CTA: comment (save) for element selections,
    // send-to-chat for pod selections, with the same permission gates.
    if (isPodSelection.value) {
      if (props.canSendToAgent && !sendBlocked.value) void props.onSendBatch();
    } else if (props.canEditComment && !saveDisabled.value) {
      void props.onSaveComment();
    }
  }
}
function onRootKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    props.onClose();
  }
}
function onMemberPointer(event: PointerEvent, elementId: string | null) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  props.onHoverMember?.(elementId);
}
</script>

<template>
  <div
    ref="popoverRef"
    :class="['comment-popover', 'comment-popover-composer', { 'comment-popover-docked': docked, 'comment-popover-dragging': dragging }]"
    data-testid="comment-popover"
    role="dialog"
    aria-modal="false"
    aria-label="Annotation"
    :style="popoverStyle ? px(popoverStyle) : undefined"
    @keydown="onRootKeyDown"
  >
    <div v-if="!docked" class="comment-popover-titlebar">
      <button
        type="button"
        class="comment-popover-drag-handle"
        aria-label="Move comment box"
        title="Move comment box"
        @pointerdown="startPopoverDrag"
      >
        <span aria-hidden="true" />
      </button>
      <span class="comment-popover-title" :title="target.label || target.elementId">{{ target.label || target.elementId }}</span>
      <button
        v-if="onViewAllComments"
        type="button"
        class="comment-popover-view-all"
        data-testid="comment-popover-view-all"
        @click="onViewAllComments($event.currentTarget as HTMLElement)"
      >
        {{ t('chat.comments.viewAll') }}
        <Icon name="chevron-right" :size="12" />
      </button>
    </div>
    <!-- Everything above the action row scrolls; the action row lives outside
         this box so a height-clamped card can never push the buttons away. -->
    <div class="comment-popover-body">
      <section class="comment-popover-section comment-popover-section-params">
        <AnnotationStyleSummary :target="target" test-id="comment-popover-style-summary" />
      </section>
      <div v-if="podMembers.length > 0" class="board-pod-summary">
        <strong>{{ t('chat.comments.capturedItems', { n: target.memberCount || podMembers.length }) }}</strong>
        <div class="board-pod-members">
          <span
            v-for="member in podMembers"
            :key="member.elementId"
            class="board-pod-chip"
            @pointerenter="onMemberPointer($event, member.elementId)"
            @pointerleave="onMemberPointer($event, null)"
          >
            {{ summarizeMember(member) }}
            <button
              type="button"
              class="board-pod-chip-remove"
              :aria-label="t('chat.comments.remove')"
              :title="t('chat.comments.remove')"
              @click="onRemoveMember(member.elementId)"
              @focus="onHoverMember?.(member.elementId)"
              @blur="onHoverMember?.(null)"
            >
              <Icon name="close" :size="14" />
            </button>
          </span>
        </div>
      </div>
      <section v-if="commenting" class="comment-popover-section comment-popover-section-compose">
        <div v-if="notes.length > 0" class="board-note-list">
          <div v-for="(note, index) in notes" :key="`${index}-${note}`" class="board-note-item">
            <span>{{ note }}</span>
            <Button variant="ghost" @click="onRemoveQueuedNote(index)">{{ t('chat.comments.remove') }}</Button>
          </div>
        </div>
        <div v-if="existingImages.length > 0 || images.length > 0" class="comment-popover-images">
          <div v-for="item in existingImages" :key="item.url" class="comment-popover-image">
            <a
              class="comment-popover-image-thumb"
              data-testid="comment-popover-existing-image"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="item.name"
            >
              <img :src="item.url" alt="" aria-hidden="true" />
            </a>
          </div>
          <div v-for="(item, index) in images" :key="item.url" class="comment-popover-image">
            <button
              type="button"
              class="comment-popover-image-thumb"
              :title="item.file.name"
              :aria-label="item.file.name"
              @click="onPreviewImage?.(index)"
            >
              <img :src="item.url" alt="" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="comment-popover-image-remove"
              :aria-label="t('chat.annotationAttachedRemove')"
              :title="t('chat.annotationAttachedRemove')"
              @click="onRemoveImage?.(index)"
            >
              <Icon name="close" :size="14" />
            </button>
          </div>
        </div>
        <Textarea
          ref="textareaRef"
          data-testid="comment-popover-input"
          :class="!canEditComment ? 'composer-note--readonly' : undefined"
          :model-value="draft"
          :readonly="!canEditComment"
          :aria-label="t('chat.comments.placeholder')"
          :placeholder="t('chat.comments.placeholder')"
          @update:model-value="onDraft($event)"
          @paste="onComposerPaste"
          @compositionstart="setComposing(true)"
          @compositionend="setComposing(false)"
          @keydown="onTextareaKeyDown"
        />
        <p v-if="!canEditComment && existing?.authorKind === 'user'" class="comment-popover-readonly-note">
          {{ t('comment.sharePageCommentReadOnly') }}
        </p>
        <p v-if="discardPending" class="comment-popover-readonly-note" role="status">{{ t('comment.unsentDiscardNotice') }}</p>
      </section>
    </div>
    <div v-if="commenting" class="comment-popover-actions">
      <div class="comment-popover-actions-start">
        <template v-if="onAttachImages && canEditComment">
          <input ref="imageInputRef" type="file" accept="image/*" multiple style="display: none" @change="onImageInputChange" />
          <button
            type="button"
            class="comment-popover-close"
            :title="t('chat.annotationAttachImage')"
            :aria-label="t('chat.annotationAttachImage')"
            @click="imageInputRef?.click()"
          >
            <Icon name="attach" :size="14" />
          </button>
        </template>
        <button
          v-if="existing && onDeleteComment && canDeleteComment"
          type="button"
          class="comment-popover-close comment-popover-delete"
          :title="t('common.delete')"
          :aria-label="t('common.delete')"
          @click="void onDeleteComment(existing.id)"
        >
          <Icon name="trash" :size="14" />
        </button>
        <button v-else type="button" class="comment-popover-close" :title="t('common.close')" :aria-label="t('common.close')" @click="onClose()">
          <Icon name="close" :size="14" />
        </button>
      </div>
      <div class="comment-popover-actions-end">
        <template v-if="isPodSelection">
          <!-- Pod: add-note is secondary, send-to-chat is the primary CTA. -->
          <Button v-if="canEditComment" variant="ghost" data-testid="comment-popover-add-note" :disabled="!draft.trim()" @click="onAddDraft()">
            {{ t('chat.comments.addNote') }}
          </Button>
          <Button
            v-if="canSendToAgent && allowSendToChat"
            variant="primary"
            data-testid="comment-add-send"
            :disabled="sendBlocked"
            :title="sendDisabled ? sendDisabledReason : undefined"
            @click="void onSendBatch()"
          >
            {{ primaryLabel }}
          </Button>
        </template>
        <template v-else>
          <!-- Element: comment (save) is the primary CTA (also Enter). -->
          <Button
            v-if="canSendToAgent && allowSendToChat"
            variant="ghost"
            data-testid="comment-add-send"
            :disabled="sendBlocked"
            :title="sendDisabled ? sendDisabledReason : undefined"
            @click="void onSendBatch()"
          >
            {{ primaryLabel }}
          </Button>
          <Button v-if="canEditComment" variant="primary" data-testid="comment-popover-save" :disabled="saveDisabled" @click="void onSaveComment()">
            {{ t('chat.comments.comment') }}
          </Button>
        </template>
      </div>
    </div>
  </div>
</template>
