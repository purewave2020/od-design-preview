// Normalisation of the selection bridge's comment-target payloads, ported
// from apps/web/src/components/FileViewer.tsx (snapshotFromData,
// clampBridgeCoordinate, normalizeAnnotationStyle, finiteBridgeInteger).
// The frame is untrusted: every field is coerced and bounded before it
// reaches React state.
import type { PreviewCommentSnapshot } from '../vendor/open-design/comments';

const MAX_BRIDGE_COORDINATE = 1_000_000;

const ANNOTATION_STYLE_KEYS = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'fontFamily',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
] as const;

export function clampBridgeCoordinate(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-MAX_BRIDGE_COORDINATE, Math.min(MAX_BRIDGE_COORDINATE, Math.round(numeric)));
}

function finiteBridgeInteger(value: unknown): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return clampBridgeCoordinate(value);
}

function normalizeAnnotationStyle(input: unknown): PreviewCommentSnapshot['style'] {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const style: NonNullable<PreviewCommentSnapshot['style']> = {};
  for (const key of ANNOTATION_STYLE_KEYS) {
    const value = raw[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed) style[key] = trimmed.slice(0, 120);
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

export type BridgeSnapshotData = Partial<Omit<PreviewCommentSnapshot, 'position' | 'hoverPoint'>> & {
  position?: Partial<PreviewCommentSnapshot['position']>;
  hoverPoint?: Partial<NonNullable<PreviewCommentSnapshot['hoverPoint']>>;
};

export function snapshotFromBridge(filePath: string, data: BridgeSnapshotData): PreviewCommentSnapshot {
  return {
    filePath,
    elementId: String(data.elementId || ''),
    selector: String(data.selector || ''),
    domSelector: typeof data.domSelector === 'string' ? data.domSelector : undefined,
    label: String(data.label || ''),
    text: String(data.text || ''),
    position: {
      x: clampBridgeCoordinate(data.position?.x),
      y: clampBridgeCoordinate(data.position?.y),
      width: clampBridgeCoordinate(data.position?.width),
      height: clampBridgeCoordinate(data.position?.height),
    },
    hoverPoint: data.hoverPoint ? { x: clampBridgeCoordinate(data.hoverPoint.x), y: clampBridgeCoordinate(data.hoverPoint.y) } : undefined,
    htmlHint: String(data.htmlHint || ''),
    style: normalizeAnnotationStyle(data.style),
    selectionKind: data.selectionKind === 'pod' ? 'pod' : 'element',
    memberCount: finiteBridgeInteger(data.memberCount),
    podMembers: Array.isArray(data.podMembers) ? data.podMembers : undefined,
    ...(typeof data.slideIndex === 'number' ? { slideIndex: data.slideIndex } : {}),
  };
}
