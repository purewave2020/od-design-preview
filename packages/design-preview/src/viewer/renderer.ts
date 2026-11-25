// Mirrors apps/web/src/artifacts/renderer-registry.ts + manifest.ts
// (`inferLegacyManifest`): which viewer a project file opens in.
import type { ProjectFile } from '../types';

export type RendererId = 'react-component' | 'deck-html' | 'html' | 'markdown' | 'svg';

function ext(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

function inferManifest(file: ProjectFile): { kind: string; renderer: string } | null {
  if (file.artifactManifest?.kind || file.artifactManifest?.renderer) {
    return { kind: file.artifactManifest.kind ?? '', renderer: file.artifactManifest.renderer ?? '' };
  }
  const e = ext(file.name);
  const lower = file.name.toLowerCase();
  if (e === '.html' || e === '.htm') {
    const isDeck = lower.includes('deck') || lower.includes('slides') || lower.includes('pitch');
    return isDeck ? { kind: 'deck', renderer: 'deck-html' } : { kind: 'html', renderer: 'html' };
  }
  if (e === '.svg') return { kind: 'svg', renderer: 'svg' };
  if (e === '.md' || e === '.markdown') return { kind: 'markdown-document', renderer: 'markdown' };
  if (e === '.jsx' || e === '.tsx') return { kind: 'react-component', renderer: 'react-component' };
  return null;
}

export function resolveRenderer(file: ProjectFile, isDeckHint = false): RendererId | null {
  const manifest = inferManifest(file);
  if (!manifest) return null;
  if (manifest.kind === 'react-component' || manifest.renderer === 'react-component') return 'react-component';
  if (manifest.kind === 'deck' || manifest.renderer === 'deck-html') return 'deck-html';
  if (file.kind === 'html' && isDeckHint) return 'deck-html';
  if (manifest.renderer === 'html' || manifest.kind === 'html' || file.kind === 'html') return 'html';
  if (manifest.renderer === 'markdown' || manifest.kind === 'markdown-document') return 'markdown';
  if (manifest.renderer === 'svg' || manifest.kind === 'svg') return 'svg';
  return null;
}
