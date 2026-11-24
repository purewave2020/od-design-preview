// Port of FileViewer.tsx `MarkdownViewer`: same Source / Split / Preview
// workbench and markup (`markdown-workbench`, `markdown-rendered`), rendered
// through the vendored micromark+GFM pipeline. Relative images resolve
// against the project; links to other project files open as tabs. On a
// writable source the editor is live and autosaves 700 ms after typing stops
// (upstream's timing), with the same "Saving… / Auto-saved · time" status.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useLocale, useT } from '../i18n';
import { copyText, usePersistentState } from '../lib/hooks';
import { exportAsMd } from '../vendor/open-design/runtime/exports';
import { renderMarkdownToSafeHtml } from '../vendor/open-design/artifacts/markdown';
import { Icon } from '../vendor/open-design/components/Icon';
import { RemixIcon } from '../vendor/open-design/components/RemixIcon';
import { resolveProjectPath } from '../sources/inline-assets';
import { baseName } from '../sources/file-kind';
import { canWrite, type PreviewSource } from '../sources/types';
import type { ProjectFile } from '../types';

type Mode = 'edit' | 'split' | 'preview';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 700;

function isMode(value: unknown): value is Mode {
  return value === 'edit' || value === 'split' || value === 'preview';
}

export function MarkdownViewer({
  source,
  file,
  filesRefreshKey,
  projectFiles,
  onOpenFile,
  viewerOnly = false,
}: {
  source: PreviewSource;
  file: ProjectFile;
  filesRefreshKey: number;
  projectFiles: ProjectFile[];
  onOpenFile?: (name: string) => void;
  viewerOnly?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const editable = canWrite(source) && !viewerOnly;
  const [mode, setMode] = usePersistentState<Mode>('od-preview:markdown-mode', editable ? 'split' : 'preview', isMode);
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const known = useMemo(() => new Set(projectFiles.map((f) => f.name)), [projectFiles]);
  const textRef = useRef('');
  const lastSavedRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void source.readText(file.name, { fresh: true }).then((next) => {
      if (cancelled) return;
      const value = next ?? '';
      // Keep unsaved typing; ignore the echo of our own save.
      if (lastSavedRef.current !== null && textRef.current !== lastSavedRef.current) return;
      if (value === lastSavedRef.current && textRef.current === value) return;
      lastSavedRef.current = value;
      textRef.current = value;
      setText(value);
    });
    return () => {
      cancelled = true;
    };
  }, [source, file.name, file.mtime, filesRefreshKey]);

  const save = useCallback(
    async (value: string) => {
      if (!editable || !source.writeFile) return;
      if (inFlightRef.current) await inFlightRef.current;
      if (value === lastSavedRef.current) return;
      const run = (async () => {
        setSaveState('saving');
        try {
          await source.writeFile!(file.name, value);
          lastSavedRef.current = value;
          setSavedAt(Date.now());
          setSaveState(textRef.current === value ? 'saved' : 'idle');
        } catch {
          setSaveState('error');
        }
      })();
      inFlightRef.current = run;
      try {
        await run;
      } finally {
        if (inFlightRef.current === run) inFlightRef.current = null;
      }
    },
    [editable, source, file.name],
  );

  const onChangeText = (value: string) => {
    textRef.current = value;
    setText(value);
    setSaveState((current) => (current === 'saved' ? 'idle' : current));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void save(textRef.current);
    }, AUTOSAVE_DELAY_MS);
  };

  // Flush on unmount (tab closed / file switched).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        void saveRef.current(textRef.current);
      }
    },
    [],
  );

  const html = useMemo(() => {
    if (text === null) return null;
    const rendered = renderMarkdownToSafeHtml(text);
    // Point relative <img src> at the project's own bytes.
    return rendered.replace(/(<img\b[^>]*?\ssrc=")([^"]+)(")/gi, (match, lead: string, src: string, tail: string) => {
      const path = resolveProjectPath(file.name, src);
      if (!path || !known.has(path)) return match;
      const target = projectFiles.find((f) => f.name === path);
      return `${lead}${source.fileUrl(path, target?.mtime)}${tail}`;
    });
  }, [text, file.name, known, projectFiles, source]);

  const onArticleClick = (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href) return;
    const path = resolveProjectPath(file.name, href);
    if (path && known.has(path) && onOpenFile) {
      event.preventDefault();
      onOpenFile(path);
      return;
    }
    if (/^https?:/i.test(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  const showEditor = mode !== 'preview';
  const showPreview = mode !== 'edit';
  const autoSaveTime = savedAt != null ? new Date(savedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null;
  const autoSaveLabel =
    saveState === 'error'
      ? t('fileViewer.markdownSaveFailed')
      : saveState === 'saving'
        ? t('fileViewer.markdownSaving')
        : savedAt != null && autoSaveTime
          ? t('fileViewer.markdownAutoSaved', { time: autoSaveTime })
          : t('fileViewer.markdownAutoSaveHint');
  const autoSaveStatus = saveState === 'error' ? 'error' : saveState === 'saving' ? 'saving' : savedAt != null ? 'saved' : 'idle';

  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <div className="viewer-tabs markdown-mode-tabs" role="tablist" aria-label={t('fileViewer.markdownViewMode')}>
            {(['edit', 'split', 'preview'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                className={`viewer-tab ${mode === item ? 'active' : ''}`}
                data-testid={`markdown-mode-${item}`}
                onClick={() => setMode(item)}
              >
                {item === 'edit' ? t('fileViewer.source') : item === 'split' ? t('fileViewer.split') : t('fileViewer.preview')}
              </button>
            ))}
          </div>
        </div>
        <div className="viewer-toolbar-actions">
          {editable ? (
            autoSaveStatus === 'error' ? (
              <button
                type="button"
                className="viewer-action markdown-autosave markdown-autosave-error"
                onClick={() => text !== null && void save(text)}
                title={t('fileViewer.save')}
              >
                <Icon name="alert-triangle" size={13} />
                <span>{autoSaveLabel}</span>
              </button>
            ) : (
              <span className={`viewer-meta markdown-autosave markdown-autosave-${autoSaveStatus}`} data-testid="markdown-autosave">
                {autoSaveStatus === 'saving' ? <Icon name="spinner" size={13} className="icon-spin" /> : autoSaveStatus === 'saved' ? <Icon name="check" size={13} /> : null}
                <span>{autoSaveLabel}</span>
              </span>
            )
          ) : null}
          <button
            type="button"
            className="viewer-action"
            onClick={() => {
              if (text === null) return;
              void copyText(text).then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
            title={t('fileViewer.copyTitle')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </button>
          <button
            type="button"
            className="viewer-action"
            disabled={text === null}
            onClick={() => text !== null && exportAsMd(text, baseName(file.name).replace(/\.[^.]+$/, ''))}
          >
            <RemixIcon name="download-line" size={14} />
            <span>{t('fileViewer.download')}</span>
          </button>
        </div>
      </div>
      <div className={`viewer-body markdown-workbench markdown-workbench-${mode}`}>
        {text === null || html === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : (
          <>
            {showEditor ? (
              <section className="markdown-editor-pane" aria-label={t('fileViewer.markdownEditor')}>
                <textarea
                  className="markdown-editor"
                  value={text}
                  readOnly={!editable}
                  aria-label={t('fileViewer.markdownEditor')}
                  placeholder={editable ? t('fileViewer.markdownEditorPlaceholder') : undefined}
                  spellCheck={editable}
                  data-testid="markdown-editor"
                  onChange={(event) => onChangeText(event.currentTarget.value)}
                />
              </section>
            ) : null}
            {showPreview ? (
              <div className="markdown-preview-pane-wrap">
                <section className="markdown-preview-pane" aria-label={t('fileViewer.markdownPreview')}>
                  {/* Safe by contract: renderMarkdownToSafeHtml escapes raw HTML and rejects unsafe link protocols. */}
                  <article ref={articleRef} className="markdown-rendered" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: html }} />
                </section>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
