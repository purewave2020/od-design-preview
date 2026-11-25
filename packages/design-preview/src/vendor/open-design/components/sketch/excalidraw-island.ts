// React island for Excalidraw. Excalidraw only ships as a React component, so
// the Vue SketchEditor.vue mounts this one small React tree into its canvas
// wrapper and re-renders it with plain props; everything around it (state,
// autosave, toasts, DOM enhancements) is Vue. The tree is the same one
// upstream apps/web/src/components/SketchEditor.tsx renders: <Excalidraw> with
// the save-state badge (renderTopRightUI) and the custom main menu.
import { createElement as h, Fragment, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Excalidraw, MainMenu } from '@excalidraw/excalidraw';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { ICON_GLYPHS, REMIX_ICON, type IconName, type IconNode } from '../Icon';
import { REMIX_ICON_PATHS } from '../remix-icon-paths';
import { validateSketchEmbeddableUrl } from './editor-helpers';

/** Icon data stores DOM attribute names; React wants its camelCase props. */
function reactAttrs(attrs: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') out.className = value;
    else if (name.startsWith('aria-') || name.startsWith('data-') || !name.includes('-')) out[name] = value;
    else out[name.replace(/[-:]([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

/** React rendering of the shared icon set (same markup as Icon.vue). */
export function reactIcon(name: IconName, size: number, className?: string): ReactElement | null {
  const remix = REMIX_ICON[name];
  const remixPath = remix ? REMIX_ICON_PATHS[remix] : undefined;
  const classes = (extra?: string) => ['od-icon', extra, className].filter(Boolean).join(' ');
  if (remixPath) {
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'currentColor',
        'aria-hidden': true,
        focusable: 'false',
        className: classes(name === 'spinner' ? 'icon-spin' : undefined),
      },
      h('path', { d: remixPath }),
    );
  }
  const glyph = ICON_GLYPHS[name];
  if (!glyph) return null;
  const common = glyph.common
    ? {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: 'false',
      }
    : {};
  const nodes = (list: IconNode[]): ReactNode[] =>
    list.map(([tag, attrs, children], index) => h(tag, { key: index, ...reactAttrs(attrs) }, children ? nodes(children) : undefined));
  return h('svg', { ...common, ...reactAttrs(glyph.svg), className: classes(glyph.className) }, ...nodes(glyph.children));
}

export interface ExcalidrawIslandLabels {
  saving: string;
  dirty: string;
  saved: string;
  save: string;
  exporting: string;
  exportImage: string;
  clear: string;
}

export interface ExcalidrawIslandProps {
  /** Changing it remounts Excalidraw (new file / after Clear). */
  editorKey: string;
  initialData: ExcalidrawInitialDataState;
  langCode: string;
  theme: 'light' | 'dark';
  fileName: string;
  saving: boolean;
  dirty: boolean;
  showSaved: boolean;
  exporting: boolean;
  canSave: boolean;
  canClear: boolean;
  canExport: boolean;
  hasExport: boolean;
  labels: ExcalidrawIslandLabels;
  onApi: (api: ExcalidrawImperativeAPI) => void;
  onChange: (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => void;
  onSave: () => void;
  onExportImage: () => void;
  onClear: () => void;
}

const UI_OPTIONS: ExcalidrawProps['UIOptions'] = {
  canvasActions: {
    saveToActiveFile: false,
    loadScene: false,
    toggleTheme: false,
    saveAsImage: false,
    export: false,
  },
  tools: {
    image: true,
  },
};

function topRightUI(props: ExcalidrawIslandProps): ReactElement {
  const { saving, dirty, labels } = props;
  const state = saving ? 'saving' : dirty ? 'dirty' : 'saved';
  const label = saving ? labels.saving : dirty ? labels.dirty : labels.saved;
  return h(
    'div',
    { className: 'sketch-excalidraw-actions', 'data-testid': 'sketch-save-state' },
    h(
      'span',
      { className: `sketch-save-state is-${state}`, role: 'status', 'aria-live': 'polite' },
      reactIcon(saving ? 'spinner' : dirty ? 'alert-triangle' : 'check', 12, saving ? 'icon-spin' : undefined),
      h('span', null, label),
    ),
  );
}

function mainMenu(props: ExcalidrawIslandProps): ReactElement {
  const { labels, saving, showSaved, exporting } = props;
  const saveLabel = saving ? labels.saving : showSaved ? labels.saved : labels.save;
  const exportLabel = exporting ? labels.exporting : labels.exportImage;
  const Item = MainMenu.Item as unknown as (p: Record<string, unknown>) => ReactElement;
  return h(
    MainMenu,
    null,
    h(
      Item,
      {
        'data-testid': 'sketch-menu-save',
        icon: showSaved ? reactIcon('check', 16) : undefined,
        onClick: () => props.onSave(),
        disabled: saving || !props.canSave,
        'aria-label': saveLabel,
      },
      saveLabel,
    ),
    props.hasExport
      ? h(
          Item,
          {
            'data-testid': 'sketch-menu-export-image',
            icon: reactIcon('download', 16),
            onClick: () => props.onExportImage(),
            disabled: exporting || !props.canExport,
            'aria-label': exportLabel,
          },
          exportLabel,
        )
      : null,
    h(MainMenu.Separator),
    h(MainMenu.DefaultItems.SearchMenu),
    h(MainMenu.DefaultItems.Help),
    h(
      Item,
      {
        'data-testid': 'sketch-menu-clear',
        icon: reactIcon('trash', 16),
        onClick: () => props.onClear(),
        disabled: !props.canClear,
      },
      labels.clear,
    ),
    h(MainMenu.Separator),
    h(MainMenu.DefaultItems.ChangeCanvasBackground),
  );
}

function view(props: ExcalidrawIslandProps): ReactElement {
  return h(
    Fragment,
    null,
    h(
      Excalidraw,
      {
        key: props.editorKey,
        initialData: props.initialData,
        excalidrawAPI: props.onApi,
        onChange: props.onChange,
        langCode: props.langCode,
        theme: props.theme,
        detectScroll: false,
        handleKeyboardGlobally: false,
        autoFocus: true,
        name: props.fileName,
        UIOptions: UI_OPTIONS,
        renderTopRightUI: () => topRightUI(props),
        validateEmbeddable: validateSketchEmbeddableUrl,
      },
      mainMenu(props),
    ),
  );
}

export interface ExcalidrawIsland {
  render(props: ExcalidrawIslandProps): void;
  unmount(): void;
}

/** Mount the Excalidraw React tree into `container` (owned by the Vue component). */
export function mountExcalidrawIsland(container: HTMLElement): ExcalidrawIsland {
  const root: Root = createRoot(container);
  return {
    render(props) {
      root.render(view(props));
    },
    unmount() {
      root.unmount();
    },
  };
}
