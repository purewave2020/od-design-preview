// Canvas overlays for comments: saved pins over their elements, the hover /
// selected target outline, and the pin of the comment being written. Ported
// from apps/web/src/components/FileViewer.tsx `CommentPreviewOverlays` +
// `CommentTargetOverlay` (same classes), without the team drift ladder.
import { memo, useMemo, useRef, type CSSProperties } from 'react';
import type { TranslateFn } from '../i18n';
import {
  commentTargetDisplayName,
  commentVisibleOnDeckSlide,
  liveSnapshotForComment,
  overlayBoundsFromSnapshot,
  type PreviewCommentSnapshot,
} from '../vendor/open-design/comments';
import { commentUsesIdentity, resolveOwnerCommentAnchor } from '../vendor/open-design/comments/owner-anchor';
import type { PreviewComment } from '../vendor/open-design/contracts/api/comments';
import { CommentBadgeFace } from './CommentSidePanel';
import { commentAuthorAvatarColor } from './comment-utils';

function podDisplayMembers(snapshot: PreviewCommentSnapshot): PreviewCommentSnapshot[] {
  if (snapshot.selectionKind !== 'pod' || !Array.isArray(snapshot.podMembers)) return [];
  return snapshot.podMembers.map((member) => ({
    filePath: snapshot.filePath,
    elementId: member.elementId,
    selector: member.selector,
    label: member.label,
    text: member.text,
    position: member.position,
    htmlHint: member.htmlHint,
    selectionKind: 'element' as const,
  }));
}

export function CommentTargetOverlay({
  snapshot,
  scale,
  offset = { x: 0, y: 0 },
  selected,
}: {
  snapshot: PreviewCommentSnapshot;
  scale: number;
  offset?: { x: number; y: number };
  selected: boolean;
}) {
  const members = podDisplayMembers(snapshot);
  const items = members.length > 0 ? members : [snapshot];
  return (
    <>
      {items.map((item) => {
        const bounds = overlayBoundsFromSnapshot(item, scale, offset);
        return (
          <div
            key={item.elementId}
            className={`comment-target-overlay${members.length ? ' comment-target-overlay--member' : ''}${selected ? ' selected' : ''}`}
            style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
            data-testid="comment-target-overlay"
          >
            <span className="comment-target-overlay-label">{item.elementId}</span>
          </div>
        );
      })}
    </>
  );
}

function activeCommentPinStyle(target: PreviewCommentSnapshot, scale: number, offset: { x: number; y: number }): CSSProperties {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const anchor = target.hoverPoint ?? { x: target.position.x, y: target.position.y };
  return { left: Math.round(offset.x + anchor.x * safeScale), top: Math.round(offset.y + anchor.y * safeScale) };
}

export interface CommentPreviewOverlaysProps {
  /** Open comments of this file, in creation order. */
  comments: PreviewComment[];
  pinNumbers: Map<string, number>;
  provisionalPinNumber: number;
  liveTargets: Map<string, PreviewCommentSnapshot>;
  hoveredTarget: PreviewCommentSnapshot | null;
  activeTarget: PreviewCommentSnapshot | null;
  activeExistingCommentId: string | null;
  showActivePin: boolean;
  scale: number;
  activeSlideIndex: number | null;
  onOpenComment: (comment: PreviewComment, snapshot: PreviewCommentSnapshot) => void;
  t: TranslateFn;
}

export const CommentPreviewOverlays = memo(function CommentPreviewOverlays({
  comments,
  pinNumbers,
  provisionalPinNumber,
  liveTargets,
  hoveredTarget,
  activeTarget,
  activeExistingCommentId,
  showActivePin,
  scale,
  activeSlideIndex,
  onOpenComment,
  t,
}: CommentPreviewOverlaysProps) {
  const offset = useMemo(() => ({ x: 0, y: 0 }), []);
  const onOpenRef = useRef(onOpenComment);
  onOpenRef.current = onOpenComment;
  const visible = useMemo(
    () =>
      comments
        .map((comment) => {
          // New comment identities need a unique current target; legacy
          // element ids fall back to the live snapshot map (or a free pin).
          const resolution = commentUsesIdentity(comment) ? resolveOwnerCommentAnchor(comment, liveTargets) : null;
          const snapshot = resolution ? (resolution.state === 'lost' ? null : resolution.snapshot) : liveSnapshotForComment(comment, liveTargets);
          return { comment, snapshot };
        })
        .filter((item): item is { comment: PreviewComment; snapshot: PreviewCommentSnapshot } => Boolean(item.snapshot))
        .filter(({ comment }) => commentVisibleOnDeckSlide(comment, activeSlideIndex)),
    [comments, liveTargets, activeSlideIndex],
  );
  const markers = useMemo(
    () =>
      visible.map(({ comment, snapshot }) => {
        const number = pinNumbers.get(comment.id) ?? 0;
        const bounds = overlayBoundsFromSnapshot(snapshot, scale, offset);
        const color = commentAuthorAvatarColor(comment.authorKey ?? '');
        const label = commentTargetDisplayName(comment);
        const tooltip = `${number}. ${label}: ${comment.note}`;
        return (
          <div
            key={comment.id}
            className="comment-saved-marker"
            style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
            data-testid={`comment-saved-marker-${comment.elementId}`}
            data-pin-number={number}
            onClick={() => onOpenRef.current(comment, snapshot)}
          >
            <div className="comment-saved-outline" />
            <button
              type="button"
              className="comment-saved-pin"
              style={{ background: color.bg, color: color.fg }}
              onClick={(event) => {
                event.stopPropagation();
                onOpenRef.current(comment, snapshot);
              }}
              title={tooltip}
              aria-label={`${t('chat.tabComments')} ${number}: ${label}`}
            >
              <CommentBadgeFace comment={comment} number={number} />
            </button>
          </div>
        );
      }),
    [visible, pinNumbers, scale, offset, t],
  );
  const activeSaved = activeExistingCommentId ? comments.find((comment) => comment.id === activeExistingCommentId) : undefined;
  const activeColor = activeSaved ? commentAuthorAvatarColor(activeSaved.authorKey ?? '') : undefined;
  const activeNumber = activeSaved ? pinNumbers.get(activeSaved.id) ?? provisionalPinNumber : provisionalPinNumber;
  const targetOverlay = activeTarget ?? hoveredTarget;
  return (
    <div className="comment-overlay-layer" aria-hidden={false}>
      {markers}
      {targetOverlay ? <CommentTargetOverlay snapshot={targetOverlay} scale={scale} offset={offset} selected={Boolean(activeTarget)} /> : null}
      {showActivePin && activeTarget ? (
        <div
          className="comment-active-pin"
          style={{
            ...activeCommentPinStyle(activeTarget, scale, offset),
            ...(activeColor ? { background: activeColor.bg, color: activeColor.fg } : {}),
          }}
          data-testid="comment-active-pin"
          data-pin-number={activeNumber}
          aria-hidden="true"
        >
          {activeSaved ? <CommentBadgeFace comment={activeSaved} number={activeNumber} /> : activeNumber}
        </div>
      ) : null}
    </div>
  );
});
