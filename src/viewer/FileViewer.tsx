// Dispatcher — same routing as upstream FileViewer: renderer registry first
// (react-component → deck-html → html → markdown → svg), then file kind.
// Sketch documents (`*.sketch.json`) open in the sketch editor, as they do in
// upstream's FileWorkspace.
import { lazy, memo, Suspense } from 'react';
import type { PreviewSource } from '../sources/types';
import type { ProjectFile } from '../types';
import { isSketchJsonFileName } from '../vendor/open-design/components/sketch-model';
import { FileViewerLoadingSkeleton } from './FileViewerLoadingSkeleton';
import { HtmlViewer } from './HtmlViewer';
import { MarkdownViewer } from './MarkdownViewer';
import { ReactComponentViewer } from './ReactComponentViewer';
import { resolveRenderer } from './renderer';
import {
  AudioViewer,
  BinaryViewer,
  DocumentViewer,
  ImageViewer,
  SvgViewer,
  TextViewer,
  VideoViewer,
} from './SimpleViewers';

// Excalidraw is large; load the sketch editor only when a sketch opens.
const SketchFileViewer = lazy(() => import('../sketch/SketchFileViewer').then((m) => ({ default: m.SketchFileViewer })));

export interface FileViewerProps {
  source: PreviewSource;
  file: ProjectFile;
  filesRefreshKey: number;
  active: boolean;
  actionsHost: HTMLElement | null;
  /** Floating host for the comments panel (upstream comment-float-host). */
  commentHost?: HTMLElement | null;
  projectFiles: ProjectFile[];
  onOpenFile?: (name: string) => void;
  viewerOnly?: boolean;
  isDeckHint?: boolean;
}

export const FileViewer = memo(function FileViewer({
  source,
  file,
  filesRefreshKey,
  active,
  actionsHost,
  commentHost,
  projectFiles,
  onOpenFile,
  viewerOnly,
  isDeckHint,
}: FileViewerProps) {
  if (isSketchJsonFileName(file.name)) {
    return (
      <Suspense
        fallback={
          <div className="viewer">
            <div className="viewer-body">
              <FileViewerLoadingSkeleton />
            </div>
          </div>
        }
      >
        <SketchFileViewer source={source} file={file} active={active} viewerOnly={viewerOnly} onOpenFile={onOpenFile} />
      </Suspense>
    );
  }
  const renderer = resolveRenderer(file, isDeckHint);
  const common = { source, file, filesRefreshKey };
  if (renderer === 'html' || renderer === 'deck-html') {
    return (
      <HtmlViewer
        {...common}
        isDeckHint={renderer === 'deck-html'}
        active={active}
        actionsHost={actionsHost}
        commentHost={commentHost}
        viewerOnly={viewerOnly}
      />
    );
  }
  if (renderer === 'react-component') return <ReactComponentViewer {...common} />;
  if (renderer === 'markdown') {
    return <MarkdownViewer {...common} projectFiles={projectFiles} onOpenFile={onOpenFile} viewerOnly={viewerOnly} />;
  }
  if (renderer === 'svg') return <SvgViewer {...common} />;
  if (file.kind === 'image' || file.kind === 'sketch') {
    return /\.json$/i.test(file.name) ? <TextViewer {...common} /> : <ImageViewer {...common} />;
  }
  if (file.kind === 'video') return <VideoViewer {...common} />;
  if (file.kind === 'audio') return <AudioViewer {...common} />;
  if (file.kind === 'text' || file.kind === 'code') return <TextViewer {...common} />;
  if (file.kind === 'pdf' || file.kind === 'document' || file.kind === 'presentation' || file.kind === 'spreadsheet') {
    return <DocumentViewer {...common} />;
  }
  return <BinaryViewer {...common} />;
});
