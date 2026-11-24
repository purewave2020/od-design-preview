// Mirrors packages/contracts/src/api/files.ts (ProjectFile / ProjectFileKind)
// so files coming straight from an Open Design daemon need no mapping.

export type ProjectFileKind =
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'sketch'
  | 'text'
  | 'code'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'binary';

export interface ArtifactManifestLike {
  kind?: string;
  renderer?: string;
  title?: string;
}

export interface ProjectFile {
  /** Project-relative path, `/`-separated. */
  name: string;
  size: number;
  /** Last-modified time, ms since epoch. */
  mtime: number;
  kind: ProjectFileKind;
  mime: string;
  artifactManifest?: ArtifactManifestLike;
}

export type PreviewViewportId = 'desktop' | 'tablet' | 'mobile';
