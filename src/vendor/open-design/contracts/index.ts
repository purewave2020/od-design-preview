// Hand-written adapter (not vendored). Stands in for the `@open-design/contracts`
// package entry so the vendored files resolve without the monorepo.
// Only the symbols the vendored code actually imports are re-exported.

export { ANNOTATED_SELECTOR_HELPERS } from './runtime/annotated-selector';
export { COMMENT_IDENTITY_HELPERS } from './runtime/comment-identity-helpers';
export {
  COMMENT_ID_ATTRIBUTE,
  COMMENT_ID_PREFIX,
  commentElementId,
  commentIdentitySelector,
  commentUuidFromElementId,
  isCommentUuid,
  uniqueCommentIdentity,
} from './runtime/comment-identity';
export { commentSelectorClaimsIdentity } from './runtime/comment-identity-selector';
export { resolveCommentTargetTitle } from './comment-target-title';
export type { CommentTargetKind, CommentTargetTitle, CommentTargetTitleInput } from './comment-target-title';
export * from './api/comments';

/**
 * Team-workspace identity. The standalone preview never has one; the type is
 * kept so vendored signatures (export helpers) type-check unchanged.
 */
export interface WorkspaceCollabContext {
  workspaceId: string;
  workspaceType: string;
  workspaceMemberId: string;
}

/** packages/contracts/src/api/context.ts — tabs listed by the "+" launcher. */
export type WorkspaceContextKind =
  | 'design-files'
  | 'design-system'
  | 'project'
  | 'local-code'
  | 'file'
  | 'folder'
  | 'browser'
  | 'terminal'
  | 'side-chat'
  | 'live-artifact';

export interface WorkspaceContextItem {
  id: string;
  kind: WorkspaceContextKind;
  label: string;
  tabId?: string;
  path?: string;
  absolutePath?: string;
  url?: string;
  title?: string;
}
