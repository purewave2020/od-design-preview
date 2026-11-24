#!/usr/bin/env node
// Re-vendors the preview runtime, the review/edit tools, icons, strings and
// the stylesheet slice from an Open Design (nexu-io/open-design) checkout into
// this project.
//
//   node scripts/sync-upstream.mjs [path-to-open-design-checkout]
//
// Default upstream path: ../source (the clone sitting next to this project),
// or $OD_UPSTREAM.
//
// What it does
//   1. Copies upstream modules verbatim into src/vendor/open-design/: the
//      framework-free preview runtime (srcdoc builder, deck bridge, sandbox
//      shims, export helpers, manual-edit bridge + source patcher), the comment
//      model, and the self-contained UI pieces (comment composer, Mark overlay,
//      manual-edit inspector, sketch editor, tab launcher, icons). Only module
//      specifiers are rewritten: a relative import is resolved against the
//      upstream tree and pointed at the vendored copy (or at a hand-written
//      adapter in shims/ for app-wide modules such as i18n, types, registry).
//   2. Extracts the i18n strings those surfaces use (en + zh-CN) into
//      src/i18n/upstream-strings.ts.
//   3. Walks the upstream global stylesheet (apps/web/src/index.css and its
//      @imports, in cascade order), tree-shakes it down to the selectors this
//      project's components use (PurgeCSS) and writes src/styles/upstream.css,
//      then copies the brand fonts.
//
// Files under src/vendor/open-design/shims/, contracts/index.ts,
// contracts/common.ts and ui-components/index.ts are hand-written adapters and
// are never overwritten. Re-run this after adding new upstream class names to
// the components so their rules get extracted.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const upstream = path.resolve(root, process.argv[2] ?? process.env.OD_UPSTREAM ?? '../source');
const vendorRoot = path.join(root, 'src/vendor/open-design');
const only = new Set((process.env.OD_SYNC_ONLY ?? 'code,i18n,styles').split(','));

if (!fs.existsSync(path.join(upstream, 'apps/web/src/runtime/srcdoc.ts'))) {
  console.error(`[sync-upstream] ${upstream} does not look like an open-design checkout`);
  process.exit(1);
}

let upstreamSha = 'unknown';
try {
  upstreamSha = execSync('git rev-parse HEAD', { cwd: upstream, encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout — keep "unknown" */
}
const shortSha = upstreamSha.slice(0, 12);

const web = (p) => `apps/web/src/${p}`;
const comp = (name) => [web(`components/${name}`), `components/${name}`];

// [upstream path, vendor path]
const FILES = [
  // contracts — injected-script builders shared by every transport, plus the
  // comment model shared with the daemon.
  ...[
    'annotated-selector',
    'comment-identity',
    'comment-identity-helpers',
    'comment-identity-selector',
    'deck-protocol',
    'deck-stage-fallback',
    'html-injection-points',
    'motion-source-player',
    'preview-guards',
    'preview-observability',
    'preview-runtime-state',
  ].map((name) => [`packages/contracts/src/runtime/${name}.ts`, `contracts/runtime/${name}.ts`]),
  ['packages/contracts/src/api/comments.ts', 'contracts/api/comments.ts'],
  ['packages/contracts/src/comment-target-title.ts', 'contracts/comment-target-title.ts'],
  // web runtime
  ...[
    'srcdoc',
    'preview-storage',
    'deck-thumbnail-parser',
    'deck-slide-structure',
    'annotated-selector',
    'speaker-notes',
    'zip',
    'react-component',
    'daemon-proxy-failure',
    'exports',
  ].map((name) => [web(`runtime/${name}.ts`), `runtime/${name}.ts`]),
  // manual edit: in-frame bridge, types and the source patcher (Edit tool)
  [web('edit-mode/bridge.ts'), 'edit-mode/bridge.ts'],
  [web('edit-mode/types.ts'), 'edit-mode/types.ts'],
  [web('edit-mode/source-patches.ts'), 'edit-mode/source-patches.ts'],
  // comment model: target snapshots, overlay geometry, anchoring
  [web('comments.ts'), 'comments.ts'],
  ...['anchor', 'owner-anchor', 'target-index'].map((name) => [web(`comments/${name}.ts`), `comments/${name}.ts`]),
  [web('utils/uuid.ts'), 'utils/uuid.ts'],
  [web('utils/imeComposing.ts'), 'utils/imeComposing.ts'],
  [web('artifacts/markdown.ts'), 'artifacts/markdown.ts'],
  // UI reused 1:1
  comp('Icon.tsx'),
  comp('RemixIcon.tsx'),
  comp('remix-icon-paths.ts'),
  comp('Toast.tsx'),
  comp('TooltipLayer.tsx'), //          shared hover bubble for `.od-tooltip[data-tooltip]`
  comp('DeckSlideThumbnail.tsx'),
  comp('DeckThumbnailRail.tsx'),
  [web('components/plugins-home/useInView.ts'), 'components/useInView.ts'],
  comp('BoardComposerPopover.tsx'), //  Comment composer + hover style card
  comp('PreviewDrawOverlay.tsx'), //     Mark tool (box / pen / text)
  comp('ManualEditPanel.tsx'), //        Edit tool inspector
  comp('SketchEditor.tsx'), //           Sketch (Excalidraw) editor
  comp('SketchPreview.tsx'),
  comp('sketch-model.ts'),
  comp('sketch-colors.ts'),
  comp('workspace/TabLauncherMenu.tsx'), // tab strip "+" menu
  comp('workspace/TabLauncherMenu.module.css'),
  comp('workspace/tab-launcher.ts'),
  // @open-design/components primitives used by the composer and the tooltip layer
  ...['button.tsx', 'button.module.css', 'form-controls.tsx', 'form-controls.module.css', 'class-names.ts', 'modal-stack.ts'].map((name) => [
    `packages/components/src/${name}`,
    `ui-components/${name}`,
  ]),
];

// Upstream modules that are replaced by hand-written adapters.
const SHIMS = {
  [web('types')]: 'shims/types',
  [web('i18n')]: 'shims/i18n',
  [web('i18n/index')]: 'shims/i18n',
  [web('i18n/types')]: 'shims/i18n-types',
  [web('providers/registry')]: 'shims/registry',
  [web('collab/workspace-identity')]: 'shims/workspace-identity',
  'packages/contracts/src/common': 'contracts/common',
};
const PACKAGE_SHIMS = {
  '@open-design/contracts': 'contracts/index',
  '@open-design/contracts/analytics': 'shims/analytics',
  '@open-design/host': 'shims/host',
  '@open-design/components': 'ui-components/index',
};

// Minimal, documented fixes applied on top of the verbatim copies. Each entry
// must match exactly; when upstream changes the line the patch is skipped with
// a warning so it can be re-evaluated (or dropped if upstream fixed it).
const PATCHES = [
  {
    file: 'runtime/exports.ts',
    reason:
      'Chrome stops running requestAnimationFrame in off-screen cross-origin frames, so the ' +
      'export-capture bridge (PNG / PDF export) never settles in a plain browser. Keep the ' +
      'hidden export frame inside the viewport but invisible.',
    find: 'iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;border:0;background:#fff;`;',
    replace:
      '// [od-design-preview patch] see scripts/sync-upstream.mjs PATCHES\n' +
      '  iframe.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;background:#fff;opacity:0;pointer-events:none;z-index:-2147483647;`;',
  },
  {
    file: 'components/PreviewDrawOverlay.tsx',
    reason:
      'Upstream Enter in the Mark note queues the mark for the next chat turn. There is no chat ' +
      'here: the primary action saves the mark as a comment, so Enter submits that instead.',
    find: "if (e.key === 'Enter') void send('queue');",
    replace: "if (e.key === 'Enter') void send('send'); // [od-design-preview patch] see scripts/sync-upstream.mjs PATCHES",
  },
  {
    file: 'components/TooltipLayer.tsx',
    reason:
      'The no-deps layout effect called updatePosition() after every commit and relied on the ' +
      'updater returning `current` to stop. With updates of mixed priority queued (pointerover = ' +
      'continuous lane, passive effects = default lane, the effect itself = sync lane) React ' +
      're-applies the updaters from an older base state, gets a new object every time, and the ' +
      'effect loops until "Maximum update depth exceeded" unmounts the whole app (white screen). ' +
      'Only queue the update when the committed bubble is actually stale.',
    find: [
      "  useLayoutEffect(() => {",
      "    if (!state?.visible) return;",
      "    updatePosition();",
      "  });",
    ].join('\n'),
    replace: [
      "  // [od-design-preview patch] see scripts/sync-upstream.mjs PATCHES",
      "  useLayoutEffect(() => {",
      "    if (!state?.visible) return;",
      "    // Queue an update only when the committed bubble is actually stale. With",
      "    // updates of mixed priority in the queue (pointerover = continuous lane,",
      "    // passive effects = default lane, this effect = sync lane) React re-applies",
      "    // the updaters from an older base state, so updatePosition() returning",
      "    // `current` is no reliable \"nothing changed\" signal; calling it on every",
      "    // commit looped until \"Maximum update depth exceeded\" blanked the app.",
      "    const node = tooltipRef.current;",
      "    if (",
      "      node",
      "      && isActiveTooltipTarget(state.target)",
      "      && state.target.getAttribute('aria-expanded') !== 'true'",
      "    ) {",
      "      const placement = tooltipPlacement(state.target);",
      "      const text = state.target.dataset.tooltip?.trim() ?? state.text;",
      "      if (",
      "        text === state.text",
      "        && placement === state.placement",
      "        && sameStyle(state.style, positionTooltip(state.target, node, placement))",
      "      ) {",
      "        return;",
      "      }",
      "    }",
      "    updatePosition();",
      "  });",
    ].join('\n'),
  },
];

const stripModuleExt = (p) => p.replace(/\.(tsx?|js|mjs)$/, '');
const moduleMap = new Map(FILES.map(([from, to]) => [stripModuleExt(from), to]));
for (const [from, to] of Object.entries(SHIMS)) moduleMap.set(from, to);

function relTo(fromVendorFile, toVendorModule) {
  let rel = path.posix.relative(path.posix.dirname(fromVendorFile), stripModuleExt(toVendorModule));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  // Keep non-script extensions (.css) that the import itself carried.
  return rel;
}

const unresolved = [];
function rewriteSpecifiers(source, upstreamFile, vendorFile) {
  return source.replace(/(from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\2/g, (match, lead, quote, spec) => {
    let target = null;
    if (spec.startsWith('@open-design/contracts/runtime/')) {
      target = `contracts/runtime/${spec.slice('@open-design/contracts/runtime/'.length)}`;
    } else if (PACKAGE_SHIMS[spec]) {
      target = PACKAGE_SHIMS[spec];
    } else if (spec.startsWith('.')) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(upstreamFile), spec));
      target = moduleMap.get(stripModuleExt(resolved)) ?? moduleMap.get(resolved) ?? null;
      if (!target) {
        unresolved.push(`${upstreamFile}: ${spec}`);
        return match;
      }
      if (/\.(css)$/.test(spec)) {
        let rel = path.posix.relative(path.posix.dirname(vendorFile), target);
        if (!rel.startsWith('.')) rel = `./${rel}`;
        return `${lead}${quote}${rel}${quote}`;
      }
    }
    if (!target) return match;
    const next = relTo(vendorFile, target);
    return next === spec ? match : `${lead}${quote}${next}${quote}`;
  });
}

const header = (from, to) =>
  to.endsWith('.css')
    ? `/* Vendored verbatim from nexu-io/open-design@${shortSha}\n * upstream: ${from} (Apache-2.0). Do not edit by hand; run \`npm run sync:upstream\`. */\n`
    : `// Vendored verbatim from nexu-io/open-design@${shortSha}\n` +
      `// upstream: ${from} (Apache-2.0). Do not edit by hand; run \`npm run sync:upstream\`.\n`;

if (only.has('code')) {
  let copied = 0;
  for (const [from, to] of FILES) {
    const src = path.join(upstream, from);
    const dest = path.join(vendorRoot, to);
    const text = fs.readFileSync(src, 'utf8');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let body = to.endsWith('.css') ? text : rewriteSpecifiers(text, from, to);
    for (const patch of PATCHES.filter((p) => p.file === to)) {
      if (body.includes(patch.find)) {
        body = body.replace(patch.find, patch.replace);
        console.log(`[sync-upstream] patched ${to}: ${patch.reason.split('.')[0]}`);
      } else {
        console.warn(`[sync-upstream] WARNING: patch for ${to} no longer applies — re-check: ${patch.reason}`);
      }
    }
    fs.writeFileSync(dest, header(from, to) + body);
    copied += 1;
  }
  if (unresolved.length) {
    console.warn(`[sync-upstream] WARNING: ${unresolved.length} relative import(s) point outside the vendored set:`);
    for (const line of unresolved) console.warn(`  ${line}`);
  }
  fs.writeFileSync(
    path.join(vendorRoot, 'UPSTREAM.json'),
    `${JSON.stringify({ repository: 'https://github.com/nexu-io/open-design', commit: upstreamSha, files: FILES.map(([from, to]) => ({ from, to })) }, null, 2)}\n`,
  );
  fs.copyFileSync(path.join(upstream, 'LICENSE'), path.join(vendorRoot, 'LICENSE'));
  console.log(`[sync-upstream] code: vendored ${copied} files from ${shortSha}`);
}

// --- i18n -------------------------------------------------------------------
if (only.has('i18n')) {
  const I18N_PREFIXES = [
    'fileViewer.',
    'designFiles.',
    'workspace.',
    'common.',
    'nextStep.more',
    'manualEdit.',
    'sketch.',
    'comment.',
    'preview.',
    'chat.tabComments',
    'chat.comments.',
    'chat.annotation',
    'chat.inspect.',
    'chat.send',
    'chat.attachTitle',
    'chat.attachAria',
    'chat.queuedReorder',
    'ds.reset',
  ];
  const extractDict = (file) => {
    const text = fs.readFileSync(path.join(upstream, 'apps/web/src/i18n/locales', file), 'utf8');
    const out = {};
    const re = /(["'])([\w.-]+)\1\s*:\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)/g;
    let m;
    while ((m = re.exec(text))) {
      const key = m[2];
      if (!I18N_PREFIXES.some((p) => key.startsWith(p))) continue;
      try {
        // The regex only ever captures a single string literal.
        out[key] = new Function(`return ${m[3]};`)();
      } catch {
        /* skip unparsable */
      }
    }
    return out;
  };
  const en = extractDict('en.ts');
  const zh = extractDict('zh-CN.ts');
  fs.mkdirSync(path.join(root, 'src/i18n'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src/i18n/upstream-strings.ts'),
    `// Generated by scripts/sync-upstream.mjs from nexu-io/open-design@${shortSha}\n` +
      `// apps/web/src/i18n/locales/{en,zh-CN}.ts — keys used by the vendored surfaces.\n` +
      `export const upstreamEn: Record<string, string> = ${JSON.stringify(en, null, 2)};\n\n` +
      `export const upstreamZhCN: Record<string, string> = ${JSON.stringify(zh, null, 2)};\n`,
  );
  console.log(`[sync-upstream] i18n: ${Object.keys(en).length} en / ${Object.keys(zh).length} zh-CN keys`);
}

// --- styles -----------------------------------------------------------------
if (only.has('styles')) {
  const webSrc = path.join(upstream, 'apps/web/src');
  // Expand index.css's @import graph into a flat, cascade-ordered file list.
  const SKIP = [/remixicon/, /^@/, /node_modules/];
  const cssFiles = [];
  const visit = (file) => {
    if (!fs.existsSync(file) || cssFiles.includes(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^@import\s+(?:url\()?['"]([^'"]+)['"]\)?[^;]*;/gm)) {
      const spec = m[1];
      if (SKIP.some((re) => re.test(spec))) continue;
      visit(path.resolve(path.dirname(file), spec));
    }
    if (path.basename(file) !== 'index.css' || path.dirname(file) !== webSrc) cssFiles.push(file);
  };
  visit(path.join(webSrc, 'index.css'));

  const { PurgeCSS } = await import('purgecss');
  const results = await new PurgeCSS().purge({
    content: [
      path.join(root, 'index.html'),
      path.join(root, 'src/main.tsx'),
      path.join(root, 'src/{app,ui,viewer,workspace,lib,review,sketch}/**/*.{ts,tsx}'),
      // Vendored UI components render host DOM; the vendored runtime only
      // builds iframe documents, so it must not keep host rules alive.
      path.join(root, 'src/vendor/open-design/components/**/*.tsx'),
    ],
    css: cssFiles,
    variables: false,
    keyframes: true,
    fontFace: true,
    rejected: false,
    safelist: {
      standard: ['html', 'body', ':root', /^data-theme$/],
      // Class names assembled at runtime (`comment-saved-marker--${state}`,
      // `comment-side-item-drop-${edge}`) never appear whole in the sources.
      greedy: [/data-theme/, /^comment-saved-marker--/, /^comment-side-item-drop-/, /^excalidraw/],
    },
    defaultExtractor: (content) => content.match(/[A-Za-z0-9_-]+/g) ?? [],
  });
  let css =
    `/* Generated by scripts/sync-upstream.mjs — tree-shaken slice of the\n` +
    ` * nexu-io/open-design@${shortSha} web stylesheet (Apache-2.0), in upstream\n` +
    ` * cascade order. Do not edit by hand; overrides live in src/styles/app.css. */\n`;
  for (const result of results) {
    const rel = path.relative(webSrc, result.file ?? '').split(path.sep).join('/');
    const body = result.css
      .replace(/^@import[^;]+;\s*$/gm, '')
      // Upstream comments are design notes for the full app; drop them.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!body) continue;
    css += `\n/* ---- ${rel} ---- */\n${body}\n`;
  }
  fs.mkdirSync(path.join(root, 'src/styles'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/styles/upstream.css'), css);
  console.log(`[sync-upstream] styles: ${(css.length / 1024).toFixed(1)} KB from ${cssFiles.length} files`);

  const fontsDir = path.join(upstream, 'apps/web/public/fonts');
  if (fs.existsSync(fontsDir)) {
    fs.mkdirSync(path.join(root, 'public/fonts'), { recursive: true });
    for (const f of fs.readdirSync(fontsDir)) {
      fs.copyFileSync(path.join(fontsDir, f), path.join(root, 'public/fonts', f));
    }
  }
}
