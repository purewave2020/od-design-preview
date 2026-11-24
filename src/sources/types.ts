import type { ProjectFile } from '../types';

export type PreviewSourceKind = 'static' | 'local' | 'daemon';

/**
 * Where a source's writes land (manual edits, sketches, new documents,
 * uploads):
 *   disk    — straight into the folder on disk (File System Access API)
 *   daemon  — through the Open Design daemon (`POST /api/projects/:id/files`)
 *   browser — kept in this browser (IndexedDB) on top of a read-only source
 *   memory  — kept in this tab only (a dropped snapshot without a folder handle)
 */
export type PreviewWriteMode = 'disk' | 'daemon' | 'browser' | 'memory';

/**
 * Where the previewed project's files come from. The upstream FileWorkspace
 * talks to the daemon directly (`/api/projects/:id/files`, `/raw/...`); here
 * that contract is an interface so the same viewer works against a bundled
 * static folder, a folder on the user's disk, or a live Open Design daemon.
 */
export interface PreviewSource {
  /** Stable identity — keys per-file UI state (zoom, viewport, slide). */
  readonly id: string;
  readonly kind: PreviewSourceKind;
  /** Short label for the project chip. */
  readonly label: string;
  /** Secondary line (origin, folder, project id). */
  readonly description?: string;
  /** Present when the source accepts writes. */
  readonly writeMode?: PreviewWriteMode;
  listFiles(signal?: AbortSignal): Promise<ProjectFile[]>;
  readText(name: string, options?: { fresh?: boolean }): Promise<string | null>;
  readBlob(name: string): Promise<Blob | null>;
  /** URL for <img>/<video>/<audio>, downloads and "open in new tab". */
  fileUrl(name: string, version?: number): string;
  /**
   * Absolute `<base href>` (ending in `/`) for a file's directory when the
   * source is reachable over HTTP, so the sandboxed preview can load relative
   * assets itself. `null` → the source can only inline assets (local folders).
   */
  baseHrefFor(name: string): string | null;
  /** Subscribe to file changes. `changed === null` means "re-list everything". */
  watch?(onChange: (changed: string[] | null) => void): () => void;
  /** Create or replace a project file. Resolves to the written file's entry. */
  writeFile?(name: string, content: string | Blob): Promise<ProjectFile>;
  /**
   * Files that exist only in the browser overlay of an HTTP source. Previews
   * inline these (the sandboxed frame cannot fetch them by URL).
   */
  overlayPaths?(): ReadonlySet<string>;
  /** Browser-kept edits exist that a "discard" can drop. */
  hasLocalChanges?(): boolean;
  discardLocalChanges?(): Promise<void>;
  dispose?(): void;
}

export interface PreparedHtml {
  html: string;
  baseHref?: string;
}

export function canWrite(source: PreviewSource): source is PreviewSource & Required<Pick<PreviewSource, 'writeFile' | 'writeMode'>> {
  return typeof source.writeFile === 'function' && Boolean(source.writeMode);
}
