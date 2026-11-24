// The Edit tool ("编辑") host side. Ported from the manual-edit half of
// apps/web/src/components/FileViewer.tsx `HtmlViewer`: the sandboxed preview
// runs the vendored edit bridge (edit-mode/bridge.ts, injected by buildSrcdoc
// with `editBridge: true`), which reports editable targets, hover, selection,
// inline text commits and drag-to-move; this hook turns those into patches
// on the file's source (vendored edit-mode/source-patches.ts), writes them
// back through the PreviewSource, keeps undo / redo history and drives the
// vendored ManualEditPanel inspector.
//
// Text and style edits are already live in the frame (the bridge applied
// them), so saving them must not reload the preview; every other patch
// (attributes, HTML, delete, full source, undo / redo) re-renders it.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { TranslateFn } from '../i18n';
import { Icon } from '../vendor/open-design/components/Icon';
import { ManualEditPanel, emptyManualEditDraft, type ManualEditDraft } from '../vendor/open-design/components/ManualEditPanel';
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

function floatingPanelStyle(target: ManualEditTarget, scale: number, canvas: CanvasSize): CSSProperties {
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

function hoverIconStyle(target: ManualEditTarget, scale: number, canvas: CanvasSize): CSSProperties {
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
  enabled: boolean;
  /** The viewer is the visible tab. */
  active: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  fileName: string;
  /** Current source text (what the preview was built from). */
  source: string | null;
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
  scale: number;
  canvasSize: CanvasSize;
  t: TranslateFn;
}

export interface ManualEditController {
  panel: ReactNode;
  hoverAffordance: ReactNode;
  /** Flush pending edits; resolves false when a save failed (stay in Edit). */
  exit: () => Promise<boolean>;
  clearHover: () => void;
  /** Replay bridge state after the frame (re)loads. */
  syncFrame: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
}

export function useManualEdit({
  enabled,
  active,
  iframeRef,
  fileName,
  source,
  readFresh,
  writeSource,
  saveImage,
  onSourceChange,
  scale,
  canvasSize,
  t,
}: UseManualEditOptions): ManualEditController {
  const [targets, setTargets] = useState<ManualEditTarget[]>([]);
  const [selected, setSelected] = useState<ManualEditTarget | null>(null);
  const [hover, setHover] = useState<ManualEditTarget | null>(null);
  const [draft, setDraft] = useState<ManualEditDraft>(() => emptyManualEditDraft(''));
  const [draftDirty, setDraftDirty] = useState(false);
  const [history, setHistory] = useState<ManualEditHistoryEntry[]>([]);
  const [undone, setUndone] = useState<ManualEditHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pageStylesOpen, setPageStylesOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const [locked, setLocked] = useState(false);

  const sourceRef = useRef<string | null>(source);
  sourceRef.current = source;
  const selectedIdRef = useRef<string | null>(null);
  const selectionDraftRef = useRef<{ id: string; draft: ManualEditDraft } | null>(null);
  const pendingStyleRef = useRef<PendingStyleSave | null>(null);
  const liveStylesRef = useRef(new Map<string, { styles: Partial<ManualEditStyles>; version: number }>());
  const previewVersionRef = useRef(0);
  const savingRef = useRef(false);
  const textSessionRef = useRef<string | null>(null);
  const textCommitRef = useRef<Promise<boolean> | null>(null);
  const textFailedRef = useRef(new Set<string>());
  const textFinishRef = useRef<((sessionId: string) => void) | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const undoneRef = useRef(undone);
  undoneRef.current = undone;

  const post = useCallback(
    (message: Record<string, unknown>) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return false;
      win.postMessage(message, '*');
      return true;
    },
    [iframeRef],
  );
  const nextVersion = () => {
    previewVersionRef.current += 1;
    return previewVersionRef.current;
  };
  const previewStyle = useCallback((id: string, styles: Partial<ManualEditStyles>, version: number) => post({ type: 'od-edit-preview-style', id, styles, version }), [post]);
  const postSelected = useCallback((id: string | null) => post({ type: 'od-edit-selected-target', id }), [post]);

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

  const adopt = useCallback(
    (text: string, live: boolean) => {
      sourceRef.current = text;
      onSourceChange(text, live);
    },
    [onSourceChange],
  );

  /** The file changed outside Edit: adopt it and drop history (no overwrite). */
  const confirmSource = async (expected: string, message: string): Promise<boolean> => {
    const persisted = await readFresh();
    if (persisted == null || persisted === expected) return true;
    adopt(persisted, false);
    setHistory([]);
    setUndone([]);
    pendingStyleRef.current = null;
    setDraft((current) => ({ ...current, fullSource: persisted }));
    setError(message);
    return false;
  };

  const applyManualEdit = async (patch: ManualEditPatch, label: string): Promise<boolean> => {
    if (savingRef.current || sourceRef.current == null) return false;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const base = sourceRef.current;
      const result = applyManualEditPatch(base, patch);
      if (!result.ok) {
        setError(result.error ?? 'Could not apply edit.');
        return false;
      }
      if (!(await confirmSource(base, t('app.editExternalChange')))) return false;
      try {
        await writeSource(result.source);
      } catch (err) {
        setError(t('app.editSaveFailed', { message: err instanceof Error ? err.message : String(err) }));
        return false;
      }
      const entry: ManualEditHistoryEntry = {
        id: `${Date.now()}-${historyRef.current.length}`,
        label,
        patch,
        beforeSource: base,
        afterSource: result.source,
        createdAt: Date.now(),
      };
      // Text and style edits already show in the frame (inline edits / the
      // style preview). A text change typed in the inspector is pushed to the
      // live DOM the same way upstream does (`od-edit-preview-text`).
      let live = patch.kind === 'set-style';
      if (patch.kind === 'set-text') {
        const savedText = readManualEditFields(result.source, patch.id).text;
        live = savedText !== undefined && post({ type: 'od-edit-preview-text', id: patch.id, value: savedText });
      }
      adopt(result.source, live);
      setHistory((current) => [entry, ...current]);
      setUndone([]);
      setDraft((current) => ({ ...current, fullSource: result.source }));
      if (patch.kind === 'set-text') {
        setSelected((current) => (current?.id === patch.id ? { ...current, text: patch.value, fields: { ...current.fields, text: patch.value } } : current));
        setDraft((current) => ({ ...current, text: patch.value }));
      } else if (patch.kind === 'set-link') {
        setSelected((current) => (current?.id === patch.id ? { ...current, text: patch.text, fields: { ...current.fields, text: patch.text, href: patch.href } } : current));
        setDraft((current) => ({ ...current, text: patch.text, href: patch.href }));
      } else if (patch.kind === 'set-image') {
        setSelected((current) => (current?.id === patch.id ? { ...current, fields: { ...current.fields, src: patch.src, alt: patch.alt } } : current));
        setDraft((current) => ({ ...current, src: patch.src, alt: patch.alt }));
      } else if (patch.kind === 'remove-element') {
        if (pendingStyleRef.current?.id === patch.id) pendingStyleRef.current = null;
        selectedIdRef.current = null;
        selectionDraftRef.current = null;
        setSelected(null);
        setTargets((current) => current.filter((target) => target.id !== patch.id));
        setDraft(emptyManualEditDraft(result.source));
        setDraftDirty(false);
        postSelected(null);
      }
      if (patch.kind !== 'remove-element' && patch.kind !== 'set-token' && patch.kind !== 'set-full-source' && selectedIdRef.current === patch.id) {
        setDraftDirty(true);
      }
      if (patch.kind === 'set-style' && patch.id !== '__body__' && !readManualEditOuterHtml(result.source, patch.id)) {
        // The target vanished from the saved source: refresh the preview.
        setSelected(null);
        adopt(result.source, false);
      }
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const applyRef = useRef(applyManualEdit);
  applyRef.current = applyManualEdit;

  const replayHistory = async (direction: 'undo' | 'redo') => {
    const stack = direction === 'undo' ? historyRef.current : undoneRef.current;
    const [latest, ...rest] = stack;
    if (!latest || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const expected = direction === 'undo' ? latest.afterSource : latest.beforeSource;
      const next = direction === 'undo' ? latest.beforeSource : latest.afterSource;
      if (!(await confirmSource(expected, t('app.editHistoryCleared')))) return;
      try {
        await writeSource(next);
      } catch (err) {
        setError(t('app.editSaveFailed', { message: err instanceof Error ? err.message : String(err) }));
        return;
      }
      liveStylesRef.current.clear();
      adopt(next, false);
      if (direction === 'undo') {
        setHistory(rest);
        setUndone((current) => [latest, ...current]);
      } else {
        setUndone(rest);
        setHistory((current) => [latest, ...current]);
      }
      setDraft((current) => ({ ...current, fullSource: next }));
      if (selectedIdRef.current) {
        const target = selected;
        if (target) setDraft(draftForTarget(target, next));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // --- pending style pipeline (live preview, saved on Save / exit) -------------

  const handleStyleChange = (id: string, styles: Partial<ManualEditStyles>, label: string) => {
    const version = nextVersion();
    const current = pendingStyleRef.current;
    pendingStyleRef.current = { id, styles: current?.id === id ? { ...current.styles, ...styles } : styles, label, version };
    const previous = liveStylesRef.current.get(id);
    liveStylesRef.current.set(id, { styles: { ...previous?.styles, ...styles }, version });
    setError(null);
    previewStyle(id, styles, version);
  };
  const styleChangeRef = useRef(handleStyleChange);
  styleChangeRef.current = handleStyleChange;

  const flushStyleSave = async (): Promise<boolean> => {
    const pending = pendingStyleRef.current;
    if (!pending) return true;
    if (savingRef.current) return false;
    const ok = await applyManualEdit({ id: pending.id, kind: 'set-style', styles: pending.styles }, pending.label);
    if (ok && pendingStyleRef.current === pending) pendingStyleRef.current = null;
    return ok;
  };

  const cancelStyleDraft = () => {
    const pending = pendingStyleRef.current;
    if (!pending) return;
    pendingStyleRef.current = null;
    const base = sourceRef.current ?? '';
    const target = pending.id === '__body__' ? null : selected?.id === pending.id ? selected : targets.find((item) => item.id === pending.id) ?? null;
    const sourceStyles = target ? inspectorStyles(target, base) : readManualEditStyles(base, pending.id);
    const reset = MANUAL_EDIT_STYLE_PROPS.reduce<Partial<ManualEditStyles>>((acc, key) => {
      acc[key] = sourceStyles[key] ?? '';
      return acc;
    }, {});
    liveStylesRef.current.delete(pending.id);
    previewStyle(pending.id, reset, nextVersion());
    if (!target || target.id === selected?.id) {
      setDraft((current) => ({ ...current, styles: target ? sourceStyles : current.styles, fullSource: base }));
    }
    setError(null);
  };

  // --- inline text sessions ---------------------------------------------------

  /** End the frame's inline text edit and wait for its commit. */
  const finishTextSession = (commit: boolean): Promise<boolean> => {
    const sessionId = textSessionRef.current;
    if (!sessionId) return Promise.resolve(true);
    if (!post({ type: 'od-edit-text-finish', commit })) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        textFinishRef.current = null;
        void (async () => {
          const pending = textCommitRef.current;
          const ok = pending ? await pending.catch(() => false) : true;
          if (textSessionRef.current === sessionId) textSessionRef.current = null;
          resolve(ok && textFailedRef.current.size === 0);
        })();
      };
      textFinishRef.current = settle;
      const timer = window.setTimeout(settle, 1500);
    });
  };

  const settlePendingCommit = async (commitActive = true): Promise<boolean> => {
    if (textSessionRef.current) return finishTextSession(commitActive);
    const pending = textCommitRef.current;
    if (pending) await pending.catch(() => false);
    return textFailedRef.current.size === 0;
  };

  // --- selection ---------------------------------------------------------------

  const selectTarget = (target: ManualEditTarget) => {
    setPageStylesOpen(false);
    if (pendingStyleRef.current?.id !== target.id) cancelStyleDraft();
    const nextDraft = draftForTarget(target, sourceRef.current ?? '');
    selectedIdRef.current = target.id;
    selectionDraftRef.current = { id: target.id, draft: nextDraft };
    setSelected(target);
    setDraft(nextDraft);
    setDraftDirty(false);
    setError(null);
  };
  const selectRef = useRef(selectTarget);
  selectRef.current = selectTarget;

  const clearSelection = async () => {
    if (!(await settlePendingCommit())) return;
    cancelStyleDraft();
    selectedIdRef.current = null;
    selectionDraftRef.current = null;
    textSessionRef.current = null;
    setSelected(null);
    setPanelPosition(null);
    setDraft(emptyManualEditDraft(sourceRef.current ?? ''));
    setDraftDirty(false);
    setError(null);
  };
  const clearSelectionRef = useRef(clearSelection);
  clearSelectionRef.current = clearSelection;

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
    const target = selected;
    const contentBefore = target ? contentPatchForDraft(target, draft, sourceRef.current ?? '') : null;
    if (!(await settlePendingCommit(!contentBefore))) return;
    if (target) {
      const contentPatch = contentPatchForDraft(target, draft, sourceRef.current ?? '');
      if (contentPatch && !(await applyManualEdit(contentPatch.patch, contentPatch.label))) return;
    }
    if (!(await flushStyleSave())) return;
    if (selected) void clearSelection();
    else setPageStylesOpen(false);
  };

  const resetDraft = async () => {
    if (textSessionRef.current) await finishTextSession(false);
    cancelStyleDraft();
    if (!selected) {
      setDraft(emptyManualEditDraft(sourceRef.current ?? ''));
      setError(null);
      return;
    }
    const snapshot = selectionDraftRef.current?.id === selected.id ? selectionDraftRef.current.draft : draftForTarget(selected, sourceRef.current ?? '');
    const base = sourceRef.current ?? '';
    const currentOuter = readManualEditOuterHtml(base, selected.id);
    if (snapshot.outerHtml && currentOuter && snapshot.outerHtml !== currentOuter) {
      if (!(await applyManualEdit({ id: selected.id, kind: 'set-outer-html', html: snapshot.outerHtml }, 'Reset element'))) return;
    }
    const refreshed = sourceRef.current ?? base;
    setDraft({ ...snapshot, fullSource: refreshed, styles: inspectorStyles(selected, refreshed) });
    setDraftDirty(false);
    setError(null);
    postSelected(selected.id);
  };

  const cancelDraft = async () => {
    if (textSessionRef.current) await finishTextSession(false);
    if (selected) void clearSelection();
    else {
      cancelStyleDraft();
      setPageStylesOpen(false);
    }
  };

  const dismissPanel = async () => {
    if (!(await settlePendingCommit())) return;
    if (!(await flushStyleSave())) return;
    if (selected) void clearSelection();
    else setPageStylesOpen(false);
  };

  const exitRef = useRef<() => Promise<boolean>>(async () => true);
  exitRef.current = async () => {
    if (!(await settlePendingCommit())) return false;
    if (textFailedRef.current.size > 0) return false;
    if (!(await flushStyleSave())) return false;
    setPanelPosition(null);
    return true;
  };

  // --- reset on leaving Edit ----------------------------------------------------

  useEffect(() => {
    if (enabled) return;
    setTargets([]);
    setSelected(null);
    setHover(null);
    setPageStylesOpen(false);
    setPanelPosition(null);
    setDraftDirty(false);
    setError(null);
    selectedIdRef.current = null;
    selectionDraftRef.current = null;
    textSessionRef.current = null;
    textCommitRef.current = null;
    textFailedRef.current.clear();
    pendingStyleRef.current = null;
    liveStylesRef.current.clear();
  }, [enabled]);

  // History belongs to one file revision chain; a different file starts clean.
  useEffect(() => {
    setHistory([]);
    setUndone([]);
  }, [fileName]);

  // --- bridge mode ----------------------------------------------------------------

  const syncFrame = useCallback(() => {
    post({ type: 'od-edit-mode', enabled: enabled && active });
    post({ type: 'od-edit-selected-target', id: enabled ? selectedIdRef.current : null });
    if (enabled) {
      for (const [id, preview] of liveStylesRef.current) post({ type: 'od-edit-preview-style', id, styles: preview.styles, version: preview.version });
    }
  }, [post, enabled, active]);

  useEffect(() => {
    syncFrame();
  }, [syncFrame, selected?.id]);

  // --- frame → host -----------------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const data = ev.data as ManualEditBridgeMessage | null;
      if (!data?.type) return;
      if (!active && data.type !== 'od-edit-text-commit' && data.type !== 'od-edit-text-session') return;
      switch (data.type) {
        case 'od-edit-targets':
          if (!Array.isArray(data.targets)) return;
          setTargets(data.targets);
          setSelected((current) => (current ? data.targets.find((target) => target.id === current.id) ?? current : current));
          if (selectedIdRef.current) {
            const id = selectedIdRef.current;
            window.setTimeout(() => postSelected(id), 0);
          }
          return;
        case 'od-edit-select':
          setHover(null);
          selectRef.current(data.target);
          return;
        case 'od-edit-hover':
          if (textSessionRef.current) return;
          setHover(data.target.id === selectedIdRef.current ? null : data.target);
          return;
        case 'od-edit-background':
          setHover(null);
          if (typeof sourceRef.current === 'string' && isManualEditFullHtmlDocument(sourceRef.current)) {
            void clearSelectionRef.current();
            setPageStylesOpen(true);
          }
          return;
        case 'od-edit-text-commit': {
          const sessionId = String(data.id);
          const commit = applyRef.current({ id: sessionId, kind: 'set-text', value: String(data.value) }, t('manualEdit.text'));
          textCommitRef.current = commit;
          void commit
            .then((ok) => {
              if (ok) textFailedRef.current.delete(sessionId);
              else textFailedRef.current.add(sessionId);
            })
            .catch(() => textFailedRef.current.add(sessionId))
            .finally(() => {
              if (textCommitRef.current === commit) textCommitRef.current = null;
            });
          return;
        }
        case 'od-edit-text-session': {
          const sessionId = String(data.id || '');
          if (data.active) {
            textSessionRef.current = sessionId;
            return;
          }
          if (textSessionRef.current === sessionId) textSessionRef.current = null;
          textFinishRef.current?.(sessionId);
          return;
        }
        case 'od-edit-drag-commit': {
          const id = String(data.id || '');
          if (!id) return;
          const dragStyles: Partial<ManualEditStyles> = { transform: String(data.transform || '') };
          if (typeof data.display === 'string' && data.display) dragStyles.display = data.display;
          styleChangeRef.current(id, dragStyles, t('app.editMoveElement'));
          if (selectedIdRef.current === id) {
            setDraft((current) => ({ ...current, styles: { ...current.styles, ...dragStyles } }));
            setDraftDirty(true);
          }
          return;
        }
        default:
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled, active, iframeRef, postSelected, t]);

  const clearHover = useCallback(() => {
    setHover(null);
    post({ type: 'od-edit-hover-reset' });
  }, [post]);

  // --- render ----------------------------------------------------------------------

  const pageStylesEnabled = typeof source === 'string' && isManualEditFullHtmlDocument(source);
  const pageCardActive = enabled && !selected && pageStylesOpen;
  const panelActive = enabled && (Boolean(selected) || pageCardActive);
  const panel = panelActive ? (
    <ManualEditPanel
      targets={targets}
      selectedTarget={selected}
      draft={draft}
      history={history}
      error={error}
      canUndo={history.length > 0}
      canRedo={undone.length > 0}
      busy={saving}
      resetAvailable={selected ? draftDirty : false}
      pageStylesEnabled={pageStylesEnabled}
      onSelectTarget={(target) => selectTarget(target)}
      onDraftChange={(next) => {
        setDraft(next);
        setDraftDirty(Boolean(selected));
      }}
      onStyleChange={(id, styles, label) => handleStyleChange(id, styles, label)}
      onInvalidStyle={(id, keys) => {
        pendingStyleRef.current = cancelPendingStyleKeys(pendingStyleRef.current, id, keys);
      }}
      onApplyPatch={(patch, label) => {
        void applyManualEdit(patch, label);
      }}
      onError={setError}
      onClearSelection={() => void clearSelection()}
      onExit={() => void dismissPanel()}
      onCancelDraft={() => void cancelDraft()}
      onSaveDraft={() => void saveDraft()}
      onResetDraft={() => void resetDraft()}
      onUndo={() => void replayHistory('undo')}
      onRedo={() => void replayHistory('redo')}
      floatingClassName={pageCardActive ? 'manual-edit-page-card' : undefined}
      floatingStyle={
        selected ? { ...floatingPanelStyle(selected, scale, canvasSize), ...(panelPosition ?? {}) } : { top: 12, right: 12, width: 320 }
      }
      onFloatingPositionChange={selected && !locked ? setPanelPosition : undefined}
      locked={locked}
      onToggleLock={() => setLocked((value) => !value)}
      onPickImage={async (file) => {
        try {
          const src = await saveImage(file);
          setError(null);
          return src;
        } catch (err) {
          setError(err instanceof Error ? err.message : t('manualEdit.uploadImageFailed'));
          return null;
        }
      }}
    />
  ) : null;

  const hoverAffordance =
    enabled && hover && hover.id !== selected?.id ? (
      <button
        type="button"
        className="manual-edit-hover-action"
        data-testid="manual-edit-hover-open"
        aria-label={t('manualEdit.editParams')}
        title={t('manualEdit.editParams')}
        style={hoverIconStyle(hover, scale, canvasSize)}
        onClick={() => {
          const target = hover;
          setHover(null);
          selectTarget(target);
        }}
      >
        <Icon name="sliders" size={15} />
      </button>
    ) : null;

  return {
    panel,
    hoverAffordance,
    exit: () => exitRef.current(),
    clearHover,
    syncFrame,
    canUndo: history.length > 0,
    canRedo: undone.length > 0,
    saving,
  };
}
