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
// What it does (paths below are in packages/design-preview/)
//   1. Copies the framework-free upstream modules verbatim into
//      src/vendor/open-design/: the preview runtime (srcdoc builder, deck
//      bridge, sandbox shims, export helpers, manual-edit bridge + source
//      patcher), the comment model, sketch model, tab-launcher registry and the
//      CSS modules. Only module specifiers are rewritten: a relative import is
//      resolved against the upstream tree and pointed at the vendored copy (or
//      at a hand-written adapter in shims/ for app-wide modules such as i18n,
//      types, registry).
//      Upstream's React components (.tsx) are NOT copied: this library carries
//      Vue ports of them (same DOM / class names / behaviour). Their upstream
//      source is written to .upstream-ref/ (git-ignored) for diffing, its hash
//      is recorded in UPSTREAM.json, and the sync lists every component whose
//      upstream source changed since the last sync so the port can follow.
//      Two pieces are still generated from the React sources: Icon.ts (glyph
//      data, scripts/lib/convert-icon.mjs) and sketch/{editor-helpers,
//      preview-model}.ts (scripts/lib/split-sketch.py).
//   2. Extracts the i18n strings those surfaces use (en + zh-CN) into
//      src/locales/upstream-strings.ts.
//   3. Walks the upstream global stylesheet (apps/web/src/index.css and its
//      @imports, in cascade order), tree-shakes it down to the selectors this
//      project's components use (PurgeCSS) into src/styles/upstream.css, and
//      scopes that to `.odp-scope` (scripts/lib/scope-css.mjs) as
//      src/styles/upstream.scoped.css — the file the library ships; then
//      copies the brand fonts into the demo app.
//
// Files under src/vendor/open-design/shims/, contracts/index.ts,
// contracts/common.ts, ui-components/index.ts and every .vue file are
// hand-written and are never overwritten. Re-run this after adding new
// upstream class names to the components so their rules get extracted.

import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const upstream = path.resolve(root, process.argv[2] ?? process.env.OD_UPSTREAM ?? '../source');
const libRoot = path.join(root, 'packages/design-preview');
const appRoot = path.join(root, 'apps/preview');
const vendorRoot = path.join(libRoot, 'src/vendor/open-design');
const refRoot = path.join(root, '.upstream-ref');
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

// React components ported to Vue: vendor path of the upstream .tsx → the
// hand-written port(s) that must follow upstream changes.
const PORTS = {
  'components/Icon.tsx': ['components/Icon.vue', 'components/Icon.ts (generated)'],
  'components/RemixIcon.tsx': ['components/RemixIcon.vue'],
  'components/Toast.tsx': ['components/Toast.vue'],
  'components/TooltipLayer.tsx': ['components/TooltipLayer.vue'],
  'components/DeckSlideThumbnail.tsx': ['components/DeckSlideThumbnail.vue', 'components/deck-thumbnails.ts'],
  'components/DeckThumbnailRail.tsx': ['components/DeckThumbnailRail.vue', 'components/DeckThumbnailItem.vue', 'components/DeckIframeThumbnail.vue'],
  'components/BoardComposerPopover.tsx': ['components/BoardComposerPopover.vue', 'components/AnnotationHoverPopover.vue', 'components/board-composer.ts'],
  'components/PreviewDrawOverlay.tsx': ['components/PreviewDrawOverlay.vue', 'components/preview-draw.ts'],
  'components/ManualEditPanel.tsx': ['components/ManualEditPanel.vue', 'components/manual-edit/*'],
  'components/SketchEditor.tsx': ['components/SketchEditor.vue', 'components/sketch/editor-helpers.ts (generated)', 'components/sketch/excalidraw-island.ts'],
  'components/SketchPreview.tsx': ['components/SketchPreview.vue', 'components/sketch/preview-model.ts (generated)'],
  'components/workspace/TabLauncherMenu.tsx': ['components/workspace/TabLauncherMenu.vue'],
  'ui-components/button.tsx': ['ui-components/Button.vue', 'ui-components/button.ts'],
  'ui-components/form-controls.tsx': ['ui-components/Input.vue', 'ui-components/Textarea.vue'],
};
const isPorted = (to) => to.endsWith('.tsx');
// plugins-home/useInView.ts is a React hook; its Vue composable lives at the same path.
const HAND_PORTED_TS = new Set(['components/useInView.ts']);

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
    file: 'utils/imeComposing.ts',
    reason: 'The Vue ports pass DOM KeyboardEvents, not React synthetic events; type the parameter accordingly.',
    find: "import type { KeyboardEvent as ReactKeyboardEvent } from 'react';",
    replace:
      "// [od-design-preview patch] DOM KeyboardEvent instead of React's synthetic event (Vue port).\n" +
      'type ReactKeyboardEvent<_T = Element> = KeyboardEvent;',
  },
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
  // The two entries below patch the React reference copies only; the Vue
  // ports (PreviewDrawOverlay.vue, TooltipLayer.vue) carry the same behaviour.
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
  const upstreamJson = path.join(vendorRoot, 'UPSTREAM.json');
  const previous = fs.existsSync(upstreamJson) ? JSON.parse(fs.readFileSync(upstreamJson, 'utf8')) : {};
  const previousHashes = new Map((previous.ported ?? []).map((entry) => [entry.from, entry.sha256]));
  const ported = [];
  const changedPorts = [];
  for (const [from, to] of FILES) {
    const src = path.join(upstream, from);
    const text = fs.readFileSync(src, 'utf8');
    if (HAND_PORTED_TS.has(to)) {
      const sha256 = crypto.createHash('sha256').update(text).digest('hex');
      ported.push({ from, ports: [to], sha256 });
      if (previousHashes.has(from) && previousHashes.get(from) !== sha256) changedPorts.push(`${from} → ${to}`);
      fs.mkdirSync(path.dirname(path.join(refRoot, to)), { recursive: true });
      fs.writeFileSync(path.join(refRoot, to), text);
      continue;
    }
    const dest = isPorted(to) ? path.join(refRoot, to) : path.join(vendorRoot, to);
    if (isPorted(to)) {
      const sha256 = crypto.createHash('sha256').update(text).digest('hex');
      ported.push({ from, ports: PORTS[to] ?? [], sha256 });
      if (previousHashes.has(from) && previousHashes.get(from) !== sha256) changedPorts.push(`${from} → ${(PORTS[to] ?? []).join(', ')}`);
    }
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
  // Generated from the React sources (see the header): icon glyph data and
  // the framework-free halves of the sketch components.
  const { convertIconSource } = await import('./lib/convert-icon.mjs');
  fs.writeFileSync(
    path.join(vendorRoot, 'components/Icon.ts'),
    convertIconSource(
      fs.readFileSync(path.join(refRoot, 'components/Icon.tsx'), 'utf8'),
      `// Generated by scripts/lib/convert-icon.mjs from nexu-io/open-design@${shortSha}\n` +
        `// apps/web/src/components/Icon.tsx (Apache-2.0). Do not edit by hand; run \`pnpm sync:upstream\`.\n`,
    ),
  );
  execFileSync('python3', [path.join(here, 'lib/split-sketch.py'), path.join(refRoot, 'components'), path.join(vendorRoot, 'components/sketch')], {
    stdio: 'inherit',
  });
  fs.writeFileSync(
    upstreamJson,
    `${JSON.stringify(
      {
        repository: 'https://github.com/nexu-io/open-design',
        commit: upstreamSha,
        files: FILES.filter(([, to]) => !isPorted(to) && !HAND_PORTED_TS.has(to)).map(([from, to]) => ({ from, to })),
        ported,
      },
      null,
      2,
    )}\n`,
  );
  fs.copyFileSync(path.join(upstream, 'LICENSE'), path.join(vendorRoot, 'LICENSE'));
  console.log(`[sync-upstream] code: vendored ${copied} files from ${shortSha}; ${ported.length} React sources kept as reference in .upstream-ref/`);
  if (changedPorts.length) {
    console.warn(`[sync-upstream] ${changedPorts.length} upstream component(s) changed since the last sync — port the diff (git diff --no-index or compare .upstream-ref/) to:`);
    for (const line of changedPorts) console.warn(`  ${line}`);
  }
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
  fs.mkdirSync(path.join(libRoot, 'src/locales'), { recursive: true });
  fs.writeFileSync(
    path.join(libRoot, 'src/locales/upstream-strings.ts'),
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
      path.join(appRoot, 'index.html'),
      path.join(appRoot, 'src/**/*.{ts,vue}'),
      path.join(libRoot, 'src/{components,composables,review,ui,viewer,lib}/**/*.{ts,vue}'),
      // Vendored UI components render host DOM; the vendored runtime only
      // builds iframe documents, so it must not keep host rules alive.
      path.join(libRoot, 'src/vendor/open-design/{components,ui-components}/**/*.{ts,vue}'),
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
    ` * cascade order. Do not edit by hand; overrides live in src/styles/app.scss.\n` +
    ` * The library ships the scoped copy (upstream.scoped.css), not this file. */\n`;
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
  const stylesDir = path.join(libRoot, 'src/styles');
  fs.mkdirSync(stylesDir, { recursive: true });
  fs.writeFileSync(path.join(stylesDir, 'upstream.css'), css);
  console.log(`[sync-upstream] styles: ${(css.length / 1024).toFixed(1)} KB from ${cssFiles.length} files`);
  const { scopeCss, SCOPE_CLASS } = await import('./lib/scope-css.mjs');
  const scoped = scopeCss(css, path.join(stylesDir, 'upstream.css'));
  fs.writeFileSync(
    path.join(stylesDir, 'upstream.scoped.css'),
    '/* GENERATED by scripts/lib/scope-css.mjs from upstream.css — do not edit by hand.\n' +
      `   Every rule is scoped to .${SCOPE_CLASS} (see packages/design-preview/src/theme.ts). */\n` +
      scoped.css,
  );
  console.log(`[sync-upstream] styles: scoped to .${SCOPE_CLASS} (${scoped.kept} rules, ${scoped.dropped} document-only selectors dropped)`);

  const fontsDir = path.join(upstream, 'apps/web/public/fonts');
  if (fs.existsSync(fontsDir)) {
    fs.mkdirSync(path.join(appRoot, 'public/fonts'), { recursive: true });
    for (const f of fs.readdirSync(fontsDir)) {
      fs.copyFileSync(path.join(fontsDir, f), path.join(appRoot, 'public/fonts', f));
    }
  }
}
