// Vendored verbatim from nexu-io/open-design@5fdcc3db1e31
// upstream: packages/contracts/src/runtime/annotated-selector.ts (Apache-2.0). Do not edit by hand; run `npm run sync:upstream`.
/** Annotation identity/selector contract shared by URL, srcDoc, and portable comment bridges.
 * Select the same nonempty attribute for both fields; an empty od-id must not mask a screen label.
 * Hosts supply their existing attribute escaping function. This module only emits script source.
 */
export const ANNOTATED_SELECTOR_HELPERS = String.raw`
  function annotatedElementIdFor(el){
    var odId = el.getAttribute('data-od-id');
    if (odId) return odId;
    var label = el.getAttribute('data-screen-label');
    return label || null;
  }
  function annotatedSelectorFor(el, esc){
    var odId = el.getAttribute('data-od-id');
    if (odId) return '[data-od-id="' + esc(odId) + '"]';
    var label = el.getAttribute('data-screen-label');
    if (label) return '[data-screen-label="' + esc(label) + '"]';
    return null;
  }
`;
