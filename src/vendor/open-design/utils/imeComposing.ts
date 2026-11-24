// Vendored verbatim from nexu-io/open-design@5fdcc3db1e31
// upstream: apps/web/src/utils/imeComposing.ts (Apache-2.0). Do not edit by hand; run `npm run sync:upstream`.
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * True while an IME composition is active.
 *
 * We trust the composing ref (driven by onCompositionStart/End) over
 * nativeEvent.isComposing because on some browser/IME combinations
 * (e.g. Chrome/macOS Pinyin), the Enter keydown that confirms a candidate
 * can still carry isComposing=true even after compositionEnd has fired.
 *
 * Relying on the stale nativeEvent.isComposing causes the Enter key to
 * insert a newline instead of sending the message.
 */
export function isImeComposing(
  event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  composing: boolean,
): boolean {
  // Trust the composition ref first
  return composing;
}
