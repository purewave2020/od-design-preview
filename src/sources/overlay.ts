import { idbDeletePrefix, idbEntries, idbSet } from '../lib/idb';
import { mimeFor } from './file-kind';

interface OverlayEntry {
  blob: Blob;
  mtime: number;
}

/**
 * Files written on top of a read-only source and kept in this browser
 * (IndexedDB), so editing the bundled demo — or any static folder — works and
 * survives a reload. Reads check the overlay first.
 */
export class BrowserOverlay {
  private files = new Map<string, OverlayEntry>();
  private urls = new Map<string, { mtime: number; url: string }>();
  readonly ready: Promise<void>;

  constructor(private readonly scope: string) {
    this.ready = idbEntries<OverlayEntry>(this.prefix())
      .then((entries) => {
        for (const [key, value] of entries) {
          if (value?.blob instanceof Blob) this.files.set(key.slice(this.prefix().length), value);
        }
      })
      .catch(() => {
        /* IndexedDB blocked — the overlay stays in memory for this tab */
      });
  }

  private prefix(): string {
    return `files:${this.scope}:`;
  }

  has(name: string): boolean {
    return this.files.has(name);
  }

  get(name: string): OverlayEntry | undefined {
    return this.files.get(name);
  }

  paths(): ReadonlySet<string> {
    return new Set(this.files.keys());
  }

  entries(): Array<[string, OverlayEntry]> {
    return [...this.files];
  }

  get size(): number {
    return this.files.size;
  }

  async write(name: string, content: string | Blob): Promise<OverlayEntry> {
    const blob =
      typeof content === 'string' ? new Blob([content], { type: mimeFor(name) }) : content.type ? content : new Blob([content], { type: mimeFor(name) });
    const entry: OverlayEntry = { blob, mtime: Date.now() };
    this.files.set(name, entry);
    try {
      await idbSet(this.prefix() + name, entry);
    } catch {
      /* keep the in-memory copy */
    }
    return entry;
  }

  url(name: string): string | null {
    const entry = this.files.get(name);
    if (!entry) return null;
    const cached = this.urls.get(name);
    if (cached?.mtime === entry.mtime) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    const url = URL.createObjectURL(entry.blob);
    this.urls.set(name, { mtime: entry.mtime, url });
    return url;
  }

  async clear(): Promise<void> {
    this.files.clear();
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    try {
      await idbDeletePrefix(this.prefix());
    } catch {
      /* nothing persisted */
    }
  }
}
