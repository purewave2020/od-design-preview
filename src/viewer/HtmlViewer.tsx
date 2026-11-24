// The HTML / deck preview — the heart of the Open Design workspace's right
// pane. Rebuilt from apps/web/src/components/FileViewer.tsx `HtmlViewer`
// (same DOM + class names so the upstream stylesheet applies), keeping the
// preview surface: sandboxed srcdoc iframe built by the vendored
// `buildSrcdoc`, Preview/Source tabs, reload, Desktop/Tablet/Mobile viewports,
// auto-fit + manual zoom, deck navigation (toolbar, floating nav, thumbnail
// rail, keyboard), speaker notes, Present (in tab / fullscreen / new tab),
// Export (PDF / PNG / ZIP / HTML), and the review / edit tools:
//   注释 Comment  — pick an element, write a comment in the vendored composer
//   标记 Mark     — the vendored draw overlay (box / pen / text) → comment
//   编辑 Edit     — manual edit through the vendored edit bridge + inspector
//   评论 Comments — pins on the canvas + the comments panel
// Chat, versions and sharing stay in Open Design.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TranslationScope, useT } from '../i18n';
import { copyText, useElementSize, usePersistentState } from '../lib/hooks';
import { CommentPreviewOverlays } from '../review/CommentPreviewOverlays';
import { CommentSidePanel } from '../review/CommentSidePanel';
import { useComments } from '../review/CommentsContext';
import { commentCreatedAt, commentEffectiveSortKey, computeReorderedSortKey } from '../review/comment-utils';
import { snapshotFromBridge, type BridgeSnapshotData } from '../review/review-bridge';
import { useManualEdit } from '../review/useManualEdit';
import { prepareHtmlForPreview, selfContainedHtml } from '../sources/prepare';
import { canWrite, type PreparedHtml, type PreviewSource } from '../sources/types';
import { baseDirFor, baseName } from '../sources/file-kind';
import type { PreviewViewportId, ProjectFile } from '../types';
import { AnchoredPopover } from '../ui/AnchoredPopover';
import { useToast } from '../ui/Toast';
import {
  commentsToAttachments,
  commentSnapshotEqual,
  isValidCommentOverlayPosition,
  liveCommentTargetMapsEqual,
  liveSnapshotForComment,
  messageContentWithCommentAttachments,
  provisionalNextPinNumber,
  targetFromSnapshot,
  type PreviewCommentSnapshot,
} from '../vendor/open-design/comments';
import { indexCommentTargets } from '../vendor/open-design/comments/target-index';
import { AnnotationHoverPopover, BoardComposerPopover } from '../vendor/open-design/components/BoardComposerPopover';
import { DeckThumbnailRail } from '../vendor/open-design/components/DeckThumbnailRail';
import { Icon } from '../vendor/open-design/components/Icon';
import { ANNOTATION_EVENT, PreviewDrawOverlay, type AnnotationEventDetail } from '../vendor/open-design/components/PreviewDrawOverlay';
import { RemixIcon } from '../vendor/open-design/components/RemixIcon';
import type { PreviewComment, PreviewCommentAttachment, PreviewCommentTarget } from '../vendor/open-design/contracts/api/comments';
import { parseDeckThumbnails } from '../vendor/open-design/runtime/deck-thumbnail-parser';
import {
  copyImageDataUrlToClipboard,
  exportArtifactImageDataUrl,
  exportAsHtml,
  exportAsImage,
  exportAsPdf,
  exportAsZip,
  openSandboxedPreviewInNewTab,
  requestPreviewSnapshot,
  sourceLooksLikeNavigableDeck,
} from '../vendor/open-design/runtime/exports';
import { previewStorageKey, readPreviewStorage, savePreviewStorageMessage } from '../vendor/open-design/runtime/preview-storage';
import { extractSpeakerNotesFromHtml } from '../vendor/open-design/runtime/speaker-notes';
import { findRealTagEnd, HTML_TAG_PATTERNS } from '../vendor/open-design/contracts/runtime/html-injection-points';
import { buildRedirectLoopBlockedDoc, buildSrcdoc, PREVIEW_REDIRECT_LOOP_MESSAGE } from '../vendor/open-design/runtime/srcdoc';
import { FileViewerLoadingSkeleton } from './FileViewerLoadingSkeleton';
import {
  deckKeyboardShortcutForEvent,
  effectivePreviewScale,
  isEditableKeyboardTarget,
  isPreviewViewportId,
  PREVIEW_VIEWPORT_PRESETS,
  previewScaleShellStyle,
  previewViewportIcon,
  previewViewportStyle,
  resolveDesktopPreviewZoomPercent,
  sourceLooksLikeDeckPreview,
  ZOOM_LEVELS,
  zoomPercentLabel,
} from './preview-geometry';
import { PreviewViewportControls } from './PreviewViewportControls';

// Same sandbox as upstream HTML_PREVIEW_SANDBOX: scripts run, but on an
// opaque origin with no access to this app, its storage or cookies.
export const HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-downloads';

type SlideState = { active: number; count: number };
type ZoomPref = { mode: 'auto' | 'manual'; zoom: number };
type ScrollState = { frameLeft: number; frameTop: number; canvasLeft: number; canvasTop: number };

const HOVER_CARD_DISMISS_DELAY_MS = 80;

// Pointer activity inside the sandboxed frame never reaches the host document
// (the frame runs out of process), so upstream's `.comment-preview-canvas:hover`
// reveal for the floating deck nav cannot fire. This tiny bridge reports
// in-frame pointer activity so the host can reveal the nav itself.
const ACTIVITY_BRIDGE = `<script data-odp-activity-bridge>(function(){var last=0;function post(type){try{window.parent.postMessage({type:type},'*')}catch(_){}}document.addEventListener('pointermove',function(){var now=Date.now();if(now-last>200){last=now;post('odp:pointer-activity')}},{capture:true,passive:true});document.addEventListener('pointerdown',function(){post('odp:pointer-activity')},{capture:true,passive:true});document.documentElement.addEventListener('mouseleave',function(){post('odp:pointer-leave')});})();</script>`;

function injectActivityBridge(doc: string): string {
  const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
  return headEnd >= 0 ? doc.slice(0, headEnd) + ACTIVITY_BRIDGE + doc.slice(headEnd) : ACTIVITY_BRIDGE + doc;
}

// The Mark tool's submit menu is worded for the chat composer upstream; here
// its three actions save a comment, copy the marked-up image, or download it.
const MARK_TOOL_REMAP: Record<string, string> = {
  'chat.send': 'app.markSaveComment',
  'chat.annotationSending': 'app.markSaving',
  'chat.annotationAddToInput': 'app.markCopy',
  'chat.annotationAddingToInput': 'app.markCopying',
  'chat.annotationQueue': 'app.markDownload',
  'chat.annotationQueueing': 'app.markDownloading',
};

/** Survives tab switches / remounts like upstream `htmlPreviewSlideState`. */
const slideStateCache = new Map<string, SlideState>();
let measurementSeq = 0;
let requestSeq = 0;

function isZoomPref(value: unknown): value is ZoomPref {
  const v = value as ZoomPref | null;
  return !!v && (v.mode === 'auto' || v.mode === 'manual') && typeof v.zoom === 'number' && v.zoom > 0;
}

function exportTitleFor(file: ProjectFile): string {
  return baseName(file.name).replace(/\.[^.]+$/, '') || 'artifact';
}

function manualEditShellStyle(viewport: PreviewViewportId, scale: number, frozenWidth: number | null): CSSProperties {
  if (viewport === 'desktop' && frozenWidth) {
    return { width: `${frozenWidth / scale}px`, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: '0 0' };
  }
  return previewScaleShellStyle(viewport, scale);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

export interface HtmlViewerProps {
  source: PreviewSource;
  file: ProjectFile;
  /** Bumps when non-HTML assets of the project change (CSS, images, …). */
  filesRefreshKey: number;
  isDeckHint?: boolean;
  /** This viewer is the visible tab (retained viewers stay mounted, hidden). */
  active: boolean;
  /** Tab-strip slot for the file's header actions (Present / Export). */
  actionsHost: HTMLElement | null;
  /** Floating host the comments panel is portaled into (upstream comment-float-host). */
  commentHost?: HTMLElement | null;
  /** Embedded/read-only mode: hide Source + header chrome affordances. */
  viewerOnly?: boolean;
}

export const HtmlViewer = memo(function HtmlViewer({
  source,
  file,
  filesRefreshKey,
  isDeckHint = false,
  active,
  actionsHost,
  commentHost = null,
  viewerOnly = false,
}: HtmlViewerProps) {
  const t = useT();
  const toast = useToast();
  const comments = useComments();
  const writable = canWrite(source) && !viewerOnly;
  const reviewAvailable = Boolean(comments) && !viewerOnly;
  const stateKey = `${source.id}::${file.name}`;
  const title = exportTitleFor(file);

  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [reloadKey, setReloadKey] = useState(0);
  const [raw, setRaw] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [prepared, setPrepared] = useState<(PreparedHtml & { seq: number }) | null>(null);
  const prepSeqRef = useRef(0);
  /** What the current srcdoc was built from, and under which refresh key. */
  const builtFromRef = useRef<{ text: string; key: string } | null>(null);
  /** Source the live frame already shows (Edit text / style saves). */
  const liveSourceRef = useRef<string | null>(null);
  const refreshKey = `${filesRefreshKey}:${reloadKey}`;
  const refreshKeyRef = useRef(refreshKey);
  refreshKeyRef.current = refreshKey;

  const rebuildFrom = useCallback(
    async (text: string) => {
      const next = await prepareHtmlForPreview(source, file.name, text);
      prepSeqRef.current += 1;
      builtFromRef.current = { text, key: refreshKeyRef.current };
      setPrepared({ ...next, seq: prepSeqRef.current });
    },
    [source, file.name],
  );

  // --- load + prepare -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    void (async () => {
      try {
        const text = await source.readText(file.name, { fresh: true });
        if (cancelled) return;
        if (text === null) {
          setLoadError(true);
          return;
        }
        setRaw(text);
        const built = builtFromRef.current;
        // Same bytes under the same refresh key (a write echo, a touched
        // mtime) — or the edit the frame already shows — needs no re-render.
        if (built && built.key === refreshKey && (built.text === text || liveSourceRef.current === text)) {
          builtFromRef.current = { text, key: refreshKey };
          return;
        }
        liveSourceRef.current = null;
        const next = await prepareHtmlForPreview(source, file.name, text);
        if (cancelled) return;
        prepSeqRef.current += 1;
        builtFromRef.current = { text, key: refreshKey };
        setPrepared({ ...next, seq: prepSeqRef.current });
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, file.name, file.mtime, refreshKey]);

  const effectiveDeck = isDeckHint || sourceLooksLikeDeckPreview(raw, sourceLooksLikeNavigableDeck);

  // --- tools -----------------------------------------------------------------
  const [boardMode, setBoardMode] = useState(false);
  const [commentCreateMode, setCommentCreateMode] = useState(false);
  const [commentPanelOpen, setCommentPanelOpen] = useState(false);
  const [commentPanelCollapsed, setCommentPanelCollapsed] = useState(false);
  const [drawOverlayOpen, setDrawOverlayOpen] = useState(false);
  const [manualEditMode, setManualEditMode] = useState(false);
  const [manualEditFrozenWidth, setManualEditFrozenWidth] = useState<number | null>(null);

  // --- viewport / zoom ------------------------------------------------------
  const [viewport, setViewport] = usePersistentState<PreviewViewportId>(`od-preview:viewport:${stateKey}`, 'desktop', isPreviewViewportId);
  const [zoomPref, setZoomPref] = usePersistentState<ZoomPref>(`od-preview:zoom:${stateKey}`, { mode: 'auto', zoom: 100 }, isZoomPref);
  // Scale math uses the viewer body (the space available to the canvas), as
  // upstream does: tablet/mobile canvases are themselves sized from the scale.
  const [bodyRef, bodySize] = useElementSize<HTMLDivElement>();
  const [canvasRef, canvasSize] = useElementSize<HTMLDivElement>();
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const setCanvasNode = useCallback(
    (node: HTMLDivElement | null) => {
      canvasRef(node);
      setCanvasEl(node);
    },
    [canvasRef],
  );
  const [layoutEl, setLayoutEl] = useState<HTMLDivElement | null>(null);
  const [contentMeasure, setContentMeasure] = useState<{ width: number; overflow: boolean } | null>(null);
  const previewZoomPercent = resolveDesktopPreviewZoomPercent({
    zoomMode: zoomPref.mode,
    viewport,
    isDeck: effectiveDeck,
    manualZoomPercent: zoomPref.zoom,
    canvasSize: bodySize,
    contentWidth: contentMeasure?.overflow ? contentMeasure.width : null,
  });
  const previewScale = previewZoomPercent / 100;
  const overlayScale = effectivePreviewScale(viewport, previewScale, bodySize);
  const zoomLevelActive = (level: number) => zoomPref.mode === 'manual' && Math.abs(previewZoomPercent - level) < 0.001;
  const setManualZoom = (level: number) => setZoomPref({ mode: 'manual', zoom: level });

  // --- deck state -----------------------------------------------------------
  const [slideState, setSlideState] = useState<SlideState | null>(() => slideStateCache.get(stateKey) ?? null);
  const [railCollapsed, setRailCollapsed] = usePersistentState<boolean>('od-preview:deck-rail-collapsed', false);
  const [notesOpen, setNotesOpen] = usePersistentState<boolean>('od-preview:speaker-notes-open', true);
  useEffect(() => {
    if (!effectiveDeck) setSlideState(null);
  }, [effectiveDeck]);

  // --- srcdoc -----------------------------------------------------------------
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameLoads, setFrameLoads] = useState(0);
  const [redirectBlockedSeq, setRedirectBlockedSeq] = useState<number | null>(null);
  const redirectBlocked = prepared !== null && redirectBlockedSeq === prepared.seq;
  const storageScope = previewStorageKey('od-design-preview', source.id, file.name);
  const documentEpoch = useMemo(
    () => `doc-${prepared?.seq ?? 0}-${effectiveDeck ? 'deck' : 'page'}-${Math.random().toString(36).slice(2, 8)}`,
    [prepared, effectiveDeck],
  );
  const srcDoc = useMemo(() => {
    if (!prepared) return '';
    if (redirectBlocked) return buildRedirectLoopBlockedDoc();
    return injectActivityBridge(
      buildSrcdoc(prepared.html, {
        deck: effectiveDeck,
        baseHref: prepared.baseHref,
        initialSlideIndex: slideStateCache.get(stateKey)?.active ?? 0,
        hideDeckChrome: effectiveDeck,
        // Like upstream, the selection (comment) and manual-edit bridges are
        // always injected and boot dormant: toggling a tool only posts a mode
        // message, so the document is never re-parsed on a tool switch.
        selectionBridge: true,
        editBridge: true,
        previewFocusGuard: true,
        deferFontStylesheets: true,
        reloadKey: prepared.seq,
        previewMeasurementEpoch: documentEpoch,
        previewStorage: Boolean(storageScope),
        previewStorageSeed: storageScope ? { generation: documentEpoch, values: readPreviewStorage(storageScope) } : undefined,
      }),
    );
    // stateKey/storageScope derive from source+file, which also drive `prepared`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, effectiveDeck, documentEpoch, redirectBlocked]);

  // --- scroll capture / restore across re-renders (upstream #92) -------------
  const scrollRef = useRef<ScrollState>({ frameLeft: 0, frameTop: 0, canvasLeft: 0, canvasTop: 0 });
  const scrollRestoreRef = useRef<ScrollState | null>(null);
  const scrollCapturesRef = useRef(new Map<string, (state: ScrollState) => void>());
  const captureScroll = useCallback(async () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    requestSeq += 1;
    const requestId = `scroll-${requestSeq}`;
    const state = await new Promise<ScrollState | null>((resolve) => {
      const timer = window.setTimeout(() => {
        scrollCapturesRef.current.delete(requestId);
        resolve(null);
      }, 300);
      scrollCapturesRef.current.set(requestId, (value) => {
        window.clearTimeout(timer);
        resolve(value);
      });
      win.postMessage({ type: 'od:preview-scroll-capture', requestId }, '*');
    });
    scrollRestoreRef.current = state ?? scrollRef.current;
  }, []);

  // --- desktop auto-fit measurement (upstream content-size bridge) ----------
  const measureRequestRef = useRef<{ id: string; canvasWidth: number; scale: number; epoch: string } | null>(null);
  const liveRef = useRef({ canvasWidth: 0, scale: 1 });
  liveRef.current = { canvasWidth: bodySize?.width ?? 0, scale: previewScale };
  const measurementEligible =
    active && mode === 'preview' && viewport === 'desktop' && zoomPref.mode === 'auto' && !effectiveDeck && !redirectBlocked && !manualEditMode;
  useEffect(() => {
    if (!measurementEligible || !bodySize?.width) return;
    const raf = window.requestAnimationFrame(() => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      measurementSeq += 1;
      const id = `measure-${measurementSeq}`;
      measureRequestRef.current = { id, canvasWidth: bodySize.width, scale: previewScale, epoch: documentEpoch };
      win.postMessage({ type: 'od:preview-content-size-request', measurementId: id, generation: documentEpoch }, '*');
    });
    return () => window.cancelAnimationFrame(raf);
  }, [measurementEligible, bodySize?.width, previewScale, documentEpoch, frameLoads]);

  const handleMeasurement = useCallback((data: Record<string, unknown>) => {
    const req = measureRequestRef.current;
    if (!req || data.measurementId !== req.id || data.generation !== req.epoch || data.documentEpoch !== req.epoch) return;
    const live = liveRef.current;
    if (Math.abs(req.canvasWidth - live.canvasWidth) > 1 || Math.abs(req.scale - live.scale) > 0.0001) return;
    const scrollWidth = typeof data.scrollWidth === 'number' && data.scrollWidth > 0 ? Math.ceil(data.scrollWidth) : null;
    const clientWidth = typeof data.clientWidth === 'number' && data.clientWidth > 0 ? Math.ceil(data.clientWidth) : null;
    if (scrollWidth == null || clientWidth == null) return;
    const neutral = Math.abs(req.scale - 1) <= 0.0001;
    const overflow = scrollWidth > clientWidth + 1;
    setContentMeasure((prev) => {
      if (neutral) {
        const next = overflow ? { width: scrollWidth, overflow: true } : { width: Math.max(1, Math.ceil(req.canvasWidth)), overflow: false };
        return prev && prev.width === next.width && prev.overflow === next.overflow ? prev : next;
      }
      // At a non-neutral zoom the body width is the scaled viewport floor, not
      // the artifact's width: keep a confirmed overflow, else re-measure at 100%.
      return prev?.overflow ? prev : null;
    });
  }, []);

  // --- present ----------------------------------------------------------------
  const [presenting, setPresenting] = useState<null | 'tab' | 'fullscreen'>(null);
  const [escHint, setEscHint] = useState(false);
  const presentOverlayRef = useRef<HTMLDivElement | null>(null);
  const presentFrameRef = useRef<HTMLIFrameElement | null>(null);
  const presentationSrcDoc = useMemo(
    () =>
      presenting && prepared
        ? buildSrcdoc(prepared.html, {
            deck: effectiveDeck,
            baseHref: prepared.baseHref,
            initialSlideIndex: slideStateCache.get(stateKey)?.active ?? 0,
            hideDeckChrome: effectiveDeck,
            deckClickNavigation: effectiveDeck,
            previewFocusGuard: true,
          })
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presenting, prepared, effectiveDeck],
  );

  const postSlide = useCallback((action: 'next' | 'prev' | 'first' | 'last' | 'go', index?: number) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'od:slide', action, ...(action === 'go' && typeof index === 'number' ? { index } : {}) }, '*');
  }, []);

  const closePresent = useCallback(() => {
    setPresenting(null);
    setEscHint(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    // Bring the workspace preview to wherever the presentation ended.
    const cached = slideStateCache.get(stateKey);
    if (cached) postSlide('go', cached.active);
  }, [postSlide, stateKey]);

  // --- floating deck nav reveal ---------------------------------------------------
  const [navRevealed, setNavRevealed] = useState(false);
  const navHoverRef = useRef(false);
  const navHideTimerRef = useRef<number | null>(null);
  const revealNav = useCallback((ms: number) => {
    setNavRevealed(true);
    if (navHideTimerRef.current !== null) window.clearTimeout(navHideTimerRef.current);
    navHideTimerRef.current = window.setTimeout(() => {
      navHideTimerRef.current = null;
      if (!navHoverRef.current) setNavRevealed(false);
    }, ms);
  }, []);
  useEffect(
    () => () => {
      if (navHideTimerRef.current !== null) window.clearTimeout(navHideTimerRef.current);
    },
    [],
  );

  // --- iframe → host messages (preview runtime) ---------------------------------
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const frame = iframeRef.current;
      const presentFrame = presentFrameRef.current;
      const fromMain = !!frame && ev.source === frame.contentWindow;
      const fromPresent = !!presentFrame && ev.source === presentFrame.contentWindow;
      if (!fromMain && !fromPresent) return;
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      switch (data.type) {
        case 'od:slide-state': {
          if (typeof data.active !== 'number' || typeof data.count !== 'number') return;
          const next = { active: data.active, count: data.count };
          slideStateCache.set(stateKey, next);
          setSlideState(next);
          return;
        }
        case 'od:present-escape':
          if (fromPresent) closePresent();
          return;
        case 'odp:pointer-activity':
          if (fromMain) revealNav(2500);
          return;
        case 'odp:pointer-leave':
          if (fromMain) revealNav(700);
          return;
        case 'od:preview-content-size':
          if (fromMain) handleMeasurement(data);
          return;
        case 'od:preview-local-storage':
          if (fromMain) savePreviewStorageMessage(ev, frame!.contentWindow, documentEpoch, storageScope);
          return;
        case 'od:preview-scroll': {
          if (!fromMain) return;
          const state: ScrollState = {
            frameLeft: Number(data.frameLeft || 0),
            frameTop: Number(data.frameTop || 0),
            canvasLeft: Number(data.canvasLeft || 0),
            canvasTop: Number(data.canvasTop || 0),
          };
          const requestId = typeof data.requestId === 'string' ? data.requestId : '';
          const pending = requestId ? scrollCapturesRef.current.get(requestId) : undefined;
          if (pending) {
            scrollCapturesRef.current.delete(requestId);
            pending(state);
            return;
          }
          scrollRef.current = state;
          return;
        }
        case 'od:preview-scroll-request': {
          if (!fromMain) return;
          const restore = scrollRestoreRef.current;
          if (!restore) return;
          scrollRestoreRef.current = null;
          frame!.contentWindow?.postMessage({ type: 'od:preview-scroll-restore', ...restore }, '*');
          return;
        }
        case PREVIEW_REDIRECT_LOOP_MESSAGE:
          if (fromMain && prepared) setRedirectBlockedSeq(prepared.seq);
          return;
        default:
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [stateKey, closePresent, handleMeasurement, documentEpoch, storageScope, prepared, revealNav]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePresent();
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement && presenting === 'fullscreen') closePresent();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    const hint = window.setTimeout(() => setEscHint(false), 2600);
    if (presenting === 'fullscreen') {
      void presentOverlayRef.current?.requestFullscreen?.().catch(() => setPresenting('tab'));
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.clearTimeout(hint);
    };
  }, [presenting, closePresent]);

  // --- deck derived values ----------------------------------------------------
  const deckSlideCount = slideState?.count ?? 0;
  const activeDeckSlideIndex = slideState?.active ?? 0;
  const speakerNotes = useMemo(
    () => (effectiveDeck && raw ? extractSpeakerNotesFromHtml(raw, deckSlideCount) : []),
    [effectiveDeck, raw, deckSlideCount],
  );
  const showDeckNavigation = effectiveDeck && (slideState === null || slideState.count > 0);
  const deckSlideTotal = Math.max(deckSlideCount, speakerNotes.length, showDeckNavigation ? 1 : 0);
  const deckNavTotal = Math.max(deckSlideTotal, activeDeckSlideIndex + 1, 1);
  const showDeckThumbnailRail = effectiveDeck && prepared !== null && deckSlideTotal > 0 && !redirectBlocked && !manualEditMode;
  const showDeckFloatingNav = effectiveDeck && deckSlideTotal > 0 && !redirectBlocked && !manualEditMode;
  const hasSpeakerNotes = speakerNotes.some((note) => note.trim().length > 0);
  const activeSpeakerNote = speakerNotes[activeDeckSlideIndex] ?? '';

  const goToSlide = useCallback(
    (index: number) => {
      if (!Number.isFinite(index) || index < 0) return;
      const target = Math.floor(index);
      const count = Math.max(slideStateCache.get(stateKey)?.count ?? 0, target + 1);
      slideStateCache.set(stateKey, { active: target, count });
      setSlideState({ active: target, count });
      postSlide('go', target);
    },
    [postSlide, stateKey],
  );
  const goToSlideRef = useRef(goToSlide);
  goToSlideRef.current = goToSlide;
  const handleThumbnailSelect = useCallback((index: number) => goToSlideRef.current(index), []);

  const buildThumbSrcDoc = useCallback(
    (index: number) =>
      buildSrcdoc(prepared?.html ?? '', {
        deck: true,
        baseHref: prepared?.baseHref,
        initialSlideIndex: index,
        hideDeckChrome: true,
        previewFocusGuard: true,
        freezeMotion: true,
      }),
    [prepared],
  );
  const parsedDeck = useMemo(() => {
    if (!effectiveDeck || !prepared) return null;
    try {
      const parsed = parseDeckThumbnails(prepared.html, prepared.baseHref);
      return parsed.renderable ? parsed : null;
    } catch {
      return null;
    }
  }, [effectiveDeck, prepared]);
  const thumbViewport = useMemo(() => {
    const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
    if (preset?.width && preset.height) return { width: preset.width, height: preset.height };
    if (!canvasSize) return null;
    const scale = Number.isFinite(previewScale) && previewScale > 0 ? previewScale : 1;
    return { width: Math.max(1, Math.round(canvasSize.width / scale)), height: Math.max(1, Math.round(canvasSize.height / scale)) };
  }, [viewport, canvasSize, previewScale]);

  // Host-side deck shortcuts while focus is outside the sandboxed frame.
  useEffect(() => {
    if (!active || !effectiveDeck || mode !== 'preview' || presenting || manualEditMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableKeyboardTarget(event.target) || isEditableKeyboardTarget(document.activeElement)) return;
      if (document.activeElement instanceof HTMLIFrameElement) return;
      if ((event.target as HTMLElement | null)?.closest?.('[role="menu"],[role="listbox"],[role="dialog"]')) return;
      const shortcut = deckKeyboardShortcutForEvent(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'reset') goToSlide(0);
      else postSlide(shortcut);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, effectiveDeck, mode, presenting, manualEditMode, goToSlide, postSlide]);

  // ===========================================================================
  // Comments (注释 / 评论)
  // ===========================================================================
  const [liveTargets, setLiveTargets] = useState<Map<string, PreviewCommentSnapshot>>(() => new Map());
  const liveTargetsRef = useRef(liveTargets);
  liveTargetsRef.current = liveTargets;
  const [hoveredTarget, setHoveredTarget] = useState<PreviewCommentSnapshot | null>(null);
  const [activeTarget, setActiveTarget] = useState<PreviewCommentSnapshot | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [queuedNotes, setQueuedNotes] = useState<string[]>([]);
  const [boardImages, setBoardImages] = useState<File[]>([]);
  const [keepAttachments, setKeepAttachments] = useState<PreviewCommentAttachment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sendingComment, setSendingComment] = useState(false);
  const hoverCardPinnedRef = useRef(false);
  const hoverDismissTimerRef = useRef<number | null>(null);
  const locateRequestRef = useRef<{ requestId: string; commentId: string } | null>(null);

  const boardImagePreviews = useMemo(() => boardImages.map((image) => ({ file: image, url: URL.createObjectURL(image) })), [boardImages]);
  useEffect(() => () => boardImagePreviews.forEach((preview) => URL.revokeObjectURL(preview.url)), [boardImagePreviews]);

  const fileComments = useMemo(() => (comments?.comments ?? []).filter((comment) => comment.filePath === file.name), [comments?.comments, file.name]);
  const creationSorted = useMemo(
    () => fileComments.filter((comment) => comment.status === 'open').sort((a, b) => commentCreatedAt(a) - commentCreatedAt(b)),
    [fileComments],
  );
  const pinNumbers = useMemo(() => {
    const byCreation = [...fileComments].sort((a, b) => commentCreatedAt(a) - commentCreatedAt(b));
    return new Map(byCreation.map((comment, index) => [comment.id, typeof comment.pinSeq === 'number' ? comment.pinSeq : index + 1]));
  }, [fileComments]);
  const provisionalPin = useMemo(
    () => provisionalNextPinNumber([...fileComments].sort((a, b) => commentCreatedAt(a) - commentCreatedAt(b))),
    [fileComments],
  );
  const sideComments = useMemo(() => [...creationSorted].sort((a, b) => commentEffectiveSortKey(b) - commentEffectiveSortKey(a)), [creationSorted]);
  const resolvedComments = useMemo(
    () => fileComments.filter((comment) => comment.status === 'resolved').sort((a, b) => b.updatedAt - a.updatedAt),
    [fileComments],
  );
  const activeComment = activeCommentId ? fileComments.find((comment) => comment.id === activeCommentId) ?? null : null;

  const cancelHoverDismiss = useCallback(() => {
    if (hoverDismissTimerRef.current !== null) window.clearTimeout(hoverDismissTimerRef.current);
    hoverDismissTimerRef.current = null;
  }, []);
  const scheduleHoverDismiss = useCallback(() => {
    cancelHoverDismiss();
    hoverDismissTimerRef.current = window.setTimeout(() => {
      hoverDismissTimerRef.current = null;
      if (!hoverCardPinnedRef.current) setHoveredTarget(null);
    }, HOVER_CARD_DISMISS_DELAY_MS);
  }, [cancelHoverDismiss]);
  useEffect(() => {
    if (!hoveredTarget) hoverCardPinnedRef.current = false;
  }, [hoveredTarget]);

  const clearComposer = useCallback(() => {
    setActiveTarget(null);
    setHoveredTarget(null);
    setActiveCommentId(null);
    setCommentDraft('');
    setQueuedNotes([]);
    setBoardImages([]);
    setKeepAttachments([]);
    locateRequestRef.current = null;
  }, []);

  // Board mode → bridge picker on/off.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'od:comment-mode', enabled: boardMode && active, mode: 'picker' }, '*');
  }, [boardMode, active, srcDoc, frameLoads]);

  useEffect(() => {
    if (boardMode && active) return;
    setCommentCreateMode(false);
    setActiveTarget(null);
    setHoveredTarget(null);
    setActiveCommentId(null);
    setLiveTargets((current) => (current.size > 0 ? new Map() : current));
    setQueuedNotes((current) => (current.length ? [] : current));
  }, [boardMode, active]);

  // Selection bridge → comment targets.
  useEffect(() => {
    if (!boardMode || !active) return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const data = ev.data as (BridgeSnapshotData & { type?: string; requestId?: string; targets?: BridgeSnapshotData[] }) | null;
      if (!data?.type) return;
      const toSnapshot = (value: BridgeSnapshotData) => snapshotFromBridge(file.name, value);
      switch (data.type) {
        case 'od:comment-targets': {
          if (!Array.isArray(data.targets)) return;
          const next = indexCommentTargets(data.targets.map(toSnapshot));
          for (const [id, snapshot] of next) if (!id || !isValidCommentOverlayPosition(snapshot.position)) next.delete(id);
          setLiveTargets((current) => (liveCommentTargetMapsEqual(current, next) ? current : next));
          setActiveTarget((current) => {
            if (!current || current.selectionKind === 'pod' || current.elementId.startsWith('pin-') || current.elementId.startsWith('file-comment-')) return current;
            const updated = next.get(current.elementId);
            if (!updated) return current;
            return commentSnapshotEqual(current, updated) ? current : updated;
          });
          setHoveredTarget((current) => {
            if (!current) return null;
            const updated = next.get(current.elementId);
            if (!updated) return null;
            return commentSnapshotEqual(current, updated) ? current : updated;
          });
          return;
        }
        case 'od:comment-location-missing': {
          const request = locateRequestRef.current;
          if (!request || request.requestId !== data.requestId) return;
          locateRequestRef.current = null;
          toast.show(t('comment.anchorState.lost'), { tone: 'error' });
          return;
        }
        case 'od:comment-active-target-update': {
          const snapshot = toSnapshot(data);
          if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
          const request = locateRequestRef.current;
          if (request && data.requestId === request.requestId) {
            locateRequestRef.current = null;
            setActiveTarget(snapshot);
            setHoveredTarget(snapshot);
          } else {
            setActiveTarget((current) => (current && current.elementId === snapshot.elementId && !commentSnapshotEqual(current, snapshot) ? snapshot : current));
          }
          setLiveTargets((current) => {
            const existing = current.get(snapshot.elementId);
            if (existing && commentSnapshotEqual(existing, snapshot)) return current;
            return new Map(current).set(snapshot.elementId, snapshot);
          });
          return;
        }
        case 'od:comment-leave':
          if (hoverCardPinnedRef.current) return;
          scheduleHoverDismiss();
          return;
        case 'od:comment-hover': {
          const snapshot = toSnapshot(data);
          if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
          cancelHoverDismiss();
          setHoveredTarget((current) => (current && current.elementId === snapshot.elementId && commentSnapshotEqual(current, snapshot) ? current : snapshot));
          setLiveTargets((current) => {
            const existing = current.get(snapshot.elementId);
            if (existing && commentSnapshotEqual(existing, snapshot)) return current;
            return new Map(current).set(snapshot.elementId, snapshot);
          });
          return;
        }
        case 'od:comment-target': {
          const snapshot = toSnapshot(data);
          if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
          cancelHoverDismiss();
          setLiveTargets((current) => new Map(current).set(snapshot.elementId, snapshot));
          setActiveTarget(snapshot);
          setHoveredTarget(snapshot);
          setActiveCommentId(null);
          setCommentDraft('');
          setQueuedNotes([]);
          setBoardImages([]);
          setKeepAttachments([]);
          return;
        }
        default:
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [boardMode, active, file.name, scheduleHoverDismiss, cancelHoverDismiss, toast, t]);

  // Keep the bridge tracking the target the composer is attached to.
  useEffect(() => {
    if (!active || !boardMode || !activeTarget || activeTarget.selectionKind === 'pod' || activeTarget.elementId.startsWith('pin-')) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'od:comment-active-target', elementId: activeTarget.elementId, selector: activeTarget.selector },
      '*',
    );
  }, [activeTarget?.elementId, activeTarget?.selector, activeTarget?.selectionKind, boardMode, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the composer, then leaves comment mode.
  useEffect(() => {
    if (!active || !boardMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isEditableKeyboardTarget(event.target)) return;
      if (activeTarget) clearComposer();
      else if (!commentPanelOpen) setBoardMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, boardMode, activeTarget, commentPanelOpen, clearComposer]);

  const openComment = useCallback(
    (comment: PreviewComment, snapshot?: PreviewCommentSnapshot | null) => {
      const fallback: PreviewCommentSnapshot = {
        filePath: comment.filePath,
        elementId: comment.elementId,
        selector: comment.selector,
        label: comment.label,
        text: comment.text,
        position: comment.position,
        htmlHint: comment.htmlHint,
        style: comment.style,
        selectionKind: comment.selectionKind ?? 'element',
        memberCount: comment.memberCount,
        podMembers: comment.podMembers,
        ...(typeof comment.slideIndex === 'number' ? { slideIndex: comment.slideIndex } : {}),
      };
      const resolved = snapshot ?? liveSnapshotForComment(comment, liveTargetsRef.current) ?? fallback;
      setBoardMode(true);
      setCommentCreateMode(true);
      setActiveTarget(resolved);
      setHoveredTarget(resolved);
      setActiveCommentId(comment.id);
      setCommentDraft(comment.note);
      setQueuedNotes([]);
      setBoardImages([]);
      setKeepAttachments(comment.attachments ?? []);
      if (effectiveDeck && typeof comment.slideIndex === 'number' && comment.slideIndex !== activeDeckSlideIndex) goToSlide(comment.slideIndex);
      // Scroll the element into view and re-measure it in the live document.
      if (!comment.elementId.startsWith('pin-') && !comment.elementId.startsWith('file-comment-') && comment.selectionKind !== 'pod') {
        requestSeq += 1;
        const requestId = `comment-locate-${requestSeq}`;
        locateRequestRef.current = { requestId, commentId: comment.id };
        window.setTimeout(() => {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'od:comment-active-target', elementId: comment.elementId, selector: comment.selector, locate: true, requestId },
            '*',
          );
        }, 0);
      }
    },
    [effectiveDeck, activeDeckSlideIndex, goToSlide],
  );

  const saveComment = async () => {
    if (!comments || !activeTarget) return;
    const note = [...queuedNotes, commentDraft.trim()].filter(Boolean).join('\n');
    if (!note && boardImages.length === 0 && keepAttachments.length === 0) return;
    setSendingComment(true);
    try {
      const isFreePin = activeTarget.elementId.startsWith('pin-');
      const target: PreviewCommentTarget = targetFromSnapshot(activeTarget);
      if (effectiveDeck && typeof target.slideIndex !== 'number' && slideState) target.slideIndex = slideState.active;
      const saved = await comments.save({ target, note, images: boardImages, existingId: activeComment?.id, keepAttachments });
      if (!saved) {
        toast.show(t('app.commentSaveFailed'), { tone: 'error', ttlMs: 5000 });
        return;
      }
      clearComposer();
      setBoardMode(true);
      setCommentCreateMode(true);
      toast.show(isFreePin ? t('chat.comments.pinSavedToast') : t('chat.comments.savedToast'), { tone: 'success' });
    } finally {
      setSendingComment(false);
    }
  };

  const savePanelComment = async (note: string): Promise<boolean> => {
    if (!comments) return false;
    setSendingComment(true);
    try {
      const idSeed = Date.now().toString(36);
      const target: PreviewCommentTarget = activeTarget
        ? targetFromSnapshot(activeTarget)
        : {
            filePath: file.name,
            elementId: `file-comment-${idSeed}-${Math.floor(Math.random() * 1e6).toString(36)}`,
            selector: 'html',
            label: file.name,
            text: '',
            position: { x: 0, y: 0, width: 0, height: 0 },
            htmlHint: '',
            selectionKind: 'element',
          };
      const saved = await comments.save({ target, note });
      if (!saved) {
        toast.show(t('app.commentSaveFailed'), { tone: 'error', ttlMs: 5000 });
        return false;
      }
      toast.show(t('chat.comments.savedToast'), { tone: 'success' });
      if (activeTarget) clearComposer();
      return true;
    } finally {
      setSendingComment(false);
    }
  };

  const selectedSideComments = sideComments.filter((comment) => selectedIds.has(comment.id));
  const resolveSelected = async () => {
    if (!comments || selectedSideComments.length === 0) return;
    setSendingComment(true);
    const ok = await comments.setStatus(
      selectedSideComments.map((comment) => comment.id),
      'resolved',
    );
    setSendingComment(false);
    if (ok) {
      setSelectedIds(new Set());
      toast.show(t('app.commentsResolved', { n: selectedSideComments.length }), { tone: 'success' });
    }
  };
  const copySelected = async () => {
    if (selectedSideComments.length === 0) return;
    const text = messageContentWithCommentAttachments(t('app.commentsCopyIntro', { file: file.name }), commentsToAttachments(selectedSideComments));
    await copyText(text);
    toast.show(t('app.commentsCopied', { n: selectedSideComments.length }), { tone: 'success' });
  };

  // ===========================================================================
  // Mark (标记): the vendored draw overlay dispatches ANNOTATION_EVENT.
  // ===========================================================================
  useEffect(() => {
    if (!active) return;
    const onAnnotation = (event: Event) => {
      const detail = (event as CustomEvent<AnnotationEventDetail>).detail;
      if (!detail || (detail.filePath && detail.filePath !== file.name)) return;
      void (async () => {
        try {
          if (detail.action === 'send') {
            if (!comments) throw new Error('comments unavailable');
            const bounds = detail.bounds ?? { x: 24, y: 24, width: 1, height: 1 };
            const images = [...(detail.file ? [detail.file] : []), ...(detail.extraFiles ?? [])];
            const target: PreviewCommentTarget = {
              filePath: file.name,
              elementId: `pin-mark-${Date.now().toString(36)}`,
              selector: 'html',
              label: '',
              text: '',
              position: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) },
              htmlHint: '',
              selectionKind: 'element',
              ...(effectiveDeck && slideState ? { slideIndex: slideState.active } : {}),
            };
            const saved = await comments.save({ target, note: detail.note || t('app.markDefaultNote'), images });
            if (!saved) throw new Error(t('app.commentSaveFailed'));
            toast.show(t('app.markSaved'), { tone: 'success' });
          } else if (detail.action === 'draft') {
            if (!detail.file) throw new Error(t('chat.annotationPreviewMissing'));
            const items: Record<string, Blob> = { 'image/png': detail.file };
            if (detail.note) items['text/plain'] = new Blob([detail.note], { type: 'text/plain' });
            try {
              await navigator.clipboard.write([new ClipboardItem(items)]);
              toast.show(t('app.markCopied'), { tone: 'success' });
            } catch {
              const result = await copyImageDataUrlToClipboard(await blobToDataUrl(detail.file));
              if (result !== 'copied') exportAsImage(await blobToDataUrl(detail.file), `${title}-mark`);
              toast.show(t(result === 'copied' ? 'app.markCopied' : 'app.screenshotDownloaded'), { tone: 'success' });
            }
          } else {
            if (!detail.file) throw new Error(t('chat.annotationPreviewMissing'));
            exportAsImage(await blobToDataUrl(detail.file), `${title}-mark`);
            toast.show(t('app.screenshotDownloaded'), { tone: 'success' });
          }
          detail.ack?.({ ok: true });
        } catch (err) {
          detail.ack?.({ ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      })();
    };
    window.addEventListener(ANNOTATION_EVENT, onAnnotation);
    return () => window.removeEventListener(ANNOTATION_EVENT, onAnnotation);
  }, [active, comments, file.name, effectiveDeck, slideState, title, toast, t]);

  // ===========================================================================
  // Edit (编辑)
  // ===========================================================================
  const manualEdit = useManualEdit({
    enabled: manualEditMode,
    active,
    iframeRef,
    fileName: file.name,
    source: raw,
    readFresh: () => source.readText(file.name, { fresh: true }),
    writeSource: async (text) => {
      if (!source.writeFile) throw new Error(t('app.readOnlySource'));
      await source.writeFile(file.name, text);
    },
    saveImage: async (picked) => {
      if (!source.writeFile) throw new Error(t('app.readOnlySource'));
      const dir = baseDirFor(file.name);
      const stamp = Date.now().toString(36);
      const name = `${stamp}-${picked.name.replace(/[^\w.-]+/g, '-')}`;
      await source.writeFile(`${dir}${name}`, picked);
      return name;
    },
    onSourceChange: (text, live) => {
      setRaw(text);
      if (live) {
        liveSourceRef.current = text;
        return;
      }
      liveSourceRef.current = null;
      void captureScroll().then(() => rebuildFrom(text));
    },
    scale: overlayScale,
    canvasSize: bodySize ? { width: bodySize.width, height: bodySize.height } : null,
    t,
  });
  const manualEditRef = useRef(manualEdit);
  manualEditRef.current = manualEdit;
  useEffect(() => {
    manualEditRef.current.syncFrame();
  }, [frameLoads, srcDoc]);

  const leaveManualEdit = useCallback(async (): Promise<boolean> => {
    if (!manualEditMode) return true;
    const ok = await manualEditRef.current.exit();
    if (!ok) return false;
    setManualEditMode(false);
    return true;
  }, [manualEditMode]);
  useEffect(() => {
    if (!active && manualEditMode) void leaveManualEdit();
  }, [active, manualEditMode, leaveManualEdit]);

  // --- tool switches (upstream activate*Tool) --------------------------------------
  const withEditExited = (fn: () => void) => {
    if (manualEditMode) {
      void leaveManualEdit().then((ok) => ok && fn());
      return;
    }
    fn();
  };

  const activateCommentTool = () => {
    if (!reviewAvailable) return;
    if (boardMode && !commentCreateMode) {
      setBoardMode(false);
      clearComposer();
      return;
    }
    withEditExited(() => {
      setCommentPanelOpen(false);
      setCommentCreateMode(false);
      clearComposer();
      setDrawOverlayOpen(false);
      setMode('preview');
      setBoardMode(true);
    });
  };

  const activateCommentCreateTool = () => {
    if (!reviewAvailable) return;
    if (boardMode && commentCreateMode && commentPanelOpen) {
      setBoardMode(false);
      setCommentCreateMode(false);
      setCommentPanelOpen(false);
      clearComposer();
      return;
    }
    withEditExited(() => {
      setCommentPanelOpen(true);
      setCommentPanelCollapsed(false);
      if (!activeTarget) clearComposer();
      setDrawOverlayOpen(false);
      setMode('preview');
      setBoardMode(true);
      setCommentCreateMode(true);
    });
  };

  const activateDrawTool = () => {
    if (!reviewAvailable) return;
    if (drawOverlayOpen) {
      setDrawOverlayOpen(false);
      return;
    }
    withEditExited(() => {
      setCommentPanelOpen(false);
      setCommentCreateMode(false);
      setBoardMode(false);
      clearComposer();
      setMode('preview');
      setDrawOverlayOpen(true);
    });
  };

  const activateManualEditTool = () => {
    if (!writable) return;
    if (manualEditMode) {
      void leaveManualEdit();
      return;
    }
    setCommentPanelOpen(false);
    setCommentCreateMode(false);
    setBoardMode(false);
    clearComposer();
    setDrawOverlayOpen(false);
    setMode('preview');
    setManualEditFrozenWidth(bodySize?.width ?? null);
    setManualEditMode(true);
  };

  const dismissCommentPanel = () => {
    setCommentPanelOpen(false);
    if (activeTarget) return;
    setCommentCreateMode(false);
    setBoardMode(false);
    clearComposer();
  };

  const commentToolActive = boardMode && !commentCreateMode;
  const commentsToolActive = boardMode && commentCreateMode;

  // --- menus ----------------------------------------------------------------------
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [presentMenuOpen, setPresentMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const zoomTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const presentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);

  const reload = () => {
    setRedirectBlockedSeq(null);
    setReloadKey((key) => key + 1);
  };

  const startPresent = (kind: 'tab' | 'fullscreen') => {
    setPresentMenuOpen(false);
    withEditExited(() => {
      setMode('preview');
      setEscHint(true);
      setPresenting(kind);
    });
  };
  const presentNewTab = () => {
    setPresentMenuOpen(false);
    if (!prepared) return;
    openSandboxedPreviewInNewTab(prepared.html, title, {
      deck: effectiveDeck,
      baseHref: prepared.baseHref,
      initialSlideIndex: slideStateCache.get(stateKey)?.active ?? 0,
      deckClickNavigation: effectiveDeck,
      previewFocusGuard: true,
    });
  };

  const runExport = async (format: 'pdf' | 'image' | 'zip' | 'html') => {
    setExportMenuOpen(false);
    if (raw === null) return;
    const pending = toast.show(t('app.exporting'), { tone: 'loading' });
    try {
      const html = await selfContainedHtml(source, file.name, raw);
      if (format === 'html') exportAsHtml(html, title);
      else if (format === 'zip') await exportAsZip(html, title);
      else if (format === 'pdf') await exportAsPdf(html, title, { deck: effectiveDeck });
      else {
        const snapshot = await exportArtifactImageDataUrl(html, { deck: effectiveDeck });
        exportAsImage(snapshot.dataUrl, title);
      }
      toast.dismiss(pending);
      toast.show(t('app.exportDone', { name: `${title}.${format === 'image' ? 'png' : format}` }), { tone: 'success' });
    } catch (error) {
      toast.dismiss(pending);
      const message = error instanceof Error ? error.message : String(error);
      toast.show(t('app.exportFailed', { message }), { tone: 'error', ttlMs: 6000 });
    }
  };

  const copyScreenshot = async () => {
    const frame = iframeRef.current;
    if (!frame) return;
    const snapshot = await requestPreviewSnapshot(frame);
    if (!snapshot) {
      toast.show(t('common.exportImageFailed'), { tone: 'error', ttlMs: 5000 });
      return;
    }
    const result = await copyImageDataUrlToClipboard(snapshot.dataUrl);
    if (result === 'copied') {
      toast.show(t('app.screenshotCopied'), { tone: 'success' });
    } else {
      exportAsImage(snapshot.dataUrl, `${title}-screenshot`);
      toast.show(t('app.screenshotDownloaded'), { tone: 'success' });
    }
  };

  const hasContent = prepared !== null;
  const initialLoading = !hasContent && !loadError;
  const readOnlyTitle = t(viewerOnly ? 'fileViewer.saveDisabled' : 'app.readOnlySource');

  // --- header actions (portaled into the tab strip, like upstream) -----------
  const headerActions: ReactNode = (
    <>
      <div className="present-wrap chrome-present-wrap">
        <button
          ref={presentTriggerRef}
          type="button"
          className="chrome-action chrome-action-secondary chrome-action-icon present-trigger od-tooltip"
          aria-haspopup="menu"
          aria-expanded={presentMenuOpen}
          aria-label={t('fileViewer.present')}
          data-tooltip={t('fileViewer.present')}
          data-tooltip-placement="bottom"
          title={t('fileViewer.present')}
          data-testid="present-trigger"
          disabled={!hasContent}
          onClick={() => setPresentMenuOpen((v) => !v)}
        >
          <RemixIcon name="slideshow-3-line" size={15} />
        </button>
        <AnchoredPopover anchor={presentTriggerRef} open={presentMenuOpen} onClose={() => setPresentMenuOpen(false)} className="present-menu odp-floating-menu">
          <button role="menuitem" data-testid="present-in-tab" onClick={() => startPresent('tab')}>
            <span className="present-icon">
              <RemixIcon name="eye-line" size={14} />
            </span>{' '}
            <span className="present-menu-copy">
              <span>{t('fileViewer.presentInTab')}</span>
              {effectiveDeck ? <small>{t('fileViewer.presentInTabDeckHint')}</small> : null}
            </span>
          </button>
          <button role="menuitem" data-testid="present-fullscreen" onClick={() => startPresent('fullscreen')}>
            <span className="present-icon">
              <RemixIcon name="play-line" size={14} />
            </span>{' '}
            {t('fileViewer.presentFullscreen')}
          </button>
          <button role="menuitem" data-testid="present-new-tab" onClick={presentNewTab}>
            <span className="present-icon">
              <RemixIcon name="share-forward-line" size={14} />
            </span>{' '}
            {t('fileViewer.presentNewTab')}
          </button>
        </AnchoredPopover>
      </div>
      <div className="chrome-file-action-menus">
        <div className="share-menu chrome-share-menu chrome-share-menu--unified">
          <button
            ref={exportTriggerRef}
            type="button"
            className="chrome-action chrome-action-secondary chrome-action-with-label chrome-action-text-only chrome-action-unified"
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            aria-label={t('fileViewer.unifiedExportTab')}
            data-testid="export-trigger"
            disabled={!hasContent}
            onClick={() => setExportMenuOpen((v) => !v)}
          >
            <RemixIcon name="download-line" size={15} />
            <span>{t('fileViewer.unifiedExportTab')}</span>
          </button>
          <AnchoredPopover
            anchor={exportTriggerRef}
            open={exportMenuOpen}
            onClose={() => setExportMenuOpen(false)}
            className="share-menu-popover chrome-unified-popover odp-floating-menu"
          >
            <div className="chrome-unified-panel">
              <button type="button" className="share-menu-item" role="menuitem" onClick={() => void runExport('pdf')}>
                <span className="share-menu-icon">
                  <RemixIcon name="file-line" size={15} />
                </span>
                <span>{t('fileViewer.exportPdf')}</span>
              </button>
              <button type="button" className="share-menu-item" role="menuitem" onClick={() => void runExport('image')}>
                <span className="share-menu-icon">
                  <RemixIcon name="image-line" size={15} />
                </span>
                <span>{t('fileViewer.exportImage')}</span>
              </button>
              <button type="button" className="share-menu-item" role="menuitem" onClick={() => void runExport('zip')}>
                <span className="share-menu-icon">
                  <RemixIcon name="file-zip-line" size={15} />
                </span>
                <span>{t('fileViewer.exportZip')}</span>
              </button>
              <button type="button" className="share-menu-item" role="menuitem" onClick={() => void runExport('html')}>
                <span className="share-menu-icon">
                  <RemixIcon name="file-code-line" size={15} />
                </span>
                <span>{t('fileViewer.exportHtml')}</span>
              </button>
              <a
                className="share-menu-item"
                role="menuitem"
                href={source.fileUrl(file.name, file.mtime)}
                download={baseName(file.name)}
                onClick={() => setExportMenuOpen(false)}
              >
                <span className="share-menu-icon">
                  <RemixIcon name="download-line" size={15} />
                </span>
                <span>{t('app.downloadOriginal')}</span>
              </a>
              <button
                type="button"
                className="share-menu-item"
                role="menuitem"
                disabled={raw === null}
                onClick={() => {
                  setExportMenuOpen(false);
                  if (raw !== null) void copyText(raw).then(() => toast.show(t('fileViewer.copied'), { tone: 'success' }));
                }}
              >
                <span className="share-menu-icon">
                  <RemixIcon name="file-copy-line" size={15} />
                </span>
                <span>{t('app.copySource')}</span>
              </button>
            </div>
          </AnchoredPopover>
        </div>
      </div>
    </>
  );

  const speakerNotesPanel =
    effectiveDeck && mode === 'preview' && hasSpeakerNotes && notesOpen && !manualEditMode ? (
      <section className="speaker-notes-panel" data-testid="speaker-notes-panel" aria-label={t('fileViewer.speakerNotes')}>
        <div className="speaker-notes-panel-head">
          <div className="speaker-notes-panel-title">
            <span>{t('fileViewer.speakerNotes')}</span>
            <span className="speaker-notes-panel-meta">
              {t('fileViewer.speakerNotesSlide', { current: activeDeckSlideIndex + 1, total: Math.max(deckSlideCount, speakerNotes.length, 1) })}
            </span>
          </div>
          <button
            type="button"
            className="icon-only od-tooltip"
            aria-label={t('app.speakerNotesHide')}
            title={t('app.speakerNotesHide')}
            data-tooltip={t('app.speakerNotesHide')}
            data-tooltip-placement="top"
            onClick={() => setNotesOpen(false)}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="speaker-notes-preview" role="textbox" tabIndex={0} aria-readonly="true">
          {activeSpeakerNote.trim() ? activeSpeakerNote : <span className="speaker-notes-empty">{t('fileViewer.speakerNotesEmpty')}</span>}
        </div>
      </section>
    ) : null;

  const showPreviewToolbarControls = mode === 'preview';

  // --- composer (portaled into the preview layout like upstream) -------------------
  const composerMetrics = (() => {
    const canvas = canvasEl;
    if (!layoutEl || !canvas) return null;
    const hostRect = layoutEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0) return null;
    return {
      bounds: { width: hostRect.width, height: hostRect.height, scrollLeft: layoutEl.scrollLeft, scrollTop: layoutEl.scrollTop },
      offset: { x: canvasRect.left - hostRect.left + layoutEl.scrollLeft, y: canvasRect.top - hostRect.top + layoutEl.scrollTop },
    };
  })();
  const composer =
    active && boardMode && activeTarget && composerMetrics && layoutEl
      ? createPortal(
          <BoardComposerPopover
            target={activeTarget}
            existing={activeComment}
            draft={commentDraft}
            notes={queuedNotes}
            onDraft={setCommentDraft}
            onAddDraft={() => {
              const note = commentDraft.trim();
              if (!note) return;
              setQueuedNotes((current) => [...current, note]);
              setCommentDraft('');
            }}
            onRemoveQueuedNote={(index) => setQueuedNotes((current) => current.filter((_, i) => i !== index))}
            onClose={clearComposer}
            onSaveComment={() => saveComment()}
            onSendBatch={() => saveComment()}
            onRemoveMember={() => clearComposer()}
            onViewAllComments={() => {
              setCommentPanelOpen(true);
              setCommentPanelCollapsed(false);
            }}
            onDeleteComment={async (commentId) => {
              if (!comments) return;
              const removed = await comments.remove(commentId);
              if (!removed) return;
              clearComposer();
              setSelectedIds((current) => {
                if (!current.has(commentId)) return current;
                const next = new Set(current);
                next.delete(commentId);
                return next;
              });
            }}
            images={boardImagePreviews}
            existingImages={keepAttachments.map((attachment) => ({ url: comments?.attachmentUrl(attachment) ?? '', name: attachment.name }))}
            onAttachImages={(files) => {
              const images = files.filter((item) => item.type.startsWith('image/'));
              if (images.length) setBoardImages((current) => [...current, ...images]);
            }}
            onRemoveImage={(index) => setBoardImages((current) => current.filter((_, i) => i !== index))}
            onPreviewImage={(index) => {
              const preview = boardImagePreviews[index];
              if (preview) window.open(preview.url, '_blank', 'noopener');
            }}
            sending={sendingComment}
            allowSendToChat={false}
            canSendToAgent={false}
            t={t}
            scale={overlayScale}
            offset={composerMetrics.offset}
            bounds={composerMetrics.bounds}
            docked={false}
            commenting
          />,
          layoutEl,
        )
      : null;

  const commentPanel =
    active && commentPanelOpen && reviewAvailable && comments ? (
      <CommentSidePanel
        comments={sideComments}
        resolvedComments={resolvedComments}
        pinNumbers={pinNumbers}
        loadState={comments.loadState}
        onRetry={() => void comments.refresh()}
        selectedIds={selectedIds}
        activeCommentId={activeCommentId}
        collapsed={commentPanelCollapsed}
        onCollapsedChange={setCommentPanelCollapsed}
        onDismiss={dismissCommentPanel}
        onToggleSelect={(id) =>
          setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onSelectAll={() => setSelectedIds(new Set(sideComments.map((comment) => comment.id)))}
        onClearSelection={() => setSelectedIds(new Set())}
        onReorder={(orderedIds, draggedId) => void comments.reorder(draggedId, computeReorderedSortKey(sideComments, orderedIds, draggedId))}
        onReply={(comment) => openComment(comment)}
        onCreateComment={savePanelComment}
        onResolveSelected={() => void resolveSelected()}
        onReopen={(comment) => void comments.setStatus([comment.id], 'open')}
        onCopySelected={() => void copySelected()}
        attachmentUrl={comments.attachmentUrl}
        deckSlideCount={effectiveDeck ? slideState?.count : undefined}
        sending={sendingComment}
        t={t}
      />
    ) : null;

  const reviewToolButtons = reviewAvailable ? (
    <>
      <div className="artifact-tool-menu-anchor">
        <button
          type="button"
          className={`viewer-action viewer-action-icon viewer-comment-toggle od-tooltip${commentToolActive ? ' active' : ''}`}
          data-testid="board-mode-toggle"
          data-tooltip={t('fileViewer.comment')}
          data-tooltip-placement="bottom"
          title={t('fileViewer.comment')}
          aria-label={t('fileViewer.comment')}
          aria-pressed={commentToolActive}
          disabled={!hasContent}
          onClick={activateCommentTool}
        >
          <RemixIcon name="chat-new-line" size={15} />
        </button>
      </div>
      <button
        className={`viewer-action viewer-action-icon od-tooltip${drawOverlayOpen ? ' active' : ''}`}
        type="button"
        data-testid="draw-overlay-toggle"
        data-tooltip={t('fileViewer.mark')}
        data-tooltip-placement="bottom"
        title={t('fileViewer.mark')}
        aria-label={t('fileViewer.mark')}
        aria-pressed={drawOverlayOpen}
        disabled={!hasContent}
        onClick={activateDrawTool}
      >
        <RemixIcon name="mark-pen-line" size={15} />
      </button>
      <span className="viewer-toolbar-tool-divider" aria-hidden />
      <button
        className={`viewer-action viewer-action-icon od-tooltip${manualEditMode ? ' active' : ''}`}
        type="button"
        data-testid="manual-edit-mode-toggle"
        data-tooltip={writable ? t('fileViewer.edit') : readOnlyTitle}
        data-tooltip-placement="bottom"
        disabled={!writable || !hasContent}
        title={writable ? t('fileViewer.edit') : readOnlyTitle}
        aria-label={t('fileViewer.edit')}
        aria-pressed={manualEditMode}
        onClick={activateManualEditTool}
      >
        <RemixIcon name="edit-line" size={15} />
      </button>
      <span className="viewer-toolbar-tool-divider" aria-hidden />
      <button
        type="button"
        className={`viewer-action viewer-comment-count-trigger viewer-comment-toggle od-tooltip${commentsToolActive ? ' active' : ''}`}
        data-testid="comment-panel-toggle"
        data-tooltip={t('chat.tabComments')}
        data-tooltip-placement="bottom"
        title={t('chat.tabComments')}
        aria-label={`${t('chat.tabComments')} (${sideComments.length})`}
        aria-pressed={commentsToolActive}
        disabled={!hasContent}
        onClick={activateCommentCreateTool}
      >
        <RemixIcon name="message-3-line" size={15} />
        <span className="viewer-comment-count" aria-hidden data-testid="comment-count">
          {sideComments.length}
        </span>
      </button>
    </>
  ) : null;

  const layoutClass = manualEditMode
    ? 'manual-edit-workspace'
    : [
        'comment-preview-layer',
        showDeckThumbnailRail ? 'comment-preview-layer-with-deck-rail' : '',
        showDeckThumbnailRail && railCollapsed ? 'comment-preview-layer-deck-rail-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ');

  return (
    <div className={`viewer html-viewer${presenting ? ' is-tab-present' : ''}${viewerOnly ? ' html-viewer--viewer-only' : ''}`}>
      <div className="viewer-toolbar" style={active ? undefined : { visibility: 'hidden' }}>
        <div className="viewer-toolbar-left">
          {showDeckThumbnailRail ? (
            <button
              type="button"
              className="icon-only deck-thumbnail-toolbar-toggle od-tooltip"
              aria-expanded={!railCollapsed}
              aria-label={railCollapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')}
              title={railCollapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')}
              data-tooltip={railCollapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')}
              data-tooltip-placement="bottom"
              data-testid="deck-rail-toggle"
              onClick={() => setRailCollapsed((value) => !value)}
            >
              <Icon name="panel-left" size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-only od-tooltip"
            onClick={reload}
            title={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip-placement="bottom"
            aria-label={`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`}
            data-testid="reload-preview"
          >
            <Icon name="reload" size={14} />
          </button>
          <div className="viewer-tabs viewer-mode-tabs" role="tablist" aria-label="View mode">
            {(
              [
                ['preview', t('fileViewer.preview'), 'eye-line'],
                ['source', t('fileViewer.source'), 'code-s-slash-line'],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={`viewer-tab od-tooltip ${mode === id ? 'active' : ''}`}
                aria-label={label}
                aria-selected={mode === id}
                disabled={viewerOnly && id === 'source'}
                title={label}
                data-tooltip={label}
                data-tooltip-placement="bottom"
                data-testid={`mode-${id}`}
                onClick={() => {
                  if (id === 'source') withEditExited(() => setMode('source'));
                  else setMode(id);
                }}
              >
                <RemixIcon name={icon} size={14} className="viewer-tab-icon" />
                <span className="viewer-tab-label">{label}</span>
              </button>
            ))}
          </div>
          {showPreviewToolbarControls ? (
            <span className="viewer-preview-toolbar-inline">
              <PreviewViewportControls viewport={viewport} onViewport={setViewport} t={t} />
            </span>
          ) : null}
          {showPreviewToolbarControls && showDeckNavigation && !showDeckFloatingNav ? (
            <span className="deck-nav viewer-deck-nav-inline" role="group" aria-label={t('fileViewer.slideNavAria')}>
              <button
                type="button"
                className="icon-only od-tooltip"
                onClick={() => postSlide('prev')}
                title={t('fileViewer.previousSlide')}
                data-tooltip={t('fileViewer.previousSlide')}
                data-tooltip-placement="bottom"
                aria-label={t('fileViewer.previousSlide')}
                disabled={slideState !== null && slideState.active <= 0}
              >
                <Icon name="chevron-right" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <span className="deck-nav-counter">{slideState ? `${slideState.active + 1} / ${slideState.count}` : '— / —'}</span>
              <button
                type="button"
                className="icon-only od-tooltip"
                onClick={() => postSlide('next')}
                title={t('fileViewer.nextSlide')}
                data-tooltip={t('fileViewer.nextSlide')}
                data-tooltip-placement="bottom"
                aria-label={t('fileViewer.nextSlide')}
                disabled={slideState !== null && slideState.active >= slideState.count - 1}
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </span>
          ) : null}
        </div>
        <div className="viewer-toolbar-actions">
          {showPreviewToolbarControls ? (
            <div className="viewer-toolbar-inline-actions">
              {effectiveDeck && hasSpeakerNotes && !notesOpen && !manualEditMode ? (
                <button
                  type="button"
                  className="viewer-action viewer-action-icon od-tooltip"
                  data-tooltip={t('app.speakerNotesShow')}
                  data-tooltip-placement="bottom"
                  title={t('app.speakerNotesShow')}
                  aria-label={t('app.speakerNotesShow')}
                  onClick={() => setNotesOpen(true)}
                >
                  <RemixIcon name="file-text-line" size={15} />
                </button>
              ) : null}
              <button
                type="button"
                className="viewer-action viewer-action-icon od-tooltip"
                data-testid="copy-screenshot-button"
                data-tooltip={t('app.copyScreenshot')}
                data-tooltip-placement="bottom"
                title={t('app.copyScreenshot')}
                aria-label={t('app.copyScreenshot')}
                disabled={!hasContent}
                onClick={() => void copyScreenshot()}
              >
                <RemixIcon name="camera-line" size={15} />
              </button>
              {reviewToolButtons}
              {hasContent ? (
                <div className="zoom-menu viewer-toolbar-zoom">
                  <button
                    ref={zoomTriggerRef}
                    type="button"
                    className="viewer-action zoom-trigger od-tooltip"
                    aria-haspopup="menu"
                    aria-expanded={zoomMenuOpen}
                    title={t('fileViewer.resetZoom')}
                    data-tooltip={t('fileViewer.resetZoom')}
                    data-tooltip-placement="bottom"
                    data-testid="zoom-trigger"
                    onClick={() => setZoomMenuOpen((v) => !v)}
                  >
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{zoomPercentLabel(previewZoomPercent)}</span>
                  </button>
                  <AnchoredPopover anchor={zoomTriggerRef} open={zoomMenuOpen} onClose={() => setZoomMenuOpen(false)} className="zoom-menu-popover odp-floating-menu">
                    <button
                      type="button"
                      className={`zoom-menu-item${zoomPref.mode === 'auto' ? ' active' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        setZoomPref({ mode: 'auto', zoom: 100 });
                        setZoomMenuOpen(false);
                      }}
                    >
                      <span>{t('app.zoomFit')}</span>
                      {zoomPref.mode === 'auto' ? <Icon name="check" size={13} /> : null}
                    </button>
                    {ZOOM_LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`zoom-menu-item${zoomLevelActive(level) ? ' active' : ''}`}
                        role="menuitem"
                        onClick={() => {
                          setManualZoom(level);
                          setZoomMenuOpen(false);
                        }}
                      >
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{level}%</span>
                        {zoomLevelActive(level) ? <Icon name="check" size={13} /> : null}
                      </button>
                    ))}
                  </AnchoredPopover>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="viewer-toolbar-more">
            <button
              ref={moreTriggerRef}
              type="button"
              className="viewer-action viewer-action-icon od-tooltip"
              aria-label={t('nextStep.more')}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              data-tooltip={t('nextStep.more')}
              data-tooltip-placement="bottom"
              title={t('nextStep.more')}
              data-testid="toolbar-more"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <RemixIcon name="more-2-line" size={16} />
            </button>
            <AnchoredPopover anchor={moreTriggerRef} open={moreOpen} onClose={() => setMoreOpen(false)} className="viewer-toolbar-more-menu odp-floating-menu">
              {PREVIEW_VIEWPORT_PRESETS.map((preset) => {
                const selected = viewport === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`viewer-toolbar-more-item${selected ? ' active' : ''}`}
                    role="menuitem"
                    title={t(preset.titleKey)}
                    onClick={() => {
                      setMode('preview');
                      setViewport(preset.id);
                      setMoreOpen(false);
                    }}
                  >
                    <RemixIcon name={previewViewportIcon(preset.id)} size={15} />
                    <span>{t(preset.labelKey)}</span>
                    {selected ? <Icon name="check" size={13} /> : null}
                  </button>
                );
              })}
              {showDeckNavigation ? (
                <>
                  <div className="viewer-toolbar-more-separator" role="separator" />
                  <button
                    type="button"
                    className="viewer-toolbar-more-item"
                    role="menuitem"
                    disabled={slideState !== null && slideState.active <= 0}
                    onClick={() => {
                      postSlide('prev');
                      setMoreOpen(false);
                    }}
                  >
                    <Icon name="chevron-right" size={14} style={{ transform: 'rotate(180deg)' }} />
                    <span>{t('fileViewer.previousSlide')}</span>
                  </button>
                  <button
                    type="button"
                    className="viewer-toolbar-more-item"
                    role="menuitem"
                    disabled={slideState !== null && slideState.active >= slideState.count - 1}
                    onClick={() => {
                      postSlide('next');
                      setMoreOpen(false);
                    }}
                  >
                    <Icon name="chevron-right" size={14} />
                    <span>{t('fileViewer.nextSlide')}</span>
                  </button>
                </>
              ) : null}
              {reviewAvailable && hasContent ? (
                <>
                  <div className="viewer-toolbar-more-separator" role="separator" />
                  <button
                    type="button"
                    className={`viewer-toolbar-more-item${commentToolActive ? ' active' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      activateCommentTool();
                      setMoreOpen(false);
                    }}
                  >
                    <RemixIcon name="chat-new-line" size={15} />
                    <span>{t('fileViewer.comment')}</span>
                  </button>
                  <button
                    type="button"
                    className={`viewer-toolbar-more-item${drawOverlayOpen ? ' active' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      activateDrawTool();
                      setMoreOpen(false);
                    }}
                  >
                    <RemixIcon name="mark-pen-line" size={15} />
                    <span>{t('fileViewer.mark')}</span>
                  </button>
                  <button
                    type="button"
                    className={`viewer-toolbar-more-item${manualEditMode ? ' active' : ''}`}
                    role="menuitem"
                    disabled={!writable}
                    onClick={() => {
                      activateManualEditTool();
                      setMoreOpen(false);
                    }}
                  >
                    <RemixIcon name="edit-line" size={15} />
                    <span>{t('fileViewer.edit')}</span>
                  </button>
                  <button
                    type="button"
                    className={`viewer-toolbar-more-item${commentsToolActive ? ' active' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      activateCommentCreateTool();
                      setMoreOpen(false);
                    }}
                  >
                    <RemixIcon name="message-3-line" size={15} />
                    <span>
                      {t('chat.tabComments')} ({sideComments.length})
                    </span>
                  </button>
                </>
              ) : null}
              <div className="viewer-toolbar-more-separator" role="separator" />
              <button type="button" className="viewer-toolbar-more-item" role="menuitem" disabled={!hasContent} onClick={presentNewTab}>
                <RemixIcon name="external-link-line" size={15} />
                <span>{t('common.openInNewTab')}</span>
              </button>
              <button
                type="button"
                className="viewer-toolbar-more-item"
                role="menuitem"
                disabled={raw === null}
                onClick={() => {
                  setMoreOpen(false);
                  if (raw !== null) void copyText(raw).then(() => toast.show(t('fileViewer.copied'), { tone: 'success' }));
                }}
              >
                <RemixIcon name="file-copy-line" size={15} />
                <span>{t('app.copySource')}</span>
              </button>
              {mode === 'preview' && hasContent ? (
                <>
                  <div className="viewer-toolbar-more-separator" role="separator" />
                  {ZOOM_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={`viewer-toolbar-more-item${zoomLevelActive(level) ? ' active' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        setManualZoom(level);
                        setMoreOpen(false);
                      }}
                    >
                      <RemixIcon name="zoom-in-line" size={15} />
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{level}%</span>
                      {zoomLevelActive(level) ? <Icon name="check" size={13} /> : null}
                    </button>
                  ))}
                </>
              ) : null}
            </AnchoredPopover>
          </div>
          {viewerOnly || !actionsHost ? <div className="odp-inline-file-actions">{headerActions}</div> : null}
        </div>
      </div>
      {!viewerOnly && actionsHost && active
        ? createPortal(
            <div data-od-file-actions-owner={file.name} style={{ display: 'contents' }}>
              {headerActions}
            </div>,
            actionsHost,
          )
        : null}
      <div className="viewer-body" ref={bodyRef}>
        {loadError && !hasContent ? (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        ) : initialLoading ? (
          <FileViewerLoadingSkeleton />
        ) : (
          <>
            <div
              hidden={mode !== 'preview'}
              aria-hidden={mode !== 'preview' ? true : undefined}
              ref={setLayoutEl}
              className={`${layoutClass} preview-viewport preview-viewport-${viewport}${drawOverlayOpen ? ' preview-draw-active' : ''}`}
              data-testid={manualEditMode ? 'manual-edit-workspace' : 'comment-preview-layout'}
              style={{
                ...previewViewportStyle(viewport, previewScale, bodySize),
                ...(mode !== 'preview' ? { display: 'none' } : {}),
              }}
              onMouseLeave={manualEditMode ? manualEdit.clearHover : undefined}
            >
              {manualEdit.panel}
              {manualEdit.hoverAffordance}
              {showDeckThumbnailRail && !railCollapsed ? (
                <DeckThumbnailRail
                  count={deckSlideTotal}
                  activeIndex={activeDeckSlideIndex}
                  labelTotal={deckNavTotal}
                  buildThumbSrcDoc={buildThumbSrcDoc}
                  parsedDeck={parsedDeck}
                  previewViewport={thumbViewport}
                  onSelect={handleThumbnailSelect}
                />
              ) : null}
              <div
                className={manualEditMode ? 'manual-edit-canvas' : 'comment-preview-canvas'}
                data-testid={manualEditMode ? 'manual-edit-canvas' : 'comment-preview-canvas'}
                ref={setCanvasNode}
              >
                <div className={manualEditMode ? undefined : 'comment-frame-clip'} style={manualEditMode ? { height: '100%' } : undefined}>
                  <div style={manualEditMode ? manualEditShellStyle(viewport, previewScale, manualEditFrozenWidth) : previewScaleShellStyle(viewport, previewScale)}>
                    <TranslationScope remap={MARK_TOOL_REMAP}>
                      <PreviewDrawOverlay
                        active={drawOverlayOpen && active}
                        onActiveChange={setDrawOverlayOpen}
                        captureViewport
                        captureTarget={null}
                        filePath={file.name}
                        toolbarHost={manualEditMode ? null : layoutEl}
                      >
                        <div className="artifact-preview-transport-stack">
                          <iframe
                            ref={iframeRef}
                            data-testid="artifact-preview-frame"
                            data-od-render-mode="srcdoc"
                            data-od-active="true"
                            title={file.name}
                            sandbox={HTML_PREVIEW_SANDBOX}
                            srcDoc={srcDoc}
                            tabIndex={active && mode === 'preview' ? 0 : -1}
                            onLoad={() => setFrameLoads((n) => n + 1)}
                          />
                        </div>
                      </PreviewDrawOverlay>
                    </TranslationScope>
                  </div>
                </div>
                {boardMode && !manualEditMode ? (
                  <CommentPreviewOverlays
                    comments={commentCreateMode ? creationSorted : []}
                    pinNumbers={pinNumbers}
                    provisionalPinNumber={provisionalPin}
                    liveTargets={liveTargets}
                    hoveredTarget={hoveredTarget}
                    activeTarget={activeTarget}
                    activeExistingCommentId={activeComment?.id ?? null}
                    showActivePin={commentCreateMode}
                    scale={overlayScale}
                    activeSlideIndex={effectiveDeck ? slideState?.active ?? null : null}
                    onOpenComment={openComment}
                    t={t}
                  />
                ) : null}
                {showDeckFloatingNav ? (
                  <div
                    className={`deck-floating-nav${navRevealed ? ' is-revealed' : ''}`}
                    aria-label="Deck navigation"
                    data-testid="deck-floating-nav"
                    onPointerEnter={() => {
                      navHoverRef.current = true;
                      setNavRevealed(true);
                    }}
                    onPointerLeave={() => {
                      navHoverRef.current = false;
                      revealNav(800);
                    }}
                    onFocus={() => setNavRevealed(true)}
                  >
                    <button
                      type="button"
                      className="deck-floating-button od-tooltip"
                      aria-label={t('fileViewer.previousSlide')}
                      title={t('fileViewer.previousSlide')}
                      data-tooltip={t('fileViewer.previousSlide')}
                      data-tooltip-placement="top"
                      disabled={activeDeckSlideIndex <= 0}
                      data-testid="deck-prev"
                      onClick={() => postSlide('prev')}
                    >
                      <Icon name="chevron-left" size={14} />
                    </button>
                    <span className="deck-floating-count" aria-live="polite" data-testid="deck-count">
                      <strong>{activeDeckSlideIndex + 1}</strong>
                      <span>/</span>
                      <span>{deckNavTotal}</span>
                    </span>
                    <button
                      type="button"
                      className="deck-floating-button od-tooltip"
                      aria-label={t('fileViewer.nextSlide')}
                      title={t('fileViewer.nextSlide')}
                      data-tooltip={t('fileViewer.nextSlide')}
                      data-tooltip-placement="top"
                      disabled={activeDeckSlideIndex >= deckNavTotal - 1}
                      data-testid="deck-next"
                      onClick={() => postSlide('next')}
                    >
                      <Icon name="chevron-right" size={14} />
                    </button>
                    <span className="deck-floating-divider" aria-hidden="true" />
                    <button type="button" className="deck-floating-reset" onClick={() => goToSlide(0)} disabled={activeDeckSlideIndex <= 0}>
                      {t('fileViewer.presenterReset')}
                      <kbd>R</kbd>
                    </button>
                  </div>
                ) : null}
                {active && boardMode && !commentCreateMode && hoveredTarget && !activeTarget ? (
                  <AnnotationHoverPopover
                    target={hoveredTarget}
                    scale={overlayScale}
                    bounds={canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined}
                    offset={{ x: 0, y: 0 }}
                    onMouseEnter={() => {
                      hoverCardPinnedRef.current = true;
                      cancelHoverDismiss();
                    }}
                    onMouseLeave={() => {
                      hoverCardPinnedRef.current = false;
                      scheduleHoverDismiss();
                    }}
                  />
                ) : null}
                {redirectBlocked ? (
                  <div className="odp-preview-notice" role="status">
                    {t('app.redirectLoop')}
                  </div>
                ) : null}
              </div>
            </div>
            {composer}
            {mode !== 'preview' ? (
              raw === null ? (
                <div className="viewer-empty">{t('fileViewer.loading')}</div>
              ) : (
                <pre className="viewer-source" data-testid="viewer-source">
                  {raw}
                </pre>
              )
            ) : null}
          </>
        )}
      </div>
      {speakerNotesPanel}
      {commentPanel ? (commentHost ? createPortal(commentPanel, commentHost) : <div className="odp-comment-panel-inline">{commentPanel}</div>) : null}
      {active && presenting && prepared
        ? createPortal(
            <div ref={presentOverlayRef} className="present-overlay" role="dialog" aria-label={t('fileViewer.present')} data-testid="present-overlay">
              <iframe
                ref={presentFrameRef}
                title="present"
                sandbox={HTML_PREVIEW_SANDBOX}
                data-od-render-mode="srcdoc"
                srcDoc={presentationSrcDoc}
                onLoad={(event) => event.currentTarget.focus()}
              />
              <button type="button" className="present-exit-btn" onClick={closePresent} title={t('fileViewer.exitPresentation')} aria-label={t('fileViewer.exitPresentation')}>
                <Icon name="close" size={14} />
              </button>
              {escHint ? (
                <div className="present-esc-hint" role="status">
                  {t('fileViewer.presentEscHint')}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
