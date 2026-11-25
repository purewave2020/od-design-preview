// Framework-free parts of upstream apps/web/src/components/PreviewDrawOverlay.tsx
// (nexu-io/open-design, Apache-2.0): the annotation event contract, geometry
// helpers, canvas painters and the toolbar's inline style objects (React
// style: numbers = px; the Vue component passes them through `px()`).
import type { PreviewVisualMarkKind } from '../shims/types';

type CSSProperties = Record<string, string | number>;

export interface Point {
  x: number;
  y: number;
}
export interface Stroke {
  points: Point[];
}
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
// A free-floating text label the user drops onto the preview. `x`/`y` are the
// top-left position normalized to the frame (0..1) so it tracks the artifact as
// the device frame scales; `text` is the raw multi-line string.
export interface TextMark {
  id: number;
  x: number;
  y: number;
  text: string;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type MarkTool = 'box' | 'pen' | 'text';
export type DrawDockLayout = 'floating' | 'docked';
export type DrawDockSide = 'right' | 'left' | 'bottom' | 'top';
export interface CaptureTarget {
  filePath?: string;
  elementId?: string;
  selector?: string;
  label?: string;
  text?: string;
  position: { x: number; y: number; width: number; height: number };
  htmlHint?: string;
}
export interface PreviewSnapshot {
  dataUrl: string;
  w: number;
  h: number;
}
export type CaptureFrameRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

export const ANNOTATION_EVENT = 'opendesign:annotation';
export type AnnotationAction = 'draft' | 'queue' | 'send';
export type DrawToolbarElement = 'rect' | 'pen' | 'text' | 'undo' | 'redo' | 'attach_image' | 'annotation_submit' | 'exit';

export interface AnnotationEventDetail {
  file: File | null;
  note: string;
  action: AnnotationAction;
  filePath?: string;
  markKind?: PreviewVisualMarkKind;
  bounds?: { x: number; y: number; width: number; height: number };
  target?: CaptureTarget | null;
  /** Images the user attached in the markup composer to combine with the mark. */
  extraFiles?: File[];
  ack?: (result: { ok: boolean; message?: string }) => void;
}

// Left-to-right order of the three submit buttons. Send is last so it sits
// closest to the toolbar's trailing edge.
export const SUBMIT_ORDER: AnnotationAction[] = ['draft', 'queue', 'send'];

export const STROKE_COLOR = '#ff3b30';
export const STROKE_WIDTH = 4;
export const TARGET_COLOR = '#1677ff';
// Text-annotation glyph height as a fraction of the frame height, so a dropped
// label reads at a consistent size across frames and matches the screenshot.
export const TEXT_FONT_FRACTION = 0.03;
export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_MIN_FONT_PX = 12;
export const TEXT_FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
export const DRAW_DOCK_GAP = 12;
export const DRAW_DOCK_MARGIN = 16;
export const DRAW_DOCK_MIN_WIDTH = 320;
export const DRAW_DOCK_MIN_HEIGHT = 120;

export function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function rectsOverlap(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export interface DockPlacement {
  layout: DrawDockLayout;
  side: DrawDockSide | null;
  style: CSSProperties;
}

export function dockPlacementEquals(a: DockPlacement, b: DockPlacement) {
  return (
    a.layout === b.layout &&
    a.side === b.side &&
    a.style.left === b.style.left &&
    a.style.top === b.style.top &&
    a.style.bottom === b.style.bottom &&
    a.style.transform === b.style.transform &&
    a.style.maxWidth === b.style.maxWidth
  );
}

export function normalizedRectFromPoints(a: Point, b: Point): NormalizedRect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Bake the transparent on-screen labels into the exported screenshot (same
// frame-height fraction as the DOM textareas; soft white halo for legibility).
export function drawTextMarks(ctx: CanvasRenderingContext2D, marks: TextMark[], width: number, height: number) {
  const fontPx = Math.max(TEXT_MIN_FONT_PX, TEXT_FONT_FRACTION * height);
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;
  const topPad = (lineHeight - fontPx) / 2;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `600 ${fontPx}px ${TEXT_FONT_FAMILY}`;
  ctx.fillStyle = STROKE_COLOR;
  ctx.shadowColor = 'rgba(255,255,255,0.75)';
  ctx.shadowBlur = Math.max(1, fontPx * 0.14);
  for (const mark of marks) {
    if (mark.text.trim().length === 0) continue;
    const baseX = mark.x * width;
    const baseY = mark.y * height + topPad;
    mark.text.split('\n').forEach((line, index) => {
      ctx.fillText(line, baseX, baseY + index * lineHeight);
    });
  }
  ctx.restore();
}

export function drawNormalizedBox(ctx: CanvasRenderingContext2D, box: NormalizedRect, width: number, height: number) {
  const left = box.x * width;
  const top = box.y * height;
  const boxWidth = Math.max(1, box.width * width);
  const boxHeight = Math.max(1, box.height * height);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 59, 48, 0.10)';
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.002));
  ctx.setLineDash([10, 6]);
  ctx.fillRect(left, top, boxWidth, boxHeight);
  ctx.strokeRect(left, top, boxWidth, boxHeight);
  ctx.restore();
}

export function drawCaptureTarget(ctx: CanvasRenderingContext2D, scaleX: number, scaleY: number, target: CaptureTarget | null) {
  if (!target) return;
  const { x, y, width, height } = target.position;
  if (![x, y, width, height].every(Number.isFinite)) return;
  if (width <= 0 || height <= 0) return;
  const left = x * scaleX;
  const top = y * scaleY;
  const boxWidth = Math.max(1, width * scaleX);
  const boxHeight = Math.max(1, height * scaleY);
  ctx.save();
  ctx.fillStyle = 'rgba(22, 119, 255, 0.12)';
  ctx.strokeStyle = TARGET_COLOR;
  ctx.lineWidth = Math.max(2, Math.round(Math.max(scaleX, scaleY) * 2));
  ctx.setLineDash([Math.max(8, 8 * scaleX), Math.max(4, 4 * scaleX)]);
  ctx.fillRect(left, top, boxWidth, boxHeight);
  ctx.strokeRect(left, top, boxWidth, boxHeight);
  const label = (target.label || target.elementId || '').trim();
  if (label) {
    const fontSize = Math.max(12, Math.round(12 * Math.max(scaleX, scaleY)));
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    const text = label.length > 42 ? `${label.slice(0, 39)}...` : label;
    const metrics = ctx.measureText(text);
    const padX = Math.max(6, Math.round(6 * scaleX));
    const padY = Math.max(4, Math.round(4 * scaleY));
    const labelWidth = metrics.width + padX * 2;
    const labelHeight = fontSize + padY * 2;
    const labelTop = Math.max(0, top - labelHeight - Math.max(4, 4 * scaleY));
    ctx.setLineDash([]);
    ctx.fillStyle = TARGET_COLOR;
    ctx.fillRect(left, labelTop, labelWidth, labelHeight);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, left + padX, labelTop + padY + fontSize * 0.82);
  }
  ctx.restore();
}

export const tooltipStyle = `
  .preview-draw-overlay-active iframe {
    pointer-events: none !important;
    user-select: none !important;
    -webkit-user-select: none !important;
  }
  .preview-draw-icon-action,
  .preview-draw-subtool-action {
    position: relative;
  }
  .preview-draw-icon-action::after,
  .preview-draw-subtool-action::after {
    content: attr(data-tooltip);
    position: absolute;
    z-index: 12;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translateX(-50%) translateY(2px);
    padding: 4px 7px;
    border-radius: var(--radius-medium, 4px);
    background: rgba(20,20,20,0.94);
    color: #fff;
    font-size: 12px;
    line-height: 1.2;
    opacity: 0;
    pointer-events: none;
    white-space: nowrap;
    transition: opacity 140ms cubic-bezier(0.23, 1, 0.32, 1), transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .preview-draw-icon-action:hover::after,
  .preview-draw-icon-action:focus-visible::after,
  .preview-draw-subtool-action:hover::after,
  .preview-draw-subtool-action:focus-visible::after {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
  /* A label's remove control stays hidden until you hover the label (or tab to
     it), then fades + scales in — subtle, not a permanent hard chip. */
  .preview-draw-text-remove {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 15px;
    height: 15px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.28);
    background: rgba(28,28,30,0.5);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
    color: rgba(255,255,255,0.92);
    box-shadow: 0 1px 4px rgba(0,0,0,0.28);
    cursor: pointer;
    opacity: 0;
    transform: scale(0.9);
    transition: opacity 140ms cubic-bezier(0.23, 1, 0.32, 1), transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .preview-draw-text-mark:hover .preview-draw-text-remove,
  .preview-draw-text-remove:focus-visible {
    opacity: 1;
    transform: scale(1);
  }
  .preview-draw-text-remove:hover {
    background: rgba(42,42,46,0.62);
    color: #fff;
  }
`;

export const subToolGroupStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: 3,
  borderRadius: 999,
  // Track behind the segments, so the armed tool's fill reads as a thumb.
  background: 'rgba(255,255,255,0.08)',
  border: 'none',
  flex: '0 0 auto',
};

export const drawToolbarClusterStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  flex: '0 0 auto',
};

export const drawToolbarNoteActionsStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  flex: '1 1 360px',
  minWidth: 0,
  maxWidth: 420,
};

export function subToolButtonStyle(active: boolean): CSSProperties {
  return {
    border: 'none',
    borderRadius: 999,
    width: 34,
    height: 30,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
    color: '#fff',
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

export function drawActionButtonStyle(primary: boolean): CSSProperties {
  return {
    border: primary ? 'none' : '1px solid rgba(255,255,255,0.2)',
    borderRadius: 999,
    width: 34,
    height: 34,
    padding: 0,
    fontSize: 13,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    whiteSpace: 'nowrap',
    background: primary ? 'var(--accent)' : 'transparent',
    color: primary ? '#fff' : 'inherit',
  };
}

const iconButtonStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 999,
  width: 30,
  minWidth: 30,
  height: 30,
  padding: 0,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 30px',
  aspectRatio: '1 / 1',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
};

export function historyButtonStyle(enabled: boolean): CSSProperties {
  return { ...iconButtonStyle, opacity: enabled ? 1 : 0.36, cursor: enabled ? 'pointer' : 'not-allowed' };
}

export const closeButtonStyle: CSSProperties = {
  ...iconButtonStyle,
  borderColor: 'rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.05)',
};

// Bottom-anchored column that stacks the capture warning, attached-image
// strip, and toolbar with real spacing.
export const previewDrawDockBaseStyle: CSSProperties = {
  position: 'absolute',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  zIndex: 91,
  pointerEvents: 'none',
};

export const previewDrawDockDockedStyle: CSSProperties = {
  left: 'calc(50% - 52px)',
  bottom: 16,
  transform: 'translateX(-50%)',
  maxWidth: 'min(760px, calc(100% - 144px))',
};
