// The right-hand workspace pane, standalone. Port of the parts of
// apps/web/src/components/FileWorkspace.tsx that make up the preview surface:
// the `ws-tabs-shell` strip (Design Files tab + closable file tabs + the "+"
// tab launcher + the file-actions slot), the Design Files panel and retained
// file viewers (hidden-not-unmounted, so switching tabs never reloads a
// preview), plus the project-level pieces the review tools need: the shared
// comment state and the floating comments-card host (upstream ProjectView's
// `comment-float-host`).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { useT } from '../i18n';
import { usePersistentState } from '../lib/hooks';
import { CommentsProvider } from '../review/CommentsContext';
import { kindFor } from '../sources/file-kind';
import { canWrite, type PreviewSource } from '../sources/types';
import type { ProjectFile, ProjectFileKind } from '../types';
import { useToast } from '../ui/Toast';
import { Icon, type IconName } from '../vendor/open-design/components/Icon';
import { emptySketchScene, serializeExcalidrawSketchScene } from '../vendor/open-design/components/sketch-model';
import { TabLauncherMenu } from '../vendor/open-design/components/workspace/TabLauncherMenu';
import { buildLauncherActions, type LauncherContext } from '../vendor/open-design/components/workspace/tab-launcher';
import type { WorkspaceContextItem } from '../vendor/open-design/contracts';
import { registerPreviewSource } from '../vendor/open-design/shims/registry';
import { FileViewer } from '../viewer/FileViewer';
import { DesignFilesPanel } from './DesignFilesPanel';

export const DESIGN_FILES_TAB = '__design_files__';
const MAX_RETAINED_VIEWERS = 4;

const RETAINED_VIEWER_INACTIVE_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
};

function kindIconName(kind: ProjectFileKind | undefined, name?: string): IconName {
  if (name?.endsWith('.sketch.json')) return 'pencil';
  switch (kind) {
    case 'html':
      return 'file-code';
    case 'image':
    case 'sketch':
      return 'image';
    case 'video':
      return 'video-ai';
    case 'audio':
      return 'volume';
    case 'text':
      return 'file-text';
    case 'code':
      return 'file-code';
    case 'presentation':
      return 'slides';
    default:
      return 'file';
  }
}

const Tab = memo(function Tab({
  label,
  title,
  active,
  kind,
  onActivate,
  onClose,
  closeLabel,
}: {
  label: string;
  title: string;
  active: boolean;
  kind?: ProjectFileKind;
  onActivate: () => void;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div
      className={['ws-tab', 'od-tooltip', active ? 'active' : ''].filter(Boolean).join(' ')}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={title}
      data-tooltip={title}
      data-tooltip-placement="bottom"
      data-testid={`ws-tab-${title}`}
    >
      <span className="tab-icon" aria-hidden>
        <Icon name={kindIconName(kind, title)} size={13} />
      </span>
      <span className="ws-tab-text">
        <span className="ws-tab-label">{label}</span>
      </span>
      <button
        type="button"
        className="ws-tab-close od-tooltip"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title={closeLabel}
        data-tooltip={closeLabel}
        data-tooltip-placement="bottom"
        aria-label={closeLabel}
      >
        <Icon name="close" size={11} />
      </button>
    </div>
  );
});

function diffChangedFiles(prev: ProjectFile[], next: ProjectFile[]): string[] {
  const before = new Map(prev.map((f) => [f.name, f]));
  const changed: string[] = [];
  for (const f of next) {
    const old = before.get(f.name);
    if (!old || old.mtime !== f.mtime || old.size !== f.size) changed.push(f.name);
    before.delete(f.name);
  }
  return [...changed, ...before.keys()];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** `name.ext` → first free `name.ext`, `name-2.ext`, … in the project. */
function uniqueName(desired: string, taken: Set<string>): string {
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

/** Same starter as upstream `initialMarkdownDocument` (FileWorkspace.tsx). */
function initialMarkdownDocument(path: string, t: (key: string) => string): string {
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

export interface PreviewWorkspaceProps {
  source: PreviewSource;
  /** Left slot of the tab strip (project switcher). */
  leading?: ReactNode;
  /** Extra controls at the far right of the tab strip. */
  trailing?: ReactNode;
  initialFile?: string | null;
  /** Called with the active file (null = Design Files) for URL sync. */
  onActiveFileChange?: (name: string | null) => void;
  onDropFiles?: (dataTransfer: DataTransfer) => void;
}

export function PreviewWorkspace(props: PreviewWorkspaceProps) {
  return (
    <CommentsProvider source={props.source}>
      <PreviewWorkspaceInner {...props} />
    </CommentsProvider>
  );
}

function PreviewWorkspaceInner({ source, leading, trailing, initialFile, onActiveFileChange, onDropFiles }: PreviewWorkspaceProps) {
  const t = useT();
  const toast = useToast();
  const writable = canWrite(source);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const filesRef = useRef<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetRefreshKey, setAssetRefreshKey] = useState(0);
  const [listingKey, setListingKey] = useState(0);
  const persistKey = source.kind === 'local' ? null : `od-preview:tabs:${source.id}`;
  const [tabs, setTabs] = usePersistentState<string[]>(persistKey, [], isStringArray);
  const [activeTab, setActiveTab] = useState<string>(DESIGN_FILES_TAB);
  const [retained, setRetained] = useState<string[]>([]);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [commentHost, setCommentHost] = useState<HTMLDivElement | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherBtnRef = useRef<HTMLButtonElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const tabsBarRef = useRef<HTMLDivElement | null>(null);
  const initialApplied = useRef<string | null>(null);

  useEffect(() => registerPreviewSource(source), [source]);

  // --- listing + change feed ---------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void source
      .listFiles(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        const changed = filesRef.current.length ? diffChangedFiles(filesRef.current, next) : [];
        // Any non-HTML change (stylesheet, image, script) can affect every
        // page, so HTML previews reload; an HTML file's own mtime already
        // reloads just that viewer. Sketches and documents never do.
        if (changed.some((name) => kindFor(name) !== 'html' && !/\.(sketch\.json|md|markdown)$/i.test(name))) setAssetRefreshKey((k) => k + 1);
        filesRef.current = next;
        setFiles(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source, listingKey]);

  useEffect(() => {
    filesRef.current = [];
    setFiles([]);
    setActiveTab(DESIGN_FILES_TAB);
    setRetained([]);
    initialApplied.current = null;
  }, [source]);

  useEffect(() => {
    if (!source.watch) return;
    return source.watch(() => setListingKey((k) => k + 1));
  }, [source]);

  const fileByName = useMemo(() => new Map(files.map((f) => [f.name, f])), [files]);

  /** Show a file this app just wrote without waiting for the next listing. */
  const adoptWrittenFile = useCallback((file: ProjectFile) => {
    const next = [...filesRef.current.filter((f) => f.name !== file.name), file];
    filesRef.current = next;
    setFiles(next);
  }, []);

  // --- tabs ------------------------------------------------------------------------
  const openFile = useCallback(
    (name: string) => {
      setTabs((prev) => (prev.includes(name) ? prev : [...prev, name]));
      setActiveTab(name);
    },
    [setTabs],
  );
  const closeTab = useCallback(
    (name: string) => {
      const index = tabs.indexOf(name);
      const next = tabs.filter((n) => n !== name);
      setTabs(next);
      if (activeTab === name) setActiveTab(next[Math.min(index, next.length - 1)] ?? DESIGN_FILES_TAB);
      setRetained((prev) => prev.filter((n) => n !== name));
    },
    [tabs, activeTab, setTabs],
  );

  // Deep link (?file=…) once the listing knows the file.
  useEffect(() => {
    if (!initialFile || initialApplied.current === initialFile) return;
    if (!fileByName.has(initialFile)) return;
    initialApplied.current = initialFile;
    openFile(initialFile);
  }, [initialFile, fileByName, openFile]);

  // Drop tabs whose files disappeared (after a successful listing).
  useEffect(() => {
    if (loading || error) return;
    setTabs((prev) => {
      const next = prev.filter((name) => fileByName.has(name));
      return next.length === prev.length ? prev : next;
    });
  }, [fileByName, loading, error, setTabs]);
  useEffect(() => {
    if (activeTab !== DESIGN_FILES_TAB && !tabs.includes(activeTab)) setActiveTab(DESIGN_FILES_TAB);
  }, [tabs, activeTab]);

  useEffect(() => {
    onActiveFileChange?.(activeTab === DESIGN_FILES_TAB ? null : activeTab);
  }, [activeTab, onActiveFileChange]);

  useEffect(() => {
    if (activeTab === DESIGN_FILES_TAB) return;
    setRetained((prev) => [activeTab, ...prev.filter((n) => n !== activeTab)].slice(0, MAX_RETAINED_VIEWERS));
    const bar = tabsBarRef.current;
    const el = bar?.querySelector<HTMLElement>('.ws-tab.active');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  // Keyboard: Ctrl+Tab / Ctrl+Shift+Tab cycle tabs (when focus is on the host).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        const order = [DESIGN_FILES_TAB, ...tabs];
        const i = order.indexOf(activeTab);
        setActiveTab(order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, activeTab]);

  // --- create / upload (upstream startNewSketch / createMarkdownDocument) -----------
  const takenNames = () => new Set(filesRef.current.map((f) => f.name.toLowerCase()));
  const writeAndOpen = useCallback(
    async (name: string, content: string | Blob, open = true) => {
      if (!source.writeFile) return null;
      try {
        const written = await source.writeFile(name, content);
        adoptWrittenFile(written);
        if (open) openFile(written.name);
        return written;
      } catch (err) {
        toast.show(t('app.writeFailed', { message: err instanceof Error ? err.message : String(err) }), { tone: 'error', ttlMs: 6000 });
        return null;
      }
    },
    [source, adoptWrittenFile, openFile, toast, t],
  );

  const createSketch = useCallback(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = uniqueName(`sketch-${stamp}.sketch.json`, takenNames());
    void writeAndOpen(name, serializeExcalidrawSketchScene(emptySketchScene(name), name));
  }, [writeAndOpen]);

  const createDocument = useCallback(() => {
    const name = uniqueName('document.md', takenNames());
    void writeAndOpen(name, initialMarkdownDocument(name, t));
  }, [writeAndOpen, t]);

  const uploadFiles = useCallback(
    async (list: File[]) => {
      if (!list.length) return;
      const taken = takenNames();
      let last: ProjectFile | null = null;
      for (const file of list) {
        const name = uniqueName(file.name, taken);
        taken.add(name.toLowerCase());
        last = (await writeAndOpen(name, file, false)) ?? last;
      }
      if (last) {
        toast.show(t('app.uploaded', { n: list.length }), { tone: 'success' });
        if (list.length === 1) openFile(last.name);
      }
    },
    [writeAndOpen, openFile, toast, t],
  );

  const launcherContext = useMemo<LauncherContext>(
    () => ({
      projectId: source.id,
      openTab: (tabId) => (tabId === DESIGN_FILES_TAB ? setActiveTab(DESIGN_FILES_TAB) : openFile(tabId)),
      ...(writable
        ? {
            createSketch,
            createDocument,
            uploadDesignFiles: () => uploadInputRef.current?.click(),
          }
        : {}),
    }),
    [source.id, writable, openFile, createSketch, createDocument],
  );
  const launcherActions = useMemo(() => buildLauncherActions(launcherContext), [launcherContext]);
  const workspaceContexts = useMemo<WorkspaceContextItem[]>(
    () => [
      { id: 'workspace:design-files', kind: 'design-files', label: t('workspace.designFiles'), tabId: DESIGN_FILES_TAB },
      ...tabs.map((name) => ({ id: `file:${name}`, kind: 'file' as const, label: name.slice(name.lastIndexOf('/') + 1), tabId: name, path: name })),
    ],
    [tabs, t],
  );

  const designFilesActive = activeTab === DESIGN_FILES_TAB;
  const viewerFileActive = !designFilesActive && fileByName.has(activeTab);
  const mountedViewers = retained.filter((name) => fileByName.has(name));

  const onDragEnter = (e: DragEvent) => {
    if (!onDropFiles || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!onDropFiles) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0 || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  return (
    <div
      className="workspace odp-workspace"
      data-testid="file-workspace"
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        if (onDropFiles && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        if (!onDropFiles || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        onDropFiles(e.dataTransfer);
      }}
    >
      <div className="ws-tabs-shell">
        {leading ? <div className="ws-tabs-project-dock odp-project-dock">{leading}</div> : null}
        <div
          ref={tabsBarRef}
          className="ws-tabs-bar"
          role="tablist"
          aria-label={t('workspace.pages')}
          onWheel={(event) => {
            const el = event.currentTarget;
            if (el.scrollWidth <= el.clientWidth) return;
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            el.scrollLeft += event.deltaY;
          }}
        >
          <button
            type="button"
            className={`ws-tab design-files-tab ${designFilesActive ? 'active' : ''}`}
            role="tab"
            aria-selected={designFilesActive}
            aria-label={t('workspace.designFiles')}
            data-testid="design-files-tab"
            onClick={() => setActiveTab(DESIGN_FILES_TAB)}
            title={t('workspace.designFiles')}
          >
            <span className="tab-icon" aria-hidden>
              <Icon name="grid" size={14} />
            </span>
            <span className="ws-tab-label">{t('workspace.designFiles')}</span>
          </button>
          {tabs.map((name) => {
            const file = fileByName.get(name);
            return (
              <Tab
                key={name}
                label={name.slice(name.lastIndexOf('/') + 1)}
                title={name}
                kind={file?.kind ?? kindFor(name)}
                active={activeTab === name}
                onActivate={() => setActiveTab(name)}
                onClose={() => closeTab(name)}
                closeLabel={t('workspace.closeTab')}
              />
            );
          })}
        </div>
        <div className="ws-add-tab">
          <button
            ref={launcherBtnRef}
            type="button"
            className="icon-only ws-tab-add od-tooltip"
            data-testid="workspace-add-tab"
            aria-haspopup="dialog"
            aria-expanded={launcherOpen}
            title={t('workspace.newTab')}
            data-tooltip={t('workspace.newTab')}
            data-tooltip-placement="bottom"
            aria-label={t('workspace.newTab')}
            onClick={() => setLauncherOpen((v) => !v)}
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
        <div className="ws-tabs-actions">
          <div ref={setActionsHost} className="ws-tabs-file-actions" data-app-chrome-file-actions="true" hidden={!viewerFileActive} />
          {trailing}
        </div>
      </div>
      {launcherOpen ? (
        <TabLauncherMenu
          anchor={launcherBtnRef.current}
          files={files}
          workspaceContexts={workspaceContexts}
          openTabNames={tabs}
          actions={launcherActions}
          launcherContext={launcherContext}
          onOpenFile={openFile}
          onOpenTab={launcherContext.openTab}
          onClose={() => setLauncherOpen(false)}
        />
      ) : null}
      <div className="ws-body">
        {designFilesActive ? (
          <DesignFilesPanel
            source={source}
            files={files}
            loading={loading}
            error={error}
            refreshKey={assetRefreshKey}
            onRetry={() => setListingKey((k) => k + 1)}
            onOpenFile={openFile}
            onNewSketch={writable ? createSketch : undefined}
            onNewDocument={writable ? createDocument : undefined}
            onUpload={writable ? () => uploadInputRef.current?.click() : undefined}
          />
        ) : null}
        {!designFilesActive && !viewerFileActive && !loading ? (
          <div className="viewer">
            <div className="viewer-body">
              <div className="viewer-empty">{t('app.fileMissing')}</div>
            </div>
          </div>
        ) : null}
        {mountedViewers.map((name) => {
          const file = fileByName.get(name)!;
          const isActive = activeTab === name;
          return (
            <div
              key={name}
              data-testid="retained-file-viewer"
              data-file-name={name}
              aria-hidden={isActive ? undefined : true}
              ref={(el) => {
                if (!el) return;
                if (isActive) el.removeAttribute('inert');
                else el.setAttribute('inert', '');
              }}
              style={{
                display: 'flex',
                flex: isActive ? '1 1 auto' : undefined,
                flexDirection: 'column',
                minHeight: 0,
                ...(isActive ? {} : RETAINED_VIEWER_INACTIVE_STYLE),
              }}
            >
              <FileViewer
                source={source}
                file={file}
                filesRefreshKey={assetRefreshKey}
                active={isActive}
                actionsHost={actionsHost}
                commentHost={commentHost}
                projectFiles={files}
                onOpenFile={openFile}
              />
            </div>
          );
        })}
        {dragging ? (
          <div className="df-drop-overlay" aria-hidden>
            <div className="df-drop-overlay-card">
              <Icon name="upload" size={22} />
              <span className="label">{t('app.dropToOpen')}</span>
              <span className="desc">{t('app.dropToOpenDesc')}</span>
            </div>
          </div>
        ) : null}
      </div>
      {/* Floating comments card (upstream ProjectView `comment-float-host`):
          pre-mounted so a viewer can portal into it the moment comments open;
          `:empty` hides it otherwise. */}
      <div ref={setCommentHost} className="comment-float-host" data-testid="comment-float-host" />
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        data-testid="workspace-upload-input"
        onChange={(e) => {
          const list = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
          e.currentTarget.value = '';
          void uploadFiles(list);
        }}
      />
    </div>
  );
}

/** Viewer-only surface for `?embed=1&file=…` (no tab strip). */
export function EmbeddedViewer({ source, file }: { source: PreviewSource; file: string }) {
  const t = useT();
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => registerPreviewSource(source), [source]);
  useEffect(() => {
    let cancelled = false;
    void source.listFiles().then(
      (next) => !cancelled && setFiles(next),
      () => !cancelled && setFiles([]),
    );
    return () => {
      cancelled = true;
    };
  }, [source, refreshKey]);
  useEffect(() => (source.watch ? source.watch(() => setRefreshKey((k) => k + 1)) : undefined), [source]);
  const target = files?.find((f) => f.name === file) ?? null;
  return (
    <div className="workspace odp-workspace odp-embed" data-testid="embedded-viewer">
      <div className="ws-body">
        {files === null ? null : target ? (
          <FileViewer source={source} file={target} filesRefreshKey={refreshKey} active actionsHost={null} projectFiles={files} viewerOnly />
        ) : (
          <div className="viewer">
            <div className="viewer-body">
              <div className="viewer-empty">{t('app.fileMissing')}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
