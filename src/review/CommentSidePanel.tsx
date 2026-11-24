// The comments panel ("评论"). Rewritten from apps/web/src/components/
// FileViewer.tsx `CommentSidePanel` + `CommentSideDock` with the same DOM and
// class names, minus team collaboration (authors, sync banner). The batch
// "Send to chat" becomes "Resolve" and "Copy for agent" — the latter copies
// exactly the context block Open Design would attach to an agent message.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import type { TranslateFn } from '../i18n';
import type { PreviewComment, PreviewCommentAttachment } from '../vendor/open-design/contracts/api/comments';
import { Icon } from '../vendor/open-design/components/Icon';
import { RemixIcon } from '../vendor/open-design/components/RemixIcon';
import { Button } from '../vendor/open-design/ui-components';
import type { CommentsLoadState } from './CommentsContext';
import {
  commentAuthorAvatarColor,
  commentAuthorInitials,
  commentCreatedAt,
  commentDisplayLabel,
  formatAbsoluteDateTime,
  formatCommentTime,
  reorderPreviewCommentIds,
  type CommentSideDropEdge,
} from './comment-utils';

const DRAG_MIME = 'application/x-open-design-preview-comment';

interface DragState {
  draggingId: string;
  overId: string | null;
  edge: CommentSideDropEdge | null;
}

function dropEdgeForEvent(event: ReactDragEvent<HTMLElement>): CommentSideDropEdge {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

/** Avatar / pin face: the author's initial when the comment carries a name, else its pin number. */
export function CommentBadgeFace({ comment, number }: { comment: PreviewComment; number: number }) {
  const name = comment.authorDisplayName?.trim();
  return <>{name ? commentAuthorInitials(name) : number}</>;
}

/** List-only disclosure: measure the rendered three-line clamp, never truncate saved data. */
function CommentListBody({ note, t }: { note: string; t: TranslateFn }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      const wasClamped = body.classList.contains('is-clamped');
      if (!wasClamped) body.classList.add('is-clamped');
      const next = body.scrollHeight > body.clientHeight + 1;
      if (!wasClamped) body.classList.remove('is-clamped');
      setOverflows((previous) => (previous === next ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [note, expanded]);
  return (
    <div className="comment-side-body-wrap">
      <div ref={bodyRef} id={bodyId} className={`comment-side-body${expanded ? '' : ' is-clamped'}`}>
        {note}
      </div>
      {overflows ? (
        <button
          type="button"
          className="comment-side-expand"
          aria-controls={bodyId}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {t(expanded ? 'chat.comments.collapseBody' : 'chat.comments.expandBody')}
        </button>
      ) : null}
    </div>
  );
}

export interface CommentSidePanelProps {
  /** Open comments for the file, in display order (newest first by sortKey). */
  comments: PreviewComment[];
  /** Resolved comments for the file, shown on demand. */
  resolvedComments: PreviewComment[];
  /** Pin number per comment id (shared with the canvas pins). */
  pinNumbers: Map<string, number>;
  loadState: CommentsLoadState;
  onRetry: () => void;
  selectedIds: Set<string>;
  activeCommentId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onDismiss: () => void;
  onToggleSelect: (commentId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onReorder: (orderedIds: string[], draggedId: string) => void;
  onReply: (comment: PreviewComment) => void;
  onCreateComment: (note: string) => Promise<boolean>;
  onResolveSelected: () => void;
  onReopen: (comment: PreviewComment) => void;
  onCopySelected: () => void;
  attachmentUrl: (attachment: PreviewCommentAttachment) => string;
  deckSlideCount?: number;
  sending: boolean;
  composer?: ReactNode;
  t: TranslateFn;
}

export function CommentSidePanel({
  comments,
  resolvedComments,
  pinNumbers,
  loadState,
  onRetry,
  selectedIds,
  activeCommentId,
  collapsed,
  onCollapsedChange,
  onDismiss,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onReorder,
  onReply,
  onCreateComment,
  onResolveSelected,
  onReopen,
  onCopySelected,
  attachmentUrl,
  deckSlideCount,
  sending,
  composer,
  t,
}: CommentSidePanelProps) {
  const [newCommentDraft, setNewCommentDraft] = useState('');
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const showAge = !collapsed && comments.length + resolvedComments.length > 0;
  useEffect(() => {
    if (!showAge) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [showAge]);
  const visibleSelectedIds = useMemo(
    () => new Set(comments.filter((comment) => selectedIds.has(comment.id)).map((comment) => comment.id)),
    [comments, selectedIds],
  );
  const selectedCount = visibleSelectedIds.size;
  const allSelected = comments.length > 0 && selectedCount === comments.length;
  const commentsLabel = t('chat.tabComments');
  const canCreate = newCommentDraft.trim().length > 0 && !sending;
  const canReorder = comments.length > 1;
  const collapsedRailRef = useRef<HTMLButtonElement | null>(null);
  const expandedToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocusRef = useRef<'collapsed' | 'expanded' | null>(null);
  const panelId = useId();

  useEffect(() => {
    const target = pendingFocusRef.current === 'collapsed' ? collapsedRailRef.current : pendingFocusRef.current === 'expanded' ? expandedToggleRef.current : null;
    if (!target) return;
    pendingFocusRef.current = null;
    target.focus();
  }, [collapsed]);

  const toggleCollapsed = (next: boolean, focus: 'collapsed' | 'expanded') => {
    pendingFocusRef.current = focus;
    onCollapsedChange(next);
  };

  const submitNewComment = async () => {
    const note = newCommentDraft.trim();
    if (!note) return;
    if (await onCreateComment(note)) setNewCommentDraft('');
  };

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, comment: PreviewComment) => {
    if (!canReorder) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_MIME, comment.id);
    event.dataTransfer.setData('text/plain', comment.id);
    setDragState({ draggingId: comment.id, overId: comment.id, edge: null });
  };
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>, targetId: string) => {
    if (!canReorder) return;
    const draggingId = dragState?.draggingId || event.dataTransfer.getData(DRAG_MIME);
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (draggingId === targetId) {
      if (dragState?.overId !== targetId || dragState.edge !== null) setDragState({ draggingId, overId: targetId, edge: null });
      return;
    }
    const edge = dropEdgeForEvent(event);
    if (dragState?.draggingId !== draggingId || dragState.overId !== targetId || dragState.edge !== edge) {
      setDragState({ draggingId, overId: targetId, edge });
    }
  };
  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, targetId: string) => {
    if (!canReorder) return;
    event.preventDefault();
    const draggingId = dragState?.draggingId || event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!draggingId || draggingId === targetId) {
      setDragState(null);
      return;
    }
    const edge = dragState?.overId === targetId && dragState.edge ? dragState.edge : dropEdgeForEvent(event);
    const nextIds = reorderPreviewCommentIds(comments, draggingId, targetId, edge);
    if (nextIds.join('\0') !== comments.map((comment) => comment.id).join('\0')) onReorder(nextIds, draggingId);
    setDragState(null);
  };

  const renderItem = (comment: PreviewComment, index: number, resolved: boolean) => {
    const selected = !resolved && visibleSelectedIds.has(comment.id);
    const active = comment.id === activeCommentId;
    const number = pinNumbers.get(comment.id) ?? index + 1;
    const avatar = commentAuthorAvatarColor(comment.authorKey ?? '');
    const isDragging = dragState?.draggingId === comment.id;
    const dropClass =
      dragState?.overId === comment.id && dragState.draggingId !== comment.id && dragState.edge ? ` comment-side-item-drop-${dragState.edge}` : '';
    const authorName = comment.authorDisplayName?.trim();
    return (
      <div
        key={comment.id}
        className={`comment-side-item${selected ? ' selected' : ''}${active ? ' active' : ''}${isDragging ? ' dragging' : ''}${dropClass}${resolved ? ' odp-comment-resolved' : ''}`}
        data-testid="comment-side-item"
        data-comment-id={comment.id}
        data-comment-status={comment.status}
        aria-current={active ? 'true' : undefined}
        role="button"
        tabIndex={0}
        onDragOver={resolved ? undefined : (event) => handleDragOver(event, comment.id)}
        onDrop={resolved ? undefined : (event) => handleDrop(event, comment.id)}
        onClick={() => (resolved ? undefined : onReply(comment))}
        onKeyDown={(event) => {
          if (resolved || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onReply(comment);
        }}
      >
        <div className="comment-side-item-head">
          {resolved ? null : (
            <button
              type="button"
              className="comment-side-drag-handle"
              title={t('chat.queuedReorder')}
              aria-label={t('chat.queuedReorder')}
              draggable={canReorder}
              disabled={!canReorder}
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => handleDragStart(event, comment)}
              onDragEnd={() => setDragState(null)}
            >
              <Icon name="grip-vertical" size={13} />
            </button>
          )}
          <span className="comment-side-author" data-author-kind={comment.authorKind ?? 'member'}>
            <span className="comment-side-avatar" style={{ background: avatar.bg, color: avatar.fg }} aria-hidden="true">
              <CommentBadgeFace comment={comment} number={number} />
            </span>
            <span className="comment-side-author-copy">
              <strong>{`${number}. ${commentDisplayLabel(comment, t)}`}</strong>
              {authorName ? <small>{authorName}</small> : null}
            </span>
          </span>
          {typeof comment.slideIndex === 'number' && deckSlideCount && deckSlideCount > 0 ? (
            <span className="comment-side-slide">
              {t('fileViewer.speakerNotesSlide', { current: comment.slideIndex + 1, total: deckSlideCount })}
            </span>
          ) : null}
          <span className="comment-side-time" title={formatAbsoluteDateTime(commentCreatedAt(comment) || undefined)}>
            {formatCommentTime(commentCreatedAt(comment), clock, t)}
          </span>
          {resolved ? (
            <button
              type="button"
              className="odp-comment-reopen"
              data-testid="comment-reopen"
              onClick={(event) => {
                event.stopPropagation();
                onReopen(comment);
              }}
            >
              {t('app.commentsReopen')}
            </button>
          ) : (
            <button
              type="button"
              className={`comment-side-check${selected ? ' checked' : ''}`}
              aria-label={selected ? t('chat.comments.deselect') : t('chat.comments.select')}
              aria-pressed={selected}
              data-testid="comment-side-check"
              onClick={(event) => {
                event.stopPropagation();
                onToggleSelect(comment.id);
              }}
            >
              {selected ? <Icon name="check" size={11} /> : null}
            </button>
          )}
        </div>
        <CommentListBody key={comment.note} note={comment.note} t={t} />
        {comment.attachments && comment.attachments.length > 0 ? (
          <div className="comment-side-attachments">
            {comment.attachments.map((attachment) => {
              const url = attachmentUrl(attachment);
              return (
                <a
                  key={attachment.path}
                  className="comment-side-attachment"
                  data-testid="comment-side-attachment"
                  href={url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={attachment.name}
                  title={attachment.name}
                  onClick={(event) => event.stopPropagation()}
                >
                  {url ? <img src={url} alt={attachment.name} /> : null}
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  if (collapsed) {
    return (
      <div className="comment-side-dock collapsed" data-testid="comment-side-dock">
        <button
          ref={collapsedRailRef}
          type="button"
          className="comment-side-rail"
          data-testid="comment-side-collapsed-rail"
          aria-label={t('preview.showSidebar', { label: commentsLabel })}
          aria-expanded={false}
          title={t('preview.showSidebar', { label: commentsLabel })}
          onClick={() => toggleCollapsed(false, 'expanded')}
        >
          <RemixIcon name="message-3-line" size={15} />
          <span>{commentsLabel}</span>
          {comments.length > 0 ? <strong>{comments.length}</strong> : null}
        </button>
      </div>
    );
  }

  return (
    <div className="comment-side-dock" data-testid="comment-side-dock">
      <aside
        id={panelId}
        className="comment-side-panel"
        data-testid="comment-side-panel"
        aria-label={commentsLabel}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
        }}
      >
        <div className="comment-side-header">
          <div className="comment-side-title">
            <RemixIcon name="message-3-line" size={15} />
            <span>{commentsLabel}</span>
          </div>
          <div className="comment-side-header-actions">
            <button
              ref={expandedToggleRef}
              type="button"
              className="comment-side-collapse"
              aria-label={t('preview.hideSidebar', { label: commentsLabel })}
              aria-controls={panelId}
              aria-expanded
              title={t('preview.hideSidebar', { label: commentsLabel })}
              onClick={() => toggleCollapsed(true, 'collapsed')}
            >
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
        {comments.length > 0 || resolvedComments.length > 0 ? (
          <div className="comment-side-toolbar">
            {comments.length > 0 ? (
              <button type="button" className="comment-side-select-all" disabled={allSelected} onClick={onSelectAll}>
                {t('chat.comments.selectAll')}
              </button>
            ) : null}
            {resolvedComments.length > 0 ? (
              <button
                type="button"
                className="comment-side-select-all odp-comment-resolved-toggle"
                aria-pressed={showResolved}
                data-testid="comment-show-resolved"
                onClick={() => setShowResolved((value) => !value)}
              >
                {t(showResolved ? 'app.commentsHideResolved' : 'app.commentsShowResolved', { n: resolvedComments.length })}
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          className="comment-side-list"
          onDragLeave={(event) => {
            const related = event.relatedTarget;
            if (related instanceof Node && event.currentTarget.contains(related)) return;
            setDragState(null);
          }}
        >
          {loadState === 'loading' ? <div role="status">{t('common.loading')}</div> : null}
          {loadState === 'error' ? (
            <div role="alert">
              {t('chat.comments.loadFailed')}
              <Button variant="ghost" onClick={onRetry}>
                {t('preview.retry')}
              </Button>
            </div>
          ) : null}
          {comments.length === 0 && loadState === 'success' ? (
            <div className="comment-side-empty">{t('chat.comments.emptySaved')}</div>
          ) : (
            comments.map((comment, index) => renderItem(comment, index, false))
          )}
          {showResolved ? resolvedComments.map((comment, index) => renderItem(comment, index, true)) : null}
        </div>
        {selectedCount > 0 ? (
          <div className="comment-side-selectbar" data-testid="comment-side-selectbar">
            <span className="comment-side-selectcount">{t('chat.comments.nSelected', { n: selectedCount })}</span>
            <Button variant="ghost" onClick={onClearSelection}>
              {t('chat.comments.clear')}
            </Button>
            <Button variant="ghost" data-testid="comment-side-resolve" disabled={sending} onClick={onResolveSelected}>
              {t('app.commentsResolve')}
            </Button>
            <Button variant="primary" data-testid="comment-side-copy" disabled={sending} onClick={onCopySelected}>
              {t('app.commentsCopyForAgent')}
            </Button>
          </div>
        ) : null}
        {composer ? <div className="comment-side-composer">{composer}</div> : null}
        <form
          className="comment-side-new-comment composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitNewComment();
          }}
        >
          <div className="composer-shell comment-side-new-comment-shell">
            <div className="composer-input-wrap">
              <div className="composer-textarea-layer">
                <textarea
                  value={newCommentDraft}
                  placeholder={t('chat.comments.placeholder')}
                  aria-label={t('chat.comments.placeholder')}
                  data-testid="comment-side-new-input"
                  onChange={(event) => setNewCommentDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void submitNewComment();
                    }
                  }}
                />
              </div>
            </div>
            <div className="composer-row comment-side-new-comment-actions">
              <span className="composer-spacer" />
              <button type="submit" className={`composer-send${sending ? ' is-sending' : ''}`} disabled={!canCreate} data-testid="comment-side-new-submit">
                <Icon name="send" size={13} />
                <span>{sending ? t('chat.comments.sending') : t('app.commentsPost')}</span>
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}
