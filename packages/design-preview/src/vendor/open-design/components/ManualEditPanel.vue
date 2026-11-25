<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/ManualEditPanel.tsx (Apache-2.0).

  The Edit tool's floating inspector (编辑检查器): content (text / link / image /
  selected-element HTML), style parameters with token reference values, page
  styles, image upload, undo / redo / delete and the Save / Cancel / Reset row.
  Same DOM / classes as upstream; callbacks are function props as upstream.
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { ProjectDesignTokenSuggestion, ProjectDesignTokenSuggestionProp } from '../shims/registry';
import { useT } from '../shims/i18n';
import type { ManualEditHistoryEntry, ManualEditPatch, ManualEditStyles, ManualEditTarget } from '../edit-mode/types';
import { px, type StyleInput } from '../../../lib/style';
import Icon from './Icon.vue';
import ContentInspector from './manual-edit/ContentInspector.vue';
import PageInspector from './manual-edit/PageInspector.vue';
import StyleInspector from './manual-edit/StyleInspector.vue';
import { clamp, normalizeManualEditStyles, readableManualEditTargetName, type ManualEditDraft } from './manual-edit/panel-model';

const props = withDefaults(
  defineProps<{
    targets: ManualEditTarget[];
    selectedTarget: ManualEditTarget | null;
    draft: ManualEditDraft;
    history: ManualEditHistoryEntry[];
    error: string | null;
    canUndo: boolean;
    canRedo: boolean;
    busy?: boolean;
    resetAvailable?: boolean;
    pageStylesEnabled?: boolean;
    onSelectTarget: (target: ManualEditTarget) => void;
    onDraftChange: (draft: ManualEditDraft) => void;
    onStyleChange?: (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
    onInvalidStyle?: (id: string, keys: Array<keyof ManualEditStyles>) => void;
    onApplyPatch: (patch: ManualEditPatch, label: string) => void;
    onPickImage?: (file: File) => Promise<string | null>;
    tokenSuggestions?: ProjectDesignTokenSuggestion[];
    tokenSuggestionsLoading?: boolean;
    onApplyTokenSuggestion?: (prop: keyof ManualEditStyles, value: string) => void;
    onInspectValueSelect?: (prop: ProjectDesignTokenSuggestionProp, value: string) => void;
    floatingStyle?: StyleInput;
    floatingClassName?: string;
    onFloatingPositionChange?: (position: { left: number; top: number }) => void;
    /** Pinned: no dragging, and no repositioning when another element is selected. */
    locked?: boolean;
    onToggleLock?: () => void;
    onError: (message: string) => void;
    onClearSelection: () => void;
    onExit?: () => void;
    onCancelDraft: () => void;
    onSaveDraft: () => void;
    onResetDraft: () => void;
    onUndo: () => void;
    onRedo: () => void;
  }>(),
  {
    busy: false,
    resetAvailable: false,
    pageStylesEnabled: true,
    onStyleChange: undefined,
    onInvalidStyle: undefined,
    onPickImage: undefined,
    tokenSuggestions: () => [],
    tokenSuggestionsLoading: false,
    onApplyTokenSuggestion: undefined,
    onInspectValueSelect: undefined,
    floatingStyle: undefined,
    floatingClassName: undefined,
    onFloatingPositionChange: undefined,
    locked: false,
    onToggleLock: undefined,
    onExit: undefined,
  },
);

const t = useT();
const uploadingImage = ref(false);
// Pin toggle: draggable (pin pulled out) vs locked/fixed (pin pushed in).
const dragEnabled = computed(() => !props.locked);
const selectedTargetRef = shallowRef<ManualEditTarget | null>(props.selectedTarget);
const fileInputRef = ref<HTMLInputElement | null>(null);
const targetForInspector = computed(() => props.selectedTarget);
const panelTitle = computed(() =>
  targetForInspector.value ? readableManualEditTargetName(targetForInspector.value) : t('manualEdit.fallbackTitle'),
);
watch(
  () => props.selectedTarget,
  (target) => {
    selectedTargetRef.value = target;
  },
);

function changeTargetStyle(key: keyof ManualEditStyles, value: string) {
  const nextStyles = { ...props.draft.styles, [key]: value };
  props.onDraftChange({ ...props.draft, styles: nextStyles });
  const target = targetForInspector.value;
  if (!target) return;
  const normalized = normalizeManualEditStyles({ [key]: value }, { layoutEnabled: target.isLayoutContainer });
  if (!normalized.ok) {
    props.onError('error' in normalized ? normalized.error : 'Invalid style value.');
    props.onInvalidStyle?.(target.id, [key]);
    return;
  }
  props.onError('');
  props.onStyleChange?.(target.id, normalized.styles, `Style: ${target.label}`);
}

function applyTargetStyles(styles: Partial<ManualEditStyles>, label: string) {
  const target = targetForInspector.value;
  if (!target) return;
  const normalized = normalizeManualEditStyles(styles, { layoutEnabled: target.isLayoutContainer });
  if (!normalized.ok) {
    props.onError('error' in normalized ? normalized.error : 'Invalid style value.');
    props.onInvalidStyle?.(target.id, Object.keys(styles) as Array<keyof ManualEditStyles>);
    return;
  }
  props.onError('');
  props.onDraftChange({ ...props.draft, styles: { ...props.draft.styles, ...normalized.styles } });
  props.onStyleChange?.(target.id, normalized.styles, label);
}

function onPageStyleChange(styles: Partial<ManualEditStyles>) {
  const normalized = normalizeManualEditStyles(styles, { layoutEnabled: true });
  if (!normalized.ok) {
    props.onError('error' in normalized ? normalized.error : 'Invalid style value.');
    props.onInvalidStyle?.('__body__', Object.keys(styles) as Array<keyof ManualEditStyles>);
    return;
  }
  props.onError('');
  props.onStyleChange?.('__body__', normalized.styles, 'Page styles');
}

// Drag the whole floating panel from any non-interactive chrome.
const DRAG_IGNORE_SELECTOR =
  'input, textarea, select, button, a[href], label, [contenteditable], [role="button"], [role="slider"], [role="combobox"], [role="textbox"]';
function startPanelDrag(event: PointerEvent) {
  if (!props.floatingStyle) return;
  const onMove = props.onFloatingPositionChange;
  if (!onMove || !dragEnabled.value || event.button !== 0) return;
  const origin = event.target as HTMLElement | null;
  if (origin?.closest(DRAG_IGNORE_SELECTOR)) return;
  event.preventDefault();
  event.stopPropagation();
  const panel = (event.currentTarget as HTMLElement).closest('.manual-edit-right') as HTMLElement | null;
  const parent = panel?.parentElement;
  if (!panel || !parent) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = panel.offsetLeft;
  const startTop = panel.offsetTop;
  const parentRect = parent.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const pad = 8;
  const maxLeft = Math.max(pad, parentRect.width - panelRect.width - pad);
  const maxTop = Math.max(pad, parentRect.height - panelRect.height - pad);
  const ownerDocument = panel.ownerDocument;
  const prevCursor = ownerDocument.body.style.cursor;
  const prevUserSelect = ownerDocument.body.style.userSelect;
  ownerDocument.body.style.cursor = 'grabbing';
  ownerDocument.body.style.userSelect = 'none';
  const move = (moveEvent: PointerEvent) => {
    onMove({
      left: clamp(startLeft + moveEvent.clientX - startX, pad, maxLeft),
      top: clamp(startTop + moveEvent.clientY - startY, pad, maxTop),
    });
  };
  const up = () => {
    ownerDocument.body.style.cursor = prevCursor;
    ownerDocument.body.style.userSelect = prevUserSelect;
    ownerDocument.removeEventListener('pointermove', move);
    ownerDocument.removeEventListener('pointerup', up);
    ownerDocument.removeEventListener('pointercancel', up);
  };
  ownerDocument.addEventListener('pointermove', move);
  ownerDocument.addEventListener('pointerup', up);
  ownerDocument.addEventListener('pointercancel', up);
}

async function onImagePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !props.onPickImage) return;
  input.value = '';
  uploadingImage.value = true;
  try {
    const src = await props.onPickImage(file);
    if (src) {
      const activeTargetId = selectedTargetRef.value?.id ?? targetForInspector.value?.id;
      if (activeTargetId) props.onApplyPatch({ id: activeTargetId, kind: 'set-image', src, alt: props.draft.alt }, t('manualEdit.uploadImage'));
    } else {
      props.onError(t('manualEdit.uploadImageFailed'));
    }
  } finally {
    uploadingImage.value = false;
  }
}

function deleteElement() {
  const target = targetForInspector.value;
  if (target) props.onApplyPatch({ id: target.id, kind: 'remove-element' }, t('manualEdit.deleteElement'));
}
</script>

<template>
  <aside
    :class="['manual-edit-right', { 'manual-edit-floating': Boolean(floatingStyle) }, floatingClassName]"
    :style="floatingStyle ? px(floatingStyle) : undefined"
  >
    <section :class="['manual-edit-modal', 'cc-panel', { 'is-drag-locked': Boolean(floatingStyle) && !dragEnabled }]" @pointerdown="startPanelDrag">
      <div class="manual-edit-titlebar">
        <button
          v-if="floatingStyle"
          type="button"
          :class="['manual-edit-drag-handle', dragEnabled ? 'is-draggable' : 'is-locked']"
          :aria-pressed="dragEnabled"
          :aria-label="t('manualEdit.movePanel')"
          :title="t('manualEdit.movePanel')"
          @click="onToggleLock?.()"
        >
          <svg v-if="dragEnabled" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              d="M13.8273 1.69L22.3126 10.1753L20.8984 11.5895L20.1913 10.8824L15.9486 15.125L15.2415 18.6606L13.8273 20.0748L9.58466 15.8321L4.63492 20.7819L3.2207 19.3677L8.17045 14.4179L3.92781 10.1753L5.34202 8.76107L8.87756 8.05396L13.1202 3.81132L12.4131 3.10422L13.8273 1.69ZM14.5344 5.22554L9.86358 9.89637L7.0417 10.4607L13.5418 16.9609L14.1062 14.139L18.7771 9.46818L14.5344 5.22554Z"
            />
          </svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18 3V5H17V11L19 14V16H13V23H11V16H5V14L7 11V5H6V3H18Z" />
          </svg>
        </button>
        <span :title="panelTitle">{{ panelTitle }}</span>
        <button
          v-if="onExit"
          type="button"
          class="manual-edit-titlebar-close"
          :aria-label="t('manualEdit.closePanel')"
          :title="t('manualEdit.closePanel')"
          @click="onExit()"
        >
          <Icon name="close" :size="14" />
        </button>
      </div>
      <div class="manual-edit-scroll">
        <template v-if="targetForInspector">
          <ContentInspector :target="targetForInspector" :draft="draft" @draft-change="onDraftChange" />
          <StyleInspector
            :target="targetForInspector"
            :styles="draft.styles"
            :on-change="changeTargetStyle"
            :on-apply="(styles) => applyTargetStyles(styles, `Style: ${targetForInspector!.label}`)"
            :token-suggestions="tokenSuggestions"
            :token-suggestions-loading="tokenSuggestionsLoading"
            :on-apply-token-suggestion="onApplyTokenSuggestion"
            :on-inspect-value-select="onInspectValueSelect"
          />
        </template>
        <PageInspector v-else :enabled="pageStylesEnabled" @style-change="onPageStyleChange" />

        <div v-if="targetForInspector?.kind === 'image' && onPickImage" class="cc-section">
          <header class="cc-section-head">{{ t('manualEdit.sectionImage') }}</header>
          <div class="cc-section-body">
            <button type="button" class="cc-action-btn" :disabled="uploadingImage" @click="fileInputRef?.click()">
              {{ uploadingImage ? t('manualEdit.uploadingImage') : t('manualEdit.uploadImage') }}
            </button>
            <input ref="fileInputRef" type="file" accept="image/*" style="display: none" @change="onImagePicked" />
          </div>
        </div>
      </div>

      <div class="manual-edit-footer">
        <div class="manual-edit-footer-actions">
          <div class="manual-edit-footer-left">
            <button
              type="button"
              class="manual-edit-history-btn"
              :aria-label="t('manualEdit.undo')"
              :title="t('manualEdit.undo')"
              :disabled="busy || !canUndo"
              @click="onUndo()"
            >
              <Icon name="undo" :size="15" />
            </button>
            <button
              type="button"
              class="manual-edit-history-btn"
              :aria-label="t('manualEdit.redo')"
              :title="t('manualEdit.redo')"
              :disabled="busy || !canRedo"
              @click="onRedo()"
            >
              <Icon name="redo" :size="15" />
            </button>
            <button
              v-if="targetForInspector"
              type="button"
              class="manual-edit-delete-btn"
              :aria-label="t('manualEdit.deleteElement')"
              :title="t('manualEdit.deleteElement')"
              :disabled="busy"
              @click="deleteElement"
            >
              <Icon name="trash" :size="15" />
            </button>
          </div>
          <div class="manual-edit-footer-right">
            <button v-if="resetAvailable" type="button" class="manual-edit-footer-btn subtle" :disabled="busy" @click="onResetDraft()">
              {{ t('ds.reset') }}
            </button>
            <button type="button" class="manual-edit-footer-btn subtle" :disabled="busy" @click="onCancelDraft()">
              {{ t('common.cancel') }}
            </button>
            <button type="button" class="manual-edit-footer-btn primary" :disabled="busy" @click="onSaveDraft()">
              {{ t('common.save') }}
            </button>
          </div>
        </div>

        <div v-if="error" class="manual-edit-error">{{ error }}</div>
      </div>
    </section>
  </aside>
</template>
