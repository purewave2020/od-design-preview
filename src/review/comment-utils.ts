// Comment presentation helpers, ported from apps/web/src/components/
// FileViewer.tsx (formatCommentTime, commentAuthorAvatarColor,
// commentAuthorInitials, commentDisplayLabel, commentEffectiveSortKey,
// computeReorderedSortKey, reorderPreviewCommentIds) so the pins and the
// comments panel number, colour and order comments exactly like Open Design.
import type { TranslateFn } from '../i18n';
import { resolveCommentTargetTitle } from '../vendor/open-design/contracts/comment-target-title';
import type { PreviewComment } from '../vendor/open-design/contracts/api/comments';

export function formatCommentTime(ts: number, now: number, t: TranslateFn): string {
  if (ts <= 0) return '—';
  const diff = now - ts;
  if (diff < 60_000) return t('common.justNow');
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t('common.minutesAgo', { n: mins });
  const date = new Date(ts);
  const today = new Date(now);
  const isSameDay =
    date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  if (isSameDay) return t('common.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return t('common.yesterday');
  const crossYear = date.getFullYear() !== today.getFullYear();
  try {
    return date.toLocaleDateString(undefined, crossYear ? { year: 'numeric', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
  } catch {
    return date.toISOString();
  }
}

export function formatAbsoluteDateTime(ts: number | undefined): string | undefined {
  if (!ts || !Number.isFinite(ts)) return undefined;
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return undefined;
  }
}

/** Unknown creation age must not borrow an edit or receipt timestamp. */
export function commentCreatedAt(comment: PreviewComment): number {
  return Number.isFinite(comment.createdAt) && comment.createdAt > 0 && comment.createdAt <= Number.MAX_SAFE_INTEGER
    ? comment.createdAt
    : 0;
}

/** Sidebar ordering key: persisted `sortKey`, else `createdAt` (newest first). */
export function commentEffectiveSortKey(comment: PreviewComment): number {
  return Number.isFinite(comment.sortKey) ? (comment.sortKey as number) : commentCreatedAt(comment);
}

// Stable avatar palette for comment authors (same 30 swatches as upstream).
export const COMMENT_AUTHOR_AVATAR_COLORS = [
  { bg: '#7DB7FF', fg: '#144582' },
  { bg: '#FFB86B', fg: '#803D12' },
  { bg: '#B19AFF', fg: '#482D80' },
  { bg: '#6DDDB1', fg: '#155C40' },
  { bg: '#FF92BC', fg: '#7D234C' },
  { bg: '#F7D45B', fg: '#75560C' },
  { bg: '#69D5F0', fg: '#155365' },
  { bg: '#FF9B85', fg: '#733526' },
  { bg: '#8DE56C', fg: '#285728' },
  { bg: '#D58FFF', fg: '#5A2C6D' },
  { bg: '#91A9FF', fg: '#283F75' },
  { bg: '#FFC76B', fg: '#634E28' },
  { bg: '#68DEC9', fg: '#1C5C53' },
  { bg: '#FF8BC7', fg: '#702D48' },
  { bg: '#BDE66A', fg: '#445D20' },
  { bg: '#B78AFF', fg: '#442C64' },
  { bg: '#5ED9B3', fg: '#1B5349' },
  { bg: '#FF939D', fg: '#6E342E' },
  { bg: '#78C7FF', fg: '#2E516A' },
  { bg: '#F5CF63', fg: '#6B5118' },
  { bg: '#9AE883', fg: '#375C38' },
  { bg: '#EA8AD7', fg: '#563450' },
  { bg: '#6EDA94', fg: '#274E38' },
  { bg: '#9E9BFF', fg: '#363861' },
  { bg: '#FFA277', fg: '#6C3F1D' },
  { bg: '#ABE779', fg: '#3D6030' },
  { bg: '#68D4E6', fg: '#285567' },
  { bg: '#D99AFA', fg: '#63365A' },
  { bg: '#FFD17C', fg: '#625034' },
  { bg: '#6CDCD9', fg: '#33585E' },
] as const;

export function commentAuthorAvatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COMMENT_AUTHOR_AVATAR_COLORS[hash % COMMENT_AUTHOR_AVATAR_COLORS.length] ?? COMMENT_AUTHOR_AVATAR_COLORS[0];
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** First grapheme of a name, preserving joined emoji and combining marks. */
export function commentAuthorInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = segmenter ? segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment : trimmed[0];
  return (first ?? '?').toUpperCase();
}

export function commentDisplayLabel(comment: Pick<PreviewComment, 'elementId' | 'label' | 'text' | 'htmlHint'>, t: TranslateFn): string {
  const title = resolveCommentTargetTitle(comment);
  if (title.name) return title.name;
  switch (title.kind) {
    case 'pin':
      return t('chat.comments.pin');
    case 'image':
      return t('chat.comments.targetImage');
    case 'control':
      return t('chat.comments.targetControl');
    case 'link':
      return t('chat.comments.targetLink');
    case 'text':
      return t('chat.comments.targetText');
    case 'section':
      return t('chat.comments.targetSection');
    case 'page':
      return t('chat.comments.targetPage');
    case 'area':
      return t('chat.comments.targetArea');
  }
}

/** Pin number: the persisted `pinSeq`, else creation rank. */
export function commentPinNumber(comment: PreviewComment, creationRank: Map<string, number>, fallbackIndex: number): number {
  if (typeof comment.pinSeq === 'number') return comment.pinSeq;
  return creationRank.get(comment.id) ?? fallbackIndex + 1;
}

export type CommentSideDropEdge = 'before' | 'after';

export function reorderPreviewCommentIds(
  comments: PreviewComment[],
  draggingId: string,
  targetId: string,
  edge: CommentSideDropEdge,
): string[] {
  const ids = comments.map((comment) => comment.id);
  const from = ids.indexOf(draggingId);
  if (from < 0) return ids;
  const [draggedId] = ids.splice(from, 1);
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex < 0 || !draggedId) return comments.map((comment) => comment.id);
  ids.splice(edge === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
  return ids;
}

/** Midpoint between the dragged comment's new neighbours (one row is written). */
export function computeReorderedSortKey(comments: PreviewComment[], orderedIds: string[], draggedId: string): number {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const newIndex = orderedIds.indexOf(draggedId);
  const dragged = byId.get(draggedId);
  if (newIndex < 0 || !dragged) return commentEffectiveSortKey(dragged ?? comments[0]!);
  const above = newIndex > 0 ? byId.get(orderedIds[newIndex - 1]!) : undefined;
  const below = newIndex < orderedIds.length - 1 ? byId.get(orderedIds[newIndex + 1]!) : undefined;
  if (above && below) return (commentEffectiveSortKey(above) + commentEffectiveSortKey(below)) / 2;
  if (above) return commentEffectiveSortKey(above) - 1;
  if (below) return commentEffectiveSortKey(below) + 1;
  return commentEffectiveSortKey(dragged);
}
