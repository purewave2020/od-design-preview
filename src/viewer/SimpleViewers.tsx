// Non-HTML viewers. Ports of FileViewer.tsx ImageViewer / VideoViewer /
// AudioViewer / SvgViewer / TextViewer / BinaryViewer / DocumentPreviewViewer
// with the daemon-specific fetches replaced by the PreviewSource contract.
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { copyText } from '../lib/hooks';
import { baseName, humanSize } from '../sources/file-kind';
import type { PreviewSource } from '../sources/types';
import type { ProjectFile } from '../types';
import { Icon } from '../vendor/open-design/components/Icon';

interface ViewerProps {
  source: PreviewSource;
  file: ProjectFile;
  filesRefreshKey: number;
}

export function FileActions({ source, file }: { source: PreviewSource; file: ProjectFile }) {
  const t = useT();
  const url = source.fileUrl(file.name, file.mtime);
  return (
    <div className="viewer-toolbar-actions">
      <a className="ghost-link" href={url} download={baseName(file.name)}>
        {t('fileViewer.download')}
      </a>
      <a className="ghost-link" href={url} target="_blank" rel="noreferrer noopener">
        {t('fileViewer.open')}
      </a>
    </div>
  );
}

function useFileText(source: PreviewSource, file: ProjectFile, refreshKey: number, enabled = true) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError(false);
    void source.readText(file.name, { fresh: true }).then((next) => {
      if (cancelled) return;
      if (next === null) setError(true);
      setText(next ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [source, file.name, file.mtime, refreshKey, enabled]);
  return { text, error };
}

export function ImageViewer({ source, file }: ViewerProps) {
  const t = useT();
  return (
    <div className="viewer image-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {file.kind === 'sketch'
              ? t('fileViewer.sketchMeta', { size: humanSize(file.size) })
              : t('fileViewer.imageMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions source={source} file={file} />
      </div>
      <div className="viewer-body image-body">
        <img alt={file.name} src={source.fileUrl(file.name, file.mtime)} />
      </div>
    </div>
  );
}

export function VideoViewer({ source, file }: ViewerProps) {
  const t = useT();
  return (
    <div className="viewer video-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">{t('fileViewer.videoMeta', { size: humanSize(file.size) })}</span>
        </div>
        <FileActions source={source} file={file} />
      </div>
      <div className="viewer-body video-body">
        <video src={source.fileUrl(file.name, file.mtime)} controls playsInline preload="metadata" />
      </div>
    </div>
  );
}

export function AudioViewer({ source, file }: ViewerProps) {
  const t = useT();
  return (
    <div className="viewer audio-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">{t('fileViewer.audioMeta', { size: humanSize(file.size) })}</span>
        </div>
        <FileActions source={source} file={file} />
      </div>
      <div className="viewer-body audio-body">
        <div className="audio-card">
          <Icon name="mic" size={28} />
          <div className="audio-card-name">{file.name}</div>
          <audio src={source.fileUrl(file.name, file.mtime)} controls preload="metadata" />
        </div>
      </div>
    </div>
  );
}

export function SvgViewer({ source, file, filesRefreshKey }: ViewerProps) {
  const t = useT();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [reloadKey, setReloadKey] = useState(0);
  const { text, error } = useFileText(source, file, filesRefreshKey + reloadKey, mode === 'source');
  const url = source.fileUrl(file.name, file.mtime);
  return (
    <div className="viewer svg-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">{t('fileViewer.imageMeta', { size: humanSize(file.size) })}</span>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            <button
              type="button"
              className={`viewer-tab ${mode === 'preview' ? 'active' : ''}`}
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              {t('fileViewer.preview')}
            </button>
            <button
              type="button"
              className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
            >
              {t('fileViewer.source')}
            </button>
          </div>
          <span className="viewer-divider" aria-hidden />
          <button
            type="button"
            className="viewer-action od-tooltip"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
            data-tooltip={t('fileViewer.reloadDisk')}
            data-tooltip-placement="bottom"
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </button>
          <a className="ghost-link" href={url} download={baseName(file.name)}>
            {t('fileViewer.download')}
          </a>
          <a className="ghost-link" href={url} target="_blank" rel="noreferrer noopener">
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className={`viewer-body ${mode === 'preview' ? 'image-body' : ''}`}>
        {mode === 'preview' ? (
          <img alt={file.name} src={reloadKey ? `${url}${url.includes('?') ? '&' : '?'}r=${reloadKey}` : url} />
        ) : text === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : error ? (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        ) : (
          <pre className="viewer-source">{text}</pre>
        )}
      </div>
    </div>
  );
}

function isJsonFile(file: ProjectFile): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.mime.toLowerCase().startsWith('application/json');
}

function formatForDisplay(file: ProjectFile, text: string): string {
  if (!isJsonFile(file)) return text;
  try {
    const parsed = JSON.parse(text) as unknown;
    // Keep the original bytes when re-serialising could change a number.
    const roundTrip = JSON.stringify(parsed);
    if (/\d{16,}|\d\.\d{15,}/.test(text) && roundTrip.length !== text.replace(/\s+/g, '').length) return text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

/** Port of FileViewer.tsx `CodeWithLines`. */
export function CodeWithLines({ text }: { text: string }) {
  const lines = text.split('\n');
  const gutter = lines.map((_, i) => `${i + 1}`).join('\n');
  return (
    <pre className="code-viewer">
      <code className="gutter" aria-hidden>
        {gutter}
      </code>
      <code className="lines">{text}</code>
    </pre>
  );
}

export function TextViewer({ source, file, filesRefreshKey }: ViewerProps) {
  const t = useT();
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const { text } = useFileText(source, file, filesRefreshKey + reloadKey);
  const displayText = useMemo(() => (text == null ? null : formatForDisplay(file, text)), [file, text]);
  const lineCount = displayText ? displayText.split('\n').length : 0;
  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left" />
        <div className="viewer-toolbar-actions">
          <button
            type="button"
            className="viewer-action od-tooltip"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
            data-tooltip={t('fileViewer.reloadDisk')}
            data-tooltip-placement="bottom"
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </button>
          <button
            type="button"
            className="viewer-action od-tooltip"
            onClick={() => {
              if (text == null) return;
              void copyText(text).then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
            title={t('fileViewer.copyTitle')}
            data-tooltip={t('fileViewer.copyTitle')}
            data-tooltip-placement="bottom"
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </button>
        </div>
      </div>
      <div className="viewer-body">
        {text === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : displayText !== null && lineCount > 0 ? (
          <CodeWithLines text={displayText} />
        ) : (
          <pre className="viewer-source">{displayText}</pre>
        )}
      </div>
    </div>
  );
}

export function BinaryViewer({ source, file }: ViewerProps) {
  const t = useT();
  return (
    <div className="viewer binary-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">{t('fileViewer.binaryMeta', { size: humanSize(file.size) })}</span>
        </div>
        <FileActions source={source} file={file} />
      </div>
      <div className="viewer-body">
        <div className="viewer-empty">{t('fileViewer.binaryNote', { size: file.size })}</div>
      </div>
    </div>
  );
}

/** PDFs render natively in an <object>; Office files fall back to download. */
export function DocumentViewer({ source, file }: ViewerProps) {
  const t = useT();
  const metaKey =
    file.kind === 'pdf'
      ? 'fileViewer.pdfMeta'
      : file.kind === 'presentation'
        ? 'fileViewer.presentationMeta'
        : file.kind === 'spreadsheet'
          ? 'fileViewer.spreadsheetMeta'
          : 'fileViewer.documentMeta';
  return (
    <div className="viewer document-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t(metaKey)} · {humanSize(file.size)}
          </span>
        </div>
        <FileActions source={source} file={file} />
      </div>
      <div className="viewer-body">
        {file.kind === 'pdf' ? (
          <object className="odp-pdf-object" data={source.fileUrl(file.name, file.mtime)} type="application/pdf" aria-label={file.name}>
            <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
          </object>
        ) : (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        )}
      </div>
    </div>
  );
}
