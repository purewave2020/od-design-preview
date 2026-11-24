// Vendored verbatim from nexu-io/open-design@5fdcc3db1e31
// upstream: packages/contracts/src/runtime/comment-identity-helpers.ts (Apache-2.0). Do not edit by hand; run `npm run sync:upstream`.
import { commentSelectorClaimsIdentity } from './comment-identity-selector';

/** Comment-only helpers; serialized as a complete closure into both preview bridges.
 * Inspect/tool annotations are deliberately independent. Count the whole document,
 * including hidden nodes, before exposing any persisted identity.
 *
 * The bridges call `commentSelectorClaimsIdentity(...)` by name, but a production
 * minifier renames the function, so `toString()` alone would declare a different
 * name. Bind the serialized function to the name the bridges use.
 */
export const COMMENT_IDENTITY_HELPERS = String.raw`
  var commentSelectorClaimsIdentity = ${commentSelectorClaimsIdentity.toString()};
  function commentUuid(value){ return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
  function commentSelector(uuid){ return '[data-od-comment-id="' + uuid + '"]'; }
  function uniqueCommentNode(uuid){
    if (!commentUuid(uuid)) return null;
    var nodes = document.querySelectorAll(commentSelector(uuid));
    return nodes.length === 1 ? nodes[0] : null;
  }
  function ownCommentIdentity(el){
    if (!el || !el.hasAttribute || !el.hasAttribute('data-od-comment-id')) return null;
    var uuid = el.getAttribute('data-od-comment-id');
    return uniqueCommentNode(uuid) === el ? { elementId: 'cmt:' + uuid, selector: commentSelector(uuid) } : null;
  }
  function strictCommentNode(elementId, selector){
    if (typeof elementId !== 'string' || elementId.indexOf('cmt:') !== 0) return null;
    var uuid = elementId.slice(4);
    if (!commentUuid(uuid) || selector !== commentSelector(uuid)) return null;
    return uniqueCommentNode(uuid);
  }
`;
