import { useId, useRef, useState } from 'react';
import type { TranslateFn } from '../i18n';
import { useDismiss } from '../lib/hooks';
import type { PreviewViewportId } from '../types';
import { Icon } from '../vendor/open-design/components/Icon';
import { RemixIcon } from '../vendor/open-design/components/RemixIcon';
import { PREVIEW_VIEWPORT_PRESETS, previewViewportIcon } from './preview-geometry';

/** Port of FileViewer.tsx `PreviewViewportControls` (Desktop / Tablet / Mobile). */
export function PreviewViewportControls({
  viewport,
  onViewport,
  t,
}: {
  viewport: PreviewViewportId;
  onViewport: (viewport: PreviewViewportId) => void;
  t: TranslateFn;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const activePreset = PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === viewport) ?? PREVIEW_VIEWPORT_PRESETS[0]!;
  useDismiss(open, menuRef, () => setOpen(false));

  return (
    <div className="viewer-viewport-switcher" ref={menuRef}>
      <button
        type="button"
        className={`viewer-action viewer-viewport-trigger${open ? '' : ' od-tooltip'}`}
        aria-label={t('fileViewer.viewportAria')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={t(activePreset.titleKey)}
        data-tooltip={open ? undefined : t(activePreset.titleKey)}
        data-tooltip-placement="bottom"
        data-testid="viewport-trigger"
        onClick={() => setOpen((value) => !value)}
      >
        <RemixIcon name={previewViewportIcon(activePreset.id)} size={14} className="viewer-viewport-icon" />
        <span>{t(activePreset.labelKey)}</span>
        <RemixIcon name="arrow-down-s-line" size={14} />
      </button>
      {open ? (
        <div className="viewer-viewport-menu" id={listboxId} role="listbox" aria-label={t('fileViewer.viewportAria')}>
          {PREVIEW_VIEWPORT_PRESETS.map((preset) => {
            const selected = viewport === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`viewer-viewport-menu-item${selected ? ' active' : ''}`}
                role="option"
                aria-selected={selected}
                title={t(preset.titleKey)}
                data-testid={`viewport-option-${preset.id}`}
                onClick={() => {
                  onViewport(preset.id);
                  setOpen(false);
                }}
              >
                <span className="viewer-viewport-menu-label">
                  <RemixIcon name={previewViewportIcon(preset.id)} size={14} />
                  <span>{t(preset.labelKey)}</span>
                </span>
                {selected ? <Icon name="check" size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
