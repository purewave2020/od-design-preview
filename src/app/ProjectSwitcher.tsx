import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useT } from '../i18n';
import { listDaemonProjects, type DaemonProjectSummary } from '../sources/daemon-source';
import type { PreviewSource } from '../sources/types';
import { AnchoredPopover } from '../ui/AnchoredPopover';
import { Icon } from '../vendor/open-design/components/Icon';
import { RemixIcon } from '../vendor/open-design/components/RemixIcon';

export type ThemePref = 'system' | 'light' | 'dark';

export interface ProjectSwitcherProps {
  source: PreviewSource;
  theme: ThemePref;
  onTheme: (theme: ThemePref) => void;
  onOpenDemo: () => void;
  onOpenFolderLive: (() => void) | null;
  onOpenFolderInput: () => void;
  onOpenFilesInput: () => void;
  onOpenDaemonProject: (origin: string, projectId: string, label: string) => void;
  onCopyLink: () => void;
  onDiscardLocalChanges?: () => void;
}

function sourceIcon(kind: PreviewSource['kind']): string {
  if (kind === 'daemon') return 'global-line';
  if (kind === 'local') return 'folder-line';
  return 'layout-grid-line';
}

export function ProjectSwitcher(props: ProjectSwitcherProps) {
  const { source } = props;
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const [daemonOpen, setDaemonOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="odp-project-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${source.label}${source.description ? `\n${source.description}` : ''}`}
        data-testid="project-switcher"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="odp-project-chip-mark" aria-hidden>
          <RemixIcon name={sourceIcon(source.kind)} size={14} />
        </span>
        <span className="odp-project-chip-label">{source.label}</span>
        {source.kind === 'local' && source.description?.includes('live') ? (
          <span className="odp-live-dot" title={t('app.liveBadge')} aria-label={t('app.liveBadge')} />
        ) : null}
        <RemixIcon name="arrow-down-s-line" size={14} />
      </button>
      <AnchoredPopover anchor={triggerRef} open={open} onClose={() => setOpen(false)} className="odp-menu" align="start">
        <div className="odp-menu-section-label">{t('app.switchProject')}</div>
        <button type="button" role="menuitem" className="odp-menu-item" onClick={run(props.onOpenDemo)}>
          <RemixIcon name="layout-grid-line" size={15} />
          <span className="odp-menu-copy">
            <span>{t('app.demoProject')}</span>
            <small>{t('app.demoProjectDesc')}</small>
          </span>
        </button>
        {props.onOpenFolderLive ? (
          <button type="button" role="menuitem" className="odp-menu-item" onClick={run(props.onOpenFolderLive)}>
            <RemixIcon name="folder-line" size={15} />
            <span className="odp-menu-copy">
              <span>{t('app.openFolderLive')}</span>
              <small>{t('app.openFolderDesc')}</small>
            </span>
          </button>
        ) : null}
        <button type="button" role="menuitem" className="odp-menu-item" onClick={run(props.onOpenFolderInput)}>
          <RemixIcon name="folder-2-line" size={15} />
          <span className="odp-menu-copy">
            <span>{t('app.openFolder')}</span>
            {props.onOpenFolderLive ? null : <small>{t('app.openFolderDesc')}</small>}
          </span>
        </button>
        <button type="button" role="menuitem" className="odp-menu-item" onClick={run(props.onOpenFilesInput)}>
          <RemixIcon name="file-line" size={15} />
          <span className="odp-menu-copy">
            <span>{t('app.openFiles')}</span>
          </span>
        </button>
        <button type="button" role="menuitem" className="odp-menu-item" onClick={run(() => setDaemonOpen(true))}>
          <RemixIcon name="global-line" size={15} />
          <span className="odp-menu-copy">
            <span>{t('app.connectDaemon')}</span>
            <small>{t('app.connectDaemonDesc')}</small>
          </span>
        </button>
        <div className="odp-menu-separator" role="separator" />
        <button type="button" role="menuitem" className="odp-menu-item" onClick={run(props.onCopyLink)}>
          <RemixIcon name="link" size={15} />
          <span className="odp-menu-copy">
            <span>{t('app.copyLink')}</span>
          </span>
        </button>
        {source.writeMode ? (
          <div className="odp-menu-note" data-testid="write-mode-note">
            <RemixIcon name="information-line" size={14} />
            <span>
              {t(
                source.writeMode === 'disk'
                  ? 'app.writeModeDisk'
                  : source.writeMode === 'daemon'
                    ? 'app.writeModeDaemon'
                    : source.writeMode === 'browser'
                      ? 'app.writeModeBrowser'
                      : 'app.writeModeMemory',
              )}
            </span>
          </div>
        ) : null}
        {props.onDiscardLocalChanges && source.hasLocalChanges?.() ? (
          <button type="button" role="menuitem" className="odp-menu-item" data-testid="discard-local-changes" onClick={run(props.onDiscardLocalChanges)}>
            <RemixIcon name="reset-left-line" size={15} />
            <span className="odp-menu-copy">
              <span>{t('app.discardLocalChanges')}</span>
            </span>
          </button>
        ) : null}
        <div className="odp-menu-separator" role="separator" />
        <div className="odp-menu-row">
          <span className="odp-menu-row-label">
            <RemixIcon name="translate-2" size={15} />
            {t('app.language')}
          </span>
          <div className="viewer-tabs odp-seg">
            {(['zh-CN', 'en'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`viewer-tab ${locale === value ? 'active' : ''}`}
                onClick={() => setLocale(value)}
              >
                {value === 'zh-CN' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
        </div>
        <div className="odp-menu-row">
          <span className="odp-menu-row-label">
            <RemixIcon name={props.theme === 'dark' ? 'moon-line' : 'sun-line'} size={15} />
            {t('app.theme')}
          </span>
          <div className="viewer-tabs odp-seg">
            {(['system', 'light', 'dark'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`viewer-tab ${props.theme === value ? 'active' : ''}`}
                onClick={() => props.onTheme(value)}
              >
                {t(value === 'system' ? 'app.themeSystem' : value === 'light' ? 'app.themeLight' : 'app.themeDark')}
              </button>
            ))}
          </div>
        </div>
      </AnchoredPopover>
      {daemonOpen ? (
        <DaemonDialog
          onClose={() => setDaemonOpen(false)}
          onOpen={(origin, id, label) => {
            setDaemonOpen(false);
            props.onOpenDaemonProject(origin, id, label);
          }}
        />
      ) : null}
    </>
  );
}

const DAEMON_ORIGIN_KEY = 'od-preview:daemon-origin';

function DaemonDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (origin: string, id: string, label: string) => void }) {
  const t = useT();
  const [origin, setOrigin] = useState(() => {
    try {
      return window.localStorage.getItem(DAEMON_ORIGIN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [projects, setProjects] = useState<DaemonProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      window.localStorage.setItem(DAEMON_ORIGIN_KEY, origin.trim());
    } catch {
      /* ignore */
    }
    try {
      setProjects(await listDaemonProjects(origin));
    } catch (err) {
      setProjects(null);
      setError(t('app.daemonError', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop odp-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal odp-modal" role="dialog" aria-modal="true" aria-labelledby="odp-daemon-title">
        <div className="modal-head">
          <div className="kicker">Open Design</div>
          <h2 id="odp-daemon-title">{t('app.daemonTitle')}</h2>
          <p className="subtitle">{t('app.connectDaemonDesc')}</p>
        </div>
        <form className="odp-form" onSubmit={(e) => void load(e)}>
          <label className="odp-field">
            <span>{t('app.daemonOrigin')}</span>
            <div className="odp-field-row">
              <input
                type="url"
                value={origin}
                placeholder="http://127.0.0.1:7456"
                onChange={(e) => setOrigin(e.target.value)}
                data-testid="daemon-origin"
              />
              <button type="submit" className="odp-btn" disabled={busy}>
                {busy ? <Icon name="spinner" size={13} /> : null}
                {t('app.daemonLoadProjects')}
              </button>
            </div>
            <small>{t('app.daemonOriginHint')}</small>
          </label>
          {error ? (
            <div className="odp-form-error" role="alert">
              {error}
            </div>
          ) : null}
          {projects ? (
            projects.length ? (
              <ul className="odp-project-list" role="listbox">
                {projects.map((project) => (
                  <li key={project.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => onOpen(origin, project.id, project.name)}>
                      <span className="odp-project-name">{project.name}</span>
                      <span className="odp-project-id">{project.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="odp-form-hint">{t('app.daemonNoProjects')}</div>
            )
          ) : null}
          <label className="odp-field">
            <span>{t('app.daemonProjectId')}</span>
            <div className="odp-field-row">
              <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="proj_…" />
              <button
                type="button"
                className="odp-btn odp-btn-primary"
                disabled={!projectId.trim()}
                onClick={() => onOpen(origin, projectId.trim(), projectId.trim())}
              >
                {t('app.daemonOpen')}
              </button>
            </div>
          </label>
        </form>
        <div className="modal-foot">
          <button type="button" className="odp-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
