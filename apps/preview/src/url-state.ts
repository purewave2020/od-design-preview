// URL contract (shareable / embeddable), unchanged from the React app:
//   ?source=demo                              bundled demo (default)
//   ?source=static&base=/path/&name=Label     any static folder with manifest.json
//   ?source=daemon&project=<id>[&daemon=<origin>][&name=Label]
//   &file=<project-relative path>             open that file
//   &embed=1                                  viewer only (no tab strip)
//   &lang=zh-CN|en  &theme=light|dark|system
import { DaemonSource, StaticSource, type PreviewSource } from '@od-design/preview';
import type { LocationQuery, LocationQueryRaw } from 'vue-router';

export const DEMO_BASE = `${import.meta.env.BASE_URL}demo-project/`;

export interface UrlState {
  source: PreviewSource;
  file: string | null;
  embed: boolean;
}

const one = (value: LocationQuery[string] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v !== '' ? v : null;
};

export function demoSource(label: string): PreviewSource {
  return new StaticSource(DEMO_BASE, label);
}

export function readUrlState(query: LocationQuery, demoLabel: string): UrlState {
  const kind = one(query.source);
  const file = one(query.file);
  const embed = one(query.embed) === '1';
  const project = one(query.project);
  if (kind === 'daemon' && project) {
    return { source: new DaemonSource(one(query.daemon) ?? '', project, one(query.name) ?? project), file, embed };
  }
  const base = one(query.base);
  if (kind === 'static' && base) {
    return { source: new StaticSource(base, one(query.name) ?? base), file, embed };
  }
  return { source: demoSource(demoLabel), file, embed };
}

/** Query for `source` + `file`, keeping the view parameters (lang / theme / embed). */
export function queryFor(current: LocationQuery, source: PreviewSource, file: string | null): LocationQueryRaw {
  const next: LocationQueryRaw = {};
  for (const key of ['lang', 'theme', 'embed']) if (current[key] != null) next[key] = current[key];
  if (source instanceof DaemonSource) {
    next.source = 'daemon';
    next.project = source.projectId;
    if (source.origin) next.daemon = source.origin;
    if (source.label !== source.projectId) next.name = source.label;
  } else if (
    source instanceof StaticSource &&
    !source.id.endsWith(DEMO_BASE) &&
    source.description !== new URL(DEMO_BASE, window.location.href).href
  ) {
    next.source = 'static';
    next.base = new URL(source.description).pathname;
    next.name = source.label;
  }
  if (file && source.kind !== 'local') next.file = file;
  return next;
}
