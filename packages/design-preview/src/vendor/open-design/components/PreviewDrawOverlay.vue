<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/PreviewDrawOverlay.tsx (Apache-2.0).

  The Mark tool (标记): box-select / pen / text labels drawn over the preview,
  undo / redo, attached images and a note; submitting composites the marks
  onto a preview snapshot and dispatches ANNOTATION_EVENT. Same DOM, classes
  and inline styles as upstream; the default slot is the preview itself.
  [od-design-preview patch] Enter in the note input runs "send" (upstream:
  queue for the next chat turn) — see scripts/sync-upstream.mjs.
-->
<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import Icon from './Icon.vue';
import RemixIcon from './RemixIcon.vue';
import { useT } from '../shims/i18n';
import type { PreviewVisualMarkKind } from '../shims/types';
import { requestPreviewSnapshot } from '../runtime/exports';
import { isImeComposing } from '../utils/imeComposing';
import { px } from '../../../lib/style';
import { usePreviewScope } from '../../../theme';
import {
  ANNOTATION_EVENT,
  DRAW_DOCK_GAP,
  DRAW_DOCK_MARGIN,
  DRAW_DOCK_MIN_HEIGHT,
  DRAW_DOCK_MIN_WIDTH,
  STROKE_COLOR,
  STROKE_WIDTH,
  SUBMIT_ORDER,
  TEXT_FONT_FAMILY,
  TEXT_FONT_FRACTION,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_FONT_PX,
  clamp,
  clamp01,
  closeButtonStyle,
  dockPlacementEquals,
  drawActionButtonStyle,
  drawCaptureTarget,
  drawNormalizedBox,
  drawTextMarks,
  drawToolbarClusterStyle,
  drawToolbarNoteActionsStyle,
  historyButtonStyle,
  normalizedRectFromPoints,
  previewDrawDockBaseStyle,
  previewDrawDockDockedStyle,
  rectsOverlap,
  subToolButtonStyle,
  subToolGroupStyle,
  tooltipStyle,
  type AnnotationAction,
  type AnnotationEventDetail,
  type CaptureFrameRect,
  type CaptureTarget,
  type DockPlacement,
  type DrawDockSide,
  type DrawToolbarElement,
  type MarkTool,
  type NormalizedRect,
  type Point,
  type PreviewSnapshot,
  type Rect,
  type Stroke,
  type TextMark,
} from './preview-draw';

const props = withDefaults(
  defineProps<{
    active?: boolean;
    captureViewport?: boolean;
    onActiveChange?: (active: boolean) => void;
    captureTarget?: CaptureTarget | null;
    captureSnapshot?: () => Promise<PreviewSnapshot | null>;
    captureFrameRect?: () => CaptureFrameRect | null;
    filePath?: string;
    hideChrome?: boolean;
    sendDisabled?: boolean;
    sendDisabledReason?: string;
    onToolbarClick?: (element: DrawToolbarElement, submitAction?: AnnotationAction) => void;
    toolbarHost?: HTMLElement | null;
  }>(),
  {
    active: false,
    captureViewport: false,
    onActiveChange: undefined,
    captureTarget: null,
    captureSnapshot: undefined,
    captureFrameRect: undefined,
    filePath: undefined,
    hideChrome: false,
    sendDisabled: false,
    sendDisabledReason: undefined,
    onToolbarClick: undefined,
    toolbarHost: null,
  },
);

const DrawStyle = () => h('style', tooltipStyle);
const scope = usePreviewScope();

const t = useT();
const wrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const note = ref('');
const markTool = ref<MarkTool>('box');
let strokes: Stroke[] = [];
let undoneStrokes: Stroke[] = [];
let drawing: Stroke | null = null;
// Box-select accumulates: each drag commits another region.
let selectionBoxes: NormalizedRect[] = [];
let boxDraft: { start: Point; current: Point } | null = null;
let composing = false;
const setComposing = (value: boolean) => {
  composing = value;
};
// Text tool labels: state drives the DOM textareas; the plain mirror lets the
// async capture pipeline read the latest labels synchronously.
const textMarks = shallowRef<TextMark[]>([]);
let textMarksMirror: TextMark[] = [];
let textId = 0;
const editingTextId = ref<number | null>(null);
const textAreaEls = new Map<number, HTMLTextAreaElement>();
let textDrag: {
  id: number;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  curX: number;
  curY: number;
  moved: boolean;
} | null = null;
let lastTextTap: { id: number; time: number } | null = null;
// Untransformed layout size of the frame (text glyph size scales with it).
const frameSize = shallowRef<{ w: number; h: number }>({ w: 0, h: 0 });
const hasInk = ref(false);
const hasBox = ref(false);
const hasText = ref(false);
const undoCount = ref(0);
const redoCount = ref(0);
const pendingAction = ref<AnnotationAction | null>(null);
// True only while a host compositor capture is in flight: hides this overlay's
// marks / toolbar so they don't appear in the screenshot.
const capturing = ref(false);
const extraFiles = shallowRef<File[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);
const imagePreviews = shallowRef<{ file: File; url: string }[]>([]);
const previewIndex = ref<number | null>(null);
const captureWarning = shallowRef<{ action: AnnotationAction; message: string } | null>(null);
const dockRef = ref<HTMLDivElement | null>(null);
const layoutRevision = ref(0);
const dockPlacement = shallowRef<DockPlacement>({ layout: 'docked', side: null, style: previewDrawDockDockedStyle });
const sending = computed(() => pendingAction.value !== null);

function bumpLayoutRevision() {
  layoutRevision.value += 1;
}

function redraw() {
  const cvs = canvasRef.value;
  if (!cvs) return;
  if (typeof window.CanvasRenderingContext2D === 'undefined') return;
  const ctx = cvs.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.strokeStyle = STROKE_COLOR;
  const dpr = window.devicePixelRatio || 1;
  ctx.lineWidth = STROKE_WIDTH * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const all = drawing ? [...strokes, drawing] : strokes;
  for (const box of selectionBoxes) drawNormalizedBox(ctx, box, cvs.width, cvs.height);
  const draft = boxDraft ? normalizedRectFromPoints(boxDraft.start, boxDraft.current) : null;
  if (draft) drawNormalizedBox(ctx, draft, cvs.width, cvs.height);
  for (const s of all) {
    const first = s.points[0];
    if (!first) continue;
    ctx.beginPath();
    ctx.moveTo(first.x * cvs.width, first.y * cvs.height);
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i]!;
      ctx.lineTo(p.x * cvs.width, p.y * cvs.height);
    }
    ctx.stroke();
  }
}

// rAF-coalesce redraws driven by the pointermove hot path.
let redrawFrame: number | null = null;
function scheduleRedraw() {
  if (redrawFrame !== null) return;
  redrawFrame = requestAnimationFrame(() => {
    redrawFrame = null;
    redraw();
  });
}

// Size the canvas from the frame's *layout* box (offsetWidth/Height): inside a
// scaled device frame getBoundingClientRect() is already scaled.
watch(
  [wrapRef, canvasRef],
  ([wrap, cvs], _prev, onCleanup) => {
    if (!wrap || !cvs) return;
    const resize = () => {
      const width = wrap.offsetWidth;
      const height = wrap.offsetHeight;
      const dpr = window.devicePixelRatio || 1;
      cvs.width = Math.max(1, Math.floor(width * dpr));
      cvs.height = Math.max(1, Math.floor(height * dpr));
      cvs.style.width = `${width}px`;
      cvs.style.height = `${height}px`;
      const cur = frameSize.value;
      if (cur.w !== width || cur.h !== height) frameSize.value = { w: width, h: height };
      redraw();
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    onCleanup(() => ro.disconnect());
  },
  { immediate: true, flush: 'post' },
);

function onWindowKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    props.onActiveChange?.(false);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoStroke();
    else undoStroke();
  }
}
onMounted(() => window.addEventListener('keydown', onWindowKeyDown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeyDown);
  if (redrawFrame !== null) cancelAnimationFrame(redrawFrame);
});

function syncHistoryState() {
  hasInk.value = strokes.length > 0;
  hasBox.value = selectionBoxes.length > 0;
  hasText.value = textMarksMirror.some((mark) => mark.text.trim().length > 0);
  undoCount.value = strokes.length;
  redoCount.value = undoneStrokes.length;
}

// Route every text-label mutation through here so state and mirror never drift.
function commitTextMarks(next: TextMark[]) {
  textMarksMirror = next;
  textMarks.value = next;
  hasText.value = next.some((mark) => mark.text.trim().length > 0);
}

function pointFromEvent(e: PointerEvent): Point {
  const cvs = canvasRef.value!;
  const rect = cvs.getBoundingClientRect();
  const x = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
  const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function activePreviewIframe(): HTMLIFrameElement | null {
  return (
    wrapRef.value?.querySelector<HTMLIFrameElement>('iframe[data-od-active="true"]') ??
    wrapRef.value?.querySelector<HTMLIFrameElement>('iframe') ??
    null
  );
}

// The snapshot bridge only lives in the srcDoc transport iframe.
function snapshotHostIframe(): HTMLIFrameElement | null {
  return wrapRef.value?.querySelector<HTMLIFrameElement>('iframe[data-od-render-mode="srcdoc"]') ?? activePreviewIframe();
}

function canTryDirectFrameScroll(iframe: HTMLIFrameElement): boolean {
  const sandbox = iframe.getAttribute('sandbox');
  return sandbox === null || /\ballow-same-origin\b/.test(sandbox);
}

function postFrameScrollBy(win: Window, left: number, top: number): boolean {
  try {
    win.postMessage({ type: 'od:preview-scroll-by', left, top }, '*');
    return true;
  } catch {
    return false;
  }
}

function scrollPreviewIframeBy(iframe: HTMLIFrameElement, left: number, top: number): boolean {
  const win = iframe.contentWindow;
  if (!win) return false;
  if (canTryDirectFrameScroll(iframe)) {
    try {
      const scrollBy = win.scrollBy;
      if (typeof scrollBy === 'function') {
        win.scrollBy({ left, top, behavior: 'auto' });
        return true;
      }
    } catch {
      // Sandboxed / cross-origin frames throw on Window property reads.
    }
  }
  return postFrameScrollBy(win, left, top);
}

function onPointerDown(e: PointerEvent) {
  if (!props.active) return;
  e.preventDefault();
  if (sending.value) return;
  if (markTool.value === 'text') {
    // A press on empty canvas drops a fresh label there and opens it for typing.
    const point = pointFromEvent(e);
    textId += 1;
    const id = textId;
    commitTextMarks([...textMarksMirror, { id, x: point.x, y: point.y, text: '' }]);
    editingTextId.value = id;
    return;
  }
  (e.target as Element).setPointerCapture?.(e.pointerId);
  const point = pointFromEvent(e);
  if (markTool.value === 'box') {
    boxDraft = { start: point, current: point };
    syncHistoryState();
    redraw();
    return;
  }
  drawing = { points: [point] };
  redraw();
}
function onPointerMove(e: PointerEvent) {
  if (!props.active) return;
  e.preventDefault();
  if (sending.value) return;
  if (boxDraft) {
    boxDraft.current = pointFromEvent(e);
    scheduleRedraw();
    return;
  }
  if (!drawing) return;
  drawing.points.push(pointFromEvent(e));
  scheduleRedraw();
}
function onPointerUp(e: PointerEvent) {
  if (!props.active) return;
  e.preventDefault();
  if (sending.value) return;
  if (redrawFrame !== null) {
    cancelAnimationFrame(redrawFrame);
    redrawFrame = null;
  }
  if (boxDraft) {
    boxDraft.current = pointFromEvent(e);
    const next = normalizedRectFromPoints(boxDraft.start, boxDraft.current);
    boxDraft = null;
    // Commit the drawn region; ignore accidental micro-drags.
    if (next.width >= 0.006 && next.height >= 0.006) {
      selectionBoxes = [...selectionBoxes, next];
      bumpLayoutRevision();
    }
    syncHistoryState();
    redraw();
    return;
  }
  if (!drawing) return;
  if (drawing.points.length > 1) {
    strokes.push(drawing);
    undoneStrokes = [];
    bumpLayoutRevision();
    syncHistoryState();
  }
  drawing = null;
  redraw();
}

function onCanvasWheel(e: WheelEvent) {
  if (!props.active || sending.value) return;
  const iframe = activePreviewIframe();
  if (!iframe) return;
  if (scrollPreviewIframeBy(iframe, e.deltaX, e.deltaY)) e.preventDefault();
}

function resetTextEditingState() {
  textAreaEls.clear();
  textDrag = null;
  lastTextTap = null;
  editingTextId.value = null;
}

function clearInk() {
  strokes = [];
  undoneStrokes = [];
  drawing = null;
  selectionBoxes = [];
  boxDraft = null;
  resetTextEditingState();
  commitTextMarks([]);
  syncHistoryState();
  redraw();
  bumpLayoutRevision();
}

// Grow a label textarea to exactly fit its text in both axes (`wrap="off"`).
function autosizeTextArea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.width = '0px';
  el.style.height = '0px';
  el.style.width = `${el.scrollWidth + 2}px`;
  el.style.height = `${el.scrollHeight}px`;
}

function setTextAreaRef(id: number, el: unknown) {
  if (el instanceof HTMLTextAreaElement) {
    textAreaEls.set(id, el);
    autosizeTextArea(el);
  } else {
    textAreaEls.delete(id);
  }
}

function updateTextMark(id: number, text: string) {
  commitTextMarks(textMarksMirror.map((mark) => (mark.id === id ? { ...mark, text } : mark)));
}

function removeTextMark(id: number) {
  textAreaEls.delete(id);
  commitTextMarks(textMarksMirror.filter((mark) => mark.id !== id));
}

// Leaving edit mode drops a label that was never typed into.
function handleTextBlur(id: number) {
  if (editingTextId.value === id) editingTextId.value = null;
  const mark = textMarksMirror.find((item) => item.id === id);
  if (mark && mark.text.trim() === '') removeTextMark(id);
}

// Focus the label being edited (caret at end) once it has rendered.
watch(
  [editingTextId, textMarks],
  ([id]) => {
    if (id === null) return;
    const el = textAreaEls.get(id);
    if (el) {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  },
  { flush: 'post' },
);

function onTextPointerDown(e: PointerEvent, mark: TextMark) {
  if (editingTextId.value === mark.id) return; // editing: let the textarea handle it
  e.preventDefault();
  e.stopPropagation();
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  textDrag = {
    id: mark.id,
    pointerId: e.pointerId,
    startX: (e.clientX - rect.left) / rect.width,
    startY: (e.clientY - rect.top) / rect.height,
    originX: mark.x,
    originY: mark.y,
    curX: mark.x,
    curY: mark.y,
    moved: false,
  };
}

// Move the label live by writing its wrapper style directly; commit on up.
function onTextPointerMove(e: PointerEvent, mark: TextMark) {
  const drag = textDrag;
  if (!drag || drag.id !== mark.id) return;
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  const nx = clamp01(drag.originX + ((e.clientX - rect.left) / rect.width - drag.startX));
  const ny = clamp01(drag.originY + ((e.clientY - rect.top) / rect.height - drag.startY));
  drag.curX = nx;
  drag.curY = ny;
  if (Math.abs(nx - drag.originX) > 0.002 || Math.abs(ny - drag.originY) > 0.002) drag.moved = true;
  const el = e.currentTarget as HTMLElement;
  el.style.left = `${nx * 100}%`;
  el.style.top = `${ny * 100}%`;
}

function onTextPointerUp(e: PointerEvent, mark: TextMark) {
  const drag = textDrag;
  if (!drag || drag.id !== mark.id) return;
  (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  textDrag = null;
  if (drag.moved) {
    commitTextMarks(textMarksMirror.map((item) => (item.id === mark.id ? { ...item, x: drag.curX, y: drag.curY } : item)));
    lastTextTap = null;
    return;
  }
  // A second tap on the same label within the window re-opens it for editing.
  const prev = lastTextTap;
  if (prev && prev.id === mark.id && e.timeStamp - prev.time < 320) {
    lastTextTap = null;
    editingTextId.value = mark.id;
  } else {
    lastTextTap = { id: mark.id, time: e.timeStamp };
  }
}

// A frame resize must re-fit every label to the new font size.
watch(
  [frameSize, textMarks],
  () => {
    textAreaEls.forEach((el) => autosizeTextArea(el));
  },
  { flush: 'post' },
);

function addExtraFiles(files: FileList | File[] | null) {
  if (!files) return;
  const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (imgs.length === 0) return;
  extraFiles.value = [...extraFiles.value, ...imgs];
}
function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  addExtraFiles(input.files);
  input.value = '';
}
function onNotePaste(e: ClipboardEvent) {
  const files = e.clipboardData?.files;
  if (!files || files.length === 0) return;
  const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (imgs.length === 0) return;
  e.preventDefault();
  addExtraFiles(imgs);
}
function removeExtraFile(index: number) {
  extraFiles.value = extraFiles.value.filter((_, i) => i !== index);
  previewIndex.value = null;
}

function selectMarkTool(nextTool: MarkTool) {
  props.onToolbarClick?.(nextTool === 'box' ? 'rect' : nextTool === 'text' ? 'text' : 'pen');
  markTool.value = nextTool;
}

// Keep object-URL thumbnails in sync with the attached files; revoke on change.
watch(
  extraFiles,
  (files, _prev, onCleanup) => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    imagePreviews.value = next;
    onCleanup(() => next.forEach((item) => URL.revokeObjectURL(item.url)));
  },
  { immediate: true },
);

// Escape closes the image preview first (capture phase).
watch(previewIndex, (index, _prev, onCleanup) => {
  if (index === null) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      previewIndex.value = null;
    }
  };
  window.addEventListener('keydown', onKey, true);
  onCleanup(() => window.removeEventListener('keydown', onKey, true));
});

function undoStroke() {
  if (sending.value) return;
  // Discard an in-progress draft first, then pop committed boxes (most recent
  // first) before falling back to freehand strokes.
  if (boxDraft) {
    boxDraft = null;
    syncHistoryState();
    redraw();
    bumpLayoutRevision();
    props.onToolbarClick?.('undo');
    return;
  }
  if (selectionBoxes.length > 0) {
    selectionBoxes = selectionBoxes.slice(0, -1);
    syncHistoryState();
    redraw();
    bumpLayoutRevision();
    props.onToolbarClick?.('undo');
    return;
  }
  const stroke = strokes.pop();
  if (!stroke) return;
  props.onToolbarClick?.('undo');
  undoneStrokes.push(stroke);
  drawing = null;
  syncHistoryState();
  redraw();
  bumpLayoutRevision();
}

function redoStroke() {
  if (sending.value) return;
  const stroke = undoneStrokes.pop();
  if (!stroke) return;
  props.onToolbarClick?.('redo');
  strokes.push(stroke);
  drawing = null;
  syncHistoryState();
  redraw();
  bumpLayoutRevision();
}

function closeOverlay() {
  props.onActiveChange?.(false);
}

watch(
  () => props.active,
  (active) => {
    if (active) return;
    strokes = [];
    undoneStrokes = [];
    drawing = null;
    selectionBoxes = [];
    boxDraft = null;
    resetTextEditingState();
    commitTextMarks([]);
    extraFiles.value = [];
    previewIndex.value = null;
    syncHistoryState();
    redraw();
    bumpLayoutRevision();
  },
  { immediate: true },
);

function normalizedRectToCanvasRect(box: NormalizedRect): Rect | null {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: box.x * rect.width,
    y: box.y * rect.height,
    width: Math.max(1, box.width * rect.width),
    height: Math.max(1, box.height * rect.height),
  };
}

function boxBounds(): Rect | null {
  const boxes = selectionBoxes.map((box) => normalizedRectToCanvasRect(box)).filter((box): box is Rect => Boolean(box));
  if (boxes.length === 0) return null;
  // Collapse every committed box into one enclosing rect for the capture crop.
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function lastBoxBounds(): Rect | null {
  const last = selectionBoxes.at(-1);
  return last ? normalizedRectToCanvasRect(last) : null;
}

function strokeRect(stroke: Stroke | null | undefined): Rect | null {
  const rect = canvasRef.value?.getBoundingClientRect();
  const points = stroke?.points ?? [];
  if (!rect || rect.width <= 0 || rect.height <= 0 || points.length === 0) return null;
  const xs = points.map((point) => point.x * rect.width);
  const ys = points.map((point) => point.y * rect.height);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const pad = 8;
  return { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad), width: Math.max(1, maxX - minX + pad * 2), height: Math.max(1, maxY - minY + pad * 2) };
}

function textBounds(): Rect | null {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const rects: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const mark of textMarksMirror) {
    if (mark.text.trim().length === 0) continue;
    const el = textAreaEls.get(mark.id);
    if (el) {
      const box = el.getBoundingClientRect();
      rects.push({ left: box.left - rect.left, top: box.top - rect.top, right: box.right - rect.left, bottom: box.bottom - rect.top });
    } else {
      // No live element: fall back to the drop point.
      const left = mark.x * rect.width;
      const top = mark.y * rect.height;
      rects.push({ left, top, right: left + 1, bottom: top + 1 });
    }
  }
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((item) => item.left));
  const top = Math.min(...rects.map((item) => item.top));
  const right = Math.max(...rects.map((item) => item.right));
  const bottom = Math.max(...rects.map((item) => item.bottom));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function strokeBounds(): Rect | null {
  const points = strokes.flatMap((stroke) => stroke.points);
  return strokeRect(points.length > 0 ? { points } : null);
}

function lastStrokeBounds(): Rect | null {
  return strokeRect(strokes.at(-1));
}

function anchorBounds(): Rect | null {
  return lastBoxBounds() ?? lastStrokeBounds() ?? props.captureTarget?.position ?? null;
}

function annotationBounds(): Rect | undefined {
  const bounds = [boxBounds(), strokeBounds(), textBounds(), props.captureTarget?.position ?? null].filter((item): item is Rect => Boolean(item));
  if (bounds.length === 0) return undefined;
  if (bounds.length === 1) return bounds[0];
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function markKind(): PreviewVisualMarkKind | undefined {
  const hasTarget = Boolean(props.captureTarget);
  const hasVisualMark = hasInk.value || hasBox.value || hasText.value;
  if (hasTarget && hasVisualMark) return 'click+stroke';
  if (hasTarget) return 'click';
  if (hasVisualMark) return 'stroke';
  return undefined;
}

function waitForOverlayHidden(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function snapshotFrameRect(): CaptureFrameRect | null {
  return (
    props.captureFrameRect?.() ??
    (props.captureSnapshot ? wrapRef.value?.getBoundingClientRect() : activePreviewIframe()?.getBoundingClientRect()) ??
    null
  );
}

async function requestSnapshot(): Promise<PreviewSnapshot | null> {
  if (props.captureSnapshot) {
    // The host's compositor screenshot would include this overlay's marks and
    // toolbar: hide them for the capture (re-painted by compositeWithBackground).
    capturing.value = true;
    await nextTick();
    try {
      await waitForOverlayHidden();
      return await props.captureSnapshot();
    } finally {
      capturing.value = false;
      await nextTick();
    }
  }
  const iframe = snapshotHostIframe();
  if (!iframe) return null;
  // Capture mode may still be swapping the srcDoc frame: retry with growing timeouts.
  for (const timeout of [1500, 3000, 6000]) {
    const snapshot = await requestPreviewSnapshot(iframe, timeout);
    if (snapshot) return snapshot;
  }
  return null;
}

async function compositeWithBackground(snap: PreviewSnapshot): Promise<Blob | null> {
  const rect = snapshotFrameRect();
  if (!rect) return null;
  const out = document.createElement('canvas');
  out.width = snap.w;
  out.height = snap.h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  const bg = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = snap.dataUrl;
  });
  if (!bg) return null;
  // Opaque base so a transparent snapshot never flattens the annotation to black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(bg, 0, 0, snap.w, snap.h);
  const sx = snap.w / Math.max(1, rect.width);
  const sy = snap.h / Math.max(1, rect.height);
  drawCaptureTarget(ctx, sx, sy, props.captureTarget);
  for (const box of selectionBoxes) drawNormalizedBox(ctx, box, snap.w, snap.h);
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = STROKE_WIDTH * Math.max(sx, sy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const first = s.points[0];
    if (!first) continue;
    ctx.beginPath();
    ctx.moveTo(first.x * snap.w, first.y * snap.h);
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i]!;
      ctx.lineTo(p.x * snap.w, p.y * snap.h);
    }
    ctx.stroke();
  }
  drawTextMarks(ctx, textMarksMirror, snap.w, snap.h);
  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
}

async function send(action: AnnotationAction) {
  const hasTarget = Boolean(props.captureTarget);
  const shouldCapture = hasInk.value || hasBox.value || hasText.value || hasTarget || props.captureViewport;
  const canSubmitNow = shouldCapture || Boolean(note.value.trim()) || extraFiles.value.length > 0;
  if (sending.value || !canSubmitNow) return;
  if (action === 'send' && props.sendDisabled) return;
  props.onToolbarClick?.('annotation_submit', action);
  captureWarning.value = null;
  pendingAction.value = action;
  try {
    let file: File | null = null;
    if (shouldCapture) {
      let blob: Blob | null = null;
      const snap = await requestSnapshot();
      if (snap) blob = await compositeWithBackground(snap);
      if (blob) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        file = new File([blob], `drawing-${ts}.png`, { type: 'image/png' });
      } else if (!note.value.trim() && extraFiles.value.length === 0) {
        // Best-effort snapshot: only block when the annotation is pure bitmap.
        captureWarning.value = {
          action,
          message:
            props.captureViewport && !hasInk.value && !hasBox.value && !hasTarget
              ? t('chat.annotationPreviewMissing')
              : t('chat.annotationPreviewMissingInk'),
        };
        return;
      }
    }
    const sentWithoutScreenshot = shouldCapture && !file;
    const kind = markKind();
    const files = extraFiles.value;
    const result = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
      let settled = false;
      const finish = (next: { ok: boolean; message?: string }) => {
        if (settled) return;
        settled = true;
        resolve(next);
      };
      window.setTimeout(() => finish({ ok: false, message: t('chat.annotationTimeout') }), 60000);
      const detail: AnnotationEventDetail = {
        file,
        note: note.value.trim(),
        action,
        filePath: props.captureTarget?.filePath || props.filePath,
        markKind: kind,
        bounds: kind ? annotationBounds() : undefined,
        target: props.captureTarget,
        extraFiles: files.length ? files : undefined,
        ack: finish,
      };
      window.dispatchEvent(new CustomEvent(ANNOTATION_EVENT, { detail }));
    });
    if (!result.ok) {
      captureWarning.value = { action, message: result.message || t('chat.annotationFailed') };
      return;
    }
    clearInk();
    // Degraded sends keep the user honest about what the agent received.
    captureWarning.value = sentWithoutScreenshot ? { action, message: t('chat.annotationSentWithoutScreenshot') } : null;
    note.value = '';
    extraFiles.value = [];
    previewIndex.value = null;
  } finally {
    pendingAction.value = null;
  }
}

// In a scaled, clipped device frame the toolbar would be cut off: prefer the
// caller-provided preview viewport, else `.viewer-body`.
const resolvedToolbarHost = shallowRef<HTMLElement | null>(null);
watch(
  [() => props.active, () => props.toolbarHost, wrapRef],
  ([active, toolbarHost, wrap]) => {
    resolvedToolbarHost.value = active ? toolbarHost ?? (wrap?.closest('.viewer-body') as HTMLElement | null) ?? null : null;
  },
  { immediate: true, flush: 'post' },
);

const DOCKED: DockPlacement = { layout: 'docked', side: null, style: previewDrawDockDockedStyle };
function setDockPlacement(next: DockPlacement) {
  if (!dockPlacementEquals(dockPlacement.value, next)) dockPlacement.value = next;
}

watch(
  [
    () => props.active,
    resolvedToolbarHost,
    () => props.captureTarget,
    layoutRevision,
    () => imagePreviews.value.length,
    () => captureWarning.value?.message,
    dockRef,
  ],
  () => {
    if (!props.active) {
      setDockPlacement(DOCKED);
      return;
    }
    const wrap = wrapRef.value;
    const dock = dockRef.value;
    const host = resolvedToolbarHost.value ?? wrap;
    const anchor = anchorBounds();
    if (!wrap || !dock || !host || !anchor) {
      setDockPlacement(DOCKED);
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    if (
      hostRect.width <= DRAW_DOCK_MARGIN * 2 ||
      hostRect.height <= DRAW_DOCK_MARGIN * 2 ||
      dockRect.width <= 0 ||
      dockRect.height <= 0 ||
      hostRect.width < Math.max(DRAW_DOCK_MIN_WIDTH, dockRect.width) + DRAW_DOCK_MARGIN * 2 ||
      hostRect.height < Math.max(DRAW_DOCK_MIN_HEIGHT, dockRect.height) + DRAW_DOCK_MARGIN * 2
    ) {
      setDockPlacement(DOCKED);
      return;
    }
    const anchorInHost: Rect = {
      x: wrapRect.left - hostRect.left + anchor.x,
      y: wrapRect.top - hostRect.top + anchor.y,
      width: anchor.width,
      height: anchor.height,
    };
    const safeLeft = DRAW_DOCK_MARGIN;
    const safeTop = DRAW_DOCK_MARGIN;
    const safeRight = Math.max(safeLeft, hostRect.width - dockRect.width - DRAW_DOCK_MARGIN);
    const safeBottom = Math.max(safeTop, hostRect.height - dockRect.height - DRAW_DOCK_MARGIN);
    const centeredLeft = anchorInHost.x + anchorInHost.width / 2 - dockRect.width / 2;
    const centeredTop = anchorInHost.y + anchorInHost.height / 2 - dockRect.height / 2;
    const candidates: Array<{ side: DrawDockSide; left: number; top: number; fits: boolean }> = [
      {
        side: 'right',
        left: anchorInHost.x + anchorInHost.width + DRAW_DOCK_GAP,
        top: centeredTop,
        fits: anchorInHost.x + anchorInHost.width + DRAW_DOCK_GAP + dockRect.width <= hostRect.width - DRAW_DOCK_MARGIN,
      },
      {
        side: 'left',
        left: anchorInHost.x - DRAW_DOCK_GAP - dockRect.width,
        top: centeredTop,
        fits: anchorInHost.x - DRAW_DOCK_GAP - dockRect.width >= DRAW_DOCK_MARGIN,
      },
      {
        side: 'bottom',
        left: centeredLeft,
        top: anchorInHost.y + anchorInHost.height + DRAW_DOCK_GAP,
        fits: anchorInHost.y + anchorInHost.height + DRAW_DOCK_GAP + dockRect.height <= hostRect.height - DRAW_DOCK_MARGIN,
      },
      {
        side: 'top',
        left: centeredLeft,
        top: anchorInHost.y - DRAW_DOCK_GAP - dockRect.height,
        fits: anchorInHost.y - DRAW_DOCK_GAP - dockRect.height >= DRAW_DOCK_MARGIN,
      },
    ];
    let nextPlacement: DockPlacement = DOCKED;
    for (const candidate of candidates) {
      if (!candidate.fits) continue;
      const clampedLeft = clamp(candidate.left, safeLeft, safeRight);
      const clampedTop = clamp(candidate.top, safeTop, safeBottom);
      const candidateRect: Rect = { x: clampedLeft, y: clampedTop, width: dockRect.width, height: dockRect.height };
      if (rectsOverlap(candidateRect, anchorInHost)) continue;
      nextPlacement = {
        layout: 'floating',
        side: candidate.side,
        style: {
          position: 'absolute',
          left: `${Math.round(clampedLeft)}px`,
          top: `${Math.round(clampedTop)}px`,
          transform: 'none',
          bottom: 'auto',
          maxWidth: `${Math.max(0, hostRect.width - DRAW_DOCK_MARGIN * 2)}px`,
        },
      };
      break;
    }
    setDockPlacement(nextPlacement);
  },
  { immediate: true, flush: 'post' },
);

watch(
  [() => props.active, resolvedToolbarHost, dockRef, wrapRef],
  ([active, host, dock, wrap], _prev, onCleanup) => {
    if (!active || typeof ResizeObserver === 'undefined') return;
    const target = host ?? wrap;
    if (!wrap || !dock || !target) return;
    const ro = new ResizeObserver(() => bumpLayoutRevision());
    ro.observe(wrap);
    ro.observe(dock);
    if (target !== wrap) ro.observe(target);
    onCleanup(() => ro.disconnect());
  },
  { flush: 'post' },
);

const overlayPointer = computed(() => (props.active ? 'auto' : 'none'));
const showCanvas = computed(() => props.active || hasInk.value || hasBox.value || hasText.value);
const textLayerVisible = computed(() => props.active || hasText.value);
const textFontPx = computed(() => Math.max(TEXT_MIN_FONT_PX, TEXT_FONT_FRACTION * frameSize.value.h));
const canSubmit = computed(
  () =>
    hasInk.value ||
    hasBox.value ||
    hasText.value ||
    Boolean(props.captureTarget) ||
    props.captureViewport ||
    Boolean(note.value.trim()) ||
    extraFiles.value.length > 0,
);
const activePreview = computed(() => (previewIndex.value !== null ? imagePreviews.value[previewIndex.value] ?? null : null));
const canSend = computed(() => canSubmit.value && !props.sendDisabled);
const canUndo = computed(() => (undoCount.value > 0 || hasBox.value) && !sending.value);
const canRedo = computed(() => redoCount.value > 0 && !sending.value);
const chromeHidden = computed(() => capturing.value || props.hideChrome);

// Each submit action's icon, labels and enable rule.
const submitOptions = computed(() =>
  [
    {
      action: 'send' as const,
      label: t('chat.send'),
      pendingLabel: t('chat.annotationSending'),
      title: props.sendDisabled ? props.sendDisabledReason ?? t('chat.annotationSendDisabledReason') : t('chat.send'),
      icon: { kind: 'icon' as const, name: 'send' as const, size: 14 },
      enabled: canSend.value,
    },
    {
      action: 'draft' as const,
      label: t('chat.annotationAddToInput'),
      pendingLabel: t('chat.annotationAddingToInput'),
      title: t('chat.annotationAddToInput'),
      icon: { kind: 'remix' as const, name: 'input-field', size: 15 },
      enabled: canSubmit.value,
    },
    {
      action: 'queue' as const,
      label: t('chat.annotationQueue'),
      pendingLabel: t('chat.annotationQueueing'),
      title: t('chat.annotationQueue'),
      icon: { kind: 'remix' as const, name: 'list-check-2', size: 15 },
      enabled: canSubmit.value,
    },
  ].sort((a, b) => SUBMIT_ORDER.indexOf(a.action) - SUBMIT_ORDER.indexOf(b.action)),
);

// The segmented tool group: box-select, freehand pen, drop-a-text-label.
const markToolOptions = computed<{ tool: MarkTool; label: string; icon: string }[]>(() => [
  { tool: 'box', label: t('fileViewer.boxSelect'), icon: 'checkbox-blank-line' },
  { tool: 'pen', label: t('sketch.toolPen'), icon: 'pencil-line' },
  { tool: 'text', label: t('fileViewer.textTool'), icon: 'text' },
]);

function onNoteKeyDown(e: KeyboardEvent) {
  if (isImeComposing(e, composing)) return;
  if (e.key === 'Enter') void send('send'); // [od-design-preview patch] see scripts/sync-upstream.mjs PATCHES
}

function textareaStyle(editing: boolean) {
  return px({
    display: 'block',
    margin: 0,
    padding: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre',
    boxShadow: 'none',
    color: STROKE_COLOR,
    caretColor: STROKE_COLOR,
    fontFamily: TEXT_FONT_FAMILY,
    fontWeight: 600,
    fontSize: textFontPx.value,
    lineHeight: TEXT_LINE_HEIGHT,
    minWidth: Math.max(2, Math.round(textFontPx.value * 0.5)),
    textShadow: '0 0 3px rgba(255,255,255,0.75)',
    pointerEvents: editing ? 'auto' : 'none',
    userSelect: editing ? 'text' : 'none',
    WebkitUserSelect: editing ? 'text' : 'none',
    cursor: editing ? 'text' : 'move',
  });
}
</script>

<template>
  <div
    ref="wrapRef"
    :class="['preview-draw-overlay', { 'preview-draw-overlay-active': active }]"
    style="position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0"
  >
    <slot />
    <canvas
      v-if="showCanvas"
      ref="canvasRef"
      :style="
        px({
          position: 'absolute',
          inset: 0,
          pointerEvents: overlayPointer,
          cursor: active ? (markTool === 'text' ? 'text' : 'crosshair') : 'default',
          visibility: chromeHidden ? 'hidden' : 'visible',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          zIndex: 80,
        })
      "
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onCanvasWheel"
    />
    <div
      v-if="textLayerVisible"
      class="preview-draw-text-layer"
      :style="{ position: 'absolute', inset: '0', pointerEvents: 'none', visibility: chromeHidden ? 'hidden' : 'visible', zIndex: 81 }"
    >
      <div
        v-for="mark in textMarks"
        :key="mark.id"
        class="preview-draw-text-mark"
        :style="{
          position: 'absolute',
          left: `${mark.x * 100}%`,
          top: `${mark.y * 100}%`,
          display: 'block',
          pointerEvents: markTool === 'text' ? 'auto' : 'none',
          cursor: editingTextId === mark.id ? 'default' : 'move',
          touchAction: 'none',
        }"
        @pointerdown="onTextPointerDown($event, mark)"
        @pointermove="onTextPointerMove($event, mark)"
        @pointerup="onTextPointerUp($event, mark)"
        @pointercancel="onTextPointerUp($event, mark)"
      >
        <textarea
          :ref="(el) => setTextAreaRef(mark.id, el)"
          :value="mark.text"
          wrap="off"
          rows="1"
          spellcheck="false"
          :readonly="editingTextId !== mark.id"
          :aria-label="t('fileViewer.textTool')"
          :style="textareaStyle(editingTextId === mark.id)"
          @input="
            updateTextMark(mark.id, ($event.target as HTMLTextAreaElement).value);
            autosizeTextArea($event.target as HTMLTextAreaElement);
          "
          @blur="handleTextBlur(mark.id)"
          @keydown.esc.stop="($event.target as HTMLTextAreaElement).blur()"
        />
        <button
          v-if="markTool === 'text'"
          type="button"
          class="preview-draw-text-remove"
          :aria-label="t('fileViewer.textAnnotationRemove')"
          :title="t('fileViewer.textAnnotationRemove')"
          @pointerdown.prevent.stop
          @click="removeTextMark(mark.id)"
        >
          <Icon name="close" :size="8" />
        </button>
      </div>
    </div>
    <Teleport v-if="active" :to="resolvedToolbarHost ?? 'body'" :disabled="!resolvedToolbarHost">
      <DrawStyle />
      <div
        ref="dockRef"
        v-bind="resolvedToolbarHost ? {} : scope"
        class="preview-draw-dock"
        :data-draw-layout="dockPlacement.layout"
        :data-draw-side="dockPlacement.side ?? undefined"
        :style="px({ ...previewDrawDockBaseStyle, ...dockPlacement.style })"
      >
        <div
          v-if="captureWarning"
          role="status"
          aria-live="polite"
          :style="
            px({
              display: 'flex',
              alignItems: 'center',
              maxWidth: '100%',
              padding: '8px 12px',
              borderRadius: 999,
              background: 'rgba(20,20,20,0.92)',
              color: '#fff',
              boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
              backdropFilter: 'blur(8px)',
              zIndex: 92,
              pointerEvents: 'none',
              fontSize: 13,
              lineHeight: 1.35,
              visibility: chromeHidden ? 'hidden' : undefined,
            })
          "
        >
          <span>{{ captureWarning.message }}</span>
        </div>
        <div
          v-if="imagePreviews.length > 0"
          :aria-label="t('chat.annotationAttachedImages')"
          :style="
            px({
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: '100%',
              overflowX: 'auto',
              padding: '6px 8px',
              background: 'rgba(20,20,20,0.92)',
              borderRadius: 12,
              boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
              backdropFilter: 'blur(8px)',
              zIndex: 90,
              pointerEvents: 'auto',
              visibility: chromeHidden ? 'hidden' : undefined,
            })
          "
        >
          <div v-for="(item, i) in imagePreviews" :key="item.url" style="position: relative; flex: 0 0 auto">
            <button
              type="button"
              :disabled="sending"
              :title="item.file.name"
              :aria-label="item.file.name"
              :style="
                px({
                  display: 'block',
                  width: 44,
                  height: 44,
                  padding: 0,
                  border: '1px solid rgba(255,255,255,0.22)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: 'rgba(255,255,255,0.08)',
                  cursor: sending ? 'wait' : 'zoom-in',
                })
              "
              @click="previewIndex = i"
            >
              <img :src="item.url" alt="" aria-hidden="true" style="width: 100%; height: 100%; object-fit: cover; display: block" />
            </button>
            <button
              type="button"
              :disabled="sending"
              :aria-label="t('chat.annotationAttachedRemove')"
              :title="t('chat.annotationAttachedRemove')"
              :style="
                px({
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 18,
                  height: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  border: '1px solid rgba(0,0,0,0.25)',
                  background: '#1f1f1f',
                  color: '#fff',
                  cursor: sending ? 'wait' : 'pointer',
                  padding: 0,
                })
              "
              @click="removeExtraFile(i)"
            >
              <Icon name="close" :size="14" />
            </button>
          </div>
        </div>
        <div
          class="preview-draw-toolbar"
          :style="
            px({
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              alignContent: 'center',
              flexWrap: 'nowrap',
              gap: 6,
              boxSizing: 'border-box',
              width: 'max-content',
              maxWidth: '100%',
              overflow: 'visible',
              padding: 6,
              background: 'rgba(20,20,20,0.92)',
              color: '#fff',
              borderRadius: 22,
              boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
              backdropFilter: 'blur(8px)',
              zIndex: 91,
              pointerEvents: 'auto',
              fontSize: 13,
              visibility: chromeHidden ? 'hidden' : undefined,
            })
          "
        >
          <div class="preview-draw-tool-cluster" :style="px(drawToolbarClusterStyle)">
            <!-- Segmented tool group: every mark tool one click away, the armed one visible. -->
            <div role="group" :style="px(subToolGroupStyle)" :aria-label="t('fileViewer.markTool')">
              <button
                v-for="item in markToolOptions"
                :key="item.tool"
                type="button"
                :disabled="sending"
                :aria-pressed="markTool === item.tool"
                :aria-label="item.label"
                :title="item.label"
                :data-tooltip="item.label"
                class="preview-draw-subtool-action"
                :style="px(subToolButtonStyle(markTool === item.tool))"
                @click="selectMarkTool(item.tool)"
              >
                <RemixIcon :name="item.icon" :size="14" />
              </button>
            </div>
            <button
              type="button"
              :disabled="!canUndo"
              :style="px(historyButtonStyle(canUndo))"
              :aria-label="t('manualEdit.undo')"
              :title="t('manualEdit.undo')"
              @click="undoStroke"
            >
              <RemixIcon name="arrow-go-back-line" :size="14" />
            </button>
            <button
              type="button"
              :disabled="!canRedo"
              :style="px(historyButtonStyle(canRedo))"
              :aria-label="t('manualEdit.redo')"
              :title="t('manualEdit.redo')"
              @click="redoStroke"
            >
              <RemixIcon name="arrow-go-forward-line" :size="14" />
            </button>
            <input ref="fileInputRef" type="file" accept="image/*" multiple style="display: none" @change="onFileInputChange" />
            <button
              type="button"
              :disabled="sending"
              :aria-label="t('chat.annotationAttachImage')"
              :title="t('chat.annotationAttachImage')"
              :data-tooltip="t('chat.annotationAttachImage')"
              class="preview-draw-icon-action"
              :style="px(historyButtonStyle(!sending))"
              @click="
                onToolbarClick?.('attach_image');
                fileInputRef?.click();
              "
            >
              <RemixIcon name="image-add-line" :size="14" />
            </button>
          </div>
          <div class="preview-draw-note-actions" :style="px(drawToolbarNoteActionsStyle)">
            <input
              v-model="note"
              class="preview-draw-note-input"
              :disabled="sending"
              :placeholder="t('chat.annotationNotePlaceholder')"
              :style="
                px({
                  background: 'rgba(218, 97, 56, 0.18)',
                  border: '1px solid rgba(248, 150, 104, 0.82)',
                  borderRadius: 999,
                  outline: 'none',
                  boxShadow: '0 0 0 3px rgba(218, 97, 56, 0.22)',
                  color: 'inherit',
                  flexGrow: 1,
                  flexShrink: 1,
                  flexBasis: 240,
                  minWidth: 0,
                  width: 'clamp(160px, 28vw, 320px)',
                  maxWidth: '100%',
                  padding: '5px 10px',
                  fontSize: 13,
                  transition: 'background 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
                })
              "
              @paste="onNotePaste"
              @compositionstart="setComposing(true)"
              @compositionend="setComposing(false)"
              @keydown="onNoteKeyDown"
            />
            <!-- Three independent buttons, ordered add-to-input → queue → send. -->
            <button
              v-for="opt in submitOptions"
              :key="opt.action"
              type="button"
              :disabled="sending || !opt.enabled"
              :aria-label="pendingAction === opt.action ? opt.pendingLabel : opt.label"
              :title="pendingAction === opt.action ? opt.pendingLabel : opt.title"
              :data-tooltip="pendingAction === opt.action ? opt.pendingLabel : opt.title"
              class="preview-draw-icon-action"
              :style="
                px({
                  ...drawActionButtonStyle(opt.action === 'send'),
                  opacity: opt.enabled ? 1 : 0.4,
                  cursor: sending ? 'wait' : opt.enabled ? 'pointer' : 'not-allowed',
                })
              "
              @click="void send(opt.action)"
            >
              <Icon v-if="pendingAction === opt.action" name="spinner" :size="14" />
              <Icon v-else-if="opt.icon.kind === 'icon'" name="send" :size="opt.icon.size" />
              <RemixIcon v-else :name="opt.icon.name" :size="opt.icon.size" />
            </button>
          </div>
          <button
            type="button"
            :disabled="sending"
            :aria-label="t('common.close')"
            :title="t('common.close')"
            :style="px(closeButtonStyle)"
            @click="
              onToolbarClick?.('exit');
              closeOverlay();
            "
          >
            <Icon name="close" :size="13" />
          </button>
        </div>
      </div>
    </Teleport>
    <Teleport v-if="active && activePreview" to="body">
      <div
        v-bind="scope"
        class="staged-preview-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="activePreview.file.name"
        @mousedown.self="previewIndex = null"
      >
        <div class="staged-preview-card">
          <div class="staged-preview-head">
            <span :title="activePreview.file.name">{{ activePreview.file.name }}</span>
            <button type="button" class="icon-only" :aria-label="t('common.close')" :title="t('common.close')" @click="previewIndex = null">
              <Icon name="close" :size="14" />
            </button>
          </div>
          <img :src="activePreview.url" :alt="activePreview.file.name" />
        </div>
      </div>
    </Teleport>
  </div>
</template>
