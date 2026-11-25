import { markRaw } from 'vue';
import { httpRequest } from '../http/request';
import type { ProjectFile } from '../types';
import { baseDirFor, kindFor, mimeFor } from './file-kind';
import type { PreviewSource } from './types';

function encodeSegments(path: string): string {
  return path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

export interface DaemonProjectSummary {
  id: string;
  name: string;
  updatedAt?: number;
  kind?: string;
}

/**
 * Normalise the daemon origin. Empty string = same origin, i.e. the Vite dev
 * server proxies `/api/*` to `OD_DAEMON_URL` exactly like apps/web's Next
 * rewrites do. An explicit origin needs the daemon to allow CORS.
 */
export function normalizeDaemonOrigin(origin: string | null | undefined): string {
  const trimmed = (origin ?? '').trim().replace(/\/+$/, '');
  return trimmed;
}

export async function listDaemonProjects(origin: string, signal?: AbortSignal): Promise<DaemonProjectSummary[]> {
  const resp = await httpRequest<{ projects?: Array<Record<string, unknown>> }>({
    url: `${normalizeDaemonOrigin(origin)}/api/projects`,
    cache: 'no-store',
    signal,
  });
  if (!resp.ok) throw new Error(`GET /api/projects failed (${resp.status})`);
  const json = resp.data ?? {};
  return (json.projects ?? [])
    .map((project) => ({
      id: String(project.id ?? ''),
      name: String(project.name ?? project.title ?? project.id ?? ''),
      updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : undefined,
      kind: typeof project.kind === 'string' ? project.kind : undefined,
    }))
    .filter((project) => project.id)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function errorMessage(resp: { status: number; data: unknown }): string {
  const body = resp.data && typeof resp.data === 'object' ? (resp.data as { error?: unknown; message?: unknown }) : null;
  if (!body) return String(resp.status);
  const err = body.error as { message?: string } | string | undefined;
  const message = typeof err === 'string' ? err : err?.message ?? (typeof body.message === 'string' ? body.message : '');
  return `${resp.status}${message ? ` ${message}` : ''}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * A live Open Design project, read and written through the daemon's public
 * project API — the same endpoints the upstream workspace uses:
 *   GET  /api/projects/:id/files   → { files: ProjectFile[] }
 *   GET  /api/projects/:id/raw/*   → file bytes
 *   POST /api/projects/:id/files   → { name, content[, encoding: 'base64'] } (writes)
 *   GET  /api/projects/:id/events  → SSE `file-changed`, `comment-changed`
 */
export class DaemonSource implements PreviewSource {
  readonly kind = 'daemon' as const;
  readonly writeMode = 'daemon' as const;
  readonly id: string;
  readonly description: string;
  readonly origin: string;
  private readonly absoluteOrigin: string;
  private readonly commentListeners = new Set<() => void>();

  constructor(
    origin: string,
    readonly projectId: string,
    readonly label: string,
  ) {
    // Sources are identity-keyed (registries, WeakMaps): never let Vue proxy one.
    markRaw(this);
    this.origin = normalizeDaemonOrigin(origin);
    this.absoluteOrigin = new URL(this.origin || '/', window.location.href).origin;
    this.id = `daemon:${this.absoluteOrigin}:${projectId}`;
    this.description = `${this.origin || window.location.origin} · ${projectId}`;
  }

  /** `/api/projects/:id` + path, on the configured origin. */
  apiUrl(path: string): string {
    return `${this.origin}/api/projects/${encodeURIComponent(this.projectId)}${path}`;
  }

  async listFiles(signal?: AbortSignal): Promise<ProjectFile[]> {
    const resp = await httpRequest<{ files?: Array<ProjectFile & { type?: string; path?: string }> }>({
      url: this.apiUrl('/files'),
      cache: 'no-store',
      signal,
    });
    if (!resp.ok) throw new Error(`Project files request failed (${resp.status})`);
    const json = resp.data ?? {};
    if (!Array.isArray(json.files)) throw new Error('Project files response was malformed');
    return json.files
      .filter((file) => file.type !== 'dir')
      .map((file) => ({
        name: file.name,
        size: file.size ?? 0,
        mtime: file.mtime ?? 0,
        kind: file.kind ?? 'binary',
        mime: file.mime ?? 'application/octet-stream',
        artifactManifest: file.artifactManifest,
      }));
  }

  fileUrl(name: string, version?: number): string {
    const url = this.apiUrl(`/raw/${encodeSegments(name)}`);
    return version ? `${url}?v=${Math.round(version)}` : url;
  }

  baseHrefFor(name: string): string {
    return new URL(this.apiUrl(`/raw/${encodeSegments(baseDirFor(name))}`), window.location.href).href;
  }

  async readText(name: string, options?: { fresh?: boolean }): Promise<string | null> {
    try {
      const resp = await httpRequest<string>({ url: this.fileUrl(name), cache: options?.fresh ? 'no-store' : 'no-cache', responseType: 'text' });
      return resp.ok ? String(resp.data ?? '') : null;
    } catch {
      return null;
    }
  }

  async readBlob(name: string): Promise<Blob | null> {
    try {
      const resp = await httpRequest<Blob>({ url: this.fileUrl(name), cache: 'no-cache', responseType: 'blob' });
      return resp.ok ? resp.data : null;
    } catch {
      return null;
    }
  }

  async writeFile(name: string, content: string | Blob): Promise<ProjectFile> {
    const body =
      typeof content === 'string'
        ? { name, content }
        : { name, content: await blobToBase64(content), encoding: 'base64' as const };
    const resp = await httpRequest<{ file?: Partial<ProjectFile> & { path?: string } }>({
      url: this.apiUrl('/files'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: body,
    });
    if (!resp.ok) throw new Error(`Save failed (${errorMessage(resp)})`);
    const file = resp.data?.file ?? {};
    const savedName = file.name ?? file.path ?? name;
    return {
      name: savedName,
      size: file.size ?? (typeof content === 'string' ? new Blob([content]).size : content.size),
      mtime: file.mtime ?? Date.now(),
      kind: file.kind ?? kindFor(savedName),
      mime: file.mime ?? mimeFor(savedName),
      artifactManifest: file.artifactManifest,
    };
  }

  /** `comment-changed` frames on the project event stream. */
  onCommentsChanged(listener: () => void): () => void {
    this.commentListeners.add(listener);
    return () => {
      this.commentListeners.delete(listener);
    };
  }

  watch(onChange: (changed: string[] | null) => void): () => void {
    let closed = false;
    let source: EventSource | null = null;
    let retry: number | null = null;
    let delay = 1000;
    let pending = new Set<string>();
    let flushTimer: number | null = null;
    const flush = () => {
      flushTimer = null;
      const paths = [...pending];
      pending = new Set();
      onChange(paths.length ? paths : null);
    };
    const connect = () => {
      if (closed || typeof EventSource === 'undefined') return;
      const es = new EventSource(this.apiUrl('/events'));
      source = es;
      es.addEventListener('ready', () => {
        delay = 1000;
      });
      es.addEventListener('file-changed', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { path?: string };
          if (data.path) pending.add(data.path);
        } catch {
          /* malformed frame — still refresh */
        }
        // Agents write bursts of files; coalesce into one refresh.
        if (flushTimer === null) flushTimer = window.setTimeout(flush, 250);
      });
      es.addEventListener('comment-changed', () => {
        for (const listener of this.commentListeners) listener();
      });
      es.onerror = () => {
        es.close();
        source = null;
        if (closed) return;
        retry = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };
    connect();
    return () => {
      closed = true;
      source?.close();
      if (retry !== null) window.clearTimeout(retry);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }
}
