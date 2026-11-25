// Hand-written adapter (not vendored). Stands in for apps/web/src/providers/
// registry.ts (the daemon HTTP client). The vendored surfaces only need two
// things from it: design-token suggestion types (Edit inspector) and a text
// reader keyed by project id (sketch thumbnails). The "project id" here is a
// PreviewSource id; the workspace registers the active source.
import type { PreviewSource } from '../../../sources/types';

export type ProjectDesignTokenSuggestionProp =
  | 'color'
  | 'backgroundColor'
  | 'borderColor'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'width'
  | 'height'
  | 'gap'
  | 'padding'
  | 'margin'
  | 'borderRadius'
  | 'borderWidth';

export interface ProjectDesignTokenSuggestion {
  prop: ProjectDesignTokenSuggestionProp;
  token: string;
  value: string;
  sourceFile: string;
  line: number;
  matchReason: string;
  score: number;
}

const sources = new Map<string, PreviewSource>();

export function registerPreviewSource(source: PreviewSource): () => void {
  sources.set(source.id, source);
  return () => {
    if (sources.get(source.id) === source) sources.delete(source.id);
  };
}

export async function fetchProjectFileText(
  projectId: string,
  name: string,
  _options?: unknown,
): Promise<string | null> {
  const source = sources.get(projectId);
  if (!source) return null;
  return source.readText(name, { fresh: true });
}
