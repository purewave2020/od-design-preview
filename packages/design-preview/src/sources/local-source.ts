import { markRaw } from 'vue';
import type { ProjectFile } from '../types';
import { isIgnoredPath, kindFor, mimeFor } from './file-kind';
import type { PreviewSource, PreviewWriteMode } from './types';

type Entry = { file: File; handle?: FileSystemFileHandle };

// Minimal typings for the File System Access API (Chromium only).
type PermissionMode = { mode: 'read' | 'readwrite' };
interface DirectoryHandleLike {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirectoryHandleLike | FileHandleLike>;
  getDirectoryHandle?(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle?(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  queryPermission?(descriptor: PermissionMode): Promise<PermissionState>;
  requestPermission?(descriptor: PermissionMode): Promise<PermissionState>;
}
interface WritableLike {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable?(): Promise<WritableLike>;
}

let localSeq = 0;

/**
 * A folder from the user's disk. Nothing is uploaded: files stay in memory as
 * `File`s (or live `FileSystemFileHandle`s when the folder was opened through
 * the File System Access API, which also enables live reload while you edit).
 *
 * The sandboxed preview cannot reach these bytes by URL, so HTML previews are
 * prepared with inlined assets (see inline-assets.ts) — `baseHrefFor` → null.
 *
 * Writes (manual edit, sketches, new documents, uploads) go back into the
 * folder when it was opened with a handle — the first write asks the browser
 * for edit permission. A dropped snapshot keeps edits in this tab.
 */
export class LocalSource implements PreviewSource {
  readonly kind = 'local' as const;
  readonly id: string;
  readonly description: string;
  readonly writeMode: PreviewWriteMode;
  private entries = new Map<string, Entry>();
  private blobUrls = new Map<string, { key: string; url: string }>();
  private readonly listeners = new Set<(changed: string[] | null) => void>();

  private constructor(
    readonly label: string,
    private readonly root: DirectoryHandleLike | null,
  ) {
    // Sources are identity-keyed (registries, WeakMaps): never let Vue proxy one.
    markRaw(this);
    localSeq += 1;
    this.id = `local:${label}:${localSeq}`;
    this.description = root ? 'Local folder · live' : 'Local files · snapshot';
    this.writeMode = root?.getFileHandle ? 'disk' : 'memory';
  }

  static isLiveFolderSupported(): boolean {
    return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
  }

  /** Opens the OS folder picker (Chromium). Returns null when cancelled. */
  static async pickDirectory(): Promise<LocalSource | null> {
    const picker = (window as unknown as { showDirectoryPicker?: (opts?: object) => Promise<DirectoryHandleLike> })
      .showDirectoryPicker;
    if (!picker) return null;
    try {
      const handle = await picker({ mode: 'read' });
      return LocalSource.fromDirectoryHandle(handle);
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return null;
      throw error;
    }
  }

  static async fromDirectoryHandle(handle: DirectoryHandleLike): Promise<LocalSource> {
    const source = new LocalSource(handle.name, handle);
    await source.rescan();
    return source;
  }

  /**
   * From `<input webkitdirectory>` / multi-file pick / drag-and-drop. `paths`
   * overrides `webkitRelativePath` (drop traversal computes its own).
   */
  static fromFiles(files: File[], paths?: string[], label?: string): LocalSource {
    const rels = files.map((file, i) => (paths?.[i] ?? (file.webkitRelativePath || file.name)).replace(/^\/+/, ''));
    // Strip the shared top-level folder ("my-site/index.html" → "index.html").
    const firstSegs = new Set(rels.map((rel) => (rel.includes('/') ? rel.split('/')[0] : '')));
    const common = firstSegs.size === 1 ? [...firstSegs][0]! : '';
    const source = new LocalSource(label ?? (common || files[0]?.name || 'Local files'), null);
    files.forEach((file, i) => {
      const rel = common ? rels[i]!.slice(common.length + 1) : rels[i]!;
      if (!rel || isIgnoredPath(rel)) return;
      source.entries.set(rel, { file });
    });
    return source;
  }

  private async rescan(): Promise<boolean> {
    if (!this.root) return false;
    const next = new Map<string, Entry>();
    const walk = async (dir: DirectoryHandleLike, prefix: string) => {
      for await (const child of dir.values()) {
        const rel = prefix ? `${prefix}/${child.name}` : child.name;
        if (isIgnoredPath(rel)) continue;
        if (child.kind === 'directory') await walk(child, rel);
        else next.set(rel, { file: await child.getFile(), handle: child as unknown as FileSystemFileHandle });
      }
    };
    await walk(this.root, '');
    const changed =
      next.size !== this.entries.size ||
      [...next].some(([rel, entry]) => {
        const prev = this.entries.get(rel);
        return !prev || prev.file.lastModified !== entry.file.lastModified || prev.file.size !== entry.file.size;
      });
    this.entries = next;
    return changed;
  }

  async listFiles(): Promise<ProjectFile[]> {
    return [...this.entries].map(([name, { file }]) => ({
      name,
      size: file.size,
      mtime: file.lastModified,
      kind: kindFor(name),
      mime: file.type || mimeFor(name),
    }));
  }

  private async fileFor(name: string): Promise<File | null> {
    const entry = this.entries.get(name);
    if (!entry) return null;
    if (entry.handle) {
      try {
        const fresh = await (entry.handle as unknown as FileHandleLike).getFile();
        entry.file = fresh;
      } catch {
        /* removed since the last scan — fall back to the snapshot */
      }
    }
    return entry.file;
  }

  async readText(name: string): Promise<string | null> {
    const file = await this.fileFor(name);
    return file ? file.text() : null;
  }

  async readBlob(name: string): Promise<Blob | null> {
    const file = await this.fileFor(name);
    if (!file) return null;
    return file.type ? file : new Blob([file], { type: mimeFor(name) });
  }

  fileUrl(name: string): string {
    const entry = this.entries.get(name);
    if (!entry) return 'about:blank';
    const key = `${entry.file.lastModified}:${entry.file.size}`;
    const cached = this.blobUrls.get(name);
    if (cached?.key === key) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    const blob = entry.file.type ? entry.file : new Blob([entry.file], { type: mimeFor(name) });
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(name, { key, url });
    return url;
  }

  baseHrefFor(): null {
    return null;
  }

  async writeFile(name: string, content: string | Blob): Promise<ProjectFile> {
    const type = mimeFor(name);
    const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
    const base = name.slice(name.lastIndexOf('/') + 1);
    let entry: Entry;
    if (this.root && this.writeMode === 'disk') {
      await this.ensureWritable();
      const segments = name.split('/').filter(Boolean);
      let dir = this.root;
      for (const segment of segments.slice(0, -1)) dir = await dir.getDirectoryHandle!(segment, { create: true });
      const handle = await dir.getFileHandle!(segments[segments.length - 1]!, { create: true });
      const writable = await handle.createWritable!();
      await writable.write(blob);
      await writable.close();
      entry = { file: await handle.getFile(), handle: handle as unknown as FileSystemFileHandle };
    } else {
      entry = { file: new File([blob], base, { type: blob.type || type, lastModified: Date.now() }) };
    }
    this.entries.set(name, entry);
    for (const listener of this.listeners) listener([name]);
    return { name, size: entry.file.size, mtime: entry.file.lastModified, kind: kindFor(name), mime: entry.file.type || type };
  }

  private async ensureWritable(): Promise<void> {
    const root = this.root;
    if (!root?.queryPermission || !root.requestPermission) return;
    const mode: PermissionMode = { mode: 'readwrite' };
    if ((await root.queryPermission(mode)) === 'granted') return;
    if ((await root.requestPermission(mode)) !== 'granted') {
      throw new Error('Permission to edit this folder was not granted.');
    }
  }

  watch(onChange: (changed: string[] | null) => void): () => void {
    this.listeners.add(onChange);
    if (!this.root) {
      return () => {
        this.listeners.delete(onChange);
      };
    }
    let stopped = false;
    let busy = false;
    const timer = window.setInterval(async () => {
      if (stopped || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        if (await this.rescan()) onChange(null);
      } catch {
        /* permission revoked or folder gone — keep the snapshot */
      } finally {
        busy = false;
      }
    }, 1500);
    return () => {
      stopped = true;
      this.listeners.delete(onChange);
      window.clearInterval(timer);
    };
  }

  dispose(): void {
    for (const { url } of this.blobUrls.values()) URL.revokeObjectURL(url);
    this.blobUrls.clear();
  }
}

// ---------------------------------------------------------------------------
// Drag-and-drop helpers

type EntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: EntryLike[]) => void, err?: (e: unknown) => void) => void };
};

async function collectEntry(entry: EntryLike, out: Array<{ file: File; path: string }>): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    out.push({ file, path: entry.fullPath.replace(/^\/+/, '') });
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    await Promise.all(batch.map((child) => collectEntry(child, out)));
  }
}

/** Build a LocalSource from a drop event (folders included). */
export async function localSourceFromDrop(dataTransfer: DataTransfer): Promise<LocalSource | null> {
  const items = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === 'file');
  // Prefer live handles (Chromium) so the dropped folder keeps reloading.
  const withHandle = items[0] as DataTransferItem & { getAsFileSystemHandle?: () => Promise<unknown> };
  if (items.length === 1 && typeof withHandle.getAsFileSystemHandle === 'function') {
    try {
      const handle = (await withHandle.getAsFileSystemHandle()) as DirectoryHandleLike | FileHandleLike | null;
      if (handle && handle.kind === 'directory') return LocalSource.fromDirectoryHandle(handle);
    } catch {
      /* fall through to the entry API */
    }
  }
  const collected: Array<{ file: File; path: string }> = [];
  const entries = items
    .map((item) => (item.webkitGetAsEntry?.() ?? null) as unknown as EntryLike | null)
    .filter((entry): entry is EntryLike => entry !== null);
  if (entries.length) {
    await Promise.all(entries.map((entry) => collectEntry(entry, collected)));
  } else {
    for (const file of Array.from(dataTransfer.files ?? [])) collected.push({ file, path: file.name });
  }
  if (collected.length === 0) return null;
  const label = entries.length === 1 && entries[0]!.isDirectory ? entries[0]!.name : undefined;
  return LocalSource.fromFiles(
    collected.map((c) => c.file),
    collected.map((c) => c.path),
    label,
  );
}
