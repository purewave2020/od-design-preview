// Where preview comments live.
//
// Open Design keeps comments in the daemon, scoped to a project conversation
// (`/api/projects/:id/conversations/:cid/comments`, see
// apps/web/src/providers/registry.ts). A daemon-backed project uses exactly
// that API. Every other source (the bundled demo, a folder from disk) has no
// server, so its comments and their images are kept in this browser
// (IndexedDB), keyed by the source.
import { httpRequest } from '../http/request';
import { idbDelete, idbEntries, idbGet, idbSet } from '../lib/idb';
import { DaemonSource } from '../sources/daemon-source';
import type { PreviewSource } from '../sources/types';
import type {
  PreviewComment,
  PreviewCommentAttachment,
  PreviewCommentStatus,
  PreviewCommentTarget,
} from '../vendor/open-design/contracts/api/comments';
import { randomUUID } from '../vendor/open-design/utils/uuid';

export interface CommentUpsertInput {
  /** Existing comment id when editing; omit to create. */
  id?: string;
  target: PreviewCommentTarget;
  note: string;
  attachments?: PreviewCommentAttachment[];
}

export interface CommentStore {
  readonly kind: 'daemon' | 'browser';
  list(): Promise<PreviewComment[]>;
  upsert(input: CommentUpsertInput): Promise<PreviewComment>;
  setStatus(id: string, status: PreviewCommentStatus): Promise<PreviewComment>;
  reorder(id: string, sortKey: number): Promise<PreviewComment>;
  remove(id: string): Promise<void>;
  /** Persist images attached to a comment; returns their attachment records. */
  saveAttachments(files: File[]): Promise<PreviewCommentAttachment[]>;
  /** Displayable URL for an attachment (sync — call after `list()`). */
  attachmentUrl(attachment: PreviewCommentAttachment): string;
  /** Notified when comments change elsewhere (another tab, the daemon). */
  subscribe(listener: () => void): () => void;
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'image.png';
}

// ---------------------------------------------------------------------------
// Browser (IndexedDB)

interface StoredBlob {
  blob: Blob;
  name: string;
}

const BLOB_PATH_PREFIX = 'browser-attachment:';

class BrowserCommentStore implements CommentStore {
  readonly kind = 'browser' as const;
  private readonly prefix: string;
  private readonly blobPrefix: string;
  private readonly urls = new Map<string, string>();
  private readonly channel: BroadcastChannel | null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly scope: string) {
    this.prefix = `comments:${scope}:`;
    this.blobPrefix = `comment-blobs:${scope}:`;
    this.channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`od-preview-comments:${scope}`) : null;
    this.channel?.addEventListener('message', () => {
      for (const listener of this.listeners) listener();
    });
  }

  private async all(): Promise<PreviewComment[]> {
    const entries = await idbEntries<PreviewComment>(this.prefix);
    return entries.map(([, value]) => value).filter((value) => value && typeof value.id === 'string');
  }

  private async put(comment: PreviewComment): Promise<PreviewComment> {
    await idbSet(this.prefix + comment.id, comment);
    this.channel?.postMessage('changed');
    return comment;
  }

  async list(): Promise<PreviewComment[]> {
    const comments = await this.all();
    await Promise.all(
      comments.flatMap((comment) => comment.attachments ?? []).map((attachment) => this.ensureUrl(attachment.path)),
    );
    return comments;
  }

  async upsert(input: CommentUpsertInput): Promise<PreviewComment> {
    const now = Date.now();
    const { target } = input;
    const existing = input.id ? await idbGet<PreviewComment>(this.prefix + input.id) : undefined;
    const base = {
      filePath: target.filePath,
      elementId: target.elementId,
      selector: target.selector,
      label: target.label,
      text: target.text,
      position: target.position,
      htmlHint: target.htmlHint,
      style: target.style,
      selectionKind: target.selectionKind,
      memberCount: target.memberCount,
      podMembers: target.podMembers,
      ...(typeof target.slideIndex === 'number' ? { slideIndex: target.slideIndex } : {}),
      note: input.note,
      attachments: input.attachments,
    };
    if (existing) {
      return this.put({ ...existing, ...base, updatedAt: now });
    }
    const all = await this.all();
    // Pin numbers are permanent per file: max+1 across every status, never
    // a count (same rule as the daemon's upsertPreviewComment).
    const pinSeq =
      all
        .filter((comment) => comment.filePath === target.filePath)
        .reduce((max, comment) => Math.max(max, typeof comment.pinSeq === 'number' ? comment.pinSeq : 0), 0) + 1;
    return this.put({
      ...base,
      id: randomUUID(),
      projectId: this.scope,
      conversationId: 'browser',
      status: 'open',
      createdAt: now,
      updatedAt: now,
      pinSeq,
      sortKey: now,
    });
  }

  private async mutate(id: string, patch: Partial<PreviewComment>): Promise<PreviewComment> {
    const existing = await idbGet<PreviewComment>(this.prefix + id);
    if (!existing) throw new Error('comment not found');
    return this.put({ ...existing, ...patch, updatedAt: Date.now() });
  }

  setStatus(id: string, status: PreviewCommentStatus): Promise<PreviewComment> {
    return this.mutate(id, { status });
  }

  reorder(id: string, sortKey: number): Promise<PreviewComment> {
    return this.mutate(id, { sortKey });
  }

  async remove(id: string): Promise<void> {
    const existing = await idbGet<PreviewComment>(this.prefix + id);
    await idbDelete(this.prefix + id);
    for (const attachment of existing?.attachments ?? []) {
      if (attachment.path.startsWith(BLOB_PATH_PREFIX)) await idbDelete(this.blobPrefix + attachment.path).catch(() => {});
    }
    this.channel?.postMessage('changed');
  }

  async saveAttachments(files: File[]): Promise<PreviewCommentAttachment[]> {
    const out: PreviewCommentAttachment[] = [];
    for (const file of files) {
      const path = `${BLOB_PATH_PREFIX}${randomUUID()}/${safeName(file.name)}`;
      await idbSet(this.blobPrefix + path, { blob: file, name: file.name } satisfies StoredBlob);
      this.urls.set(path, URL.createObjectURL(file));
      out.push({ path, name: file.name });
    }
    return out;
  }

  private async ensureUrl(path: string): Promise<void> {
    if (this.urls.has(path) || !path.startsWith(BLOB_PATH_PREFIX)) return;
    const stored = await idbGet<StoredBlob>(this.blobPrefix + path);
    if (stored?.blob) this.urls.set(path, URL.createObjectURL(stored.blob));
  }

  attachmentUrl(attachment: PreviewCommentAttachment): string {
    return this.urls.get(attachment.path) ?? '';
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// ---------------------------------------------------------------------------
// Daemon

class DaemonCommentStore implements CommentStore {
  readonly kind = 'daemon' as const;
  private conversationId: Promise<string> | null = null;

  constructor(private readonly source: DaemonSource) {}

  /**
   * Upstream comments hang off a project conversation. Use the project's most
   * recent one (the daemon lists comments project-wide through any of them);
   * create one when the project has none yet.
   */
  private conversation(): Promise<string> {
    if (!this.conversationId) {
      this.conversationId = (async () => {
        const resp = await httpRequest<{ conversations?: Array<{ id?: string; updatedAt?: number }> }>({
          url: this.source.apiUrl('/conversations'),
          cache: 'no-store',
        });
        if (resp.ok) {
          const json = resp.data ?? {};
          const sorted = (json.conversations ?? [])
            .filter((c): c is { id: string; updatedAt?: number } => typeof c.id === 'string')
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
          if (sorted[0]) return sorted[0].id;
        }
        const created = await httpRequest<{ conversation?: { id?: string }; id?: string }>({
          url: this.source.apiUrl('/conversations'),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: { title: 'Design review' },
        });
        if (!created.ok) throw new Error(`Could not open a conversation for comments (${created.status})`);
        const json = created.data ?? {};
        const id = json.conversation?.id ?? json.id;
        if (!id) throw new Error('Conversation response was malformed');
        return id;
      })();
      this.conversationId.catch(() => {
        this.conversationId = null;
      });
    }
    return this.conversationId;
  }

  private async url(path = ''): Promise<string> {
    const cid = await this.conversation();
    return this.source.apiUrl(`/conversations/${encodeURIComponent(cid)}/comments${path}`);
  }

  private async request<T>(path: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; cache?: RequestCache }): Promise<T> {
    const resp = await httpRequest<T>({
      url: await this.url(path),
      method: init?.method ?? 'GET',
      cache: init?.cache,
      ...(init?.body !== undefined ? { data: init.body, headers: { 'Content-Type': 'application/json' } } : {}),
    });
    if (!resp.ok) throw new Error(`comments ${resp.status}`);
    return resp.data;
  }

  async list(): Promise<PreviewComment[]> {
    const json = await this.request<{ comments?: PreviewComment[] }>('', { cache: 'no-store' });
    if (!Array.isArray(json.comments)) throw new Error('Invalid comment list response');
    return json.comments;
  }

  async upsert(input: CommentUpsertInput): Promise<PreviewComment> {
    const json = await this.request<{ comment: PreviewComment }>('', {
      method: 'POST',
      body: { ...(input.id ? { id: input.id } : {}), target: input.target, note: input.note, attachments: input.attachments },
    });
    return json.comment;
  }

  async setStatus(id: string, status: PreviewCommentStatus): Promise<PreviewComment> {
    const json = await this.request<{ comment: PreviewComment }>(`/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { status },
    });
    return json.comment;
  }

  async reorder(id: string, sortKey: number): Promise<PreviewComment> {
    const json = await this.request<{ comment: PreviewComment }>(`/${encodeURIComponent(id)}/reorder`, {
      method: 'PATCH',
      body: { sortKey },
    });
    return json.comment;
  }

  async remove(id: string): Promise<void> {
    const resp = await httpRequest({ url: await this.url(`/${encodeURIComponent(id)}`), method: 'DELETE', responseType: 'text' });
    if (!resp.ok) throw new Error(`comments ${resp.status}`);
  }

  /** Same as upstream: comment images are uploaded into the project. */
  async saveAttachments(files: File[]): Promise<PreviewCommentAttachment[]> {
    const out: PreviewCommentAttachment[] = [];
    for (const file of files) {
      // Mark screenshots are already timestamped (drawing-<iso>.png); other
      // images get a short suffix so a second "image.png" never overwrites.
      const name = safeName(file.name);
      const unique = /\d{4}-\d{2}-\d{2}T/.test(name) ? name : name.replace(/(\.[^.]*)?$/, (ext) => `-${Date.now().toString(36)}${ext}`);
      const saved = await this.source.writeFile(unique, file);
      out.push({ path: saved.name, name: file.name });
    }
    return out;
  }

  attachmentUrl(attachment: PreviewCommentAttachment): string {
    return this.source.fileUrl(attachment.path);
  }

  subscribe(listener: () => void): () => void {
    return this.source.onCommentsChanged(listener);
  }
}

const stores = new WeakMap<PreviewSource, CommentStore>();

export function commentStoreFor(source: PreviewSource): CommentStore {
  let store = stores.get(source);
  if (!store) {
    // Local folders get a fresh id per open; key their comments by label so
    // reopening the same folder brings them back.
    const scope = source.kind === 'local' ? `local:${source.label}` : source.id;
    store = source instanceof DaemonSource ? new DaemonCommentStore(source) : new BrowserCommentStore(scope);
    stores.set(source, store);
  }
  return store;
}
