// Project-wide comment state shared by every open viewer (the role
// ProjectView plays for FileViewer upstream: it owns `previewComments` and
// hands down save / status / reorder / delete callbacks). Provided by
// <PreviewWorkspace>, injected by the viewers.
import { computed, inject, provide, shallowRef, watch, type InjectionKey, type MaybeRefOrGetter, toValue } from 'vue';
import type { PreviewSource } from '../sources/types';
import type {
  PreviewComment,
  PreviewCommentAttachment,
  PreviewCommentStatus,
  PreviewCommentTarget,
} from '../vendor/open-design/contracts/api/comments';
import { commentStoreFor, type CommentStore } from './comment-store';

export type CommentsLoadState = 'loading' | 'error' | 'success';

export interface CommentSaveInput {
  target: PreviewCommentTarget;
  note: string;
  /** New image files to attach. */
  images?: File[];
  /** Edit this comment instead of creating one. */
  existingId?: string;
  /** Already-saved attachments to keep on edit. */
  keepAttachments?: PreviewCommentAttachment[];
}

export interface CommentsApi {
  readonly store: CommentStore;
  /** Reactive: every comment of the project. */
  readonly comments: PreviewComment[];
  /** Reactive: state of the last list read. */
  readonly loadState: CommentsLoadState;
  refresh(): Promise<void>;
  save(input: CommentSaveInput): Promise<PreviewComment | null>;
  setStatus(ids: string[], status: PreviewCommentStatus): Promise<boolean>;
  reorder(id: string, sortKey: number): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  attachmentUrl(attachment: PreviewCommentAttachment): string;
}

const CommentsKey: InjectionKey<CommentsApi> = Symbol('od-comments');

/** Create the comment state for `source` and provide it to descendants. */
export function provideComments(source: MaybeRefOrGetter<PreviewSource>): CommentsApi {
  const store = computed(() => commentStoreFor(toValue(source)));
  const comments = shallowRef<PreviewComment[]>([]);
  const loadState = shallowRef<CommentsLoadState>('loading');
  let inFlight: Promise<void> | null = null;
  let again = false;

  const refresh = async (): Promise<void> => {
    // One list read at a time; a refresh requested meanwhile runs once after.
    if (inFlight) {
      again = true;
      return inFlight;
    }
    const current = store.value;
    const run = (async () => {
      do {
        again = false;
        try {
          const next = await current.list();
          if (current !== store.value) return;
          comments.value = next;
          loadState.value = 'success';
        } catch {
          if (loadState.value !== 'success') loadState.value = 'error';
        }
      } while (again);
    })();
    inFlight = run;
    try {
      await run;
    } finally {
      inFlight = null;
    }
  };

  watch(
    store,
    (next, _prev, onCleanup) => {
      comments.value = [];
      loadState.value = 'loading';
      void refresh();
      onCleanup(next.subscribe(() => void refresh()));
    },
    { immediate: true },
  );

  const upsertLocal = (comment: PreviewComment) => {
    const current = comments.value;
    const index = current.findIndex((item) => item.id === comment.id);
    if (index < 0) {
      comments.value = [...current, comment];
      return;
    }
    const next = current.slice();
    next[index] = comment;
    comments.value = next;
  };

  const api: CommentsApi = {
    get store() {
      return store.value;
    },
    get comments() {
      return comments.value;
    },
    get loadState() {
      return loadState.value;
    },
    refresh,
    async save({ target, note, images = [], existingId, keepAttachments = [] }) {
      try {
        const uploaded = images.length ? await store.value.saveAttachments(images) : [];
        const attachments = [...keepAttachments, ...uploaded];
        const saved = await store.value.upsert({
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
    async setStatus(ids, status) {
      try {
        for (const id of ids) upsertLocal(await store.value.setStatus(id, status));
        return true;
      } catch {
        void refresh();
        return false;
      }
    },
    async reorder(id, sortKey) {
      comments.value = comments.value.map((comment) => (comment.id === id ? { ...comment, sortKey } : comment));
      try {
        upsertLocal(await store.value.reorder(id, sortKey));
        return true;
      } catch {
        void refresh();
        return false;
      }
    },
    async remove(id) {
      try {
        await store.value.remove(id);
        comments.value = comments.value.filter((comment) => comment.id !== id);
        return true;
      } catch {
        return false;
      }
    },
    attachmentUrl(attachment) {
      return store.value.attachmentUrl(attachment);
    },
  };

  provide(CommentsKey, api);
  return api;
}

/** Null outside a <PreviewWorkspace> (e.g. the embed view stays read-only). */
export function useComments(): CommentsApi | null {
  return inject(CommentsKey, null);
}
