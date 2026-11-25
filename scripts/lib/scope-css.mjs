#!/usr/bin/env node
// Scope a global stylesheet to `.odp-scope` so it can live inside a host app.
//
//   node scripts/lib/scope-css.mjs <in.css> <out.css>
//
// Upstream Open Design ships an app-wide stylesheet: design tokens on `:root`,
// typography on `body`, resets on `*` / `button` / `input`. Dropped into a host
// app (Ant Design Vue, …) those rules would restyle the whole host. This pass
// rewrites every rule so it only matches inside (or on) an element carrying
// `.odp-scope`, without changing any selector's specificity:
//
//   button { … }                → :where(.odp-scope) button, button:where(.odp-scope) { … }
//   :root { --bg: … }           → .odp-scope { --bg: … }           (tokens live on the scope root)
//   html, body { font: …; height: 100% }
//                               → :where(.odp-scope) { font: … }   (inheritable text props + vars only)
//   [data-theme='dark'] .x { … }
//                               → :where(.odp-scope)[data-theme='dark'] .x,
//                                 .x:where(.odp-scope)[data-theme='dark'] { … }
//   html:not([data-theme]) …    → dropped (the library always sets data-theme on its roots)
//   body::before, #root, desktop-shell (`workspace-shell--desktop`) rules → dropped
//
// Keyframes, @font-face and rules nested inside other rules are left alone.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

export const SCOPE_CLASS = 'odp-scope';
const WHERE = `:where(.${SCOPE_CLASS})`;

// Declarations kept when a document-level rule (html / body / :root) is mapped
// onto the scope root: custom properties and inheritable text styling.
const DOC_KEEP = /^(--|color$|color-scheme$|font-family$|font-size$|font-weight$|font-style$|line-height$|letter-spacing$|-webkit-font-smoothing$|-moz-osx-font-smoothing$|text-rendering$)/i;

const parseSelector = (text) => {
  let result = null;
  selectorParser((root) => {
    result = root.first;
  }).processSync(text);
  return result;
};

const isDocNode = (node) =>
  (node.type === 'tag' && /^(html|body)$/i.test(node.value)) || (node.type === 'pseudo' && node.value.toLowerCase() === ':root');

const isPseudoElement = (node) =>
  node.type === 'pseudo' && (node.value.startsWith('::') || /^:(before|after|first-line|first-letter)$/i.test(node.value));

const isThemeAttr = (node) => node.type === 'attribute' && node.attribute === 'data-theme';

/** Split a complex selector into [compound nodes[], combinator, compound nodes[], …]. */
function splitCompounds(selector) {
  const parts = [[]];
  for (const node of selector.nodes) {
    if (node.type === 'combinator') {
      parts.push(node);
      parts.push([]);
    } else if (node.type !== 'comment') {
      parts[parts.length - 1].push(node);
    }
  }
  return parts;
}

const compoundText = (nodes) => nodes.map((n) => n.toString().trim()).join('');
const combinatorText = (node) => {
  const value = node.value.trim();
  return value ? ` ${value} ` : ' ';
};

/** Insert `extra` into a compound before its pseudo-element (if any). */
function withScope(nodes, extra = WHERE) {
  const index = nodes.findIndex(isPseudoElement);
  const before = index === -1 ? nodes : nodes.slice(0, index);
  const after = index === -1 ? [] : nodes.slice(index);
  // A compound needs a leading type / universal selector before `:where(...)`
  // only when it is empty; otherwise appending is fine.
  return `${compoundText(before)}${extra}${compoundText(after)}`;
}

function restText(parts, from) {
  let out = '';
  for (let i = from; i < parts.length; i += 1) {
    const part = parts[i];
    out += Array.isArray(part) ? compoundText(part) : combinatorText(part);
  }
  return out;
}

/**
 * @returns {Array<{ selector: string, doc: boolean }>} scoped selectors (empty = drop)
 */
export function scopeSelector(text) {
  if (/workspace-shell--desktop/.test(text)) return [];
  const selector = parseSelector(text);
  if (!selector) return [];
  const parts = splitCompounds(selector);
  const first = parts[0];
  if (first.some((n) => n.type === 'id' && n.value === 'root')) return [];

  // Document-level compound (html / body / :root …) → the scope root itself.
  if (first.some(isDocNode)) {
    const remaining = first.filter((n) => !isDocNode(n));
    if (remaining.some(isPseudoElement)) return [];
    if (remaining.some((n) => n.type === 'pseudo' && n.value === ':not' && /data-theme/.test(n.toString()))) return [];
    const hadRoot = first.some((n) => n.type === 'pseudo' && n.value.toLowerCase() === ':root');
    const head = `${hadRoot ? `.${SCOPE_CLASS}` : WHERE}${compoundText(remaining)}`;
    // `html … body …`: the body step collapses into the scope root too.
    let from = 1;
    if (parts.length > 2 && Array.isArray(parts[2]) && parts[2].length === 1 && parts[2][0].type === 'tag' && /^body$/i.test(parts[2][0].value)) {
      from = 3;
    }
    if (from >= parts.length) return [{ selector: head, doc: true }];
    return [{ selector: `${head}${restText(parts, from)}`, doc: false }];
  }

  // Leading theme compound (`[data-theme='dark'] …`): the theme attribute sits
  // on the scope root, which is either an ancestor or the element itself.
  if (first.length > 0 && first.every(isThemeAttr)) {
    const attrs = compoundText(first);
    if (parts.length === 1) return [{ selector: `${WHERE}${attrs}`, doc: true }];
    const out = [{ selector: `${WHERE}${attrs}${restText(parts, 1)}`, doc: false }];
    const comb = parts[1];
    if (comb.value.trim() === '' && Array.isArray(parts[2])) {
      out.push({ selector: `${withScope(parts[2], `${WHERE}${attrs}`)}${restText(parts, 3)}`, doc: false });
    }
    return out;
  }

  // Everything else: inside a scope root, or the scope root itself.
  return [
    { selector: `${WHERE} ${restText(parts, 0)}`, doc: false },
    { selector: `${withScope(first)}${restText(parts, 1)}`, doc: false },
  ];
}

const insideRule = (node) => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'rule') return true;
    if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return true;
  }
  return false;
};

export function scopeCss(css, from = undefined) {
  const root = postcss.parse(css, { from });
  let kept = 0;
  let dropped = 0;
  root.walkRules((rule) => {
    if (insideRule(rule)) return;
    const normal = [];
    const doc = [];
    for (const sel of rule.selectors) {
      const scoped = scopeSelector(sel);
      if (!scoped.length) dropped += 1;
      for (const item of scoped) (item.doc ? doc : normal).push(item.selector);
    }
    const uniq = (list) => [...new Set(list)];
    if (doc.length) {
      const docRule = normal.length ? rule.clone() : rule;
      docRule.selectors = uniq(doc);
      docRule.each((child) => {
        if (child.type === 'decl' && !DOC_KEEP.test(child.prop)) child.remove();
      });
      // A percentage line-height on body computes against body's font-size and
      // is inherited as that length. On a scope root with its own font-size
      // (a menu at 12.5px) it would compute differently, so pin it to the
      // rule's font-size: `line-height: 125%` → `calc(<font-size> * 1.25)`.
      const fontSize = docRule.nodes.find((n) => n.type === 'decl' && n.prop === 'font-size');
      docRule.each((child) => {
        if (child.type !== 'decl' || child.prop !== 'line-height') return;
        const pct = /^([\d.]+)%$/.exec(child.value.trim());
        if (pct && fontSize) child.value = `calc(${fontSize.value} * ${Number(pct[1]) / 100})`;
      });
      if (normal.length) rule.before(docRule);
      if (!docRule.nodes.some((n) => n.type === 'decl')) docRule.remove();
    }
    if (normal.length) {
      rule.selectors = uniq(normal);
      kept += 1;
    } else if (!doc.length) {
      rule.remove();
    }
  });
  // Remove at-rules left empty (media blocks whose rules were all dropped).
  let removedEmpty = true;
  while (removedEmpty) {
    removedEmpty = false;
    root.walkAtRules((atRule) => {
      if (atRule.nodes && atRule.nodes.filter((n) => n.type !== 'comment').length === 0) {
        atRule.remove();
        removedEmpty = true;
      }
    });
  }
  return { css: root.toString(), kept, dropped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: scope-css.mjs <in.css> <out.css>');
    process.exit(2);
  }
  const source = fs.readFileSync(input, 'utf8');
  const { css, kept, dropped } = scopeCss(source, input);
  const banner =
    '/* GENERATED by scripts/lib/scope-css.mjs from upstream.css — do not edit by hand.\n' +
    `   Every rule is scoped to .${SCOPE_CLASS} (see packages/design-preview/src/theme.ts). */\n`;
  fs.writeFileSync(output, banner + css);
  console.log(`scope-css: ${kept} rules scoped, ${dropped} document-only selectors dropped → ${output}`);
}
