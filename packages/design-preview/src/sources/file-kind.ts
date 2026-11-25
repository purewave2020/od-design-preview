import type { ProjectFileKind } from '../types';

// Same buckets as the daemon's `kindFor` (apps/daemon/src/projects.ts), so a
// local folder and a daemon project list identically.
export function kindFor(name: string): ProjectFileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.sketch.json')) return 'sketch';
  const ext = extOf(lower);
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'svg') return 'sketch';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) {
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    return base.startsWith('sketch-') ? 'sketch' : 'image';
  }
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (['md', 'markdown', 'txt'].includes(ext)) return 'text';
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'css', 'py', 'yml', 'yaml', 'xml', 'toml', 'sh'].includes(ext)) {
    return 'code';
  }
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'document';
  if (ext === 'pptx') return 'presentation';
  if (ext === 'xlsx') return 'spreadsheet';
  return 'binary';
}

const MIME: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  json: 'application/json',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  pdf: 'application/pdf',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  xml: 'application/xml',
};

export function mimeFor(name: string): string {
  return MIME[extOf(name.toLowerCase())] ?? 'application/octet-stream';
}

export function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function baseDirFor(name: string): string {
  const index = name.lastIndexOf('/');
  return index >= 0 ? name.slice(0, index + 1) : '';
}

export function baseName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

/** Folders and files the preview should never list (VCS, deps, OS junk). */
export function isIgnoredPath(rel: string): boolean {
  return rel
    .split('/')
    .some((seg) => seg.startsWith('.') || seg === 'node_modules' || seg === '__MACOSX' || seg === 'Thumbs.db');
}

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

export function isSvgName(name: string): boolean {
  return /\.svg$/i.test(name);
}

export function isReactComponentName(name: string): boolean {
  return /\.(jsx|tsx)$/i.test(name);
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
