// Sketch files (`*.sketch.json`) — the role FileWorkspace's sketch tab plays
// upstream: load the document, hand its Excalidraw scene to the vendored
// SketchEditor, autosave edits shortly after they stop (same 800 ms as
// upstream), save on demand, and write "Export image" PNGs next to the sketch.
// Read-only surfaces (embed) render the vendored SketchPreview instead.
import '@excalidraw/excalidraw/index.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { baseDirFor } from '../sources/file-kind';
import { canWrite, type PreviewSource } from '../sources/types';
import type { ProjectFile } from '../types';
import { SketchEditor } from '../vendor/open-design/components/SketchEditor';
import { SketchPreview } from '../vendor/open-design/components/SketchPreview';
import {
  parseSketchWorkspaceDocument,
  serializeExcalidrawSketchScene,
  type ExcalidrawSketchScene,
  type SketchItem,
} from '../vendor/open-design/components/sketch-model';

const SKETCH_AUTOSAVE_DELAY_MS = 800;

interface LoadedSketch {
  scene: ExcalidrawSketchScene;
  items: SketchItem[];
  rawItemCount: number;
}

function base64ToBlob(base64: string, type: string): Blob {
  const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const bytes = atob(clean);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type });
}

export function SketchFileViewer({
  source,
  file,
  active,
  viewerOnly = false,
  onOpenFile,
}: {
  source: PreviewSource;
  file: ProjectFile;
  active: boolean;
  viewerOnly?: boolean;
  onOpenFile?: (name: string) => void;
}) {
  const t = useT();
  const editable = canWrite(source) && !viewerOnly;
  const [loaded, setLoaded] = useState<LoadedSketch | null>(null);
  const [failed, setFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);
  const sceneRef = useRef<ExcalidrawSketchScene | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const lastWrittenRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // Load once per file; later disk changes only reload when nothing is pending
  // (and they are not the echo of our own save).
  useEffect(() => {
    let cancelled = false;
    void source.readText(file.name, { fresh: true }).then(
      (text) => {
        if (cancelled) return;
        if (text !== null && text === lastWrittenRef.current) return;
        if (dirtyRef.current || savingRef.current) return;
        const doc = parseSketchWorkspaceDocument(text);
        sceneRef.current = doc.scene;
        setLoaded({ scene: doc.scene, items: doc.items, rawItemCount: doc.rawItems.length });
        setFailed(false);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [source, file.name, file.mtime]);

  const save = useCallback(
    async (scene?: ExcalidrawSketchScene): Promise<boolean> => {
      const target = scene ?? sceneRef.current;
      if (!target || !source.writeFile) return false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (savingRef.current) await savingRef.current;
      const run = (async () => {
        setSaving(true);
        const text = serializeExcalidrawSketchScene(target, file.name);
        try {
          lastWrittenRef.current = text;
          await source.writeFile!(file.name, text);
          if (sceneRef.current === target) {
            dirtyRef.current = false;
            setDirty(false);
          }
          setSavedAt(Date.now());
          return true;
        } catch {
          return false;
        } finally {
          setSaving(false);
        }
      })();
      savingRef.current = run;
      try {
        return await run;
      } finally {
        if (savingRef.current === run) savingRef.current = null;
      }
    },
    [source, file.name],
  );

  // Flush a pending autosave when the tab is closed / the file switches.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        if (dirtyRef.current) void saveRef.current();
      }
    },
    [],
  );

  if (failed) {
    return (
      <div className="viewer">
        <div className="viewer-body">
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        </div>
      </div>
    );
  }

  if (!editable) {
    return (
      <div className="viewer image-viewer sketch-viewer">
        <div className="viewer-body image-body">
          <SketchPreview projectId={source.id} file={file} className="viewer-sketch-preview" />
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="viewer">
        <div className="viewer-body">
          <div className="viewer-empty">{t('workspace.loadingSketch')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer sketch-file-viewer" data-testid="sketch-file-viewer" style={active ? undefined : { visibility: 'hidden' }}>
      <SketchEditor
        fileName={file.name}
        scene={loaded.scene}
        legacyItems={loaded.items}
        hasPreservedRawItems={loaded.rawItemCount > loaded.items.length}
        onSceneChange={(scene, options) => {
          sceneRef.current = scene;
          // Keep the prop current (the editor is keyed by file, so this does not
          // re-mount it): its Save / Export image / Clear menu items read it.
          setLoaded((prev) => (prev ? { ...prev, scene, items: options?.discardLegacyItems ? [] : prev.items } : prev));
          if (options?.markDirty === false) return;
          dirtyRef.current = true;
          setDirty(true);
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            void save();
          }, SKETCH_AUTOSAVE_DELAY_MS);
        }}
        onClear={() => {
          const empty = { ...loaded.scene, elements: [], files: {} };
          sceneRef.current = empty;
          setLoaded({ scene: empty, items: [], rawItemCount: 0 });
          dirtyRef.current = true;
          setDirty(true);
          void save(empty);
        }}
        onSave={(scene) => save(scene)}
        onExportImage={async (base64, fileName) => {
          if (!source.writeFile) return false;
          const target = `${baseDirFor(file.name)}${fileName}`;
          try {
            const written = await source.writeFile(target, base64ToBlob(base64, 'image/png'));
            return { fileName: written.name };
          } catch {
            return false;
          }
        }}
        onOpenExportedImage={(name) => onOpenFile?.(name)}
        saving={saving}
        dirty={dirty}
        savedAt={savedAt}
      />
    </div>
  );
}
