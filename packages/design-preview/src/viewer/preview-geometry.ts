// Viewport presets and zoom math for the HTML preview canvas. Ported from
// apps/web/src/components/FileViewer.tsx (PREVIEW_VIEWPORT_PRESETS,
// previewViewportStyle, previewScaleShellStyle, effectivePreviewScale,
// desktopPreviewAutoFitZoomPercent, resolveDesktopPreviewZoomPercent) so the
// standalone canvas scales exactly like the Open Design workspace.
import type { PreviewViewportId } from '../types';

/** Inline style record (custom properties included). */
type CSSProperties = Record<string, string | number>;

export interface PreviewViewportPreset {
  id: PreviewViewportId;
  width: number | null;
  height: number | null;
  labelKey: string;
  titleKey: string;
}

export interface PreviewCanvasSize {
  width: number;
  height: number;
}

export const PREVIEW_VIEWPORT_PRESETS: PreviewViewportPreset[] = [
  { id: 'desktop', width: null, height: null, labelKey: 'fileViewer.viewportDesktop', titleKey: 'fileViewer.viewportDesktopTitle' },
  { id: 'tablet', width: 820, height: 1180, labelKey: 'fileViewer.viewportTablet', titleKey: 'fileViewer.viewportTabletTitle' },
  { id: 'mobile', width: 390, height: 844, labelKey: 'fileViewer.viewportMobile', titleKey: 'fileViewer.viewportMobileTitle' },
];

export const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200] as const;

export function previewViewportIcon(viewport: PreviewViewportId): string {
  if (viewport === 'tablet') return 'tablet-line';
  if (viewport === 'mobile') return 'smartphone-line';
  return 'computer-line';
}

export function isPreviewViewportId(value: unknown): value is PreviewViewportId {
  return value === 'desktop' || value === 'tablet' || value === 'mobile';
}

export function effectivePreviewScale(
  viewport: PreviewViewportId,
  previewScale: number,
  canvasSize?: PreviewCanvasSize | null,
  canvasPadding = 48,
): number {
  if (viewport === 'desktop') return previewScale;
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
  if (!preset?.width || !preset.height || !canvasSize?.width || !canvasSize.height) return previewScale;
  const availableWidth = Math.max(1, canvasSize.width - canvasPadding);
  const availableHeight = Math.max(1, canvasSize.height - canvasPadding);
  const fitScale = Math.min(1, availableWidth / preset.width, availableHeight / preset.height);
  return Math.min(previewScale, fitScale);
}

export function previewViewportStyle(
  viewport: PreviewViewportId,
  previewScale = 1,
  canvasSize?: PreviewCanvasSize | null,
): CSSProperties & Record<string, string | number> {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport) ?? PREVIEW_VIEWPORT_PRESETS[0]!;
  if (!preset.width) return {};
  const scale = effectivePreviewScale(viewport, previewScale, canvasSize);
  return {
    '--preview-viewport-width': `${preset.width}px`,
    '--preview-viewport-height': `${preset.height}px`,
    '--preview-scale': scale,
    '--preview-user-scale': previewScale,
  };
}

export function previewScaleShellStyle(
  viewport: PreviewViewportId,
  previewScale: number,
): CSSProperties & Record<string, string | number> {
  if (viewport === 'desktop') {
    return {
      width: `${100 / previewScale}%`,
      height: `${100 / previewScale}%`,
      transform: `scale(${previewScale})`,
      transformOrigin: '0 0',
    };
  }
  return {
    width: 'var(--preview-viewport-width)',
    height: 'var(--preview-viewport-height)',
    transform: 'scale(var(--preview-scale, 1))',
    transformOrigin: '0 0',
  };
}

export function desktopPreviewAutoFitZoomPercent(
  canvasSize: PreviewCanvasSize | null | undefined,
  contentWidth?: number | null,
): number {
  if (!canvasSize?.width || !Number.isFinite(canvasSize.width)) return 100;
  if (!contentWidth || !Number.isFinite(contentWidth) || contentWidth <= canvasSize.width) return 100;
  return Math.max(1, Math.min(100, (canvasSize.width / contentWidth) * 100));
}

export function resolveDesktopPreviewZoomPercent(params: {
  zoomMode: 'auto' | 'manual';
  viewport: PreviewViewportId;
  isDeck: boolean;
  manualZoomPercent: number;
  canvasSize: PreviewCanvasSize | null | undefined;
  contentWidth?: number | null;
}): number {
  const { zoomMode, viewport, isDeck, manualZoomPercent, canvasSize, contentWidth } = params;
  if (zoomMode !== 'auto' || viewport !== 'desktop' || isDeck) return manualZoomPercent;
  return desktopPreviewAutoFitZoomPercent(canvasSize, contentWidth);
}

export function zoomPercentLabel(zoomPercent: number): string {
  return `${Math.round(zoomPercent)}%`;
}

export type DeckKeyboardShortcut = 'next' | 'prev' | 'first' | 'last' | 'reset';

export function deckKeyboardShortcutForEvent(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): DeckKeyboardShortcut | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === 'ArrowRight' || event.key === 'PageDown') return 'next';
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') return 'prev';
  if (event.key === 'Home') return 'first';
  if (event.key === 'End') return 'last';
  if (event.key.toLowerCase() === 'r') return 'reset';
  return null;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** FileViewer's `sourceLooksLikeDeckPreview` (class="slide" or a navigable deck). */
export function sourceLooksLikeDeckPreview(
  source: string | null | undefined,
  looksNavigable: (source: string) => boolean,
): boolean {
  if (!source) return false;
  return /class\s*=\s*['"](?:[^'"]*\s)?slide(?:\s|['"])/i.test(source) || looksNavigable(source);
}
