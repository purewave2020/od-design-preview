// Pure helpers for the Design Files panel (port of the module-level helpers in
// upstream apps/web/src/components/DesignFilesPanel.tsx).
import type { TranslateFn } from '../../locales';
import { extOf } from '../../sources/file-kind';
import type { ProjectFile, ProjectFileKind } from '../../types';

export type FileCategory = ProjectFileKind | 'stylesheet';

export const SECTION_ORDER: FileCategory[] = [
  'html',
  'stylesheet',
  'code',
  'document',
  'text',
  'image',
  'sketch',
  'pdf',
  'presentation',
  'spreadsheet',
  'video',
  'audio',
  'binary',
];
const STYLESHEET_EXTENSIONS = new Set(['css', 'scss', 'sass', 'less']);
export const PAGE_THUMB_LAYOUT_WIDTH = 1200;
export const PAGE_THUMB_LAYOUT_HEIGHT = Math.round(PAGE_THUMB_LAYOUT_WIDTH * (9 / 16));
export const HTML_THUMBNAIL_INLINE_MAX_BYTES = 4 * 1024 * 1024;

export function fileCategory(file: ProjectFile): FileCategory {
  if (STYLESHEET_EXTENSIONS.has(extOf(file.name))) return 'stylesheet';
  // .md/.txt list as documents like upstream's "Documents" section.
  if (file.kind === 'text') return 'document';
  return file.kind;
}

export function kindGlyph(kind: FileCategory): string {
  if (kind === 'stylesheet') return '#';
  if (kind === 'html') return '⟨⟩';
  if (kind === 'image') return '▣';
  if (kind === 'sketch') return '✎';
  if (kind === 'text' || kind === 'document') return '¶';
  if (kind === 'code') return '{}';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'presentation') return 'PPT';
  if (kind === 'spreadsheet') return 'XLS';
  if (kind === 'video') return '▶';
  if (kind === 'audio') return '♪';
  return '·';
}

export function kindLabel(kind: FileCategory, t: TranslateFn): string {
  switch (kind) {
    case 'stylesheet':
      return t('designFiles.kindStylesheet');
    case 'html':
      return t('designFiles.kindHtml');
    case 'image':
      return t('designFiles.kindImage');
    case 'sketch':
      return t('designFiles.kindSketch');
    case 'text':
    case 'document':
      return t('designFiles.kindDocument');
    case 'code':
      return t('designFiles.kindCode');
    case 'pdf':
      return t('designFiles.kindPdf');
    case 'presentation':
      return t('designFiles.kindPresentation');
    case 'spreadsheet':
      return t('designFiles.kindSpreadsheet');
    default:
      return t('designFiles.kindBinary');
  }
}

export function sectionLabel(category: FileCategory, t: TranslateFn): string {
  switch (category) {
    case 'html':
      return t('designFiles.sectionPages');
    case 'stylesheet':
      return t('designFiles.sectionStylesheets');
    case 'code':
      return t('designFiles.sectionScripts');
    case 'document':
    case 'text':
      return t('designFiles.sectionDocuments');
    case 'image':
      return t('designFiles.sectionImages');
    case 'sketch':
      return t('designFiles.sectionSketches');
    case 'binary':
      return t('designFiles.sectionOther');
    default:
      return kindLabel(category, t);
  }
}

// --- page-card thumbnails: at most N live iframes are prepared at once --------
const MAX_CONCURRENT_THUMBNAILS = 4;
let activeThumbnails = 0;
const thumbnailQueue: Array<() => void> = [];

/** Queue `start`; returns an abandon function for a not-yet-started job. */
export function acquireThumbnailSlot(start: (release: () => void) => void): () => void {
  let started = false;
  let abandoned = false;
  const release = () => {
    activeThumbnails -= 1;
    thumbnailQueue.shift()?.();
  };
  const run = () => {
    if (abandoned) {
      thumbnailQueue.shift()?.();
      return;
    }
    started = true;
    activeThumbnails += 1;
    start(release);
  };
  if (activeThumbnails < MAX_CONCURRENT_THUMBNAILS) run();
  else thumbnailQueue.push(run);
  return () => {
    if (!started) abandoned = true;
  };
}

/** `name.ext` → first free `name.ext`, `name-2.ext`, … in the project. */
export function uniqueName(desired: string, taken: Set<string>): string {
  if (!taken.has(desired.toLowerCase())) return desired;
  const slash = desired.lastIndexOf('/');
  const dir = desired.slice(0, slash + 1);
  const base = desired.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${dir}${stem}-${i}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${dir}${stem}-${Date.now()}${ext}`;
}

export function diffChangedFiles(prev: ProjectFile[], next: ProjectFile[]): string[] {
  const before = new Map(prev.map((f) => [f.name, f]));
  const changed: string[] = [];
  for (const f of next) {
    const old = before.get(f.name);
    if (!old || old.mtime !== f.mtime || old.size !== f.size) changed.push(f.name);
    before.delete(f.name);
  }
  return [...changed, ...before.keys()];
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Same starter as upstream `initialMarkdownDocument` (FileWorkspace.tsx). */
export function initialMarkdownDocument(path: string, t: (key: string) => string): string {
  const title =
    path
      .split('/')
      .pop()
      ?.replace(/\.mdx?$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()) || t('designFiles.documentTemplate.titleFallback');
  return `# ${title}

## ${t('designFiles.documentTemplate.goalHeading')}

${t('designFiles.documentTemplate.goalBody')}

## ${t('designFiles.documentTemplate.capabilitiesHeading')}

- ${t('designFiles.documentTemplate.capabilityMarkdown')}
- ${t('designFiles.documentTemplate.capabilityAgent')}
- ${t('designFiles.documentTemplate.capabilityImages')}

## ${t('designFiles.documentTemplate.scenarioHeading')}

${t('designFiles.documentTemplate.scenario.default')}

## ${t('designFiles.documentTemplate.nextHeading')}

${t('designFiles.documentTemplate.nextBody')}
`;
}
