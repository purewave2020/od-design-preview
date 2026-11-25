// Framework-free parts of upstream DeckThumbnailRail.tsx / DeckSlideThumbnail.tsx
// (nexu-io/open-design, Apache-2.0): the mounted-thumbnail LRU and the
// per-deck shadow-root stylesheet / font helpers. The Vue components
// DeckThumbnailRail.vue / DeckSlideThumbnail.vue use them.
import { DECK_CHROME_HIDE_CSS, DECK_MOTION_FREEZE_CSS } from '../runtime/srcdoc';
import type { ParsedDeckThumbnails } from '../runtime/deck-thumbnail-parser';

/**
 * Upper bound on concurrently mounted thumbnail iframes. Currently-visible
 * thumbnails and the active slide are never evicted, so the effective cap is
 * `max(cap, visible + active)`; the constant only bounds the keep-alive tail
 * for very long decks.
 */
export const MOUNTED_THUMBNAIL_CAP = 16;

export interface DeckThumbnailViewport {
  width: number;
  height: number;
}

/**
 * Pure LRU step for the set of thumbnail indices that keep a live iframe.
 *
 * `prevOrder` is the previous mounted list in least→most recently relevant
 * order. Every currently `visible` index plus `activeIndex` moves to the
 * most-recent end; anything beyond `cap` falls off the least-recent end
 * unless it is visible or active right now. Indices outside `[0, count)` are
 * dropped (deck shrank). Returns `prevOrder` itself when nothing changed so
 * callers can bail out of state updates by identity.
 */
export function nextMountedThumbnails(
  prevOrder: readonly number[],
  visible: ReadonlySet<number>,
  activeIndex: number,
  count: number,
  cap: number = MOUNTED_THUMBNAIL_CAP,
): readonly number[] {
  const pinned = new Set<number>();
  for (const index of visible) {
    if (index >= 0 && index < count) pinned.add(index);
  }
  if (activeIndex >= 0 && activeIndex < count) pinned.add(activeIndex);

  const stale = prevOrder.filter((index) => index >= 0 && index < count && !pinned.has(index));
  const next = [...stale, ...[...pinned].sort((a, b) => a - b)];
  const evictable = Math.max(0, next.length - Math.max(cap, pinned.size));
  const bounded = evictable > 0 ? next.slice(evictable) : next;

  if (bounded.length === prevOrder.length && bounded.every((index, i) => index === prevOrder[i])) {
    return prevOrder;
  }
  return bounded;
}

// Thumbnail-only overrides layered on top of the deck's own CSS:
// - `[data-od-thumb-wrap]`: make every reconstructed wrapper fill the canvas and
//   drop the runtime transform / drop-shadow the deck's own JS would set.
// - `[data-od-thumb-slide]`: pin the single slide to the full canvas and force
//   it visible regardless of the deck's active-slide toggle.
// - `.overlay/.tapzones`: template decks (`deck-stage.js`) name their nav this
//   way — belt-and-suspenders on top of DECK_CHROME_HIDE_CSS.
const THUMB_OVERRIDE_CSS = `[data-od-thumb-wrap]{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;transform:none!important;box-shadow:none!important;visibility:visible!important;opacity:1!important;}
[data-od-thumb-slide]{position:absolute!important;inset:0!important;margin:0!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;}
.overlay,.tapzones{display:none!important;visibility:hidden!important;pointer-events:none!important;}`;

interface DeckCssEntry {
  css: string;
  sheet: CSSStyleSheet | null;
}

// One processed-CSS string + one constructable stylesheet per deck source
// (keyed by the parsed object's identity). Shared by every thumbnail of that deck.
const deckCssCache = new WeakMap<ParsedDeckThumbnails, DeckCssEntry>();
// Decks whose fonts have already been injected into the host document head.
const injectedDeckFonts = new WeakSet<ParsedDeckThumbnails>();

export function getDeckCss(parsed: ParsedDeckThumbnails): DeckCssEntry {
  let entry = deckCssCache.get(parsed);
  if (!entry) {
    const css = `${parsed.styleText}\n${THUMB_OVERRIDE_CSS}\n${DECK_CHROME_HIDE_CSS}\n${DECK_MOTION_FREEZE_CSS}`;
    let sheet: CSSStyleSheet | null = null;
    try {
      if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
      }
    } catch {
      sheet = null;
    }
    entry = { css, sheet };
    deckCssCache.set(parsed, entry);
  }
  return entry;
}

// `@font-face` is ignored inside a shadow root and external font stylesheets
// are document-scoped, so both must live in the host document. Injected once
// per deck; if the host CSP blocks a font link the browser silently uses the
// deck's fallback stack (thumbnails stay legible).
export function ensureDeckFonts(parsed: ParsedDeckThumbnails): void {
  if (typeof document === 'undefined') return;
  if (injectedDeckFonts.has(parsed)) return;
  injectedDeckFonts.add(parsed);
  const head = document.head;
  if (!head) return;
  if (parsed.fontFaces.trim()) {
    const style = document.createElement('style');
    style.setAttribute('data-od-deck-fonts', '');
    style.textContent = parsed.fontFaces;
    head.appendChild(style);
  }
  for (const href of parsed.fontLinks) {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(href) : href;
    const selector = `link[data-od-deck-font][href="${escaped}"]`;
    if (head.querySelector(selector)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-od-deck-font', '');
    head.appendChild(link);
  }
}
