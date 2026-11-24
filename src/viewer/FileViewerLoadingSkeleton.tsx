import { useT } from '../i18n';

/** Port of FileViewer.tsx `FileViewerLoadingSkeleton`. */
export function FileViewerLoadingSkeleton() {
  const t = useT();
  return (
    <div className="viewer-loading" role="status" aria-busy="true" aria-label={t('fileViewer.loading')}>
      <div className="viewer-loading-stage" aria-hidden="true">
        <span className="viewer-loading-card viewer-loading-card-back viewer-loading-card-back-two" />
        <span className="viewer-loading-card viewer-loading-card-back viewer-loading-card-back-one" />
        <span className="viewer-loading-card viewer-loading-card-main">
          <span className="viewer-loading-kicker" />
          <span className="viewer-loading-title" />
          <span className="viewer-loading-title viewer-loading-title-short" />
          <span className="viewer-loading-rule" />
          <span className="viewer-loading-content">
            <span className="viewer-loading-copy">
              <span className="viewer-loading-line" />
              <span className="viewer-loading-line viewer-loading-line-medium" />
              <span className="viewer-loading-line viewer-loading-line-short" />
            </span>
            <span className="viewer-loading-chart">
              <span className="viewer-loading-bar viewer-loading-bar-one" />
              <span className="viewer-loading-bar viewer-loading-bar-two" />
              <span className="viewer-loading-bar viewer-loading-bar-three" />
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}
