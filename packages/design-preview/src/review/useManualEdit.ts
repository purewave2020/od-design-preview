// The Edit tool ("编辑") host side. Ported from the manual-edit half of
// upstream apps/web/src/components/FileViewer.tsx `HtmlViewer`: the sandboxed
// preview runs the vendored edit bridge (edit-mode/bridge.ts, injected by
// buildSrcdoc with `editBridge: true`), which reports editable targets, hover,
// selection, inline text commits and drag-to-move; this composable turns those
// into patches on the file's source (vendored edit-mode/source-patches.ts),
// writes them back through the PreviewSource, keeps undo / redo history and
// drives the vendored ManualEditPanel inspector.
//
// Text and style edits are already live in the frame (the bridge applied
// them), so saving them must not reload the preview; every other patch
// (attributes, HTML, delete, full source, undo / redo) re-renders it.
import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue';
import type { TranslateFn } from '../locales';
import { px, type StyleInput } from '../lib/style';
import { emptyManualEditDraft, type ManualEditDraft } from '../vendor/open-design/components/manual-edit/panel-model';
import {
  applyManualEditPatch,
  isManualEditFullHtmlDocument,
  readManualEditAttributes,
  readManualEditFields,
  readManualEditOuterHtml,
  readManualEditStyles,
} from '../vendor/open-design/edit-mode/source-patches';
import {
  MANUAL_EDIT_STYLE_PROPS,
  type ManualEditBridgeMessage,
  type ManualEditHistoryEntry,
  type ManualEditPatch,
  type ManualEditStyles,
  type ManualEditTarget,
} from '../vendor/open-design/edit-mode/types';

type CanvasSize = { width: number; height: number } | null;

interface PendingStyleSave {
  id: string;
  styles: Partial<ManualEditStyles>;
  label: string;
  version: number;
}

// --- style helpers (FileViewer.tsx) -------------------------------------------

function normalizeInspectorColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgba = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!rgba) return trimmed;
  if (rgba[4] !== undefined && Number(rgba[4]) === 0) return '';
  const toHex = (raw: string) => Math.max(0, Math.min(255, Math.round(Number(raw)))).toString(16).padStart(2, '0');
  return `#${toHex(rgba[1]!)}${toHex(rgba[2]!)}${toHex(rgba[3]!)}`;
}

function inspectorStyleValue(key: keyof ManualEditStyles, value: string): string {
  if (!value) return '';
  if (key === 'color' || key === 'backgroundColor' || key === 'borderColor') return normalizeInspectorColor(value);
  return value;
}

function mergeInspectorStyles(sourceStyles: ManualEditStyles, previewStyles: ManualEditStyles): ManualEditStyles {
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    const value = sourceStyles[key]?.trim() || previewStyles[key]?.trim() || '';
    acc[key] = inspectorStyleValue(key, value);
    return acc;
  }, {} as ManualEditStyles);
}

function floatingPanelStyle(target: ManualEditTarget, scale: number, canvas: CanvasSize): StyleInput {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const panelWidth = 320;
  const pad = 12;
  const canvasWidth = canvas?.width ?? 1200;
  const canvasHeight = canvas?.height ?? 800;
  const panelHeight = Math.min(380, Math.max(260, canvasHeight - pad * 2));
  const targetLeft = target.rect.x * s;
  const targetTop = target.rect.y * s;
  const targetRight = (target.rect.x + target.rect.width) * s;
  let left = targetRight + pad;
  if (left + panelWidth > canvasWidth - pad) left = Math.max(pad, targetLeft - panelWidth - pad);
  const top = Math.max(pad, Math.min(targetTop, Math.max(pad, canvasHeight - panelHeight - pad)));
  return { left, top, width: panelWidth, maxHeight: panelHeight };
}

function hoverIconStyle(target: ManualEditTarget, scale: number, canvas: CanvasSize): StyleInput {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const iconSize = 26;
  const inset = 4;
  const canvasWidth = canvas?.width ?? 1200;
  const canvasHeight = canvas?.height ?? 800;
  const targetTop = target.rect.y * s;
  const targetRight = (target.rect.x + target.rect.width) * s;
  return {
    left: Math.max(inset, Math.min(targetRight - iconSize - inset, canvasWidth - iconSize - inset)),
    top: Math.max(inset, Math.min(targetTop + inset, canvasHeight - iconSize - inset)),
    width: iconSize,
    height: iconSize,
  };
}

function cancelPendingStyleKeys(pending: PendingStyleSave | null, id: string, keys: Array<keyof ManualEditStyles>): PendingStyleSave | null {
  if (!pending || pending.id !== id || keys.length === 0) return pending;
  const next = { ...pending.styles };
  for (const key of keys) delete next[key];
  return Object.keys(next).length === 0 ? null : { ...pending, styles: next };
}

// -----------------------------------------------------------------------------

export interface UseManualEditOptions {
  /** Edit mode is on for this viewer. */
  enabled: () => boolean;
  /** The viewer is the visible tab. */
  active: () => boolean;
  iframeRef: Ref<HTMLIFrameElement | null>;
  fileName: () => string;
  /** Current source text (what the preview was built from). */
  source: () => string | null;
  /** Re-read the file from its source, bypassing caches. */
  readFresh: () => Promise<string | null>;
  /** Persist new source bytes. Throws on failure. */
  writeSource: (text: string) => Promise<void>;
  /** Save an image the user picked; resolves to a src relative to the HTML file. */
  saveImage: (file: File) => Promise<string>;
  /**
   * New source adopted. `live` — the frame already shows it (text / style),
   * so the preview must not re-render; otherwise rebuild the preview.
   */
  onSourceChange: (text: string, live: boolean) => void;
  scale: () => number;
  canvasSize: () => CanvasSize;
  t: TranslateFn;
}

export function useManualEdit(options: UseManualEditOptions) {
  const { iframeRef, t } = options;
  const targets = shallowRef<ManualEditTarget[]>([]);
  const selected = shallowRef<ManualEditTarget | null>(null);
  const hover = shallowRef<ManualEditTarget | null>(null);
  const draft = shallowRef<ManualEditDraft>(emptyManualEditDraft(''));
  const draftDirty = ref(false);
  const history = shallowRef<ManualEditHistoryEntry[]>([]);
  const undone = shallowRef<ManualEditHistoryEntry[]>([]);
  const error = ref<string | null>(null);
  const saving = ref(false);
  const pageStylesOpen = ref(false);
  const panelPosition = shallowRef<{ left: number; top: number } | null>(null);
  const locked = ref(false);

  let sourceText: string | null = options.source();
  watch(options.source, (value) => {
    sourceText = value;
  });
  let selectedId: string | null = null;
  let selectionDraft: { id: string; draft: ManualEditDraft } | null = null;
  let pendingStyle: PendingStyleSave | null = null;
  const liveStyles = new Map<string, { styles: Partial<ManualEditStyles>; version: number }>();
  let previewVersion = 0;
  let savingNow = false;
  let textSession: string | null = null;
  let textCommit: Promise<boolean> | null = null;
  const textFailed = new Set<string>();
  let textFinish: ((sessionId: string) => void) | null = null;

  const post = (message: Record<string, unknown>) => {
    const win = iframeRef.value?.contentWindow;
    if (!win) return false;
    win.postMessage(message, '*');
    return true;
  };
  const nextVersion = () => {
    previewVersion += 1;
    return previewVersion;
  };
  const previewStyle = (id: string, styles: Partial<ManualEditStyles>, version: number) => post({ type: 'od-edit-preview-style', id, styles, version });
  const postSelected = (id: string | null) => post({ type: 'od-edit-selected-target', id });

  const inspectorStyles = (target: ManualEditTarget, base: string) => mergeInspectorStyles(readManualEditStyles(base, target.id), target.styles);

  const draftForTarget = (target: ManualEditTarget, base: string): ManualEditDraft => {
    const fields = readManualEditFields(base, target.id);
    return {
      text: fields.text ?? target.fields.text ?? target.text,
      href: fields.href ?? target.fields.href ?? '',
      src: fields.src ?? target.fields.src ?? '',
      alt: fields.alt ?? target.fields.alt ?? '',
      styles: inspectorStyles(target, base),
      attributesText: JSON.stringify(readManualEditAttributes(base, target.id), null, 2),
      outerHtml: readManualEditOuterHtml(base, target.id) || target.outerHtml,
      fullSource: base,
    };
  };

  // --- persistence ------------------------------------------------------------

  const adopt = (text: string, live: boolean) => {
    sourceText = text;
    options.onSourceChange(text, live);
  };

  /** The file changed outside Edit: adopt it and drop history (no overwrite). */
  const confirmSource = async (expected: string, message: string): Promise<boolean> => {
    const persisted = await options.readFresh();
    if (persisted == null || persisted === expected) return true;
    adopt(persisted, false);
    history.value = [];
    undone.value = [];
    pendingStyle = null;
    draft.value = { ...draft.value, fullSource: persisted };
    error.value = message;
    return false;
  };

  const applyManualEdit = async (patch: ManualEditPatch, label: string): Promise<boolean> => {
    if (savingNow || sourceText == null) return false;
    savingNow = true;
    saving.value = true;
    error.value = null;
    try {
      const base = sourceText;
      const result = applyManualEditPatch(base, patch);
      if (!result.ok) {
        error.value = result.error ?? 'Could not apply edit.';
        return false;
      }
      if (!(await confirmSource(base, t('app.editExternalChange')))) return false;
      try {
        await options.writeSource(result.source);
      } catch (err) {
        error.value = t('app.editSaveFailed', { message: err instanceof Error ? err.message : String(err) });
        return false;
      }
      const entry: ManualEditHistoryEntry = {
        id: `${Date.now()}-${history.value.length}`,
        label,
        patch,
        beforeSource: base,
        afterSource: result.source,
        createdAt: Date.now(),
      };
      // Text and style edits already show in the frame. A text change typed in
      // the inspector is pushed to the live DOM (`od-edit-preview-text`).
      let live = patch.kind === 'set-style';
      if (patch.kind === 'set-text') {
        const savedText = readManualEditFields(result.source, patch.id).text;
        live = savedText !== undefined && post({ type: 'od-edit-preview-text', id: patch.id, value: savedText });
      }
      adopt(result.source, live);
      history.value = [entry, ...history.value];
      undone.value = [];
      draft.value = { ...draft.value, fullSource: result.source };
      const current = selected.value;
      if (patch.kind === 'set-text') {
        if (current?.id === patch.id) selected.value = { ...current, text: patch.value, fields: { ...current.fields, text: patch.value } };
        draft.value = { ...draft.value, text: patch.value };
      } else if (patch.kind === 'set-link') {
        if (current?.id === patch.id) selected.value = { ...current, text: patch.text, fields: { ...current.fields, text: patch.text, href: patch.href } };
        draft.value = { ...draft.value, text: patch.text, href: patch.href };
      } else if (patch.kind === 'set-image') {
        if (current?.id === patch.id) selected.value = { ...current, fields: { ...current.fields, src: patch.src, alt: patch.alt } };
        draft.value = { ...draft.value, src: patch.src, alt: patch.alt };
      } else if (patch.kind === 'remove-element') {
        if (pendingStyle?.id === patch.id) pendingStyle = null;
        selectedId = null;
        selectionDraft = null;
        selected.value = null;
        targets.value = targets.value.filter((target) => target.id !== patch.id);
        draft.value = emptyManualEditDraft(result.source);
        draftDirty.value = false;
        postSelected(null);
      }
      if (patch.kind !== 'remove-element' && patch.kind !== 'set-token' && patch.kind !== 'set-full-source' && selectedId === patch.id) {
        draftDirty.value = true;
      }
      if (patch.kind === 'set-style' && patch.id !== '__body__' && !readManualEditOuterHtml(result.source, patch.id)) {
        // The target vanished from the saved source: refresh the preview.
        selected.value = null;
        adopt(result.source, false);
      }
      return true;
    } finally {
      savingNow = false;
      saving.value = false;
    }
  };

  const replayHistory = async (direction: 'undo' | 'redo') => {
    const stack = direction === 'undo' ? history.value : undone.value;
    const [latest, ...rest] = stack;
    if (!latest || savingNow) return;
    savingNow = true;
    saving.value = true;
    try {
      const expected = direction === 'undo' ? latest.afterSource : latest.beforeSource;
      const next = direction === 'undo' ? latest.beforeSource : latest.afterSource;
      if (!(await confirmSource(expected, t('app.editHistoryCleared')))) return;
      try {
        await options.writeSource(next);
      } catch (err) {
        error.value = t('app.editSaveFailed', { message: err instanceof Error ? err.message : String(err) });
        return;
      }
      liveStyles.clear();
      adopt(next, false);
      if (direction === 'undo') {
        history.value = rest;
        undone.value = [latest, ...undone.value];
      } else {
        undone.value = rest;
        history.value = [latest, ...history.value];
      }
      draft.value = { ...draft.value, fullSource: next };
      if (selectedId) {
        const target = selected.value;
        if (target) draft.value = draftForTarget(target, next);
      }
    } finally {
      savingNow = false;
      saving.value = false;
    }
  };

  // --- pending style pipeline (live preview, saved on Save / exit) -------------

  const handleStyleChange = (id: string, styles: Partial<ManualEditStyles>, label: string) => {
    const version = nextVersion();
    const current = pendingStyle;
    pendingStyle = { id, styles: current?.id === id ? { ...current.styles, ...styles } : styles, label, version };
    const previous = liveStyles.get(id);
    liveStyles.set(id, { styles: { ...previous?.styles, ...styles }, version });
    error.value = null;
    previewStyle(id, styles, version);
  };

  const flushStyleSave = async (): Promise<boolean> => {
    const pending = pendingStyle;
    if (!pending) return true;
    if (savingNow) return false;
    const ok = await applyManualEdit({ id: pending.id, kind: 'set-style', styles: pending.styles }, pending.label);
    if (ok && pendingStyle === pending) pendingStyle = null;
    return ok;
  };

  const cancelStyleDraft = () => {
    const pending = pendingStyle;
    if (!pending) return;
    pendingStyle = null;
    const base = sourceText ?? '';
    const current = selected.value;
    const target =
      pending.id === '__body__' ? null : current?.id === pending.id ? current : targets.value.find((item) => item.id === pending.id) ?? null;
    const sourceStyles = target ? inspectorStyles(target, base) : readManualEditStyles(base, pending.id);
    const reset = MANUAL_EDIT_STYLE_PROPS.reduce<Partial<ManualEditStyles>>((acc, key) => {
      acc[key] = sourceStyles[key] ?? '';
      return acc;
    }, {});
    liveStyles.delete(pending.id);
    previewStyle(pending.id, reset, nextVersion());
    if (!target || target.id === selected.value?.id) {
      draft.value = { ...draft.value, styles: target ? sourceStyles : draft.value.styles, fullSource: base };
    }
    error.value = null;
  };

  // --- inline text sessions ---------------------------------------------------

  /** End the frame's inline text edit and wait for its commit. */
  const finishTextSession = (commit: boolean): Promise<boolean> => {
    const sessionId = textSession;
    if (!sessionId) return Promise.resolve(true);
    if (!post({ type: 'od-edit-text-finish', commit })) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        textFinish = null;
        void (async () => {
          const pending = textCommit;
          const ok = pending ? await pending.catch(() => false) : true;
          if (textSession === sessionId) textSession = null;
          resolve(ok && textFailed.size === 0);
        })();
      };
      textFinish = settle;
      const timer = window.setTimeout(settle, 1500);
    });
  };

  const settlePendingCommit = async (commitActive = true): Promise<boolean> => {
    if (textSession) return finishTextSession(commitActive);
    const pending = textCommit;
    if (pending) await pending.catch(() => false);
    return textFailed.size === 0;
  };

  // --- selection ---------------------------------------------------------------

  const selectTarget = (target: ManualEditTarget) => {
    pageStylesOpen.value = false;
    if (pendingStyle?.id !== target.id) cancelStyleDraft();
    const nextDraft = draftForTarget(target, sourceText ?? '');
    selectedId = target.id;
    selectionDraft = { id: target.id, draft: nextDraft };
    selected.value = target;
    draft.value = nextDraft;
    draftDirty.value = false;
    error.value = null;
  };

  const clearSelection = async () => {
    if (!(await settlePendingCommit())) return;
    cancelStyleDraft();
    selectedId = null;
    selectionDraft = null;
    textSession = null;
    selected.value = null;
    panelPosition.value = null;
    draft.value = emptyManualEditDraft(sourceText ?? '');
    draftDirty.value = false;
    error.value = null;
  };

  const contentPatchForDraft = (target: ManualEditTarget, current: ManualEditDraft, base: string): { patch: ManualEditPatch; label: string } | null => {
    const fields = readManualEditFields(base, target.id);
    if (target.kind === 'text' || target.kind === 'token') {
      const text = fields.text ?? target.fields.text ?? target.text;
      return current.text !== text ? { patch: { id: target.id, kind: 'set-text', value: current.text }, label: t('manualEdit.applyContent') } : null;
    }
    if (target.kind === 'link') {
      const text = fields.text ?? target.fields.text ?? target.text;
      const href = fields.href ?? target.fields.href ?? '';
      return current.text !== text || current.href !== href
        ? { patch: { id: target.id, kind: 'set-link', text: current.text, href: current.href }, label: t('manualEdit.applyContent') }
        : null;
    }
    if (target.kind === 'image') {
      const src = fields.src ?? target.fields.src ?? '';
      const alt = fields.alt ?? target.fields.alt ?? '';
      return current.src !== src || current.alt !== alt
        ? { patch: { id: target.id, kind: 'set-image', src: current.src, alt: current.alt }, label: t('manualEdit.applyContent') }
        : null;
    }
    const outer = readManualEditOuterHtml(base, target.id) || target.outerHtml;
    return current.outerHtml !== outer ? { patch: { id: target.id, kind: 'set-outer-html', html: current.outerHtml }, label: t('manualEdit.applyHtml') } : null;
  };

  const saveDraft = async () => {
    const target = selected.value;
    const contentBefore = target ? contentPatchForDraft(target, draft.value, sourceText ?? '') : null;
    if (!(await settlePendingCommit(!contentBefore))) return;
    if (target) {
      const contentPatch = contentPatchForDraft(target, draft.value, sourceText ?? '');
      if (contentPatch && !(await applyManualEdit(contentPatch.patch, contentPatch.label))) return;
    }
    if (!(await flushStyleSave())) return;
    if (selected.value) void clearSelection();
    else pageStylesOpen.value = false;
  };

  const resetDraft = async () => {
    if (textSession) await finishTextSession(false);
    cancelStyleDraft();
    const current = selected.value;
    if (!current) {
      draft.value = emptyManualEditDraft(sourceText ?? '');
      error.value = null;
      return;
    }
    const snapshot = selectionDraft?.id === current.id ? selectionDraft.draft : draftForTarget(current, sourceText ?? '');
    const base = sourceText ?? '';
    const currentOuter = readManualEditOuterHtml(base, current.id);
    if (snapshot.outerHtml && currentOuter && snapshot.outerHtml !== currentOuter) {
      if (!(await applyManualEdit({ id: current.id, kind: 'set-outer-html', html: snapshot.outerHtml }, 'Reset element'))) return;
    }
    const refreshed = sourceText ?? base;
    draft.value = { ...snapshot, fullSource: refreshed, styles: inspectorStyles(current, refreshed) };
    draftDirty.value = false;
    error.value = null;
    postSelected(current.id);
  };

  const cancelDraft = async () => {
    if (textSession) await finishTextSession(false);
    if (selected.value) void clearSelection();
    else {
      cancelStyleDraft();
      pageStylesOpen.value = false;
    }
  };

  const dismissPanel = async () => {
    if (!(await settlePendingCommit())) return;
    if (!(await flushStyleSave())) return;
    if (selected.value) void clearSelection();
    else pageStylesOpen.value = false;
  };

  /** Flush pending edits; resolves false when a save failed (stay in Edit). */
  const exit = async (): Promise<boolean> => {
    if (!(await settlePendingCommit())) return false;
    if (textFailed.size > 0) return false;
    if (!(await flushStyleSave())) return false;
    panelPosition.value = null;
    return true;
  };

  // --- reset on leaving Edit ----------------------------------------------------

  watch(
    options.enabled,
    (enabled) => {
      if (enabled) return;
      targets.value = [];
      selected.value = null;
      hover.value = null;
      pageStylesOpen.value = false;
      panelPosition.value = null;
      draftDirty.value = false;
      error.value = null;
      selectedId = null;
      selectionDraft = null;
      textSession = null;
      textCommit = null;
      textFailed.clear();
      pendingStyle = null;
      liveStyles.clear();
    },
    { immediate: true },
  );

  // History belongs to one file revision chain; a different file starts clean.
  watch(options.fileName, () => {
    history.value = [];
    undone.value = [];
  });

  // --- bridge mode ----------------------------------------------------------------

  /** Replay bridge state after the frame (re)loads. */
  const syncFrame = () => {
    const enabled = options.enabled();
    post({ type: 'od-edit-mode', enabled: enabled && options.active() });
    post({ type: 'od-edit-selected-target', id: enabled ? selectedId : null });
    if (enabled) {
      for (const [id, preview] of liveStyles) post({ type: 'od-edit-preview-style', id, styles: preview.styles, version: preview.version });
    }
  };

  watch([options.enabled, options.active, () => selected.value?.id], syncFrame, { immediate: true, flush: 'post' });

  // --- frame → host -----------------------------------------------------------------

  const onMessage = (ev: MessageEvent) => {
    if (!options.enabled()) return;
    if (ev.source !== iframeRef.value?.contentWindow) return;
    const data = ev.data as ManualEditBridgeMessage | null;
    if (!data?.type) return;
    if (!options.active() && data.type !== 'od-edit-text-commit' && data.type !== 'od-edit-text-session') return;
    switch (data.type) {
      case 'od-edit-targets': {
        if (!Array.isArray(data.targets)) return;
        targets.value = data.targets;
        const current = selected.value;
        if (current) selected.value = data.targets.find((target) => target.id === current.id) ?? current;
        if (selectedId) {
          const id = selectedId;
          window.setTimeout(() => postSelected(id), 0);
        }
        return;
      }
      case 'od-edit-select':
        hover.value = null;
        selectTarget(data.target);
        return;
      case 'od-edit-hover':
        if (textSession) return;
        hover.value = data.target.id === selectedId ? null : data.target;
        return;
      case 'od-edit-background':
        hover.value = null;
        if (typeof sourceText === 'string' && isManualEditFullHtmlDocument(sourceText)) {
          void clearSelection();
          pageStylesOpen.value = true;
        }
        return;
      case 'od-edit-text-commit': {
        const sessionId = String(data.id);
        const commit = applyManualEdit({ id: sessionId, kind: 'set-text', value: String(data.value) }, t('manualEdit.text'));
        textCommit = commit;
        void commit
          .then((ok) => {
            if (ok) textFailed.delete(sessionId);
            else textFailed.add(sessionId);
          })
          .catch(() => textFailed.add(sessionId))
          .finally(() => {
            if (textCommit === commit) textCommit = null;
          });
        return;
      }
      case 'od-edit-text-session': {
        const sessionId = String(data.id || '');
        if (data.active) {
          textSession = sessionId;
          return;
        }
        if (textSession === sessionId) textSession = null;
        textFinish?.(sessionId);
        return;
      }
      case 'od-edit-drag-commit': {
        const id = String(data.id || '');
        if (!id) return;
        const dragStyles: Partial<ManualEditStyles> = { transform: String(data.transform || '') };
        if (typeof data.display === 'string' && data.display) dragStyles.display = data.display;
        handleStyleChange(id, dragStyles, t('app.editMoveElement'));
        if (selectedId === id) {
          draft.value = { ...draft.value, styles: { ...draft.value.styles, ...dragStyles } };
          draftDirty.value = true;
        }
        return;
      }
      default:
    }
  };
  window.addEventListener('message', onMessage);
  onBeforeUnmount(() => window.removeEventListener('message', onMessage));

  const clearHover = () => {
    hover.value = null;
    post({ type: 'od-edit-hover-reset' });
  };

  // --- view state -------------------------------------------------------------------

  const pageStylesEnabled = computed(() => {
    const text = options.source();
    return typeof text === 'string' && isManualEditFullHtmlDocument(text);
  });
  const pageCardActive = computed(() => options.enabled() && !selected.value && pageStylesOpen.value);
  const panelActive = computed(() => options.enabled() && (Boolean(selected.value) || pageCardActive.value));

  const panelProps = computed(() => {
    const current = selected.value;
    return {
      targets: targets.value,
      selectedTarget: current,
      draft: draft.value,
      history: history.value,
      error: error.value,
      canUndo: history.value.length > 0,
      canRedo: undone.value.length > 0,
      busy: saving.value,
      resetAvailable: current ? draftDirty.value : false,
      pageStylesEnabled: pageStylesEnabled.value,
      onSelectTarget: selectTarget,
      onDraftChange: (next: ManualEditDraft) => {
        draft.value = next;
        draftDirty.value = Boolean(selected.value);
      },
      onStyleChange: handleStyleChange,
      onInvalidStyle: (id: string, keys: Array<keyof ManualEditStyles>) => {
        pendingStyle = cancelPendingStyleKeys(pendingStyle, id, keys);
      },
      onApplyPatch: (patch: ManualEditPatch, label: string) => {
        void applyManualEdit(patch, label);
      },
      onError: (message: string) => {
        error.value = message;
      },
      onClearSelection: () => void clearSelection(),
      onExit: () => void dismissPanel(),
      onCancelDraft: () => void cancelDraft(),
      onSaveDraft: () => void saveDraft(),
      onResetDraft: () => void resetDraft(),
      onUndo: () => void replayHistory('undo'),
      onRedo: () => void replayHistory('redo'),
      floatingClassName: pageCardActive.value ? 'manual-edit-page-card' : undefined,
      floatingStyle: current
        ? { ...floatingPanelStyle(current, options.scale(), options.canvasSize()), ...(panelPosition.value ?? {}) }
        : { top: 12, right: 12, width: 320 },
      onFloatingPositionChange:
        current && !locked.value
          ? (position: { left: number; top: number }) => {
              panelPosition.value = position;
            }
          : undefined,
      locked: locked.value,
      onToggleLock: () => {
        locked.value = !locked.value;
      },
      onPickImage: async (file: File) => {
        try {
          const src = await options.saveImage(file);
          error.value = null;
          return src;
        } catch (err) {
          error.value = err instanceof Error ? err.message : t('manualEdit.uploadImageFailed');
          return null;
        }
      },
    };
  });

  const hoverTarget = computed(() => (options.enabled() && hover.value && hover.value.id !== selected.value?.id ? hover.value : null));
  const hoverStyle = computed(() => (hoverTarget.value ? px(hoverIconStyle(hoverTarget.value, options.scale(), options.canvasSize())) : {}));
  const openHover = () => {
    const target = hover.value;
    if (!target) return;
    hover.value = null;
    selectTarget(target);
  };

  return {
    panelActive,
    panelProps,
    hoverTarget,
    hoverStyle,
    openHover,
    exit,
    clearHover,
    syncFrame,
    canUndo: computed(() => history.value.length > 0),
    canRedo: computed(() => undone.value.length > 0),
    saving,
  };
}

export type ManualEditController = ReturnType<typeof useManualEdit>;
