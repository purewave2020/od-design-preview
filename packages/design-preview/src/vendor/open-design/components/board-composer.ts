// Framework-free parts of upstream apps/web/src/components/BoardComposerPopover.tsx
// (nexu-io/open-design, Apache-2.0): style-summary rows and the popover /
// hover-card placement math. Returned styles are React-style objects (numbers
// = px); the Vue components pass them through `px()`.
import type { PreviewCommentSnapshot } from '../comments';
import type { PreviewCommentMember } from '../shims/types';

type CSSProperties = Record<string, string | number>;

export function summarizeMember(member: PreviewCommentMember): string {
  const text = String(member.text || '').trim();
  if (text) {
    const trimmed = text.length > 24 ? `${text.slice(0, 21)}...` : text;
    return `${member.label || member.elementId} · ${trimmed}`;
  }
  return member.label || member.elementId;
}

function cssColorToHex(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw || raw === 'transparent' || raw === 'rgba(0, 0, 0, 0)') return null;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) {
    if (raw.length === 4) {
      return '#' + raw.slice(1).split('').map((char) => char + char).join('').toUpperCase();
    }
    return raw.toUpperCase();
  }
  const match = raw.match(/rgba?\(\s*([0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)/i);
  if (!match) return raw;
  const toHex = (part: string | undefined) => {
    const value = Math.max(0, Math.min(255, Math.round(Number(part ?? 0))));
    return value.toString(16).padStart(2, '0').toUpperCase();
  };
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}

function compactFontFamily(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first || null;
}

export type AnnotationStyleRow = { label: string; value: string; swatch?: string };
export type PopoverBounds = { width: number; height: number; scrollLeft?: number; scrollTop?: number };
export type PopoverOffset = { x: number; y: number };
export type PopoverSize = { width: number; height: number };
export type PopoverPosition = { left: number; top: number };
type PopoverSide = 'top' | 'bottom' | 'left' | 'right';

const POPOVER_PAD = 14;
const POPOVER_DEFAULT_WIDTH = 320;
const POPOVER_EXPANDED_ESTIMATED_HEIGHT = 320;
const POPOVER_COLLAPSED_ESTIMATED_HEIGHT = 112;
const POPOVER_MIN_VISIBLE_HEIGHT = 120;

export function annotationStyleRows(target: PreviewCommentSnapshot): AnnotationStyleRow[] {
  const rows: AnnotationStyleRow[] = [];
  const width = Math.round(target.position.width);
  const height = Math.round(target.position.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    rows.push({ label: 'Size', value: `${width}x${height}` });
  }
  const color = cssColorToHex(target.style?.color);
  if (color) rows.push({ label: 'Color', value: color, swatch: color });
  const background = cssColorToHex(target.style?.backgroundColor);
  if (background) rows.push({ label: 'Bg', value: background, swatch: background });

  const fontParts = [
    target.style?.fontSize,
    target.style?.fontWeight && target.style.fontWeight !== '400' ? target.style.fontWeight : null,
    compactFontFamily(target.style?.fontFamily),
  ].filter((part): part is string => Boolean(part));
  if (fontParts.length > 0) {
    rows.push({ label: 'Font', value: fontParts.join(' ') });
  }
  if (target.style?.lineHeight) rows.push({ label: 'Line', value: target.style.lineHeight });
  return rows;
}

function clampPopoverCoordinate(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.round(value));
}

function clampPopoverRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function popoverSizeForPositioning(expanded: boolean, measuredSize?: PopoverSize): PopoverSize {
  return {
    width: measuredSize?.width && measuredSize.width > 0 ? measuredSize.width : POPOVER_DEFAULT_WIDTH,
    height:
      measuredSize?.height && measuredSize.height > 0
        ? measuredSize.height
        : expanded
          ? POPOVER_EXPANDED_ESTIMATED_HEIGHT
          : POPOVER_COLLAPSED_ESTIMATED_HEIGHT,
  };
}

export function clampPopoverPositionStyle(
  left: number,
  top: number,
  bounds: PopoverBounds | undefined,
  size: PopoverSize,
  maxHeightLimit?: number,
): CSSProperties {
  if (!bounds?.width || bounds.width <= 0) {
    return {
      left: clampPopoverCoordinate(left, POPOVER_PAD),
      top: clampPopoverCoordinate(top, POPOVER_PAD),
    };
  }
  const viewportLeft = Math.max(0, bounds.scrollLeft ?? 0);
  const viewportTop = Math.max(0, bounds.scrollTop ?? 0);
  const viewportRight = viewportLeft + bounds.width;
  const viewportBottom = bounds.height ? viewportTop + bounds.height : Number.POSITIVE_INFINITY;
  const minLeft = viewportLeft + POPOVER_PAD;
  const minTop = viewportTop + POPOVER_PAD;
  const maxLeft = Math.max(minLeft, viewportRight - size.width - POPOVER_PAD);
  const effectiveHeight =
    typeof maxHeightLimit === 'number' && Number.isFinite(maxHeightLimit)
      ? Math.min(size.height, Math.max(POPOVER_MIN_VISIBLE_HEIGHT, Math.floor(maxHeightLimit)))
      : size.height;
  const maxTop = Number.isFinite(viewportBottom) ? Math.max(minTop, viewportBottom - effectiveHeight - POPOVER_PAD) : top;
  const clampedTop = clampPopoverRange(top, minTop, maxTop);
  const style: CSSProperties = {
    left: clampPopoverRange(left, minLeft, maxLeft),
    top: clampedTop,
  };
  if (Number.isFinite(viewportBottom)) {
    const visibleHeight = Math.floor(viewportBottom - clampedTop - POPOVER_PAD);
    const limitedHeight =
      typeof maxHeightLimit === 'number' && Number.isFinite(maxHeightLimit) ? Math.min(visibleHeight, Math.floor(maxHeightLimit)) : visibleHeight;
    style.maxHeight = Math.max(POPOVER_MIN_VISIBLE_HEIGHT, limitedHeight);
  }
  return style;
}

export function numericStyleValue(style: CSSProperties, key: 'left' | 'top'): number | null {
  const value = style[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function popoverAnchorStyle(
  target: PreviewCommentSnapshot,
  scale: number,
  bounds?: PopoverBounds,
  offset: PopoverOffset = { x: 0, y: 0 },
  expanded = true,
  measuredSize?: PopoverSize,
): CSSProperties {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const anchor = target.hoverPoint ?? {
    x: target.position.x + Math.min(target.position.width, 24),
    y: target.position.y + Math.min(target.position.height, 24),
  };
  const anchorX = offset.x + anchor.x * safeScale;
  const anchorY = offset.y + anchor.y * safeScale;
  const preferredLeft = clampPopoverCoordinate(anchorX + POPOVER_PAD, POPOVER_PAD);
  const preferredTop = clampPopoverCoordinate(anchorY + POPOVER_PAD, POPOVER_PAD);
  if (bounds?.width && bounds.width > 0) {
    const viewportLeft = Math.max(0, bounds.scrollLeft ?? 0);
    const viewportTop = Math.max(0, bounds.scrollTop ?? 0);
    const viewportRight = viewportLeft + bounds.width;
    const viewportBottom = bounds.height ? viewportTop + bounds.height : Number.POSITIVE_INFINITY;
    const position = target.position;
    const rect = {
      left: offset.x + position.x * safeScale,
      top: offset.y + position.y * safeScale,
      width: Math.max(1, position.width * safeScale),
      height: Math.max(1, position.height * safeScale),
    };
    const rectRight = rect.left + rect.width;
    const rectBottom = rect.top + rect.height;
    const measured = popoverSizeForPositioning(expanded, measuredSize);
    const verticalCenterLeft = rect.left + rect.width / 2 - measured.width / 2;
    const horizontalCenterTop = rect.top + rect.height / 2 - measured.height / 2;
    const spaces = [
      { side: 'top' as const, space: rect.top - viewportTop - POPOVER_PAD, fits: rect.top - viewportTop - POPOVER_PAD >= measured.height },
      { side: 'bottom' as const, space: viewportBottom - rectBottom - POPOVER_PAD, fits: viewportBottom - rectBottom - POPOVER_PAD >= measured.height },
      { side: 'left' as const, space: rect.left - viewportLeft - POPOVER_PAD, fits: rect.left - viewportLeft - POPOVER_PAD >= measured.width },
      { side: 'right' as const, space: viewportRight - rectRight - POPOVER_PAD, fits: viewportRight - rectRight - POPOVER_PAD >= measured.width },
    ];
    const sorted = spaces
      .filter((item) => Number.isFinite(item.space))
      .sort((a, b) => Number(b.fits) - Number(a.fits) || b.space - a.space);
    const sidePosition = (side: PopoverSide): { left: number; top: number; maxHeightLimit?: number } => {
      if (side === 'top') {
        const topLimit = rect.top - POPOVER_PAD;
        const top = Number.isFinite(topLimit) ? Math.max(viewportTop + POPOVER_PAD, topLimit - measured.height) : rect.top - measured.height - POPOVER_PAD;
        return { left: verticalCenterLeft, top, maxHeightLimit: Number.isFinite(topLimit) ? topLimit - top : undefined };
      }
      if (side === 'bottom') {
        const top = rectBottom + POPOVER_PAD;
        return { left: verticalCenterLeft, top, maxHeightLimit: Number.isFinite(viewportBottom) ? viewportBottom - top - POPOVER_PAD : undefined };
      }
      if (side === 'left') {
        return { left: rect.left - measured.width - POPOVER_PAD, top: horizontalCenterTop };
      }
      return { left: rectRight + POPOVER_PAD, top: horizontalCenterTop };
    };
    const fullyFittingSide = sorted.find((item) => item.fits)?.side;
    if (fullyFittingSide) {
      const next = sidePosition(fullyFittingSide);
      return clampPopoverPositionStyle(next.left, next.top, bounds, measured, next.maxHeightLimit);
    }
    const partialVerticalSide = sorted.find(
      (item) => (item.side === 'bottom' || item.side === 'top') && item.space >= POPOVER_MIN_VISIBLE_HEIGHT,
    )?.side;
    if (partialVerticalSide) {
      const next = sidePosition(partialVerticalSide);
      return clampPopoverPositionStyle(next.left, next.top, bounds, measured, next.maxHeightLimit);
    }
    const fallbackLeft =
      anchorX + POPOVER_PAD + measured.width <= viewportRight - POPOVER_PAD ? anchorX + POPOVER_PAD : anchorX - measured.width - POPOVER_PAD;
    return clampPopoverPositionStyle(fallbackLeft, anchorY + POPOVER_PAD, bounds, measured);
  }
  return { left: preferredLeft, top: preferredTop };
}

export function annotationHoverAnchorStyle(
  target: PreviewCommentSnapshot,
  scale: number,
  bounds?: PopoverBounds,
  offset: PopoverOffset = { x: 0, y: 0 },
  measuredSize?: PopoverSize,
): CSSProperties {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const pad = 14;
  const anchor = target.hoverPoint ?? {
    x: target.position.x + Math.min(target.position.width, 24),
    y: target.position.y + Math.min(target.position.height, 24),
  };
  const anchorX = offset.x + anchor.x * safeScale;
  const anchorY = offset.y + anchor.y * safeScale;
  const preferredLeft = anchorX + pad;
  const preferredTop = anchorY + pad;
  if (!bounds?.width || bounds.width <= 0) {
    return { left: clampPopoverCoordinate(preferredLeft, pad), top: clampPopoverCoordinate(preferredTop, pad) };
  }
  // Keep the card fully inside the preview viewport: flip to the opposite side
  // of the anchor when it would spill past an edge; else pin it on-screen.
  const viewportLeft = Math.max(0, bounds.scrollLeft ?? 0);
  const viewportTop = Math.max(0, bounds.scrollTop ?? 0);
  const viewportRight = viewportLeft + bounds.width;
  const viewportBottom = bounds.height ? viewportTop + bounds.height : Number.POSITIVE_INFINITY;
  const cardWidth = measuredSize?.width && measuredSize.width > 0 ? measuredSize.width : 240;
  const cardHeight = measuredSize?.height && measuredSize.height > 0 ? measuredSize.height : 132;
  const minLeft = viewportLeft + pad;
  const minTop = viewportTop + pad;
  const maxLeft = Math.max(minLeft, viewportRight - cardWidth - pad);
  let left = preferredLeft;
  if (left > maxLeft) {
    const flipped = anchorX - cardWidth - pad;
    left = flipped >= minLeft ? flipped : maxLeft;
  }
  if (!Number.isFinite(viewportBottom)) {
    return { left: clampPopoverRange(left, minLeft, maxLeft), top: clampPopoverCoordinate(preferredTop, minTop) };
  }
  const maxTop = Math.max(minTop, viewportBottom - cardHeight - pad);
  let top = preferredTop;
  if (top > maxTop) {
    const flipped = anchorY - cardHeight - pad;
    top = flipped >= minTop ? flipped : maxTop;
  }
  return { left: clampPopoverRange(left, minLeft, maxLeft), top: clampPopoverRange(top, minTop, maxTop) };
}
