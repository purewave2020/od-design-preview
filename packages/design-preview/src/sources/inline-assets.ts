import { baseDirFor, extOf, mimeFor } from './file-kind';

/**
 * Self-contained HTML for previews and exports.
 *
 * The preview iframe runs on an opaque origin (sandbox without
 * allow-same-origin). HTTP-backed sources hand it a `<base href>` and let the
 * browser fetch assets; a folder opened from disk has no URL the sandbox can
 * reach, so its relative references (img/src, link/href, CSS url(), module
 * imports, …) are rewritten to `data:` URLs instead. Exports use the same pass
 * so a downloaded .html / .zip / PDF capture carries its images and styles.
 */

export type AssetReader = (projectPath: string) => Promise<Blob | null>;

const ABSOLUTE_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const PROJECT_ORIGIN = 'https://project.invalid/';

/** Resolve `ref` (as written inside `fromFile`) to a project-relative path. */
export function resolveProjectPath(fromFile: string, ref: string): string | null {
  const trimmed = decodeEntities(ref.trim());
  if (!trimmed || ABSOLUTE_REF.test(trimmed)) return null;
  const clean = trimmed.split('#')[0]!.split('?')[0]!;
  if (!clean) return null;
  try {
    const url = new URL(clean, PROJECT_ORIGIN + encodePath(baseDirFor(fromFile)));
    if (`${url.protocol}//${url.host}/` !== PROJECT_ORIGIN) return null;
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

function encodePath(path: string): string {
  return path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function replaceAsync(
  input: string,
  pattern: RegExp,
  fn: (match: string, ...groups: string[]) => Promise<string>,
): Promise<string> {
  const jobs: Array<Promise<string>> = [];
  input.replace(pattern, (match: string, ...rest: unknown[]) => {
    jobs.push(fn(match, ...(rest.filter((v) => typeof v === 'string' || v === undefined) as string[])));
    return match;
  });
  if (jobs.length === 0) return input;
  const results = await Promise.all(jobs);
  let index = 0;
  return input.replace(pattern, () => results[index++]!);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

const LINK_REL_INLINE = /(?:^|\s)(?:stylesheet|icon|shortcut|apple-touch-icon|preload|modulepreload|manifest)(?:\s|$)/i;
const URL_ATTRS_BY_TAG: Record<string, string[]> = {
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  script: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  embed: ['src'],
  object: ['data'],
  input: ['src'],
  image: ['href', 'xlink:href'],
  use: ['href', 'xlink:href'],
  feimage: ['href', 'xlink:href'],
};

export interface InlineOptions {
  /** Stop inlining once this many bytes of assets were embedded. */
  maxBytes?: number;
}

export class AssetInliner {
  private readonly cache = new Map<string, Promise<string | null>>();
  private embeddedBytes = 0;
  private readonly maxBytes: number;

  constructor(
    private readonly read: AssetReader,
    options: InlineOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 48 * 1024 * 1024;
  }

  async html(html: string, fromFile: string): Promise<string> {
    // 1. <style> blocks
    let out = await replaceAsync(
      html,
      /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
      async (_m, open = '', body = '', close = '') => `${open}${await this.css(body, fromFile, 0)}${close}`,
    );
    // 2. URL-bearing attributes + inline style attributes
    out = await replaceAsync(out, /<([a-zA-Z][\w:-]*)(\s[^<>]*?)?(\/?)>/g, async (match, tag = '', attrs = '', selfClose = '') => {
      if (!attrs) return match;
      const lowerTag = tag.toLowerCase();
      let urlAttrs = URL_ATTRS_BY_TAG[lowerTag] ?? [];
      if (lowerTag === 'link') {
        const rel = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
        const relValue = rel ? (rel[1] ?? rel[2] ?? rel[3] ?? '') : '';
        urlAttrs = LINK_REL_INLINE.test(relValue) ? ['href'] : [];
      }
      if (urlAttrs.length === 0 && !/\sstyle\s*=/i.test(attrs)) return match;
      const nextAttrs = await replaceAsync(
        attrs,
        /(\s)([\w:-]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
        async (attrMatch, lead = '', name = '', eq = '', dq, sq, bare) => {
          const lowerName = name.toLowerCase();
          const value = dq ?? sq ?? bare ?? '';
          const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '"';
          if (lowerName === 'style') {
            const css = await this.css(decodeEntities(value), fromFile, 0);
            return `${lead}${name}${eq}${quote}${css.replace(/"/g, '&quot;')}${quote}`;
          }
          if (!urlAttrs.includes(lowerName)) return attrMatch;
          if (lowerName === 'srcset') {
            const rewritten = await this.srcset(value, fromFile);
            return `${lead}${name}${eq}${quote}${rewritten}${quote}`;
          }
          const forceModule = lowerTag === 'script' || (lowerTag === 'link' && /modulepreload/i.test(attrs));
          const data = await this.dataUrlFor(value, fromFile, 0, forceModule ? 'js' : undefined);
          return data ? `${lead}${name}${eq}${quote}${data}${quote}` : attrMatch;
        },
      );
      return `<${tag}${nextAttrs}${selfClose}>`;
    });
    return out;
  }

  async css(css: string, fromFile: string, depth: number): Promise<string> {
    let out = await replaceAsync(css, /@import\s+(['"])([^'"]+)\1/gi, async (match, _q, ref = '') => {
      const data = await this.dataUrlFor(ref, fromFile, depth + 1, 'css');
      return data ? `@import url("${data}")` : match;
    });
    out = await replaceAsync(out, /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, async (match, _q, ref = '') => {
      const data = await this.dataUrlFor(ref, fromFile, depth + 1);
      return data ? `url("${data}")` : match;
    });
    return out;
  }

  async js(js: string, fromFile: string, depth: number): Promise<string> {
    return replaceAsync(
      js,
      /(\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]+\s*from\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,
      async (match, lead = '', quote = '"', ref = '') => {
        const data = await this.dataUrlFor(ref, fromFile, depth + 1, 'js');
        return data ? `${lead}${quote}${data}${quote}` : match;
      },
    );
  }

  private async srcset(value: string, fromFile: string): Promise<string> {
    const parts = await Promise.all(
      value.split(',').map(async (candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return candidate;
        const [ref = '', ...descriptor] = trimmed.split(/\s+/);
        const data = await this.dataUrlFor(ref, fromFile, 0);
        return data ? [data, ...descriptor].join(' ') : trimmed;
      }),
    );
    return parts.join(', ');
  }

  private dataUrlFor(ref: string, fromFile: string, depth: number, as?: 'css' | 'js'): Promise<string | null> {
    if (depth > 6) return Promise.resolve(null);
    const path = resolveProjectPath(fromFile, ref);
    if (!path) return Promise.resolve(null);
    const key = `${as ?? ''}:${path}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.load(path, depth, as).catch(() => null);
      this.cache.set(key, pending);
    }
    return pending;
  }

  private async load(path: string, depth: number, as?: 'css' | 'js'): Promise<string | null> {
    const blob = await this.read(path);
    if (!blob) return null;
    if (this.embeddedBytes + blob.size > this.maxBytes) return null;
    this.embeddedBytes += blob.size;
    const ext = extOf(path);
    const kind = as ?? (ext === 'css' ? 'css' : ext === 'js' || ext === 'mjs' ? 'js' : undefined);
    if (kind === 'css') {
      const css = await this.css(await blob.text(), path, depth);
      return blobToDataUrl(new Blob([css], { type: 'text/css' }));
    }
    if (kind === 'js') {
      const js = await this.js(await blob.text(), path, depth);
      return blobToDataUrl(new Blob([js], { type: 'text/javascript' }));
    }
    const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : mimeFor(path);
    return blobToDataUrl(type === blob.type ? blob : new Blob([blob], { type }));
  }
}

export function inlineHtmlAssets(html: string, fromFile: string, read: AssetReader, options?: InlineOptions): Promise<string> {
  return new AssetInliner(read, options).html(html, fromFile);
}
