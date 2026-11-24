// Project-wide comment state shared by every open viewer (the role
// ProjectView plays for FileViewer upstream: it owns `previewComments` and
// hands down save / status / reorder / delete callbacks).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PreviewSource } from '../sources/types';
import type {
  PreviewComment,
  PreviewCommentAttachment,
  PreviewCommentStatus,
  PreviewCommentTarget,
} from '../vendor/open-design/contracts/api/comments';
import { commentStoreFor, type CommentStore } from './comment-store';

export type CommentsLoadState = 'loading' | 'error' | 'success';

export interface CommentsApi {
  store: CommentStore;
  comments: PreviewComment[];
  loadState: CommentsLoadState;
  refresh(): Promise<void>;
  /**
   * Create (no `existingId`) or update a comment. `images` are new files to
   * attach; `keepAttachments` are already-saved ones to retain on edit.
   */
  save(input: {
    target: PreviewCommentTarget;
    note: string;
    images?: File[];
    existingId?: string;
    keepAttachments?: PreviewCommentAttachment[];
  }): Promise<PreviewComment | null>;
  setStatus(ids: string[], status: PreviewCommentStatus): Promise<boolean>;
  reorder(id: string, sortKey: number): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  attachmentUrl(attachment: PreviewCommentAttachment): string;
}

const CommentsContext = createContext<CommentsApi | null>(null);

export function CommentsProvider({ source, children }: { source: PreviewSource; children: ReactNode }) {
  const store = useMemo(() => commentStoreFor(source), [source]);
  const [comments, setComments] = useState<PreviewComment[]>([]);
  const [loadState, setLoadState] = useState<CommentsLoadState>('loading');
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    // One list read at a time; a refresh requested meanwhile runs once after.
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        try {
          const next = await store.list();
          setComments(next);
          setLoadState('success');
        } catch {
          setLoadState((current) => (current === 'success' ? current : 'error'));
        }
      } while (again.current);
    })();
    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
  }, [store]);

  useEffect(() => {
    setComments([]);
    setLoadState('loading');
    void refresh();
    return store.subscribe(() => void refresh());
  }, [store, refresh]);

  const upsertLocal = (comment: PreviewComment) =>
    setComments((current) => {
      const index = current.findIndex((item) => item.id === comment.id);
      if (index < 0) return [...current, comment];
      const next = current.slice();
      next[index] = comment;
      return next;
    });

  const save = useCallback<CommentsApi['save']>(
    async ({ target, note, images = [], existingId, keepAttachments = [] }) => {
      try {
        const uploaded = images.length ? await store.saveAttachments(images) : [];
        const attachments = [...keepAttachments, ...uploaded];
        const saved = await store.upsert({
          id: existingId,
          target,
          note,
          attachments: attachments.length ? attachments : undefined,
        });
        upsertLocal(saved);
        return saved;
      } catch {
        return null;
      }
    },
    [store],
  );

  const setStatus = useCallback<CommentsApi['setStatus']>(
    async (ids, status) => {
      try {
        for (const id of ids) upsertLocal(await store.setStatus(id, status));
        return true;
      } catch {
        void refresh();
        return false;
      }
    },
    [store, refresh],
  );

  const reorder = useCallback<CommentsApi['reorder']>(
    async (id, sortKey) => {
      setComments((current) => current.map((comment) => (comment.id === id ? { ...comment, sortKey } : comment)));
      try {
        upsertLocal(await store.reorder(id, sortKey));
        return true;
      } catch {
        void refresh();
        return false;
      }
    },
    [store, refresh],
  );

  const remove = useCallback<CommentsApi['remove']>(
    async (id) => {
      try {
        await store.remove(id);
        setComments((current) => current.filter((comment) => comment.id !== id));
        return true;
      } catch {
        return false;
      }
    },
    [store],
  );

  const attachmentUrl = useCallback((attachment: PreviewCommentAttachment) => store.attachmentUrl(attachment), [store]);

  const value = useMemo<CommentsApi>(
    () => ({ store, comments, loadState, refresh, save, setStatus, reorder, remove, attachmentUrl }),
    [store, comments, loadState, refresh, save, setStatus, reorder, remove, attachmentUrl],
  );
  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}

/** Null outside a CommentsProvider (e.g. the embed view stays read-only). */
export function useComments(): CommentsApi | null {
  return useContext(CommentsContext);
}
