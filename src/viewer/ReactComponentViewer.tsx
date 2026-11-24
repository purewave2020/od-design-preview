// Port of FileViewer.tsx `ReactComponentViewer`: renders a .jsx/.tsx artifact
// through the vendored `buildReactComponentSrcdoc` (React 18 + Babel from
// unpkg) inside the same sandbox as HTML previews.
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { baseName } from '../sources/file-kind';
import type { PreviewSource } from '../sources/types';
import type { ProjectFile } from '../types';
import { Icon } from '../vendor/open-design/components/Icon';
import { RemixIcon } from '../vendor/open-design/components/RemixIcon';
import { exportReactComponentAsHtml } from '../vendor/open-design/runtime/exports';
import { buildReactComponentSrcdoc } from '../vendor/open-design/runtime/react-component';
import { HTML_PREVIEW_SANDBOX } from './HtmlViewer';
import { CodeWithLines } from './SimpleViewers';

export function ReactComponentViewer({
  source,
  file,
  filesRefreshKey,
}: {
  source: PreviewSource;
  file: ProjectFile;
  filesRefreshKey: number;
}) {
  const t = useT();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const title = baseName(file.name).replace(/\.[^.]+$/, '');

  useEffect(() => {
    let cancelled = false;
    void source.readText(file.name, { fresh: true }).then((next) => {
      if (!cancelled) setText(next ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [source, file.name, file.mtime, filesRefreshKey, reloadKey]);

  const srcDoc = useMemo(
    () => (text === null ? '' : buildReactComponentSrcdoc(text, { title }).replace(/(<html\b)/i, `$1 data-od-reload-key="${reloadKey}"`)),
    [text, title, reloadKey],
  );

  return (
    <div className="viewer html-viewer react-component-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <button
            type="button"
            className="icon-only od-tooltip"
            onClick={() => setReloadKey((n) => n + 1)}
            title={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip-placement="bottom"
            aria-label={`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`}
          >
            <Icon name="reload" size={14} />
          </button>
          <div className="viewer-tabs viewer-mode-tabs" role="tablist" aria-label="View mode">
            {(
              [
                ['preview', t('fileViewer.preview'), 'eye-line'],
                ['source', t('fileViewer.source'), 'code-s-slash-line'],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={`viewer-tab ${mode === id ? 'active' : ''}`}
                aria-selected={mode === id}
                onClick={() => setMode(id)}
              >
                <RemixIcon name={icon} size={14} className="viewer-tab-icon" />
                <span className="viewer-tab-label">{label}</span>
              </button>
            ))}
          </div>
          <span className="viewer-meta">{t('app.reactNote')}</span>
        </div>
        <div className="viewer-toolbar-actions">
          <button
            type="button"
            className="viewer-action od-tooltip"
            data-tooltip={t('fileViewer.exportHtml')}
            data-tooltip-placement="bottom"
            disabled={text === null}
            onClick={() => text !== null && exportReactComponentAsHtml(text, title)}
          >
            <RemixIcon name="file-code-line" size={14} />
            <span>{t('fileViewer.exportHtml')}</span>
          </button>
        </div>
      </div>
      <div className="viewer-body">
        {text === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : mode === 'preview' ? (
          <div className="comment-preview-layer preview-viewport preview-viewport-desktop">
            <div className="comment-preview-canvas">
              <div className="comment-frame-clip">
                <div style={{ width: '100%', height: '100%' }}>
                  <div className="artifact-preview-transport-stack">
                    <iframe title={file.name} sandbox={HTML_PREVIEW_SANDBOX} srcDoc={srcDoc} data-od-active="true" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <CodeWithLines text={text} />
        )}
      </div>
    </div>
  );
}
