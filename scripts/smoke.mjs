#!/usr/bin/env node
// End-to-end smoke test against a running dev/preview server, driven through
// the locally installed Google Chrome (playwright-core, no browser download).
//
//   npm run dev            # in another terminal
//   npm run smoke [-- http://127.0.0.1:5178]
//
// Env: SMOKE_SCREENSHOTS=dir  → write PNGs of each step into `dir`.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://127.0.0.1:5178').replace(/\/$/, '');
const shotsDir = process.env.SMOKE_SCREENSHOTS ?? '';
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
async function shot(page, name) {
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
}

const browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL ?? 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`);
});

const previewFrame = async () => {
  const handle = await page.locator('[data-testid="retained-file-viewer"]:not([aria-hidden]) [data-testid="artifact-preview-frame"]').elementHandle();
  return handle ? handle.contentFrame() : null;
};
async function openFromDesignFiles(name) {
  await page.getByTestId('design-files-tab').click();
  // Nested files: the search box flattens the folder tree.
  if (name.includes('/')) await page.locator('.odp-df-search input').fill(name);
  const row = page.getByTestId(`design-file-row-${name}`);
  if (!(await row.isVisible().catch(() => false))) {
    // Switch to whichever category tab holds the file.
    for (const tab of await page.locator('[data-testid^="design-files-tab-"]').all()) {
      await tab.click();
      if (await row.isVisible().catch(() => false)) break;
    }
  }
  const thumb = row.locator('.df-card-thumb, .df-row-name-btn').first();
  await thumb.click();
  await page.waitForTimeout(400);
}

try {
  // 1. Design Files panel ---------------------------------------------------
  await page.goto(`${base}/?lang=en&theme=light`, { waitUntil: 'networkidle' });
  await page.getByTestId('design-files-panel').waitFor({ timeout: 15000 });
  const tabLabels = await page.locator('[data-testid^="design-files-tab-"]').allTextContents();
  check('design files tabs render', tabLabels.length >= 3, tabLabels.join(' | '));
  const cards = await page.locator('.df-card-grid .df-card').count();
  check('page cards for html files', cards >= 4, `${cards} cards`);
  await page.waitForTimeout(1500);
  const thumbFrames = await page.locator('.df-thumb-scale-host iframe').count();
  check('live page thumbnails', thumbFrames >= 3, `${thumbFrames} thumbnail iframes`);
  await shot(page, '01-design-files');

  // 2. HTML page preview ----------------------------------------------------
  await openFromDesignFiles('index.html');
  await page.getByTestId('artifact-preview-frame').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  let frame = await previewFrame();
  const h1 = frame ? await frame.locator('h1').textContent().catch(() => null) : null;
  check('index.html renders in sandboxed iframe', !!h1 && h1.includes('think'), h1 ?? 'no h1');
  const sandbox = await page.locator('[data-testid="artifact-preview-frame"]').first().getAttribute('sandbox');
  check('preview iframe is sandboxed without same-origin', sandbox === 'allow-scripts allow-forms allow-downloads', sandbox ?? '');
  const imgOk = frame ? await frame.locator('.hero-art img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false) : false;
  check('relative image resolves via <base href>', imgOk);
  const cssOk = frame ? await frame.locator('.nav').evaluate((el) => getComputedStyle(el).position === 'sticky').catch(() => false) : false;
  check('relative stylesheet applied', cssOk);
  const counted = frame ? await frame.locator('[data-count]').first().textContent().catch(() => '') : '';
  check('artifact script runs', counted !== '0', `stat = ${counted}`);
  const actions = await page.locator('.ws-tabs-file-actions [data-testid="present-trigger"]').count();
  check('header actions portaled into tab strip', actions === 1);
  await shot(page, '02-index-desktop');

  // 2b. Exports ------------------------------------------------------------------
  const exportVia = async (label, timeout = 60000) => {
    await page.locator('.ws-tabs-file-actions').getByTestId('export-trigger').click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout }),
      page.getByRole('menuitem', { name: label, exact: true }).click(),
    ]);
    const file = await download.path();
    return { name: download.suggestedFilename(), size: file ? fs.statSync(file).size : 0, file };
  };
  for (const [label, ext] of [
    [/HTML/i, '.html'],
    [/zip/i, '.zip'],
    [/image/i, '.png'],
    [/PDF/i, '.pdf'],
  ]) {
    try {
      const labelText = await page
        .locator('.ws-tabs-file-actions')
        .getByTestId('export-trigger')
        .click()
        .then(() => page.locator('.chrome-unified-panel [role="menuitem"]').filter({ hasText: label }).first().textContent());
      await page.keyboard.press('Escape');
      const result = await exportVia(labelText.trim(), ext === '.pdf' || ext === '.png' ? 90000 : 20000);
      let detail = `${result.name} ${result.size} B`;
      let ok = result.name.endsWith(ext) && result.size > 1000;
      if (ext === '.html' && result.file) {
        const html = fs.readFileSync(result.file, 'utf8');
        ok = ok && html.includes('data:image/jpeg;base64');
        detail += ok ? ' (assets inlined)' : ' (assets NOT inlined)';
      }
      check(`export ${ext}`, ok, detail);
    } catch (error) {
      check(`export ${ext}`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
    }
  }

  // 3. Viewport presets ---------------------------------------------------------
  await page.getByTestId('viewport-trigger').click();
  await page.getByTestId('viewport-option-mobile').click();
  await page.waitForTimeout(500);
  const mobileWidth = await page.locator('.preview-viewport-mobile .comment-frame-clip > div').first().evaluate((el) => el.getBoundingClientRect().width);
  frame = await previewFrame();
  const innerWidth = frame ? await frame.evaluate(() => window.innerWidth) : 0;
  check('mobile viewport = 390 CSS px', innerWidth === 390, `iframe innerWidth ${innerWidth}, on-screen ${Math.round(mobileWidth)}px`);
  await shot(page, '03-index-mobile');
  await page.getByTestId('viewport-trigger').click();
  await page.getByTestId('viewport-option-desktop').click();

  // 4. Zoom menu ------------------------------------------------------------------
  await page.getByTestId('zoom-trigger').click();
  await page.getByRole('menuitem', { name: '50%', exact: true }).click();
  await page.waitForTimeout(300);
  const zoomLabel = await page.getByTestId('zoom-trigger').textContent();
  check('manual zoom 50%', zoomLabel?.trim() === '50%', zoomLabel ?? '');
  await page.getByTestId('zoom-trigger').click();
  await page.locator('.zoom-menu-popover .zoom-menu-item').first().click();

  // 5. Source mode ---------------------------------------------------------------------
  await page.getByTestId('mode-source').click();
  const src = await page.getByTestId('viewer-source').textContent();
  check('source mode shows raw HTML', !!src && src.includes('<link rel="stylesheet" href="assets/site.css"'));
  await page.getByTestId('mode-preview').click();

  // 6. Deck -----------------------------------------------------------------------------------
  const active = () => page.locator('[data-testid="retained-file-viewer"]:not([aria-hidden])');
  const deckCount = async () => (await active().getByTestId('deck-count').textContent())?.replace(/\s+/g, '');
  const activeSlideTitle = async () => {
    const f = await previewFrame();
    return f ? f.locator('.slide.is-active').getAttribute('data-title').catch(() => null) : null;
  };
  await openFromDesignFiles('product-slides.html');
  await active().getByTestId('deck-floating-nav').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  check('deck slide counter', (await deckCount()) === '1/5', await deckCount());
  // Pointer activity inside the sandboxed frame reveals the floating nav.
  const canvasBox = await active().getByTestId('comment-preview-canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 3, { steps: 4 });
  await page.waitForTimeout(400);
  const revealed = await active().getByTestId('deck-floating-nav').evaluate((el) => el.classList.contains('is-revealed'));
  check('floating deck nav reveals on in-frame pointer activity', revealed);
  await active().getByTestId('deck-next').click();
  await page.waitForTimeout(700);
  check('deck next → slide 2', (await deckCount()) === '2/5', await deckCount());
  check('iframe deck follows host navigation', (await activeSlideTitle()) === 'Traction', String(await activeSlideTitle()));
  const notes = await active().getByTestId('speaker-notes-panel').textContent().catch(() => '');
  check('speaker notes for active slide', !!notes && notes.includes('Retention'), notes?.slice(0, 80));
  const thumbs = await active().locator('.deck-thumbnail-rail .deck-thumbnail-button').count();
  check('deck thumbnail rail', thumbs === 5, `${thumbs} thumbnails`);
  await active().locator('.deck-thumbnail-rail .deck-thumbnail-button').nth(3).click();
  await page.waitForTimeout(2500);
  check('thumbnail click jumps to slide 4', (await deckCount()) === '4/5' && (await activeSlideTitle()) === 'Plan', `${await deckCount()} ${await activeSlideTitle()}`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(900);
  check('host keyboard ← navigates deck', (await deckCount()) === '3/5' && (await activeSlideTitle()) === 'Growth', `${await deckCount()} ${await activeSlideTitle()}`);
  await shot(page, '04-deck');

  // 7. Present ---------------------------------------------------------------------------------
  await page.locator('.ws-tabs-file-actions').getByTestId('present-trigger').click();
  await page.getByTestId('present-in-tab').click();
  await page.getByTestId('present-overlay').waitFor({ timeout: 5000 });
  check('present in tab opens overlay', true);
  await page.waitForTimeout(500);
  await shot(page, '05-present');
  await page.locator('.present-exit-btn').click();
  await page.waitForTimeout(300);
  check('present overlay closes', (await page.getByTestId('present-overlay').count()) === 0);

  // 8. Upstream deck example ---------------------------------------------------------------
  await openFromDesignFiles('pitch-deck.html');
  await active().getByTestId('deck-floating-nav').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const pitchCount = await deckCount();
  check('upstream html-ppt deck detected', /^1\/\d+$/.test(pitchCount ?? '') && pitchCount !== '1/1', pitchCount ?? '');

  // 9. Markdown + JSON -----------------------------------------------------------------------
  await openFromDesignFiles('docs/README.md');
  await page.locator('.markdown-rendered table').waitFor({ timeout: 5000 });
  const mdImg = await page.locator('.markdown-rendered img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
  check('markdown renders GFM table + relative image', mdImg);
  await page.locator('.markdown-rendered a', { hasText: 'tokens.json' }).click();
  await page.locator('.code-viewer').waitFor({ timeout: 5000 });
  const json = await page.locator('.code-viewer .lines').textContent();
  check('in-project markdown link opens JSON in code viewer', !!json && json.includes('\n  "color"'));
  await shot(page, '06-json');

  // 10. Local folder source (inlined assets) -------------------------------------------------
  await page.locator('input[type=file][webkitdirectory]').setInputFiles(path.join(root, 'public/demo-project'));
  await page.getByTestId('design-files-panel').waitFor({ timeout: 10000 });
  const chip = await page.getByTestId('project-switcher').textContent();
  check('local folder opens as project', !!chip && chip.includes('demo-project'), chip ?? '');
  await openFromDesignFiles('index.html');
  await page.waitForTimeout(1500);
  frame = await previewFrame();
  const localImg = frame
    ? await frame.locator('.hero-art img').evaluate((img) => ({ ok: img.complete && img.naturalWidth > 0, src: img.getAttribute('src')?.slice(0, 22) })).catch(() => null)
    : null;
  check('local folder: image inlined as data URL', !!localImg?.ok && localImg.src?.startsWith('data:image/'), JSON.stringify(localImg));
  const localCss = frame ? await frame.locator('.nav').evaluate((el) => getComputedStyle(el).position === 'sticky').catch(() => false) : false;
  check('local folder: stylesheet inlined', localCss);
  await shot(page, '07-local');

  // 11. Embed mode ------------------------------------------------------------------------------
  await page.goto(`${base}/?lang=en&embed=1&file=product-slides.html`, { waitUntil: 'networkidle' });
  await page.getByTestId('embedded-viewer').waitFor({ timeout: 10000 });
  await page.getByTestId('deck-floating-nav').waitFor({ timeout: 10000 });
  check('embed mode renders a single viewer', (await page.locator('.ws-tabs-shell').count()) === 0);

  // 12. Daemon source (optional: run scripts/mock-daemon.mjs or a real
  //     Open Design daemon behind OD_DAEMON_URL) ----------------------------------
  const daemonProject = process.env.SMOKE_DAEMON_PROJECT;
  if (daemonProject) {
    await page.goto(`${base}/?lang=en&source=daemon&project=${encodeURIComponent(daemonProject)}&file=index.html`, { waitUntil: 'networkidle' });
    await page.getByTestId('artifact-preview-frame').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    let dframe = await previewFrame();
    const dH1 = dframe ? await dframe.locator('h1').textContent().catch(() => null) : null;
    const baseHref = dframe ? await dframe.evaluate(() => document.baseURI) : '';
    check('daemon project renders via /api/projects/:id/raw', !!dH1 && baseHref.includes(`/api/projects/${daemonProject}/raw/`), `${dH1} @ ${baseHref}`);
    const dImg = dframe ? await dframe.locator('.hero-art img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false) : false;
    check('daemon project assets load', dImg);
    const dir = process.env.SMOKE_DAEMON_DIR;
    if (dir) {
      const target = path.join(dir, 'index.html');
      const original = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(target, original.replace('Notes that <em>think</em> with you.', 'Live reload <em>works</em>.'));
      try {
        let updated = '';
        for (let i = 0; i < 20 && !updated.includes('Live reload'); i++) {
          await page.waitForTimeout(400);
          dframe = await previewFrame();
          updated = dframe ? (await dframe.locator('h1').textContent().catch(() => '')) ?? '' : '';
        }
        check('daemon file-changed event live-reloads the preview', updated.includes('Live reload'), updated);
      } finally {
        fs.writeFileSync(target, original);
      }
    }
  }
} catch (error) {
  check('smoke run completed', false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  const relevant = consoleErrors.filter((e) => !/fonts\.googleapis|fonts\.gstatic|ERR_NAME_NOT_RESOLVED|Failed to load resource/i.test(e));
  check('no app errors in console', relevant.length === 0, relevant.slice(0, 5).join(' || '));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
