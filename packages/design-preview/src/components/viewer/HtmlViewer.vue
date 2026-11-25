<!--
  The HTML / deck preview — the heart of the Open Design workspace's right
  pane. Rebuilt from upstream apps/web/src/components/FileViewer.tsx
  `HtmlViewer` (same DOM + class names so the upstream stylesheet applies):
  sandboxed srcdoc iframe built by the vendored `buildSrcdoc`, Preview/Source,
  reload, Desktop/Tablet/Mobile viewports, auto-fit + manual zoom, deck
  navigation (toolbar, floating nav, thumbnail rail, keyboard), speaker notes,
  Present (in tab / fullscreen / new tab), Export (PDF / PNG / ZIP / HTML), and
  the review / edit tools:
    注释 Comment  — pick an element, write a comment in the vendored composer
    标记 Mark     — the vendored draw overlay (box / pen / text) → comment
    编辑 Edit     — manual edit through the vendored edit bridge + inspector
    评论 Comments — pins on the canvas + the comments panel
-->
<script lang="ts">
// Module-level state shared by every HtmlViewer instance.
/** Survives tab switches / remounts like upstream `htmlPreviewSlideState`. */
const slideStateCache = new Map<string, { active: number; count: number }>();
let measurementSeq = 0;
let requestSeq = 0;
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, Teleport, watch } from 'vue';
import { useElementSize, usePersistentState } from '../../composables/hooks';
import { px } from '../../lib/style';
import { blobToDataUrl, copyText } from '../../lib/util';
import { useT } from '../../locales';
import { commentCreatedAt, commentEffectiveSortKey, computeReorderedSortKey } from '../../review/comment-utils';
import { useComments } from '../../review/comments';
import { usePreviewScope } from '../../theme';
import { snapshotFromBridge, type BridgeSnapshotData } from '../../review/review-bridge';
import { useManualEdit } from '../../review/useManualEdit';
import { baseDirFor, baseName } from '../../sources/file-kind';
import { prepareHtmlForPreview, selfContainedHtml } from '../../sources/prepare';
import { canWrite, type PreparedHtml, type PreviewSource } from '../../sources/types';
import type { PreviewViewportId, ProjectFile } from '../../types';
import { useToast } from '../../ui/toast';
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
} from '../../vendor/open-design/comments';
import { indexCommentTargets } from '../../vendor/open-design/comments/target-index';
import AnnotationHoverPopover from '../../vendor/open-design/components/AnnotationHoverPopover.vue';
import BoardComposerPopover from '../../vendor/open-design/components/BoardComposerPopover.vue';
import DeckThumbnailRail from '../../vendor/open-design/components/DeckThumbnailRail.vue';
import Icon from '../../vendor/open-design/components/Icon.vue';
import ManualEditPanel from '../../vendor/open-design/components/ManualEditPanel.vue';
import PreviewDrawOverlay from '../../vendor/open-design/components/PreviewDrawOverlay.vue';
import { ANNOTATION_EVENT, type AnnotationEventDetail } from '../../vendor/open-design/components/preview-draw';
import RemixIcon from '../../vendor/open-design/components/RemixIcon.vue';
import type { PreviewComment, PreviewCommentAttachment, PreviewCommentTarget } from '../../vendor/open-design/contracts/api/comments';
import { findRealTagEnd, HTML_TAG_PATTERNS } from '../../vendor/open-design/contracts/runtime/html-injection-points';
import { parseDeckThumbnails } from '../../vendor/open-design/runtime/deck-thumbnail-parser';
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
} from '../../vendor/open-design/runtime/exports';
import { previewStorageKey, readPreviewStorage, savePreviewStorageMessage } from '../../vendor/open-design/runtime/preview-storage';
import { extractSpeakerNotesFromHtml } from '../../vendor/open-design/runtime/speaker-notes';
import { buildRedirectLoopBlockedDoc, buildSrcdoc, PREVIEW_REDIRECT_LOOP_MESSAGE } from '../../vendor/open-design/runtime/srcdoc';
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
} from '../../viewer/preview-geometry';
import { HTML_PREVIEW_SANDBOX, type ExportFormat } from '../../viewer/sandbox';
import CommentPreviewOverlays from '../review/CommentPreviewOverlays.vue';
import CommentSidePanel from '../review/CommentSidePanel.vue';
import AnchoredPopover from '../ui/AnchoredPopover.vue';
import TranslationScope from '../ui/TranslationScope.vue';
import FileViewerLoadingSkeleton from './FileViewerLoadingSkeleton.vue';
import HtmlViewerActions from './HtmlViewerActions.vue';
import PreviewViewportControls from './PreviewViewportControls.vue';

type SlideState = { active: number; count: number };
type ZoomPref = { mode: 'auto' | 'manual'; zoom: number };
type ScrollState = { frameLeft: number; frameTop: number; canvasLeft: number; canvasTop: number };

const HOVER_CARD_DISMISS_DELAY_MS = 80;

// Pointer activity inside the sandboxed frame never reaches the host document
// (the frame runs out of process), so upstream's `.comment-preview-canvas:hover`
// reveal for the floating deck nav cannot fire. This tiny bridge reports
// in-frame pointer activity so the host can reveal the nav itself.
const ACTIVITY_BRIDGE = `<script data-odp-activity-bridge>(function(){var last=0;function post(type){try{window.parent.postMessage({type:type},'*')}catch(_){}}document.addEventListener('pointermove',function(){var now=Date.now();if(now-last>200){last=now;post('odp:pointer-activity')}},{capture:true,passive:true});document.addEventListener('pointerdown',function(){post('odp:pointer-activity')},{capture:true,passive:true});document.documentElement.addEventListener('mouseleave',function(){post('odp:pointer-leave')});})();<\/script>`;

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
function isZoomPref(value: unknown): value is ZoomPref {
  const v = value as ZoomPref | null;
  return !!v && (v.mode === 'auto' || v.mode === 'manual') && typeof v.zoom === 'number' && v.zoom > 0;
}

function exportTitleFor(file: ProjectFile): string {
  return baseName(file.name).replace(/\.[^.]+$/, '') || 'artifact';
}

function manualEditShellStyle(viewport: PreviewViewportId, scale: number, frozenWidth: number | null) {
  if (viewport === 'desktop' && frozenWidth) {
    return { width: `${frozenWidth / scale}px`, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: '0 0' };
  }
  return previewScaleShellStyle(viewport, scale);
}

const props = withDefaults(
  defineProps<{
    source: PreviewSource;
    file: ProjectFile;
    /** Bumps when non-HTML assets of the project change (CSS, images, …). */
    filesRefreshKey: number;
    isDeckHint?: boolean;
    /** This viewer is the visible tab (retained viewers stay mounted, hidden). */
    active: boolean;
    /** Tab-strip slot for the file's header actions (Present / Export). */
    actionsHost: HTMLElement | null;
    /** Floating host the comments panel is teleported into (upstream comment-float-host). */
    commentHost?: HTMLElement | null;
    /** Embedded/read-only mode: hide Source + header chrome affordances. */
    viewerOnly?: boolean;
  }>(),
  { isDeckHint: false, commentHost: null, viewerOnly: false },
);

const t = useT();
const toast = useToast();
const comments = useComments();
const scope = usePreviewScope();
const writable = computed(() => canWrite(props.source) && !props.viewerOnly);
const reviewAvailable = computed(() => Boolean(comments) && !props.viewerOnly);
const stateKey = computed(() => `${props.source.id}::${props.file.name}`);
const title = computed(() => exportTitleFor(props.file));

const mode = ref<'preview' | 'source'>('preview');
const reloadKey = ref(0);
const raw = shallowRef<string | null>(null);
const loadError = ref(false);
const prepared = shallowRef<(PreparedHtml & { seq: number }) | null>(null);
let prepSeq = 0;
/** What the current srcdoc was built from, and under which refresh key. */
let builtFrom: { text: string; key: string } | null = null;
/** Source the live frame already shows (Edit text / style saves). */
let liveSource: string | null = null;
const refreshKey = computed(() => `${props.filesRefreshKey}:${reloadKey.value}`);

async function rebuildFrom(text: string) {
  const next = await prepareHtmlForPreview(props.source, props.file.name, text);
  prepSeq += 1;
  builtFrom = { text, key: refreshKey.value };
  prepared.value = { ...next, seq: prepSeq };
}

// --- load + prepare ---------------------------------------------------------
watch(
  () => [props.source, props.file.name, props.file.mtime, refreshKey.value] as const,
  ([source, name, , key], _prev, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    loadError.value = false;
    void (async () => {
      try {
        const text = await source.readText(name, { fresh: true });
        if (cancelled) return;
        if (text === null) {
          loadError.value = true;
          return;
        }
        raw.value = text;
        const built = builtFrom;
        // Same bytes under the same refresh key (a write echo, a touched mtime)
        // — or the edit the frame already shows — needs no re-render.
        if (built && built.key === key && (built.text === text || liveSource === text)) {
          builtFrom = { text, key };
          return;
        }
        liveSource = null;
        const next = await prepareHtmlForPreview(source, name, text);
        if (cancelled) return;
        prepSeq += 1;
        builtFrom = { text, key };
        prepared.value = { ...next, seq: prepSeq };
      } catch {
        if (!cancelled) loadError.value = true;
      }
    })();
  },
  { immediate: true },
);

const effectiveDeck = computed(() => props.isDeckHint || sourceLooksLikeDeckPreview(raw.value, sourceLooksLikeNavigableDeck));

// --- tools ---------------------------------------------------------------------
const boardMode = ref(false);
const commentCreateMode = ref(false);
const commentPanelOpen = ref(false);
const commentPanelCollapsed = ref(false);
const drawOverlayOpen = ref(false);
const manualEditMode = ref(false);
const manualEditFrozenWidth = ref<number | null>(null);

// --- viewport / zoom ---------------------------------------------------------
const viewport = usePersistentState<PreviewViewportId>(() => `od-preview:viewport:${stateKey.value}`, 'desktop', isPreviewViewportId);
const zoomPref = usePersistentState<ZoomPref>(() => `od-preview:zoom:${stateKey.value}`, { mode: 'auto', zoom: 100 }, isZoomPref);
// Scale math uses the viewer body (the space available to the canvas).
const bodyRef = ref<HTMLDivElement | null>(null);
const bodySize = useElementSize(bodyRef);
const canvasEl = ref<HTMLDivElement | null>(null);
const canvasSize = useElementSize(canvasEl);
const layoutEl = ref<HTMLDivElement | null>(null);
const contentMeasure = shallowRef<{ width: number; overflow: boolean } | null>(null);
const previewZoomPercent = computed(() =>
  resolveDesktopPreviewZoomPercent({
    zoomMode: zoomPref.value.mode,
    viewport: viewport.value,
    isDeck: effectiveDeck.value,
    manualZoomPercent: zoomPref.value.zoom,
    canvasSize: bodySize.value,
    contentWidth: contentMeasure.value?.overflow ? contentMeasure.value.width : null,
  }),
);
const previewScale = computed(() => previewZoomPercent.value / 100);
const overlayScale = computed(() => effectivePreviewScale(viewport.value, previewScale.value, bodySize.value));
const zoomLevelActive = (level: number) => zoomPref.value.mode === 'manual' && Math.abs(previewZoomPercent.value - level) < 0.001;
const setManualZoom = (level: number) => {
  zoomPref.value = { mode: 'manual', zoom: level };
};

// --- deck state ----------------------------------------------------------------
const slideState = shallowRef<SlideState | null>(slideStateCache.get(stateKey.value) ?? null);
const railCollapsed = usePersistentState<boolean>('od-preview:deck-rail-collapsed', false);
const notesOpen = usePersistentState<boolean>('od-preview:speaker-notes-open', true);
watch(effectiveDeck, (deck) => {
  if (!deck) slideState.value = null;
});

// --- srcdoc ----------------------------------------------------------------------
const iframeRef = ref<HTMLIFrameElement | null>(null);
const frameLoads = ref(0);
const redirectBlockedSeq = ref<number | null>(null);
const redirectBlocked = computed(() => prepared.value !== null && redirectBlockedSeq.value === prepared.value.seq);
const storageScope = computed(() => previewStorageKey('od-design-preview', props.source.id, props.file.name));
const documentEpoch = computed(
  () => `doc-${prepared.value?.seq ?? 0}-${effectiveDeck.value ? 'deck' : 'page'}-${Math.random().toString(36).slice(2, 8)}`,
);
const srcDoc = computed(() => {
  const current = prepared.value;
  if (!current) return '';
  if (redirectBlocked.value) return buildRedirectLoopBlockedDoc();
  const scope = storageScope.value;
  const epoch = documentEpoch.value;
  return injectActivityBridge(
    buildSrcdoc(current.html, {
      deck: effectiveDeck.value,
      baseHref: current.baseHref,
      initialSlideIndex: slideStateCache.get(stateKey.value)?.active ?? 0,
      hideDeckChrome: effectiveDeck.value,
      // Like upstream, the selection (comment) and manual-edit bridges are
      // always injected and boot dormant: toggling a tool only posts a mode
      // message, so the document is never re-parsed on a tool switch.
      selectionBridge: true,
      editBridge: true,
      previewFocusGuard: true,
      deferFontStylesheets: true,
      reloadKey: current.seq,
      previewMeasurementEpoch: epoch,
      previewStorage: Boolean(scope),
      previewStorageSeed: scope ? { generation: epoch, values: readPreviewStorage(scope) } : undefined,
    }),
  );
});

// --- scroll capture / restore across re-renders (upstream #92) -------------------
let scrollState: ScrollState = { frameLeft: 0, frameTop: 0, canvasLeft: 0, canvasTop: 0 };
let scrollRestore: ScrollState | null = null;
const scrollCaptures = new Map<string, (state: ScrollState) => void>();
async function captureScroll() {
  const win = iframeRef.value?.contentWindow;
  if (!win) return;
  requestSeq += 1;
  const requestId = `scroll-${requestSeq}`;
  const state = await new Promise<ScrollState | null>((resolve) => {
    const timer = window.setTimeout(() => {
      scrollCaptures.delete(requestId);
      resolve(null);
    }, 300);
    scrollCaptures.set(requestId, (value) => {
      window.clearTimeout(timer);
      resolve(value);
    });
    win.postMessage({ type: 'od:preview-scroll-capture', requestId }, '*');
  });
  scrollRestore = state ?? scrollState;
}

// --- desktop auto-fit measurement (upstream content-size bridge) ----------------
let measureRequest: { id: string; canvasWidth: number; scale: number; epoch: string } | null = null;
const measurementEligible = computed(
  () =>
    props.active &&
    mode.value === 'preview' &&
    viewport.value === 'desktop' &&
    zoomPref.value.mode === 'auto' &&
    !effectiveDeck.value &&
    !redirectBlocked.value &&
    !manualEditMode.value,
);
watch(
  [measurementEligible, () => bodySize.value?.width, previewScale, documentEpoch, frameLoads],
  ([eligible, width, scale, epoch], _prev, onCleanup) => {
    if (!eligible || !width) return;
    const raf = window.requestAnimationFrame(() => {
      const win = iframeRef.value?.contentWindow;
      if (!win) return;
      measurementSeq += 1;
      const id = `measure-${measurementSeq}`;
      measureRequest = { id, canvasWidth: width, scale, epoch };
      win.postMessage({ type: 'od:preview-content-size-request', measurementId: id, generation: epoch }, '*');
    });
    onCleanup(() => window.cancelAnimationFrame(raf));
  },
  { flush: 'post' },
);

function handleMeasurement(data: Record<string, unknown>) {
  const req = measureRequest;
  if (!req || data.measurementId !== req.id || data.generation !== req.epoch || data.documentEpoch !== req.epoch) return;
  if (Math.abs(req.canvasWidth - (bodySize.value?.width ?? 0)) > 1 || Math.abs(req.scale - previewScale.value) > 0.0001) return;
  const scrollWidth = typeof data.scrollWidth === 'number' && data.scrollWidth > 0 ? Math.ceil(data.scrollWidth) : null;
  const clientWidth = typeof data.clientWidth === 'number' && data.clientWidth > 0 ? Math.ceil(data.clientWidth) : null;
  if (scrollWidth == null || clientWidth == null) return;
  const neutral = Math.abs(req.scale - 1) <= 0.0001;
  const overflow = scrollWidth > clientWidth + 1;
  const prev = contentMeasure.value;
  if (neutral) {
    const next = overflow ? { width: scrollWidth, overflow: true } : { width: Math.max(1, Math.ceil(req.canvasWidth)), overflow: false };
    if (!prev || prev.width !== next.width || prev.overflow !== next.overflow) contentMeasure.value = next;
    return;
  }
  // At a non-neutral zoom the body width is the scaled viewport floor, not the
  // artifact's width: keep a confirmed overflow, else re-measure at 100%.
  contentMeasure.value = prev?.overflow ? prev : null;
}

// --- present -------------------------------------------------------------------------
const presenting = ref<null | 'tab' | 'fullscreen'>(null);
const escHint = ref(false);
const presentOverlayRef = ref<HTMLDivElement | null>(null);
const presentFrameRef = ref<HTMLIFrameElement | null>(null);
const presentationSrcDoc = computed(() =>
  presenting.value && prepared.value
    ? buildSrcdoc(prepared.value.html, {
        deck: effectiveDeck.value,
        baseHref: prepared.value.baseHref,
        initialSlideIndex: slideStateCache.get(stateKey.value)?.active ?? 0,
        hideDeckChrome: effectiveDeck.value,
        deckClickNavigation: effectiveDeck.value,
        previewFocusGuard: true,
      })
    : '',
);

function postSlide(action: 'next' | 'prev' | 'first' | 'last' | 'go', index?: number) {
  const win = iframeRef.value?.contentWindow;
  if (!win) return;
  win.postMessage({ type: 'od:slide', action, ...(action === 'go' && typeof index === 'number' ? { index } : {}) }, '*');
}

function closePresent() {
  presenting.value = null;
  escHint.value = false;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  // Bring the workspace preview to wherever the presentation ended.
  const cached = slideStateCache.get(stateKey.value);
  if (cached) postSlide('go', cached.active);
}

// --- floating deck nav reveal ----------------------------------------------------------
const navRevealed = ref(false);
let navHover = false;
let navHideTimer: number | null = null;
function revealNav(ms: number) {
  navRevealed.value = true;
  if (navHideTimer !== null) window.clearTimeout(navHideTimer);
  navHideTimer = window.setTimeout(() => {
    navHideTimer = null;
    if (!navHover) navRevealed.value = false;
  }, ms);
}
function onNavPointerEnter() {
  navHover = true;
  navRevealed.value = true;
}
function onNavPointerLeave() {
  navHover = false;
  revealNav(800);
}

// --- iframe → host messages (preview runtime) ---------------------------------
function onRuntimeMessage(ev: MessageEvent) {
  const frame = iframeRef.value;
  const presentFrame = presentFrameRef.value;
  const fromMain = !!frame && ev.source === frame.contentWindow;
  const fromPresent = !!presentFrame && ev.source === presentFrame.contentWindow;
  if (!fromMain && !fromPresent) return;
  const data = ev.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
  switch (data.type) {
    case 'od:slide-state': {
      if (typeof data.active !== 'number' || typeof data.count !== 'number') return;
      const next = { active: data.active, count: data.count };
      slideStateCache.set(stateKey.value, next);
      slideState.value = next;
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
      if (fromMain) savePreviewStorageMessage(ev, frame!.contentWindow, documentEpoch.value, storageScope.value);
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
      const pending = requestId ? scrollCaptures.get(requestId) : undefined;
      if (pending) {
        scrollCaptures.delete(requestId);
        pending(state);
        return;
      }
      scrollState = state;
      return;
    }
    case 'od:preview-scroll-request': {
      if (!fromMain) return;
      const restore = scrollRestore;
      if (!restore) return;
      scrollRestore = null;
      frame!.contentWindow?.postMessage({ type: 'od:preview-scroll-restore', ...restore }, '*');
      return;
    }
    case PREVIEW_REDIRECT_LOOP_MESSAGE:
      if (fromMain && prepared.value) redirectBlockedSeq.value = prepared.value.seq;
      return;
    default:
  }
}

watch(
  presenting,
  (kind, _prev, onCleanup) => {
    if (!kind) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePresent();
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement && presenting.value === 'fullscreen') closePresent();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    const hint = window.setTimeout(() => {
      escHint.value = false;
    }, 2600);
    if (kind === 'fullscreen') {
      void presentOverlayRef.value?.requestFullscreen?.().catch(() => {
        presenting.value = 'tab';
      });
    }
    onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.clearTimeout(hint);
    });
  },
  { flush: 'post' },
);

// --- deck derived values ---------------------------------------------------------------
const deckSlideCount = computed(() => slideState.value?.count ?? 0);
const activeDeckSlideIndex = computed(() => slideState.value?.active ?? 0);
const speakerNotes = computed(() => (effectiveDeck.value && raw.value ? extractSpeakerNotesFromHtml(raw.value, deckSlideCount.value) : []));
const showDeckNavigation = computed(() => effectiveDeck.value && (slideState.value === null || slideState.value.count > 0));
const deckSlideTotal = computed(() => Math.max(deckSlideCount.value, speakerNotes.value.length, showDeckNavigation.value ? 1 : 0));
const deckNavTotal = computed(() => Math.max(deckSlideTotal.value, activeDeckSlideIndex.value + 1, 1));
const showDeckThumbnailRail = computed(
  () => effectiveDeck.value && prepared.value !== null && deckSlideTotal.value > 0 && !redirectBlocked.value && !manualEditMode.value,
);
const showDeckFloatingNav = computed(() => effectiveDeck.value && deckSlideTotal.value > 0 && !redirectBlocked.value && !manualEditMode.value);
const hasSpeakerNotes = computed(() => speakerNotes.value.some((note) => note.trim().length > 0));
const activeSpeakerNote = computed(() => speakerNotes.value[activeDeckSlideIndex.value] ?? '');

function goToSlide(index: number) {
  if (!Number.isFinite(index) || index < 0) return;
  const target = Math.floor(index);
  const count = Math.max(slideStateCache.get(stateKey.value)?.count ?? 0, target + 1);
  slideStateCache.set(stateKey.value, { active: target, count });
  slideState.value = { active: target, count };
  postSlide('go', target);
}

const buildThumbSrcDoc = computed(() => {
  const current = prepared.value;
  return (index: number) =>
    buildSrcdoc(current?.html ?? '', {
      deck: true,
      baseHref: current?.baseHref,
      initialSlideIndex: index,
      hideDeckChrome: true,
      previewFocusGuard: true,
      freezeMotion: true,
    });
});
const parsedDeck = computed(() => {
  const current = prepared.value;
  if (!effectiveDeck.value || !current) return null;
  try {
    const parsed = parseDeckThumbnails(current.html, current.baseHref);
    return parsed.renderable ? parsed : null;
  } catch {
    return null;
  }
});
const thumbViewport = computed(() => {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport.value);
  if (preset?.width && preset.height) return { width: preset.width, height: preset.height };
  const size = canvasSize.value;
  if (!size) return null;
  const scale = Number.isFinite(previewScale.value) && previewScale.value > 0 ? previewScale.value : 1;
  return { width: Math.max(1, Math.round(size.width / scale)), height: Math.max(1, Math.round(size.height / scale)) };
});

// Host-side deck shortcuts while focus is outside the sandboxed frame.
function onDeckKeyDown(event: KeyboardEvent) {
  if (!props.active || !effectiveDeck.value || mode.value !== 'preview' || presenting.value || manualEditMode.value) return;
  if (event.defaultPrevented) return;
  if (isEditableKeyboardTarget(event.target) || isEditableKeyboardTarget(document.activeElement)) return;
  if (document.activeElement instanceof HTMLIFrameElement) return;
  if ((event.target as HTMLElement | null)?.closest?.('[role="menu"],[role="listbox"],[role="dialog"]')) return;
  const shortcut = deckKeyboardShortcutForEvent(event);
  if (!shortcut) return;
  event.preventDefault();
  if (shortcut === 'reset') goToSlide(0);
  else postSlide(shortcut);
}

// ===========================================================================
// Comments (注释 / 评论)
// ===========================================================================
const liveTargets = shallowRef<Map<string, PreviewCommentSnapshot>>(new Map());
const hoveredTarget = shallowRef<PreviewCommentSnapshot | null>(null);
const activeTarget = shallowRef<PreviewCommentSnapshot | null>(null);
const activeCommentId = ref<string | null>(null);
const commentDraft = ref('');
const queuedNotes = shallowRef<string[]>([]);
const boardImages = shallowRef<File[]>([]);
const keepAttachments = shallowRef<PreviewCommentAttachment[]>([]);
const selectedIds = shallowRef<Set<string>>(new Set());
const sendingComment = ref(false);
let hoverCardPinned = false;
let hoverDismissTimer: number | null = null;
let locateRequest: { requestId: string; commentId: string } | null = null;

const boardImagePreviews = shallowRef<{ file: File; url: string }[]>([]);
watch(
  boardImages,
  (images, _prev, onCleanup) => {
    const previews = images.map((image) => ({ file: image, url: URL.createObjectURL(image) }));
    boardImagePreviews.value = previews;
    onCleanup(() => previews.forEach((preview) => URL.revokeObjectURL(preview.url)));
  },
  { immediate: true },
);

const fileComments = computed(() => (comments?.comments ?? []).filter((comment) => comment.filePath === props.file.name));
const creationSorted = computed(() =>
  fileComments.value.filter((comment) => comment.status === 'open').sort((a, b) => commentCreatedAt(a) - commentCreatedAt(b)),
);
const pinNumbers = computed(() => {
  const byCreation = [...fileComments.value].sort((a, b) => commentCreatedAt(a) - commentCreatedAt(b));
  return new Map(byCreation.map((comment, index) => [comment.id, typeof comment.pinSeq === 'number' ? comment.pinSeq : index + 1]));
});
const provisionalPin = computed(() => provisionalNextPinNumber([...fileComments.value].sort((a, b) => commentCreatedAt(a) - commentCreatedAt(b))));
const sideComments = computed(() => [...creationSorted.value].sort((a, b) => commentEffectiveSortKey(b) - commentEffectiveSortKey(a)));
const resolvedComments = computed(() =>
  fileComments.value.filter((comment) => comment.status === 'resolved').sort((a, b) => b.updatedAt - a.updatedAt),
);
const activeComment = computed(() =>
  activeCommentId.value ? fileComments.value.find((comment) => comment.id === activeCommentId.value) ?? null : null,
);

function cancelHoverDismiss() {
  if (hoverDismissTimer !== null) window.clearTimeout(hoverDismissTimer);
  hoverDismissTimer = null;
}
function scheduleHoverDismiss() {
  cancelHoverDismiss();
  hoverDismissTimer = window.setTimeout(() => {
    hoverDismissTimer = null;
    if (!hoverCardPinned) hoveredTarget.value = null;
  }, HOVER_CARD_DISMISS_DELAY_MS);
}
watch(hoveredTarget, (target) => {
  if (!target) hoverCardPinned = false;
});

function clearComposer() {
  activeTarget.value = null;
  hoveredTarget.value = null;
  activeCommentId.value = null;
  commentDraft.value = '';
  queuedNotes.value = [];
  boardImages.value = [];
  keepAttachments.value = [];
  locateRequest = null;
}

// Board mode → bridge picker on/off.
watch(
  [boardMode, () => props.active, srcDoc, frameLoads],
  ([board, active]) => {
    iframeRef.value?.contentWindow?.postMessage({ type: 'od:comment-mode', enabled: board && active, mode: 'picker' }, '*');
  },
  { immediate: true, flush: 'post' },
);

watch(
  [boardMode, () => props.active],
  ([board, active]) => {
    if (board && active) return;
    commentCreateMode.value = false;
    activeTarget.value = null;
    hoveredTarget.value = null;
    activeCommentId.value = null;
    if (liveTargets.value.size > 0) liveTargets.value = new Map();
    if (queuedNotes.value.length) queuedNotes.value = [];
  },
  { immediate: true },
);

function setLiveTarget(snapshot: PreviewCommentSnapshot) {
  const existing = liveTargets.value.get(snapshot.elementId);
  if (existing && commentSnapshotEqual(existing, snapshot)) return;
  liveTargets.value = new Map(liveTargets.value).set(snapshot.elementId, snapshot);
}

// Selection bridge → comment targets.
function onSelectionMessage(ev: MessageEvent) {
  if (!boardMode.value || !props.active) return;
  if (ev.source !== iframeRef.value?.contentWindow) return;
  const data = ev.data as (BridgeSnapshotData & { type?: string; requestId?: string; targets?: BridgeSnapshotData[] }) | null;
  if (!data?.type) return;
  const toSnapshot = (value: BridgeSnapshotData) => snapshotFromBridge(props.file.name, value);
  switch (data.type) {
    case 'od:comment-targets': {
      if (!Array.isArray(data.targets)) return;
      const next = indexCommentTargets(data.targets.map(toSnapshot));
      for (const [id, snapshot] of next) if (!id || !isValidCommentOverlayPosition(snapshot.position)) next.delete(id);
      if (!liveCommentTargetMapsEqual(liveTargets.value, next)) liveTargets.value = next;
      const active = activeTarget.value;
      if (active && active.selectionKind !== 'pod' && !active.elementId.startsWith('pin-') && !active.elementId.startsWith('file-comment-')) {
        const updated = next.get(active.elementId);
        if (updated && !commentSnapshotEqual(active, updated)) activeTarget.value = updated;
      }
      const hovered = hoveredTarget.value;
      if (hovered) {
        const updated = next.get(hovered.elementId);
        if (!updated) hoveredTarget.value = null;
        else if (!commentSnapshotEqual(hovered, updated)) hoveredTarget.value = updated;
      }
      return;
    }
    case 'od:comment-location-missing': {
      const request = locateRequest;
      if (!request || request.requestId !== data.requestId) return;
      locateRequest = null;
      toast.show(t('comment.anchorState.lost'), { tone: 'error' });
      return;
    }
    case 'od:comment-active-target-update': {
      const snapshot = toSnapshot(data);
      if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
      const request = locateRequest;
      if (request && data.requestId === request.requestId) {
        locateRequest = null;
        activeTarget.value = snapshot;
        hoveredTarget.value = snapshot;
      } else {
        const current = activeTarget.value;
        if (current && current.elementId === snapshot.elementId && !commentSnapshotEqual(current, snapshot)) activeTarget.value = snapshot;
      }
      setLiveTarget(snapshot);
      return;
    }
    case 'od:comment-leave':
      if (hoverCardPinned) return;
      scheduleHoverDismiss();
      return;
    case 'od:comment-hover': {
      const snapshot = toSnapshot(data);
      if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
      cancelHoverDismiss();
      const current = hoveredTarget.value;
      if (!(current && current.elementId === snapshot.elementId && commentSnapshotEqual(current, snapshot))) hoveredTarget.value = snapshot;
      setLiveTarget(snapshot);
      return;
    }
    case 'od:comment-target': {
      const snapshot = toSnapshot(data);
      if (!snapshot.elementId || !isValidCommentOverlayPosition(snapshot.position)) return;
      cancelHoverDismiss();
      liveTargets.value = new Map(liveTargets.value).set(snapshot.elementId, snapshot);
      activeTarget.value = snapshot;
      hoveredTarget.value = snapshot;
      activeCommentId.value = null;
      commentDraft.value = '';
      queuedNotes.value = [];
      boardImages.value = [];
      keepAttachments.value = [];
      return;
    }
    default:
  }
}

// Keep the bridge tracking the target the composer is attached to.
watch(
  () => [activeTarget.value?.elementId, activeTarget.value?.selector, activeTarget.value?.selectionKind, boardMode.value, props.active] as const,
  ([elementId, selector, selectionKind, board, active]) => {
    if (!active || !board || !elementId || selectionKind === 'pod' || elementId.startsWith('pin-')) return;
    iframeRef.value?.contentWindow?.postMessage({ type: 'od:comment-active-target', elementId, selector }, '*');
  },
  { flush: 'post' },
);

// Escape closes the composer, then leaves comment mode.
function onCommentEscape(event: KeyboardEvent) {
  if (!props.active || !boardMode.value) return;
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (isEditableKeyboardTarget(event.target)) return;
  if (activeTarget.value) clearComposer();
  else if (!commentPanelOpen.value) boardMode.value = false;
}

function openComment(comment: PreviewComment, snapshot?: PreviewCommentSnapshot | null) {
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
  const resolved = snapshot ?? liveSnapshotForComment(comment, liveTargets.value) ?? fallback;
  boardMode.value = true;
  commentCreateMode.value = true;
  activeTarget.value = resolved;
  hoveredTarget.value = resolved;
  activeCommentId.value = comment.id;
  commentDraft.value = comment.note;
  queuedNotes.value = [];
  boardImages.value = [];
  keepAttachments.value = comment.attachments ?? [];
  if (effectiveDeck.value && typeof comment.slideIndex === 'number' && comment.slideIndex !== activeDeckSlideIndex.value) goToSlide(comment.slideIndex);
  // Scroll the element into view and re-measure it in the live document.
  if (!comment.elementId.startsWith('pin-') && !comment.elementId.startsWith('file-comment-') && comment.selectionKind !== 'pod') {
    requestSeq += 1;
    const requestId = `comment-locate-${requestSeq}`;
    locateRequest = { requestId, commentId: comment.id };
    window.setTimeout(() => {
      iframeRef.value?.contentWindow?.postMessage(
        { type: 'od:comment-active-target', elementId: comment.elementId, selector: comment.selector, locate: true, requestId },
        '*',
      );
    }, 0);
  }
}

async function saveComment() {
  const target0 = activeTarget.value;
  if (!comments || !target0) return;
  const note = [...queuedNotes.value, commentDraft.value.trim()].filter(Boolean).join('\n');
  if (!note && boardImages.value.length === 0 && keepAttachments.value.length === 0) return;
  sendingComment.value = true;
  try {
    const isFreePin = target0.elementId.startsWith('pin-');
    const target: PreviewCommentTarget = targetFromSnapshot(target0);
    if (effectiveDeck.value && typeof target.slideIndex !== 'number' && slideState.value) target.slideIndex = slideState.value.active;
    const saved = await comments.save({
      target,
      note,
      images: boardImages.value,
      existingId: activeComment.value?.id,
      keepAttachments: keepAttachments.value,
    });
    if (!saved) {
      toast.show(t('app.commentSaveFailed'), { tone: 'error', ttlMs: 5000 });
      return;
    }
    clearComposer();
    boardMode.value = true;
    commentCreateMode.value = true;
    toast.show(isFreePin ? t('chat.comments.pinSavedToast') : t('chat.comments.savedToast'), { tone: 'success' });
  } finally {
    sendingComment.value = false;
  }
}

async function savePanelComment(note: string): Promise<boolean> {
  if (!comments) return false;
  sendingComment.value = true;
  try {
    const idSeed = Date.now().toString(36);
    const target: PreviewCommentTarget = activeTarget.value
      ? targetFromSnapshot(activeTarget.value)
      : {
          filePath: props.file.name,
          elementId: `file-comment-${idSeed}-${Math.floor(Math.random() * 1e6).toString(36)}`,
          selector: 'html',
          label: props.file.name,
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
    if (activeTarget.value) clearComposer();
    return true;
  } finally {
    sendingComment.value = false;
  }
}

const selectedSideComments = computed(() => sideComments.value.filter((comment) => selectedIds.value.has(comment.id)));
async function resolveSelected() {
  const chosen = selectedSideComments.value;
  if (!comments || chosen.length === 0) return;
  sendingComment.value = true;
  const ok = await comments.setStatus(
    chosen.map((comment) => comment.id),
    'resolved',
  );
  sendingComment.value = false;
  if (ok) {
    selectedIds.value = new Set();
    toast.show(t('app.commentsResolved', { n: chosen.length }), { tone: 'success' });
  }
}
async function copySelected() {
  const chosen = selectedSideComments.value;
  if (chosen.length === 0) return;
  const text = messageContentWithCommentAttachments(t('app.commentsCopyIntro', { file: props.file.name }), commentsToAttachments(chosen));
  await copyText(text);
  toast.show(t('app.commentsCopied', { n: chosen.length }), { tone: 'success' });
}
function toggleSelect(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

// ===========================================================================
// Mark (标记): the vendored draw overlay dispatches ANNOTATION_EVENT.
// ===========================================================================
function onAnnotation(event: Event) {
  if (!props.active) return;
  const detail = (event as CustomEvent<AnnotationEventDetail>).detail;
  if (!detail || (detail.filePath && detail.filePath !== props.file.name)) return;
  void (async () => {
    try {
      if (detail.action === 'send') {
        if (!comments) throw new Error('comments unavailable');
        const bounds = detail.bounds ?? { x: 24, y: 24, width: 1, height: 1 };
        const images = [...(detail.file ? [detail.file] : []), ...(detail.extraFiles ?? [])];
        const target: PreviewCommentTarget = {
          filePath: props.file.name,
          elementId: `pin-mark-${Date.now().toString(36)}`,
          selector: 'html',
          label: '',
          text: '',
          position: {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.max(1, Math.round(bounds.width)),
            height: Math.max(1, Math.round(bounds.height)),
          },
          htmlHint: '',
          selectionKind: 'element',
          ...(effectiveDeck.value && slideState.value ? { slideIndex: slideState.value.active } : {}),
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
          if (result !== 'copied') exportAsImage(await blobToDataUrl(detail.file), `${title.value}-mark`);
          toast.show(t(result === 'copied' ? 'app.markCopied' : 'app.screenshotDownloaded'), { tone: 'success' });
        }
      } else {
        if (!detail.file) throw new Error(t('chat.annotationPreviewMissing'));
        exportAsImage(await blobToDataUrl(detail.file), `${title.value}-mark`);
        toast.show(t('app.screenshotDownloaded'), { tone: 'success' });
      }
      detail.ack?.({ ok: true });
    } catch (err) {
      detail.ack?.({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  })();
}

// ===========================================================================
// Edit (编辑)
// ===========================================================================
const manualEdit = useManualEdit({
  enabled: () => manualEditMode.value,
  active: () => props.active,
  iframeRef,
  fileName: () => props.file.name,
  source: () => raw.value,
  readFresh: () => props.source.readText(props.file.name, { fresh: true }),
  writeSource: async (text) => {
    if (!props.source.writeFile) throw new Error(t('app.readOnlySource'));
    await props.source.writeFile(props.file.name, text);
  },
  saveImage: async (picked) => {
    if (!props.source.writeFile) throw new Error(t('app.readOnlySource'));
    const dir = baseDirFor(props.file.name);
    const stamp = Date.now().toString(36);
    const name = `${stamp}-${picked.name.replace(/[^\w.-]+/g, '-')}`;
    await props.source.writeFile(`${dir}${name}`, picked);
    return name;
  },
  onSourceChange: (text, live) => {
    raw.value = text;
    if (live) {
      liveSource = text;
      return;
    }
    liveSource = null;
    void captureScroll().then(() => rebuildFrom(text));
  },
  scale: () => overlayScale.value,
  canvasSize: () => (bodySize.value ? { width: bodySize.value.width, height: bodySize.value.height } : null),
  t,
});
const { panelActive: manualPanelActive, panelProps: manualPanelProps, hoverTarget: manualHoverTarget, hoverStyle: manualHoverStyle } = manualEdit;

watch([frameLoads, srcDoc], () => manualEdit.syncFrame(), { flush: 'post' });

async function leaveManualEdit(): Promise<boolean> {
  if (!manualEditMode.value) return true;
  const ok = await manualEdit.exit();
  if (!ok) return false;
  manualEditMode.value = false;
  return true;
}
watch([() => props.active, manualEditMode], ([active, editing]) => {
  if (!active && editing) void leaveManualEdit();
});

// --- tool switches (upstream activate*Tool) --------------------------------------
function withEditExited(fn: () => void) {
  if (manualEditMode.value) {
    void leaveManualEdit().then((ok) => ok && fn());
    return;
  }
  fn();
}

function activateCommentTool() {
  if (!reviewAvailable.value) return;
  if (boardMode.value && !commentCreateMode.value) {
    boardMode.value = false;
    clearComposer();
    return;
  }
  withEditExited(() => {
    commentPanelOpen.value = false;
    commentCreateMode.value = false;
    clearComposer();
    drawOverlayOpen.value = false;
    mode.value = 'preview';
    boardMode.value = true;
  });
}

function activateCommentCreateTool() {
  if (!reviewAvailable.value) return;
  if (boardMode.value && commentCreateMode.value && commentPanelOpen.value) {
    boardMode.value = false;
    commentCreateMode.value = false;
    commentPanelOpen.value = false;
    clearComposer();
    return;
  }
  withEditExited(() => {
    commentPanelOpen.value = true;
    commentPanelCollapsed.value = false;
    if (!activeTarget.value) clearComposer();
    drawOverlayOpen.value = false;
    mode.value = 'preview';
    boardMode.value = true;
    commentCreateMode.value = true;
  });
}

function activateDrawTool() {
  if (!reviewAvailable.value) return;
  if (drawOverlayOpen.value) {
    drawOverlayOpen.value = false;
    return;
  }
  withEditExited(() => {
    commentPanelOpen.value = false;
    commentCreateMode.value = false;
    boardMode.value = false;
    clearComposer();
    mode.value = 'preview';
    drawOverlayOpen.value = true;
  });
}

function activateManualEditTool() {
  if (!writable.value) return;
  if (manualEditMode.value) {
    void leaveManualEdit();
    return;
  }
  commentPanelOpen.value = false;
  commentCreateMode.value = false;
  boardMode.value = false;
  clearComposer();
  drawOverlayOpen.value = false;
  mode.value = 'preview';
  manualEditFrozenWidth.value = bodySize.value?.width ?? null;
  manualEditMode.value = true;
}

function dismissCommentPanel() {
  commentPanelOpen.value = false;
  if (activeTarget.value) return;
  commentCreateMode.value = false;
  boardMode.value = false;
  clearComposer();
}

const commentToolActive = computed(() => boardMode.value && !commentCreateMode.value);
const commentsToolActive = computed(() => boardMode.value && commentCreateMode.value);

// --- menus ----------------------------------------------------------------------
const zoomMenuOpen = ref(false);
const moreOpen = ref(false);
const zoomTriggerRef = ref<HTMLButtonElement | null>(null);
const moreTriggerRef = ref<HTMLButtonElement | null>(null);

function reload() {
  redirectBlockedSeq.value = null;
  reloadKey.value += 1;
}

function startPresent(kind: 'tab' | 'fullscreen') {
  withEditExited(() => {
    mode.value = 'preview';
    escHint.value = true;
    presenting.value = kind;
  });
}
function presentNewTab() {
  const current = prepared.value;
  if (!current) return;
  openSandboxedPreviewInNewTab(current.html, title.value, {
    deck: effectiveDeck.value,
    baseHref: current.baseHref,
    initialSlideIndex: slideStateCache.get(stateKey.value)?.active ?? 0,
    deckClickNavigation: effectiveDeck.value,
    previewFocusGuard: true,
  });
}

async function runExport(format: ExportFormat) {
  const text = raw.value;
  if (text === null) return;
  const pending = toast.show(t('app.exporting'), { tone: 'loading' });
  try {
    const html = await selfContainedHtml(props.source, props.file.name, text);
    if (format === 'html') exportAsHtml(html, title.value);
    else if (format === 'zip') await exportAsZip(html, title.value);
    else if (format === 'pdf') await exportAsPdf(html, title.value, { deck: effectiveDeck.value });
    else {
      const snapshot = await exportArtifactImageDataUrl(html, { deck: effectiveDeck.value });
      exportAsImage(snapshot.dataUrl, title.value);
    }
    toast.dismiss(pending);
    toast.show(t('app.exportDone', { name: `${title.value}.${format === 'image' ? 'png' : format}` }), { tone: 'success' });
  } catch (error) {
    toast.dismiss(pending);
    const message = error instanceof Error ? error.message : String(error);
    toast.show(t('app.exportFailed', { message }), { tone: 'error', ttlMs: 6000 });
  }
}

function copySource() {
  const text = raw.value;
  if (text !== null) void copyText(text).then(() => toast.show(t('fileViewer.copied'), { tone: 'success' }));
}

async function copyScreenshot() {
  const frame = iframeRef.value;
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
    exportAsImage(snapshot.dataUrl, `${title.value}-screenshot`);
    toast.show(t('app.screenshotDownloaded'), { tone: 'success' });
  }
}

const hasContent = computed(() => prepared.value !== null);
const initialLoading = computed(() => !hasContent.value && !loadError.value);
const readOnlyTitle = computed(() => t(props.viewerOnly ? 'fileViewer.saveDisabled' : 'app.readOnlySource'));
const showPreviewToolbarControls = computed(() => mode.value === 'preview');
const fileUrl = computed(() => props.source.fileUrl(props.file.name, props.file.mtime));
const modeTabs = computed(
  () =>
    [
      ['preview', t('fileViewer.preview'), 'eye-line'],
      ['source', t('fileViewer.source'), 'code-s-slash-line'],
    ] as const,
);
function selectMode(id: 'preview' | 'source') {
  if (id === 'source') withEditExited(() => (mode.value = 'source'));
  else mode.value = id;
}

// --- composer (teleported into the preview layout like upstream) ------------------
// Measured at render time from the live DOM, as upstream does on every render.
function composerMetrics() {
  const layout = layoutEl.value;
  const canvas = canvasEl.value;
  if (!layout || !canvas) return null;
  const hostRect = layout.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  if (hostRect.width <= 0 || hostRect.height <= 0) return null;
  return {
    bounds: { width: hostRect.width, height: hostRect.height, scrollLeft: layout.scrollLeft, scrollTop: layout.scrollTop },
    offset: { x: canvasRect.left - hostRect.left + layout.scrollLeft, y: canvasRect.top - hostRect.top + layout.scrollTop },
  };
}
const composerVisible = computed(() => props.active && boardMode.value && activeTarget.value !== null && layoutEl.value !== null);
const composerTick = ref(0);
watch(composerVisible, async (visible) => {
  // The layout's rect is only meaningful once it has been laid out.
  if (visible) {
    await nextTick();
    composerTick.value += 1;
  }
});
const composerMetricsNow = computed(() => {
  void composerTick.value;
  void activeTarget.value;
  void bodySize.value;
  void overlayScale.value;
  return composerVisible.value ? composerMetrics() : null;
});
const existingImages = computed(() =>
  keepAttachments.value.map((attachment) => ({ url: comments?.attachmentUrl(attachment) ?? '', name: attachment.name })),
);
const composerHandlers = {
  onDraft: (value: string) => {
    commentDraft.value = value;
  },
  onAddDraft: () => {
    const note = commentDraft.value.trim();
    if (!note) return;
    queuedNotes.value = [...queuedNotes.value, note];
    commentDraft.value = '';
  },
  onRemoveQueuedNote: (index: number) => {
    queuedNotes.value = queuedNotes.value.filter((_, i) => i !== index);
  },
  onClose: clearComposer,
  onSaveComment: () => saveComment(),
  onSendBatch: () => saveComment(),
  onRemoveMember: () => clearComposer(),
  onViewAllComments: () => {
    commentPanelOpen.value = true;
    commentPanelCollapsed.value = false;
  },
  onDeleteComment: async (commentId: string) => {
    if (!comments) return;
    const removed = await comments.remove(commentId);
    if (!removed) return;
    clearComposer();
    if (selectedIds.value.has(commentId)) {
      const next = new Set(selectedIds.value);
      next.delete(commentId);
      selectedIds.value = next;
    }
  },
  onAttachImages: (files: File[]) => {
    const images = files.filter((item) => item.type.startsWith('image/'));
    if (images.length) boardImages.value = [...boardImages.value, ...images];
  },
  onRemoveImage: (index: number) => {
    boardImages.value = boardImages.value.filter((_, i) => i !== index);
  },
  onPreviewImage: (index: number) => {
    const preview = boardImagePreviews.value[index];
    if (preview) window.open(preview.url, '_blank', 'noopener');
  },
};

const commentPanelVisible = computed(() => props.active && commentPanelOpen.value && reviewAvailable.value && Boolean(comments));
function reorderComments(orderedIds: string[], draggedId: string) {
  if (!comments) return;
  void comments.reorder(draggedId, computeReorderedSortKey(sideComments.value, orderedIds, draggedId));
}

const layoutClass = computed(() =>
  manualEditMode.value
    ? 'manual-edit-workspace'
    : [
        'comment-preview-layer',
        showDeckThumbnailRail.value ? 'comment-preview-layer-with-deck-rail' : '',
        showDeckThumbnailRail.value && railCollapsed.value ? 'comment-preview-layer-deck-rail-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' '),
);
const layoutStyle = computed(() => ({
  ...px(previewViewportStyle(viewport.value, previewScale.value, bodySize.value)),
  ...(mode.value !== 'preview' ? { display: 'none' } : {}),
}));
const shellStyle = computed(() =>
  px(
    manualEditMode.value
      ? manualEditShellStyle(viewport.value, previewScale.value, manualEditFrozenWidth.value)
      : previewScaleShellStyle(viewport.value, previewScale.value),
  ),
);

function chooseViewport(id: PreviewViewportId) {
  mode.value = 'preview';
  viewport.value = id;
  moreOpen.value = false;
}
function moreAction(fn: () => void) {
  fn();
  moreOpen.value = false;
}

function onHoverCardEnter() {
  hoverCardPinned = true;
  cancelHoverDismiss();
}
function onHoverCardLeave() {
  hoverCardPinned = false;
  scheduleHoverDismiss();
}

onMounted(() => {
  window.addEventListener('message', onRuntimeMessage);
  window.addEventListener('message', onSelectionMessage);
  window.addEventListener('keydown', onDeckKeyDown);
  window.addEventListener('keydown', onCommentEscape);
  window.addEventListener(ANNOTATION_EVENT, onAnnotation);
});
onBeforeUnmount(() => {
  window.removeEventListener('message', onRuntimeMessage);
  window.removeEventListener('message', onSelectionMessage);
  window.removeEventListener('keydown', onDeckKeyDown);
  window.removeEventListener('keydown', onCommentEscape);
  window.removeEventListener(ANNOTATION_EVENT, onAnnotation);
  if (navHideTimer !== null) window.clearTimeout(navHideTimer);
  cancelHoverDismiss();
});
</script>

<template>
  <div :class="['viewer', 'html-viewer', { 'is-tab-present': presenting, 'html-viewer--viewer-only': viewerOnly }]">
    <div class="viewer-toolbar" :style="active ? undefined : { visibility: 'hidden' }">
      <div class="viewer-toolbar-left">
        <button
          v-if="showDeckThumbnailRail"
          type="button"
          class="icon-only deck-thumbnail-toolbar-toggle od-tooltip"
          :aria-expanded="!railCollapsed"
          :aria-label="railCollapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')"
          :title="railCollapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')"
          :data-tooltip="railCollapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')"
          data-tooltip-placement="bottom"
          data-testid="deck-rail-toggle"
          @click="railCollapsed = !railCollapsed"
        >
          <Icon name="panel-left" :size="15" />
        </button>
        <button
          type="button"
          class="icon-only od-tooltip"
          :title="`${t('fileViewer.reload')} ${t('fileViewer.preview')}`"
          :data-tooltip="`${t('fileViewer.reload')} ${t('fileViewer.preview')}`"
          data-tooltip-placement="bottom"
          :aria-label="`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`"
          data-testid="reload-preview"
          @click="reload"
        >
          <Icon name="reload" :size="14" />
        </button>
        <div class="viewer-tabs viewer-mode-tabs" role="tablist" aria-label="View mode">
          <button
            v-for="[id, label, icon] in modeTabs"
            :key="id"
            type="button"
            role="tab"
            :class="['viewer-tab', 'od-tooltip', { active: mode === id }]"
            :aria-label="label"
            :aria-selected="mode === id"
            :disabled="viewerOnly && id === 'source'"
            :title="label"
            :data-tooltip="label"
            data-tooltip-placement="bottom"
            :data-testid="`mode-${id}`"
            @click="selectMode(id)"
          >
            <RemixIcon :name="icon" :size="14" class="viewer-tab-icon" />
            <span class="viewer-tab-label">{{ label }}</span>
          </button>
        </div>
        <span v-if="showPreviewToolbarControls" class="viewer-preview-toolbar-inline">
          <PreviewViewportControls :viewport="viewport" :t="t" @viewport="viewport = $event" />
        </span>
        <span
          v-if="showPreviewToolbarControls && showDeckNavigation && !showDeckFloatingNav"
          class="deck-nav viewer-deck-nav-inline"
          role="group"
          :aria-label="t('fileViewer.slideNavAria')"
        >
          <button
            type="button"
            class="icon-only od-tooltip"
            :title="t('fileViewer.previousSlide')"
            :data-tooltip="t('fileViewer.previousSlide')"
            data-tooltip-placement="bottom"
            :aria-label="t('fileViewer.previousSlide')"
            :disabled="slideState !== null && slideState.active <= 0"
            @click="postSlide('prev')"
          >
            <Icon name="chevron-right" :size="14" style="transform: rotate(180deg)" />
          </button>
          <span class="deck-nav-counter">{{ slideState ? `${slideState.active + 1} / ${slideState.count}` : '— / —' }}</span>
          <button
            type="button"
            class="icon-only od-tooltip"
            :title="t('fileViewer.nextSlide')"
            :data-tooltip="t('fileViewer.nextSlide')"
            data-tooltip-placement="bottom"
            :aria-label="t('fileViewer.nextSlide')"
            :disabled="slideState !== null && slideState.active >= slideState.count - 1"
            @click="postSlide('next')"
          >
            <Icon name="chevron-right" :size="14" />
          </button>
        </span>
      </div>
      <div class="viewer-toolbar-actions">
        <div v-if="showPreviewToolbarControls" class="viewer-toolbar-inline-actions">
          <button
            v-if="effectiveDeck && hasSpeakerNotes && !notesOpen && !manualEditMode"
            type="button"
            class="viewer-action viewer-action-icon od-tooltip"
            :data-tooltip="t('app.speakerNotesShow')"
            data-tooltip-placement="bottom"
            :title="t('app.speakerNotesShow')"
            :aria-label="t('app.speakerNotesShow')"
            @click="notesOpen = true"
          >
            <RemixIcon name="file-text-line" :size="15" />
          </button>
          <button
            type="button"
            class="viewer-action viewer-action-icon od-tooltip"
            data-testid="copy-screenshot-button"
            :data-tooltip="t('app.copyScreenshot')"
            data-tooltip-placement="bottom"
            :title="t('app.copyScreenshot')"
            :aria-label="t('app.copyScreenshot')"
            :disabled="!hasContent"
            @click="void copyScreenshot()"
          >
            <RemixIcon name="camera-line" :size="15" />
          </button>
          <template v-if="reviewAvailable">
            <div class="artifact-tool-menu-anchor">
              <button
                type="button"
                :class="['viewer-action', 'viewer-action-icon', 'viewer-comment-toggle', 'od-tooltip', { active: commentToolActive }]"
                data-testid="board-mode-toggle"
                :data-tooltip="t('fileViewer.comment')"
                data-tooltip-placement="bottom"
                :title="t('fileViewer.comment')"
                :aria-label="t('fileViewer.comment')"
                :aria-pressed="commentToolActive"
                :disabled="!hasContent"
                @click="activateCommentTool"
              >
                <RemixIcon name="chat-new-line" :size="15" />
              </button>
            </div>
            <button
              :class="['viewer-action', 'viewer-action-icon', 'od-tooltip', { active: drawOverlayOpen }]"
              type="button"
              data-testid="draw-overlay-toggle"
              :data-tooltip="t('fileViewer.mark')"
              data-tooltip-placement="bottom"
              :title="t('fileViewer.mark')"
              :aria-label="t('fileViewer.mark')"
              :aria-pressed="drawOverlayOpen"
              :disabled="!hasContent"
              @click="activateDrawTool"
            >
              <RemixIcon name="mark-pen-line" :size="15" />
            </button>
            <span class="viewer-toolbar-tool-divider" aria-hidden="true" />
            <button
              :class="['viewer-action', 'viewer-action-icon', 'od-tooltip', { active: manualEditMode }]"
              type="button"
              data-testid="manual-edit-mode-toggle"
              :data-tooltip="writable ? t('fileViewer.edit') : readOnlyTitle"
              data-tooltip-placement="bottom"
              :disabled="!writable || !hasContent"
              :title="writable ? t('fileViewer.edit') : readOnlyTitle"
              :aria-label="t('fileViewer.edit')"
              :aria-pressed="manualEditMode"
              @click="activateManualEditTool"
            >
              <RemixIcon name="edit-line" :size="15" />
            </button>
            <span class="viewer-toolbar-tool-divider" aria-hidden="true" />
            <button
              type="button"
              :class="['viewer-action', 'viewer-comment-count-trigger', 'viewer-comment-toggle', 'od-tooltip', { active: commentsToolActive }]"
              data-testid="comment-panel-toggle"
              :data-tooltip="t('chat.tabComments')"
              data-tooltip-placement="bottom"
              :title="t('chat.tabComments')"
              :aria-label="`${t('chat.tabComments')} (${sideComments.length})`"
              :aria-pressed="commentsToolActive"
              :disabled="!hasContent"
              @click="activateCommentCreateTool"
            >
              <RemixIcon name="message-3-line" :size="15" />
              <span class="viewer-comment-count" aria-hidden="true" data-testid="comment-count">{{ sideComments.length }}</span>
            </button>
          </template>
          <div v-if="hasContent" class="zoom-menu viewer-toolbar-zoom">
            <button
              ref="zoomTriggerRef"
              type="button"
              class="viewer-action zoom-trigger od-tooltip"
              aria-haspopup="menu"
              :aria-expanded="zoomMenuOpen"
              :title="t('fileViewer.resetZoom')"
              :data-tooltip="t('fileViewer.resetZoom')"
              data-tooltip-placement="bottom"
              data-testid="zoom-trigger"
              @click="zoomMenuOpen = !zoomMenuOpen"
            >
              <span style="font-variant-numeric: tabular-nums">{{ zoomPercentLabel(previewZoomPercent) }}</span>
            </button>
            <AnchoredPopover :anchor="zoomTriggerRef" :open="zoomMenuOpen" class-name="zoom-menu-popover odp-floating-menu" @close="zoomMenuOpen = false">
              <button
                type="button"
                :class="['zoom-menu-item', { active: zoomPref.mode === 'auto' }]"
                role="menuitem"
                @click="
                  zoomPref = { mode: 'auto', zoom: 100 };
                  zoomMenuOpen = false;
                "
              >
                <span>{{ t('app.zoomFit') }}</span>
                <Icon v-if="zoomPref.mode === 'auto'" name="check" :size="13" />
              </button>
              <button
                v-for="level in ZOOM_LEVELS"
                :key="level"
                type="button"
                :class="['zoom-menu-item', { active: zoomLevelActive(level) }]"
                role="menuitem"
                @click="
                  setManualZoom(level);
                  zoomMenuOpen = false;
                "
              >
                <span style="font-variant-numeric: tabular-nums">{{ level }}%</span>
                <Icon v-if="zoomLevelActive(level)" name="check" :size="13" />
              </button>
            </AnchoredPopover>
          </div>
        </div>
        <div class="viewer-toolbar-more">
          <button
            ref="moreTriggerRef"
            type="button"
            class="viewer-action viewer-action-icon od-tooltip"
            :aria-label="t('nextStep.more')"
            aria-haspopup="menu"
            :aria-expanded="moreOpen"
            :data-tooltip="t('nextStep.more')"
            data-tooltip-placement="bottom"
            :title="t('nextStep.more')"
            data-testid="toolbar-more"
            @click="moreOpen = !moreOpen"
          >
            <RemixIcon name="more-2-line" :size="16" />
          </button>
          <AnchoredPopover :anchor="moreTriggerRef" :open="moreOpen" class-name="viewer-toolbar-more-menu odp-floating-menu" @close="moreOpen = false">
            <button
              v-for="preset in PREVIEW_VIEWPORT_PRESETS"
              :key="preset.id"
              type="button"
              :class="['viewer-toolbar-more-item', { active: viewport === preset.id }]"
              role="menuitem"
              :title="t(preset.titleKey)"
              @click="chooseViewport(preset.id)"
            >
              <RemixIcon :name="previewViewportIcon(preset.id)" :size="15" />
              <span>{{ t(preset.labelKey) }}</span>
              <Icon v-if="viewport === preset.id" name="check" :size="13" />
            </button>
            <template v-if="showDeckNavigation">
              <div class="viewer-toolbar-more-separator" role="separator" />
              <button
                type="button"
                class="viewer-toolbar-more-item"
                role="menuitem"
                :disabled="slideState !== null && slideState.active <= 0"
                @click="moreAction(() => postSlide('prev'))"
              >
                <Icon name="chevron-right" :size="14" style="transform: rotate(180deg)" />
                <span>{{ t('fileViewer.previousSlide') }}</span>
              </button>
              <button
                type="button"
                class="viewer-toolbar-more-item"
                role="menuitem"
                :disabled="slideState !== null && slideState.active >= slideState.count - 1"
                @click="moreAction(() => postSlide('next'))"
              >
                <Icon name="chevron-right" :size="14" />
                <span>{{ t('fileViewer.nextSlide') }}</span>
              </button>
            </template>
            <template v-if="reviewAvailable && hasContent">
              <div class="viewer-toolbar-more-separator" role="separator" />
              <button
                type="button"
                :class="['viewer-toolbar-more-item', { active: commentToolActive }]"
                role="menuitem"
                @click="moreAction(activateCommentTool)"
              >
                <RemixIcon name="chat-new-line" :size="15" />
                <span>{{ t('fileViewer.comment') }}</span>
              </button>
              <button
                type="button"
                :class="['viewer-toolbar-more-item', { active: drawOverlayOpen }]"
                role="menuitem"
                @click="moreAction(activateDrawTool)"
              >
                <RemixIcon name="mark-pen-line" :size="15" />
                <span>{{ t('fileViewer.mark') }}</span>
              </button>
              <button
                type="button"
                :class="['viewer-toolbar-more-item', { active: manualEditMode }]"
                role="menuitem"
                :disabled="!writable"
                @click="moreAction(activateManualEditTool)"
              >
                <RemixIcon name="edit-line" :size="15" />
                <span>{{ t('fileViewer.edit') }}</span>
              </button>
              <button
                type="button"
                :class="['viewer-toolbar-more-item', { active: commentsToolActive }]"
                role="menuitem"
                @click="moreAction(activateCommentCreateTool)"
              >
                <RemixIcon name="message-3-line" :size="15" />
                <span>{{ t('chat.tabComments') }} ({{ sideComments.length }})</span>
              </button>
            </template>
            <div class="viewer-toolbar-more-separator" role="separator" />
            <button type="button" class="viewer-toolbar-more-item" role="menuitem" :disabled="!hasContent" @click="presentNewTab">
              <RemixIcon name="external-link-line" :size="15" />
              <span>{{ t('common.openInNewTab') }}</span>
            </button>
            <button type="button" class="viewer-toolbar-more-item" role="menuitem" :disabled="raw === null" @click="moreAction(copySource)">
              <RemixIcon name="file-copy-line" :size="15" />
              <span>{{ t('app.copySource') }}</span>
            </button>
            <template v-if="mode === 'preview' && hasContent">
              <div class="viewer-toolbar-more-separator" role="separator" />
              <button
                v-for="level in ZOOM_LEVELS"
                :key="level"
                type="button"
                :class="['viewer-toolbar-more-item', { active: zoomLevelActive(level) }]"
                role="menuitem"
                @click="moreAction(() => setManualZoom(level))"
              >
                <RemixIcon name="zoom-in-line" :size="15" />
                <span style="font-variant-numeric: tabular-nums">{{ level }}%</span>
                <Icon v-if="zoomLevelActive(level)" name="check" :size="13" />
              </button>
            </template>
          </AnchoredPopover>
        </div>
        <div v-if="viewerOnly || !actionsHost" class="odp-inline-file-actions">
          <HtmlViewerActions
            :t="t"
            :has-content="hasContent"
            :has-source="raw !== null"
            :is-deck="effectiveDeck"
            :file-url="fileUrl"
            :download-name="baseName(file.name)"
            @present="startPresent"
            @present-new-tab="presentNewTab"
            @export="(format) => void runExport(format)"
            @copy-source="copySource"
          />
        </div>
      </div>
    </div>
    <Teleport v-if="!viewerOnly && actionsHost && active" :to="actionsHost">
      <div :data-od-file-actions-owner="file.name" style="display: contents">
        <HtmlViewerActions
          :t="t"
          :has-content="hasContent"
          :has-source="raw !== null"
          :is-deck="effectiveDeck"
          :file-url="fileUrl"
          :download-name="baseName(file.name)"
          @present="startPresent"
          @present-new-tab="presentNewTab"
          @export="(format) => void runExport(format)"
          @copy-source="copySource"
        />
      </div>
    </Teleport>
    <div ref="bodyRef" class="viewer-body">
      <div v-if="loadError && !hasContent" class="viewer-empty">{{ t('fileViewer.previewUnavailable') }}</div>
      <FileViewerLoadingSkeleton v-else-if="initialLoading" />
      <template v-else>
        <div
          ref="layoutEl"
          :hidden="mode !== 'preview'"
          :aria-hidden="mode !== 'preview' ? 'true' : undefined"
          :class="[layoutClass, 'preview-viewport', `preview-viewport-${viewport}`, { 'preview-draw-active': drawOverlayOpen }]"
          :data-testid="manualEditMode ? 'manual-edit-workspace' : 'comment-preview-layout'"
          :style="layoutStyle"
          @mouseleave="manualEditMode ? manualEdit.clearHover() : undefined"
        >
          <ManualEditPanel v-if="manualPanelActive" v-bind="manualPanelProps" />
          <button
            v-if="manualHoverTarget"
            type="button"
            class="manual-edit-hover-action"
            data-testid="manual-edit-hover-open"
            :aria-label="t('manualEdit.editParams')"
            :title="t('manualEdit.editParams')"
            :style="manualHoverStyle"
            @click="manualEdit.openHover()"
          >
            <Icon name="sliders" :size="15" />
          </button>
          <DeckThumbnailRail
            v-if="showDeckThumbnailRail && !railCollapsed"
            :count="deckSlideTotal"
            :active-index="activeDeckSlideIndex"
            :label-total="deckNavTotal"
            :build-thumb-src-doc="buildThumbSrcDoc"
            :parsed-deck="parsedDeck"
            :preview-viewport="thumbViewport"
            @select="goToSlide"
          />
          <div
            ref="canvasEl"
            :class="manualEditMode ? 'manual-edit-canvas' : 'comment-preview-canvas'"
            :data-testid="manualEditMode ? 'manual-edit-canvas' : 'comment-preview-canvas'"
          >
            <div :class="manualEditMode ? undefined : 'comment-frame-clip'" :style="manualEditMode ? { height: '100%' } : undefined">
              <div :style="shellStyle">
                <TranslationScope :remap="MARK_TOOL_REMAP">
                  <PreviewDrawOverlay
                    :active="drawOverlayOpen && active"
                    :on-active-change="(next: boolean) => (drawOverlayOpen = next)"
                    capture-viewport
                    :capture-target="null"
                    :file-path="file.name"
                    :toolbar-host="manualEditMode ? null : layoutEl"
                  >
                    <div class="artifact-preview-transport-stack">
                      <iframe
                        ref="iframeRef"
                        data-testid="artifact-preview-frame"
                        data-od-render-mode="srcdoc"
                        data-od-active="true"
                        :title="file.name"
                        :sandbox="HTML_PREVIEW_SANDBOX"
                        :srcdoc="srcDoc"
                        :tabindex="active && mode === 'preview' ? 0 : -1"
                        @load="frameLoads += 1"
                      />
                    </div>
                  </PreviewDrawOverlay>
                </TranslationScope>
              </div>
            </div>
            <CommentPreviewOverlays
              v-if="boardMode && !manualEditMode"
              :comments="commentCreateMode ? creationSorted : []"
              :pin-numbers="pinNumbers"
              :provisional-pin-number="provisionalPin"
              :live-targets="liveTargets"
              :hovered-target="hoveredTarget"
              :active-target="activeTarget"
              :active-existing-comment-id="activeComment?.id ?? null"
              :show-active-pin="commentCreateMode"
              :scale="overlayScale"
              :active-slide-index="effectiveDeck ? slideState?.active ?? null : null"
              :t="t"
              @open-comment="openComment"
            />
            <div
              v-if="showDeckFloatingNav"
              :class="['deck-floating-nav', { 'is-revealed': navRevealed }]"
              aria-label="Deck navigation"
              data-testid="deck-floating-nav"
              @pointerenter="onNavPointerEnter"
              @pointerleave="onNavPointerLeave"
              @focusin="navRevealed = true"
            >
              <button
                type="button"
                class="deck-floating-button od-tooltip"
                :aria-label="t('fileViewer.previousSlide')"
                :title="t('fileViewer.previousSlide')"
                :data-tooltip="t('fileViewer.previousSlide')"
                data-tooltip-placement="top"
                :disabled="activeDeckSlideIndex <= 0"
                data-testid="deck-prev"
                @click="postSlide('prev')"
              >
                <Icon name="chevron-left" :size="14" />
              </button>
              <span class="deck-floating-count" aria-live="polite" data-testid="deck-count">
                <strong>{{ activeDeckSlideIndex + 1 }}</strong>
                <span>/</span>
                <span>{{ deckNavTotal }}</span>
              </span>
              <button
                type="button"
                class="deck-floating-button od-tooltip"
                :aria-label="t('fileViewer.nextSlide')"
                :title="t('fileViewer.nextSlide')"
                :data-tooltip="t('fileViewer.nextSlide')"
                data-tooltip-placement="top"
                :disabled="activeDeckSlideIndex >= deckNavTotal - 1"
                data-testid="deck-next"
                @click="postSlide('next')"
              >
                <Icon name="chevron-right" :size="14" />
              </button>
              <span class="deck-floating-divider" aria-hidden="true" />
              <button type="button" class="deck-floating-reset" :disabled="activeDeckSlideIndex <= 0" @click="goToSlide(0)">
                {{ t('fileViewer.presenterReset') }}
                <kbd>R</kbd>
              </button>
            </div>
            <AnnotationHoverPopover
              v-if="active && boardMode && !commentCreateMode && hoveredTarget && !activeTarget"
              :target="hoveredTarget"
              :scale="overlayScale"
              :bounds="canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined"
              :offset="{ x: 0, y: 0 }"
              @mouseenter="onHoverCardEnter"
              @mouseleave="onHoverCardLeave"
            />
            <div v-if="redirectBlocked" class="odp-preview-notice" role="status">{{ t('app.redirectLoop') }}</div>
          </div>
        </div>
        <Teleport v-if="composerVisible && activeTarget && composerMetricsNow && layoutEl" :to="layoutEl">
          <BoardComposerPopover
            :target="activeTarget"
            :existing="activeComment"
            :draft="commentDraft"
            :notes="queuedNotes"
            v-bind="composerHandlers"
            :images="boardImagePreviews"
            :existing-images="existingImages"
            :sending="sendingComment"
            :allow-send-to-chat="false"
            :can-send-to-agent="false"
            :t="t"
            :scale="overlayScale"
            :offset="composerMetricsNow.offset"
            :bounds="composerMetricsNow.bounds"
            :docked="false"
            commenting
          />
        </Teleport>
        <template v-if="mode !== 'preview'">
          <div v-if="raw === null" class="viewer-empty">{{ t('fileViewer.loading') }}</div>
          <pre v-else class="viewer-source" data-testid="viewer-source">{{ raw }}</pre>
        </template>
      </template>
    </div>
    <section
      v-if="effectiveDeck && mode === 'preview' && hasSpeakerNotes && notesOpen && !manualEditMode"
      class="speaker-notes-panel"
      data-testid="speaker-notes-panel"
      :aria-label="t('fileViewer.speakerNotes')"
    >
      <div class="speaker-notes-panel-head">
        <div class="speaker-notes-panel-title">
          <span>{{ t('fileViewer.speakerNotes') }}</span>
          <span class="speaker-notes-panel-meta">
            {{ t('fileViewer.speakerNotesSlide', { current: activeDeckSlideIndex + 1, total: Math.max(deckSlideCount, speakerNotes.length, 1) }) }}
          </span>
        </div>
        <button
          type="button"
          class="icon-only od-tooltip"
          :aria-label="t('app.speakerNotesHide')"
          :title="t('app.speakerNotesHide')"
          :data-tooltip="t('app.speakerNotesHide')"
          data-tooltip-placement="top"
          @click="notesOpen = false"
        >
          <Icon name="close" :size="12" />
        </button>
      </div>
      <div class="speaker-notes-preview" role="textbox" tabindex="0" aria-readonly="true">
        <template v-if="activeSpeakerNote.trim()">{{ activeSpeakerNote }}</template>
        <span v-else class="speaker-notes-empty">{{ t('fileViewer.speakerNotesEmpty') }}</span>
      </div>
    </section>
    <component :is="commentHost ? Teleport : 'div'" v-if="commentPanelVisible && comments" v-bind="commentHost ? { to: commentHost } : { class: 'odp-comment-panel-inline' }">
      <CommentSidePanel
        :comments="sideComments"
        :resolved-comments="resolvedComments"
        :pin-numbers="pinNumbers"
        :load-state="comments.loadState"
        :selected-ids="selectedIds"
        :active-comment-id="activeCommentId"
        :collapsed="commentPanelCollapsed"
        :attachment-url="comments.attachmentUrl"
        :deck-slide-count="effectiveDeck ? slideState?.count : undefined"
        :sending="sendingComment"
        :on-create-comment="savePanelComment"
        :t="t"
        @retry="void comments.refresh()"
        @collapsed-change="commentPanelCollapsed = $event"
        @dismiss="dismissCommentPanel"
        @toggle-select="toggleSelect"
        @select-all="selectedIds = new Set(sideComments.map((comment) => comment.id))"
        @clear-selection="selectedIds = new Set()"
        @reorder="reorderComments"
        @reply="(comment) => openComment(comment)"
        @resolve-selected="void resolveSelected()"
        @reopen="(comment) => void comments!.setStatus([comment.id], 'open')"
        @copy-selected="void copySelected()"
      />
    </component>
    <Teleport v-if="active && presenting && prepared" to="body">
      <div ref="presentOverlayRef" v-bind="scope" class="present-overlay" role="dialog" :aria-label="t('fileViewer.present')" data-testid="present-overlay">
        <iframe
          ref="presentFrameRef"
          title="present"
          :sandbox="HTML_PREVIEW_SANDBOX"
          data-od-render-mode="srcdoc"
          :srcdoc="presentationSrcDoc"
          @load="($event.currentTarget as HTMLIFrameElement).focus()"
        />
        <button
          type="button"
          class="present-exit-btn"
          :title="t('fileViewer.exitPresentation')"
          :aria-label="t('fileViewer.exitPresentation')"
          @click="closePresent"
        >
          <Icon name="close" :size="14" />
        </button>
        <div v-if="escHint" class="present-esc-hint" role="status">{{ t('fileViewer.presentEscHint') }}</div>
      </div>
    </Teleport>
  </div>
</template>
