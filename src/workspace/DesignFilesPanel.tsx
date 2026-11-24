// "Design Files" tab — read-only port of apps/web/src/components/
// DesignFilesPanel.tsx: breadcrumbs, category tabs (Folders / Pages /
// Stylesheets / Scripts / Documents / Images / …), live page-card thumbnails,
// image masonry, file rows, row menu and batch ZIP download. Upload, rename,
// delete and agent actions belong to Open Design and are left out.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TranslateFn } from '../i18n';
import { useT } from '../i18n';
import { copyText, relativeTime } from '../lib/hooks';
import { buildBinaryZip, downloadBlob } from '../lib/zip-binary';
import { baseName, extOf, humanSize } from '../sources/file-kind';
import { prepareHtmlForPreview } from '../sources/prepare';
import type { PreviewSource } from '../sources/types';
import type { ProjectFile, ProjectFileKind } from '../types';
import { AnchoredPopover } from '../ui/AnchoredPopover';
import { useToast } from '../ui/Toast';
import { Icon } from '../vendor/open-design/components/Icon';
import { RemixIcon } from '../vendor/open-design/components/RemixIcon';
import { buildSrcdoc } from '../vendor/open-design/runtime/srcdoc';

type FileCategory = ProjectFileKind | 'stylesheet';

const SECTION_ORDER: FileCategory[] = [
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
const PAGE_THUMB_LAYOUT_WIDTH = 1200;
const PAGE_THUMB_LAYOUT_HEIGHT = Math.round(PAGE_THUMB_LAYOUT_WIDTH * (9 / 16));
const HTML_THUMBNAIL_INLINE_MAX_BYTES = 4 * 1024 * 1024;

function fileCategory(file: ProjectFile): FileCategory {
  if (STYLESHEET_EXTENSIONS.has(extOf(file.name))) return 'stylesheet';
  // .md/.txt list as documents like upstream's "Documents" section.
  if (file.kind === 'text') return 'document';
  return file.kind;
}

function kindGlyph(kind: FileCategory): string {
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

function kindLabel(kind: FileCategory, t: TranslateFn): string {
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

function sectionLabel(category: FileCategory, t: TranslateFn): string {
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

// --- page-card thumbnails ------------------------------------------------------
const MAX_CONCURRENT_THUMBNAILS = 4;
let activeThumbnails = 0;
const thumbnailQueue: Array<() => void> = [];
function acquireThumbnailSlot(start: (release: () => void) => void): () => void {
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

const HtmlCardThumbnail = memo(function HtmlCardThumbnail({
  source,
  file,
  refreshKey,
}: {
  source: PreviewSource;
  file: ProjectFile;
  refreshKey: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [near, setNear] = useState(false);
  const tooLarge = file.size > HTML_THUMBNAIL_INLINE_MAX_BYTES;

  useEffect(() => {
    if (near) return;
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || tooLarge) return;
    let cancelled = false;
    const abandon = acquireThumbnailSlot((release) => {
      void (async () => {
        try {
          const text = await source.readText(file.name);
          if (cancelled || text === null) return;
          const prepared = await prepareHtmlForPreview(source, file.name, text);
          if (!cancelled) setSrcDoc(buildSrcdoc(prepared.html, { baseHref: prepared.baseHref, freezeMotion: false }));
        } catch {
          if (!cancelled) setSrcDoc(null);
        } finally {
          release();
        }
      })();
    });
    return () => {
      cancelled = true;
      abandon();
    };
  }, [near, tooLarge, source, file.name, file.mtime, refreshKey]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const width = host.clientWidth;
      if (width > 0) setScale(width / PAGE_THUMB_LAYOUT_WIDTH);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="df-thumb-scale-host">
      {tooLarge || srcDoc === null ? (
        <div className="df-preview-placeholder">{kindGlyph('html')}</div>
      ) : (
        <iframe
          title={file.name}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-downloads"
          loading="lazy"
          tabIndex={-1}
          style={{
            width: PAGE_THUMB_LAYOUT_WIDTH,
            height: PAGE_THUMB_LAYOUT_HEIGHT,
            ...(scale ? { transform: `scale(${scale})`, transformOrigin: '0 0' } : {}),
          }}
        />
      )}
    </div>
  );
});

function DesignFileImageThumb({ src, title, onOpen }: { src: string; title: string; onOpen: () => void }) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [settled, setSettled] = useState<{ src: string; status: 'loaded' | 'error' } | null>(null);
  const status = settled?.src === src ? settled.status : 'loading';
  useEffect(() => {
    const image = imageRef.current;
    if (!image?.complete) return;
    setSettled({ src, status: image.naturalWidth > 0 ? 'loaded' : 'error' });
  }, [src]);
  return (
    <button type="button" className="df-card-thumb" data-image-status={status} onClick={onOpen} title={title} aria-label={title}>
      {status === 'loading' ? <span className="df-image-skeleton" aria-hidden /> : null}
      {status === 'error' ? (
        <span className="df-image-error" aria-hidden>
          <Icon name="image" size={24} />
        </span>
      ) : null}
      <img
        ref={imageRef}
        src={src}
        alt=""
        loading="lazy"
        data-loaded={status === 'loaded' ? 'true' : 'false'}
        onLoad={() => setSettled({ src, status: 'loaded' })}
        onError={() => setSettled({ src, status: 'error' })}
      />
    </button>
  );
}

export interface DesignFilesPanelProps {
  source: PreviewSource;
  files: ProjectFile[];
  loading: boolean;
  error: string | null;
  refreshKey: number;
  onRetry: () => void;
  onOpenFile: (name: string) => void;
  /** Empty-state starters (upstream df-empty-actions); omitted on read-only sources. */
  onNewSketch?: () => void;
  onNewDocument?: () => void;
  onUpload?: () => void;
}

export function DesignFilesPanel({ source, files, loading, error, refreshKey, onRetry, onOpenFile, onNewSketch, onNewDocument, onUpload }: DesignFilesPanelProps) {
  const t = useT();
  const toast = useToast();
  const [currentDir, setCurrentDir] = useState('');
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuAnchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setCurrentDir('');
    setActiveTab(null);
    setSelected(new Set());
    setQuery('');
  }, [source.id]);
  useEffect(() => {
    setSelected(new Set());
    setActiveTab(null);
  }, [currentDir]);

  // Climb to the nearest surviving ancestor when the current folder vanishes.
  useEffect(() => {
    if (currentDir === '') return;
    if (files.some((f) => f.name.startsWith(`${currentDir}/`))) return;
    const parts = currentDir.split('/');
    for (let i = parts.length - 1; i > 0; i--) {
      const ancestor = parts.slice(0, i).join('/');
      if (files.some((f) => f.name.startsWith(`${ancestor}/`))) {
        setCurrentDir(ancestor);
        return;
      }
    }
    setCurrentDir('');
  }, [files, currentDir]);

  const searching = query.trim().length > 0;
  const { dirsAtCurrentDir, filesAtCurrentDir, descendantCount } = useMemo(() => {
    const prefix = currentDir ? `${currentDir}/` : '';
    const dirs = new Set<string>();
    const local: ProjectFile[] = [];
    const counts = new Map<string, number>();
    const q = query.trim().toLowerCase();
    for (const file of files) {
      if (q) {
        if (file.name.toLowerCase().includes(q)) local.push(file);
        continue;
      }
      if (!file.name.startsWith(prefix)) continue;
      const rest = file.name.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) local.push(file);
      else {
        const dir = rest.slice(0, slash);
        dirs.add(dir);
        const full = prefix + dir;
        counts.set(full, (counts.get(full) ?? 0) + 1);
      }
    }
    return {
      dirsAtCurrentDir: [...dirs].sort((a, b) => a.localeCompare(b)),
      filesAtCurrentDir: local,
      descendantCount: counts,
    };
  }, [files, currentDir, query]);

  const sections = useMemo(() => {
    const grouped = new Map<FileCategory, ProjectFile[]>();
    for (const f of filesAtCurrentDir) {
      const category = fileCategory(f);
      const bucket = grouped.get(category) ?? [];
      bucket.push(f);
      grouped.set(category, bucket);
    }
    for (const bucket of grouped.values()) bucket.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
    return SECTION_ORDER.filter((c) => grouped.has(c)).map((c) => [c, grouped.get(c)!] as const);
  }, [filesAtCurrentDir]);

  const availableTabs = useMemo(() => {
    const tabs: Array<{ id: string; label: string; count: number }> = [];
    if (dirsAtCurrentDir.length > 0) {
      tabs.push({ id: 'folders', label: t('designFiles.sectionFolders'), count: dirsAtCurrentDir.length });
    }
    for (const [category, sectionFiles] of sections) {
      tabs.push({ id: `cat:${category}`, label: sectionLabel(category, t), count: sectionFiles.length });
    }
    return tabs;
  }, [dirsAtCurrentDir, sections, t]);
  const resolvedTab = useMemo(() => {
    if (activeTab && availableTabs.some((tab) => tab.id === activeTab)) return activeTab;
    const pages = availableTabs.find((tab) => tab.id === 'cat:html');
    return (pages ?? availableTabs[0])?.id ?? null;
  }, [activeTab, availableTabs]);

  const displayName = (f: ProjectFile) => (searching || currentDir === '' ? f.name : f.name.slice(currentDir.length + 1));
  const toggleSelect = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const handleBatchDownload = async () => {
    const names = [...selected];
    if (!names.length) return;
    try {
      const entries = (
        await Promise.all(names.map(async (name) => ({ path: name, data: await source.readBlob(name) })))
      ).filter((e): e is { path: string; data: Blob } => e.data !== null);
      downloadBlob(await buildBinaryZip(entries), `${source.label.replace(/[^\w.-]+/g, '-') || 'project'}.zip`);
    } catch (err) {
      toast.show(t('app.exportFailed', { message: err instanceof Error ? err.message : String(err) }), { tone: 'error' });
    }
  };

  const openMenu = (name: string, anchor: HTMLElement) => {
    menuAnchorRef.current = anchor;
    setMenuFor((current) => (current === name ? null : name));
  };

  const checkbox = (f: ProjectFile, className: string) => {
    const isSelected = selected.has(f.name);
    return (
      <span
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          toggleSelect(f.name);
        }}
        role="checkbox"
        aria-checked={isSelected}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleSelect(f.name);
          }
        }}
      >
        <RemixIcon name={isSelected ? 'checkbox-line' : 'checkbox-blank-line'} size={14} />
      </span>
    );
  };

  const rowMenu = (f: ProjectFile, extraClass = '') => (
    <span
      data-testid={`design-file-menu-${f.name}`}
      className={`df-row-menu${extraClass}`}
      role="button"
      tabIndex={0}
      aria-label={t('designFiles.rowMenu')}
      onClick={(e) => {
        e.stopPropagation();
        openMenu(f.name, e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openMenu(f.name, e.currentTarget);
        }
      }}
    >
      ⋯
    </span>
  );

  function renderFileRow(f: ProjectFile, category: FileCategory) {
    return (
      <div key={f.name} data-testid={`design-file-row-${f.name}`} className={`df-row df-file-row ${selected.has(f.name) ? 'selected' : ''}`}>
        {checkbox(f, 'df-row-check')}
        <span className="df-row-icon df-row-openable" data-kind={category} aria-hidden onClick={() => onOpenFile(f.name)}>
          {kindGlyph(category)}
        </span>
        <div className="df-row-name-wrap">
          <button type="button" className="df-row-name-btn" onClick={() => onOpenFile(f.name)}>
            <span className="df-row-name-wrap">
              <span className="df-row-name" title={f.name}>
                {displayName(f)}
              </span>
              <span className="df-row-sub">{kindLabel(category, t)}</span>
            </span>
          </button>
        </div>
        <span className="df-row-size df-row-openable" onClick={() => onOpenFile(f.name)}>
          {humanSize(f.size)}
        </span>
        <span className="df-row-time df-row-openable" onClick={() => onOpenFile(f.name)}>
          {f.mtime ? relativeTime(f.mtime, t) : ''}
        </span>
        {rowMenu(f)}
      </div>
    );
  }

  function renderPageCard(f: ProjectFile, category: FileCategory) {
    const openLabel = `${t('designFiles.previewOpen')} ${f.name}`;
    return (
      <div key={f.name} data-testid={`design-file-row-${f.name}`} className={`df-card ${selected.has(f.name) ? 'selected' : ''}`}>
        {checkbox(f, 'df-card-check')}
        <button type="button" className="df-card-thumb" onClick={() => onOpenFile(f.name)} title={openLabel} aria-label={openLabel}>
          <HtmlCardThumbnail source={source} file={f} refreshKey={refreshKey} />
        </button>
        <div className="df-card-meta">
          <div className="df-card-meta-text">
            <button type="button" className="df-card-name-btn" title={openLabel} onClick={() => onOpenFile(f.name)}>
              <span className="df-card-name" title={displayName(f)}>
                {displayName(f)}
              </span>
            </button>
            <span className="df-card-sub">
              {kindLabel(category, t)}
              {f.mtime ? ` · ${relativeTime(f.mtime, t)}` : ''}
            </span>
          </div>
          {rowMenu(f)}
        </div>
      </div>
    );
  }

  function renderImageCard(f: ProjectFile) {
    const openLabel = `${t('designFiles.previewOpen')} ${f.name}`;
    return (
      <div key={f.name} data-testid={`design-file-row-${f.name}`} className={`df-card df-card--image ${selected.has(f.name) ? 'selected' : ''}`}>
        {checkbox(f, 'df-card-check')}
        <DesignFileImageThumb src={source.fileUrl(f.name, f.mtime)} title={openLabel} onOpen={() => onOpenFile(f.name)} />
        {rowMenu(f, ' df-card-menu-overlay')}
      </div>
    );
  }

  function renderDirRow(dirName: string) {
    const fullPath = currentDir === '' ? dirName : `${currentDir}/${dirName}`;
    return (
      <div key={fullPath} className="df-row df-dir-row" onClick={() => setCurrentDir(fullPath)}>
        <span className="df-row-check" aria-hidden />
        <span className="df-row-icon" data-kind="folder" aria-hidden>
          <Icon name="folder" size={14} />
        </span>
        <div className="df-row-name-wrap">
          <button type="button" className="df-row-name-btn" onClick={() => setCurrentDir(fullPath)}>
            <span className="df-row-name-wrap">
              <span className="df-row-name" title={dirName}>
                {dirName}
              </span>
              <span className="df-row-sub">{t('designFiles.folderCount', { n: descendantCount.get(fullPath) ?? 0 })}</span>
            </span>
          </button>
        </div>
        <span className="df-row-size" />
        <span className="df-row-time" />
        <span className="df-row-menu df-row-menu-placeholder" aria-hidden />
      </div>
    );
  }

  const breadcrumbs = (
    <nav className="df-breadcrumbs" aria-label={t('designFiles.crumbs')}>
      {currentDir === '' ? (
        <span className="df-breadcrumb-current">{source.label}</span>
      ) : (
        <button type="button" className="df-breadcrumb-btn" onClick={() => setCurrentDir('')}>
          {source.label}
        </button>
      )}
      {currentDir
        .split('/')
        .filter(Boolean)
        .map((segment, idx, parts) => {
          const path = parts.slice(0, idx + 1).join('/');
          const isLast = idx === parts.length - 1;
          return (
            <span key={path} className="df-breadcrumb-segment">
              <span className="df-breadcrumb-sep" aria-hidden>
                /
              </span>
              {isLast ? (
                <span className="df-breadcrumb-current">{segment}</span>
              ) : (
                <button type="button" className="df-breadcrumb-btn" onClick={() => setCurrentDir(path)}>
                  {segment}
                </button>
              )}
            </span>
          );
        })}
    </nav>
  );

  const menuFile = menuFor ? files.find((f) => f.name === menuFor) ?? null : null;
  const isEmpty = files.length === 0;

  return (
    <div className={`df-panel ${selected.size > 0 ? 'has-selection' : ''}`} data-testid="design-files-panel">
      {loading && isEmpty ? (
        <div className="df-reloading-overlay" data-testid="design-files-reloading">
          <span className="loading-spinner">
            <Icon name="spinner" size={16} />
            <span className="loading-spinner-label">{t('common.loading')}</span>
          </span>
        </div>
      ) : null}
      <div className="df-main">
        <div className="df-topbar">
          <div className="df-topbar-left">{breadcrumbs}</div>
          <div className="df-topbar-right">
            <div className="df-actions">
              <label className="odp-df-search">
                <RemixIcon name="search-line" size={13} />
                <input
                  type="search"
                  value={query}
                  placeholder={t('designFiles.searchPlaceholder')}
                  aria-label={t('designFiles.searchPlaceholder')}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button type="button" onClick={onRetry} title={t('designFiles.refresh')} data-testid="design-files-refresh">
                <Icon name="refresh" size={13} />
                <span>{t('designFiles.refresh')}</span>
              </button>
            </div>
          </div>
        </div>
        <div className="df-body">
          {error ? (
            <div className="df-upload-banner" role="alert">
              <span>{t('app.filesError', { message: error })}</span>
              <button type="button" onClick={onRetry}>
                {t('app.retry')}
              </button>
            </div>
          ) : null}
          {selected.size > 0 ? (
            <div className="df-batch-bar" data-testid="design-files-batch-bar">
              <span className="df-batch-count">{t('designFiles.downloadSelected', { n: selected.size })}</span>
              <div className="df-batch-actions">
                <button type="button" onClick={() => void handleBatchDownload()}>
                  <Icon name="download" size={13} />
                  <span>{t('designFiles.download')}</span>
                </button>
                <button type="button" className="df-batch-clear" onClick={() => setSelected(new Set())}>
                  {t('designFiles.clearSelection')}
                </button>
              </div>
            </div>
          ) : null}
          {isEmpty && !loading ? (
            <div className="df-empty" data-testid="design-files-empty">
              <div className="df-empty-pill">
                <span className="df-empty-title">{error ? t('fileViewer.previewUnavailable') : t('designFiles.empty')}</span>
                {!error && (onNewSketch || onNewDocument || onUpload) ? (
                  <div className="df-empty-actions">
                    {onNewSketch ? (
                      <button type="button" className="df-empty-cta df-empty-cta-primary" data-testid="design-files-empty-new-sketch" onClick={onNewSketch} title={t('designFiles.newSketch')}>
                        <Icon name="pencil" size={13} />
                        <span>{t('designFiles.newSketch')}</span>
                      </button>
                    ) : null}
                    {onNewDocument ? (
                      <button type="button" className="df-empty-cta df-empty-cta-doc" data-testid="design-files-empty-new-document" onClick={onNewDocument} title={t('designFiles.newDocumentTitle')}>
                        <Icon name="file" size={13} />
                        <span>{t('designFiles.newDocument')}</span>
                      </button>
                    ) : null}
                    {onUpload ? (
                      <button type="button" className="df-empty-cta df-empty-cta-upload" data-testid="design-files-upload-trigger" onClick={onUpload} title={t('designFiles.upload.title')}>
                        <Icon name="upload" size={13} />
                        <span>{t('designFiles.upload.label')}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {availableTabs.length > 0 ? (
                <div className="df-tabs" role="tablist" data-testid="design-files-tabs">
                  {availableTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={resolvedTab === tab.id}
                      className={`df-tab ${resolvedTab === tab.id ? 'active' : ''}`}
                      data-testid={`design-files-tab-${tab.id}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                      <span className="df-tab-count">{tab.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {resolvedTab === 'folders' ? <div className="df-section">{dirsAtCurrentDir.map(renderDirRow)}</div> : null}
              {sections.map(([category, sectionFiles]) =>
                resolvedTab === `cat:${category}` ? (
                  <div className="df-section" key={category}>
                    {category === 'html' ? (
                      <div className="df-card-grid">{sectionFiles.map((f) => renderPageCard(f, category))}</div>
                    ) : category === 'image' ? (
                      <div className="df-image-masonry" data-testid="design-files-image-masonry">
                        {sectionFiles.map((f) => renderImageCard(f))}
                      </div>
                    ) : (
                      sectionFiles.map((f) => renderFileRow(f, category))
                    )}
                  </div>
                ) : null,
              )}
            </>
          )}
        </div>
      </div>
      <AnchoredPopover
        anchor={menuAnchorRef}
        open={menuFile !== null}
        onClose={() => setMenuFor(null)}
        className="df-row-popover"
        align="end"
      >
        {menuFile ? (
          <>
            <button
              type="button"
              onClick={() => {
                setMenuFor(null);
                onOpenFile(menuFile.name);
              }}
            >
              {t('designFiles.openInTab')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuFor(null);
                void copyText(menuFile.name).then(() => toast.show(t('designFiles.copiedPath'), { tone: 'success' }));
              }}
            >
              {t('designFiles.copyPath')}
            </button>
            <a
              href={source.fileUrl(menuFile.name, menuFile.mtime)}
              download={baseName(menuFile.name)}
              style={{ textDecoration: 'none' }}
              onClick={() => setMenuFor(null)}
            >
              <button type="button">{t('designFiles.download')}</button>
            </a>
            <a
              href={source.fileUrl(menuFile.name, menuFile.mtime)}
              target="_blank"
              rel="noreferrer noopener"
              style={{ textDecoration: 'none' }}
              onClick={() => setMenuFor(null)}
            >
              <button type="button">{t('common.openInNewTab')}</button>
            </a>
          </>
        ) : null}
      </AnchoredPopover>
    </div>
  );
}
