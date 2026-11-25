// Hand-written adapter (not vendored). Stands in for apps/web/src/types.ts,
// which re-exports the whole contracts package. Only the types the vendored
// review / edit / sketch surfaces import are provided here.
import type {
  PreviewAnnotationStyle,
  PreviewCommentAttachment,
  PreviewCommentMember,
  PreviewCommentPosition,
  PreviewCommentSelectionKind,
  PreviewVisualMarkKind,
} from '../contracts/api/comments';

export type {
  PreviewAnnotationStyle,
  PreviewComment,
  PreviewCommentAnchorState,
  PreviewCommentAttachment,
  PreviewCommentMember,
  PreviewCommentPosition,
  PreviewCommentSelectionKind,
  PreviewCommentStatus,
  PreviewCommentTarget,
  PreviewCommentUpsertRequest,
  PreviewVisualMarkKind,
} from '../contracts/api/comments';
export type { ProjectFile, ProjectFileKind } from '../../../types';

// packages/contracts/src/api/chat.ts — the slice comments.ts uses to render
// comments as agent context ("Copy for agent" in the comments panel).
export type ChatCommentSelectionKind = PreviewCommentSelectionKind | 'visual';

export interface ChatCommentAttachment {
  id: string;
  order: number;
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  comment: string;
  currentText: string;
  pagePosition: PreviewCommentPosition;
  htmlHint: string;
  style?: PreviewAnnotationStyle;
  selectionKind?: ChatCommentSelectionKind;
  memberCount?: number;
  podMembers?: PreviewCommentMember[];
  slideIndex?: number;
  screenshotPath?: string;
  markKind?: PreviewVisualMarkKind;
  intent?: string;
  imageAttachments?: PreviewCommentAttachment[];
  commentContext?: 'context' | 'query';
  source?: 'saved-comment' | 'board-batch';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  commentAttachments?: ChatCommentAttachment[];
}
