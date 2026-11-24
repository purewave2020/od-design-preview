import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { copyText } from '../lib/hooks';
import { DaemonSource } from '../sources/daemon-source';
import { LocalSource, localSourceFromDrop } from '../sources/local-source';
import { StaticSource } from '../sources/static-source';
import type { PreviewSource } from '../sources/types';
import { useToast } from '../ui/Toast';
import { EmbeddedViewer, PreviewWorkspace } from '../workspace/PreviewWorkspace';
import { ProjectSwitcher, type ThemePref } from './ProjectSwitcher';

const DEMO_BASE = `${import.meta.env.BASE_URL}demo-project/`;
const THEME_KEY = 'od-preview:theme';

interface UrlState {
  source: PreviewSource;
  file: string | null;
  embed: boolean;
}

function demoSource(label: string): PreviewSource {
  return new StaticSource(DEMO_BASE, label);
}

/**
 * URL contract (shareable / embeddable):
 *   ?source=demo                              bundled demo (default)
 *   ?source=static&base=/path/&name=Label     any static folder with manifest.json
 *   ?source=daemon&project=<id>[&daemon=<origin>][&name=Label]
 *   &file=<project-relative path>             open that file
 *   &embed=1                                  viewer only (no tab strip)
 *   &lang=zh-CN|en  &theme=light|dark|system
 */
function readUrlState(demoLabel: string): UrlState {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get('source');
  const file = params.get('file');
  const embed = params.get('embed') === '1';
  if (kind === 'daemon' && params.get('project')) {
    const project = params.get('project')!;
    return { source: new DaemonSource(params.get('daemon') ?? '', project, params.get('name') ?? project), file, embed };
  }
  if (kind === 'static' && params.get('base')) {
    return { source: new StaticSource(params.get('base')!, params.get('name') ?? params.get('base')!), file, embed };
  }
  return { source: demoSource(demoLabel), file, embed };
}

function writeUrl(source: PreviewSource, file: string | null, mode: 'replace' | 'link' = 'replace'): string {
  const url = new URL(window.location.href);
  const keep = ['lang', 'theme', 'embed'];
  for (const key of [...url.searchParams.keys()]) if (!keep.includes(key)) url.searchParams.delete(key);
  if (source instanceof DaemonSource) {
    url.searchParams.set('source', 'daemon');
    url.searchParams.set('project', source.projectId);
    const origin = source.origin;
    if (origin) url.searchParams.set('daemon', origin);
    if (source.label !== source.projectId) url.searchParams.set('name', source.label);
  } else if (source instanceof StaticSource && !source.id.endsWith(DEMO_BASE) && source.description !== new URL(DEMO_BASE, window.location.href).href) {
    url.searchParams.set('source', 'static');
    url.searchParams.set('base', new URL(source.description).pathname);
    url.searchParams.set('name', source.label);
  }
  if (file && source.kind !== 'local') url.searchParams.set('file', file);
  if (mode === 'replace') window.history.replaceState(null, '', url);
  return url.href;
}

function applyTheme(theme: ThemePref) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function App() {
  const t = useT();
  const toast = useToast();
  const initial = useMemo(() => readUrlState(t('app.demoProject')), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [source, setSource] = useState<PreviewSource>(initial.source);
  const [initialFile, setInitialFile] = useState<string | null>(initial.file);
  const activeFileRef = useRef<string | null>(initial.file);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);

  const [theme, setTheme] = useState<ThemePref>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('theme');
    if (fromUrl === 'light' || fromUrl === 'dark' || fromUrl === 'system') return fromUrl;
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {
      /* ignore */
    }
    return 'system';
  });
  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    document.title = `${source.label} · Open Design Preview`;
    return () => source.dispose?.();
  }, [source]);

  const switchSource = useCallback((next: PreviewSource) => {
    activeFileRef.current = null;
    setInitialFile(null);
    setSource(next);
    writeUrl(next, null);
  }, []);

  const onActiveFileChange = useCallback(
    (name: string | null) => {
      activeFileRef.current = name;
      writeUrl(source, name);
    },
    [source],
  );

  const openFolderLive = LocalSource.isLiveFolderSupported()
    ? async () => {
        try {
          const next = await LocalSource.pickDirectory();
          if (next) switchSource(next);
        } catch (err) {
          toast.show(String(err instanceof Error ? err.message : err), { tone: 'error' });
        }
      }
    : null;

  const onInputFiles = (input: HTMLInputElement | null) => {
    const list = input?.files ? Array.from(input.files) : [];
    if (input) input.value = '';
    if (list.length) switchSource(LocalSource.fromFiles(list));
  };

  const onDropFiles = useCallback(
    (dataTransfer: DataTransfer) => {
      void localSourceFromDrop(dataTransfer).then(
        (next) => {
          if (next) switchSource(next);
        },
        (err: unknown) => toast.show(String(err instanceof Error ? err.message : err), { tone: 'error' }),
      );
    },
    [switchSource, toast],
  );

  if (initial.embed && initial.file) {
    return <EmbeddedViewer source={source} file={initial.file} />;
  }

  return (
    <div className="app odp-app">
      <PreviewWorkspace
        key={source.id}
        source={source}
        initialFile={initialFile}
        onActiveFileChange={onActiveFileChange}
        onDropFiles={onDropFiles}
        leading={
          <ProjectSwitcher
            source={source}
            theme={theme}
            onTheme={setTheme}
            onOpenDemo={() => switchSource(demoSource(t('app.demoProject')))}
            onOpenFolderLive={openFolderLive ? () => void openFolderLive() : null}
            onOpenFolderInput={() => folderInputRef.current?.click()}
            onOpenFilesInput={() => filesInputRef.current?.click()}
            onOpenDaemonProject={(origin, id, label) => switchSource(new DaemonSource(origin, id, label))}
            onCopyLink={() => {
              const href = writeUrl(source, activeFileRef.current, 'link');
              void copyText(href).then(() => toast.show(t('app.linkCopied'), { tone: 'success' }));
            }}
            onDiscardLocalChanges={
              source.discardLocalChanges
                ? () => {
                    if (!window.confirm(t('app.discardLocalChangesConfirm'))) return;
                    void source.discardLocalChanges?.().then(() => toast.show(t('app.localChangesDiscarded'), { tone: 'success' }));
                  }
                : undefined
            }
          />
        }
      />
      <input
        ref={(el) => {
          folderInputRef.current = el;
          // webkitdirectory is not in React's typings.
          if (el) el.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        hidden
        onChange={(e) => onInputFiles(e.currentTarget)}
      />
      <input ref={filesInputRef} type="file" multiple hidden onChange={(e) => onInputFiles(e.currentTarget)} />
    </div>
  );
}
