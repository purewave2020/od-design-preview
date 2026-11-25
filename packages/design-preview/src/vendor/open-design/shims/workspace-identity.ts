// Hand-written adapter (not vendored). The standalone preview has no team
// workspaces, so resource URLs are used as-is and no identity headers are sent.
import type { WorkspaceCollabContext } from '../contracts/index';

export function workspaceProjectHeaders(_context: WorkspaceCollabContext): HeadersInit {
  return {};
}

export function workspaceResourceUrl(
  path: string,
  _context: WorkspaceCollabContext | null | undefined,
): string {
  return path;
}

export function workspaceIdentityCacheKey(_context: WorkspaceCollabContext | null | undefined): string {
  return 'personal';
}
