#!/usr/bin/env node
// End-to-end test of the review / edit tools — 注释 Comment, 评论 Comments
// panel + pins, 标记 Mark, 编辑 Edit, 草图 Sketch, the tab-strip "+" launcher,
// Markdown documents and uploads — against a running dev/preview server,
// driven through the locally installed Google Chrome (playwright-core).
//
//   npm run dev                              # in another terminal
//   npm run smoke:review [-- http://127.0.0.1:5178]
//
// Daemon mode as well (comments through the daemon API, edits written to disk):
//   npm run mock-daemon -- /tmp/demo-copy --id proj_demo &
//   OD_DAEMON_URL=http://127.0.0.1:7457 npm run dev &
//   SMOKE_DAEMON_PROJECT=proj_demo SMOKE_DAEMON_DIR=/tmp/demo-copy npm run smoke:review
//
// Env: SMOKE_SCREENSHOTS=dir → write PNGs of each step into `dir`.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://127.0.0.1:5178').replace(/\/$/, '');
const shotsDir = process.env.SMOKE_SCREENSHOTS ?? '';
const daemonProject = process.env.SMOKE_DAEMON_PROJECT ?? '';
const daemonDir = process.env.SMOKE_DAEMON_DIR ?? '';
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const results = [];
// Unique per run, so a daemon that kept comments from an earlier run cannot
// satisfy (or confuse) the checks.
const RUN = Date.now().toString(36);
const NOTE1 = `Make the headline shorter (${RUN})`;
const NOTE1B = `Make the headline shorter and bolder (${RUN})`;
const PAGE_NOTE = `Overall: tighten spacing (${RUN})`;
const MARK_NOTE = `Hero spacing feels cramped (${RUN})`;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
async function shot(page, name) {
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
}
async function attempt(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(name, false, String(err?.message ?? err).split('\n')[0]);
  }
}

const browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL ?? 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  // HTTP failures are reported with their URL by the response hook below.
  if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) consoleErrors.push(`console: ${msg.text()}`);
});
page.on('response', (resp) => {
  // (The local-folder check probes for the dev server's module endpoint.)
  if (resp.status() >= 400 && !resp.url().endsWith('/src/sources/local-source.ts')) consoleErrors.push(`http ${resp.status()}: ${resp.request().method()} ${resp.url()}`);
});

const activeViewer = () => page.locator('[data-testid="retained-file-viewer"]:not([aria-hidden])');
async function previewFrame() {
  const handle = await activeViewer().locator('[data-testid="artifact-preview-frame"]').elementHandle({ timeout: 10000 });
  return handle.contentFrame();
}
async function openFromDesignFiles(name) {
  await page.getByTestId('design-files-tab').click();
  await page.locator('.odp-df-search input').fill(name);
  const row = page.getByTestId(`design-file-row-${name}`);
  await row.waitFor({ timeout: 10000 });
  await row.locator('.df-card-thumb, .df-row-name-btn').first().click();
  await page.locator('.odp-df-search input').fill('').catch(() => {});
  await activeViewer().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
}
const toastText = () => page.locator('.od-toast').last().textContent({ timeout: 4000 }).catch(() => '');
const commentCount = async () => Number((await activeViewer().getByTestId('comment-count').textContent()) ?? 'NaN');

async function reviewSuite(label, { dir } = {}) {
  const tag = (s) => `[${label}] ${s}`;
  await openFromDesignFiles('index.html');
  let frame = await previewFrame();
  const originalLead = (await frame.locator('p').first().textContent())?.trim() ?? '';

  // --- 注释 Comment tool -----------------------------------------------------
  await attempt(tag('comment tool'), async () => {
    const before = await commentCount();
    await activeViewer().getByTestId('board-mode-toggle').click();
    await page.waitForTimeout(500);
    frame = await previewFrame();
    await frame.locator('h1').first().hover();
    await page.getByTestId('annotation-hover-popover').waitFor({ timeout: 5000 });
    check(tag('hover shows element style card'), true);
    await shot(page, `${label}-01-comment-hover`);
    // The hover style card sits over the element's top-left corner (upstream
    // placement), so pick the element on its right-hand side.
    const h1Box = await frame.locator('h1').first().boundingBox();
    await page.mouse.click(h1Box.x + h1Box.width - 24, h1Box.y + h1Box.height / 2);
    await page.getByTestId('comment-popover').waitFor({ timeout: 5000 });
    await page.getByTestId('comment-popover-input').fill(NOTE1);
    await shot(page, `${label}-02-comment-composer`);
    await page.getByTestId('comment-popover-save').click();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-testid="retained-file-viewer"]:not([aria-hidden]) [data-testid="comment-count"]')?.textContent) === n + 1,
      before,
      { timeout: 6000 },
    );
    check(tag('comment saved from element pick'), true, `count ${before} → ${before + 1}`);
  });

  // --- 评论 Comments panel + pins ---------------------------------------------
  await attempt(tag('comments panel'), async () => {
    await activeViewer().getByTestId('comment-panel-toggle').click();
    const panel = page.getByTestId('comment-float-host').getByTestId('comment-side-panel');
    await panel.waitFor({ timeout: 5000 });
    const items = panel.getByTestId('comment-side-item');
    const n = await items.count();
    check(tag('panel lists comments in the floating card'), n >= 1, `${n} item(s)`);
    const pins = await activeViewer().locator('[data-testid^="comment-saved-marker-"]').count();
    check(tag('pins drawn on the canvas'), pins >= 1, `${pins} pin(s)`);
    const reserved = await activeViewer().locator('.viewer-body').evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
    check(tag('preview leaves room for the card'), reserved > 200, `padding-right ${reserved}px`);
    await shot(page, `${label}-03-comments-panel`);

    // Reply/edit: open the comment, change the note.
    await items.filter({ hasText: NOTE1 }).first().click();
    await page.getByTestId('comment-popover').waitFor({ timeout: 5000 });
    const value = await page.getByTestId('comment-popover-input').inputValue();
    check(tag('clicking a comment reopens it'), value === NOTE1, value);
    await page.getByTestId('comment-popover-input').fill(NOTE1B);
    await page.getByTestId('comment-popover-save').click();
    await panel.getByText(NOTE1B).waitFor({ timeout: 5000 });
    check(tag('comment edited'), true);

    // File-level comment from the panel's form.
    const beforeForm = await items.count();
    await panel.getByTestId('comment-side-new-input').fill(PAGE_NOTE);
    await panel.getByTestId('comment-side-new-submit').click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="comment-float-host"] [data-testid="comment-side-item"]').length === n + 1,
      beforeForm,
      { timeout: 6000 },
    );
    check(tag('page comment from the panel form'), true);

    // Copy for agent.
    await items.filter({ hasText: NOTE1B }).first().getByTestId('comment-side-check').click();
    await panel.getByTestId('comment-side-copy').click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check(tag('copy for agent puts the comment context on the clipboard'), clip.includes(NOTE1B), clip.slice(0, 80).replace(/\n/g, ' '));

    // Resolve → hidden → show resolved → reopen.
    await items.filter({ hasText: NOTE1B }).first().getByTestId('comment-side-check').click().catch(() => {});
    if (!(await panel.getByTestId('comment-side-selectbar').isVisible().catch(() => false))) {
      await items.filter({ hasText: NOTE1B }).first().getByTestId('comment-side-check').click();
    }
    await panel.getByTestId('comment-side-resolve').click();
    await page.waitForTimeout(600);
    const openAfter = await items.filter({ hasText: NOTE1B }).count();
    check(tag('resolve hides the comment'), openAfter === 0, `${openAfter} open`);
    await panel.getByTestId('comment-show-resolved').click();
    await panel.getByTestId('comment-reopen').first().click();
    await page.waitForTimeout(600);
    check(tag('reopen restores it'), (await items.filter({ hasText: NOTE1B }).count()) === 1);

    // Delete the page-level comment through its composer.
    await items.filter({ hasText: PAGE_NOTE }).first().click();
    await page.getByTestId('comment-popover').waitFor({ timeout: 5000 });
    await page.locator('.comment-popover-delete').click();
    await page.waitForTimeout(600);
    check(tag('delete removes the comment'), (await items.filter({ hasText: PAGE_NOTE }).count()) === 0);
    await shot(page, `${label}-04-comments-after`);
    // Close the panel / comment mode.
    await activeViewer().getByTestId('comment-panel-toggle').click();
  });

  // --- 标记 Mark tool -------------------------------------------------------------
  await attempt(tag('mark tool'), async () => {
    const before = await commentCount();
    await activeViewer().getByTestId('draw-overlay-toggle').click();
    const canvas = activeViewer().locator('.preview-draw-overlay canvas').first();
    await canvas.waitFor({ timeout: 5000 });
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 260, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const note = page.locator('input[placeholder], textarea[placeholder]').filter({ has: page.locator(':scope') }).last();
    const noteInput = page.getByPlaceholder(/Add a note|为这个标记添加说明|note/i).last();
    await (await noteInput.count() ? noteInput : note).fill(MARK_NOTE);
    await shot(page, `${label}-05-mark`);
    await page.getByRole('button', { name: 'Save as comment' }).click();
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-testid="retained-file-viewer"]:not([aria-hidden]) [data-testid="comment-count"]')?.textContent) === n + 1,
      before,
      { timeout: 15000 },
    );
    check(tag('mark saved as a comment with its screenshot'), true, (await toastText()) ?? '');
    await activeViewer().getByTestId('comment-panel-toggle').click();
    const item = page.getByTestId('comment-float-host').getByTestId('comment-side-item').filter({ hasText: MARK_NOTE }).first();
    await item.waitFor({ timeout: 5000 });
    const imgs = await item.locator('img').count();
    check(tag('mark comment carries the marked-up image'), imgs >= 1, `${imgs} image(s)`);
    await shot(page, `${label}-06-mark-comment`);
    await activeViewer().getByTestId('comment-panel-toggle').click();
  });

  // --- 编辑 Edit tool -----------------------------------------------------------
  await attempt(tag('edit tool'), async () => {
    await activeViewer().getByTestId('manual-edit-mode-toggle').click();
    await page.waitForTimeout(800);
    frame = await previewFrame();
    // Text element → content inspector (a live `set-text` patch, no reload).
    await frame.locator('p').first().hover();
    await page.getByTestId('manual-edit-hover-open').waitFor({ timeout: 5000 });
    await page.getByTestId('manual-edit-hover-open').click();
    const textarea = page.locator('.manual-edit-content-inspector textarea').first();
    await textarea.waitFor({ timeout: 5000 });
    await shot(page, `${label}-07-edit-panel`);
    await textarea.fill('Edited lead from the inspector');
    await page.locator('.manual-edit-footer-btn.primary').click();
    await page.waitForTimeout(1500);
    frame = await previewFrame();
    const lead = (await frame.locator('p').first().textContent())?.trim();
    check(tag('text edit applied in the preview'), lead === 'Edited lead from the inspector', lead);
    const editError = await page.locator('.manual-edit-error').textContent().catch(() => null);
    if (editError) check(tag('edit error'), false, editError);
    if (dir) {
      const onDisk = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      check(tag('edit written to the project file'), onDisk.includes('Edited lead from the inspector'));
    }
    // Container element (h1 holds <em>) → selected-element HTML (re-renders the preview).
    await frame.locator('h1').first().hover();
    await page.getByTestId('manual-edit-hover-open').click();
    const html = page.locator('.manual-edit-content-inspector textarea').first();
    await html.waitFor({ timeout: 5000 });
    await html.fill('<h1>Notes that <em>listen</em> to you.</h1>');
    await page.locator('.manual-edit-footer-btn.primary').click();
    await page.waitForTimeout(2000);
    frame = await previewFrame();
    const h1 = (await frame.locator('h1').first().textContent())?.trim() ?? '';
    const em = (await frame.locator('h1 em').first().textContent().catch(() => ''))?.trim();
    check(tag('HTML edit re-renders the preview'), h1 === 'Notes that listen to you.' && em === 'listen', h1);
    await shot(page, `${label}-08-edit-saved`);
    // Undo twice from the inspector restores the original.
    await frame.locator('p').first().hover();
    await page.getByTestId('manual-edit-hover-open').click();
    await page.locator('.manual-edit-history-btn').first().waitFor({ timeout: 5000 });
    await page.locator('.manual-edit-history-btn').first().click();
    await page.waitForTimeout(1800);
    await page.locator('.manual-edit-history-btn').first().click().catch(() => {});
    await page.waitForTimeout(1800);
    frame = await previewFrame();
    const undone = (await frame.locator('p').first().textContent())?.trim();
    const h1After = (await frame.locator('h1').first().textContent())?.trim() ?? '';
    check(tag('undo restores the original'), undone === originalLead && h1After === 'Notes that think with you.', `${undone?.slice(0, 40)} | ${h1After}`);
    if (dir) {
      const onDisk = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      check(tag('undo written to the project file'), onDisk.includes('Notes that <em>think</em> with you.') && !onDisk.includes('Edited lead'));
    }
    // Inline: click a text element in the canvas, type, Enter (bridge text commit).
    await page.keyboard.press('Escape');
    const typeInline = async (text) => {
      frame = await previewFrame();
      await frame.locator('h2').first().click();
      await page.waitForTimeout(300);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      frame = await previewFrame();
      return (await frame.locator('h2').first().textContent())?.trim();
    };
    const inline = await typeInline('Pricing that scales');
    check(tag('inline text edit in the canvas'), inline === 'Pricing that scales', inline);
    if (dir) check(tag('inline edit written to the project file'), fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes('<h2>Pricing that scales</h2>'));
    await shot(page, `${label}-08b-inline-edit`);
    const restored = await typeInline('Simple pricing');
    check(tag('inline edit back to the original'), restored === 'Simple pricing', restored);
    // Drag to move: saved with the other pending edits when leaving Edit.
    // (A narrow element, so the inspector opening beside it stays clear of the pointer.)
    frame = await previewFrame();
    await frame.locator('.price').first().scrollIntoViewIfNeeded();
    const priceBox = await frame.locator('.price').first().boundingBox();
    await page.mouse.move(priceBox.x + 20, priceBox.y + priceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(priceBox.x + 80, priceBox.y + priceBox.height / 2 + 30, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await activeViewer().getByTestId('manual-edit-mode-toggle').click();
    await page.waitForTimeout(1200);
    frame = await previewFrame();
    const moved = await frame.locator('.price').first().evaluate((el) => el.style.transform);
    check(tag('drag-to-move applied'), /translate/.test(moved), moved);
    if (dir) check(tag('move saved to the project file on leaving Edit'), /<p[^>]*(class="price"[^>]*translate|translate[^>]*class="price")/.test(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')));
    check(tag('leaving edit mode'), !(await activeViewer().getByTestId('manual-edit-workspace').isVisible().catch(() => false)));
  });

  // --- "+" launcher → 新建草图 / 新建文档 / 上传 ---------------------------------
  await attempt(tag('launcher'), async () => {
    await page.getByTestId('workspace-add-tab').click();
    const menu = page.getByTestId('tab-launcher-menu');
    await menu.waitFor({ timeout: 5000 });
    const rows = await menu.locator('button').allTextContents();
    check(tag('launcher lists create actions'), rows.some((r) => r.includes('New sketch')) && rows.some((r) => r.includes('New document')) && rows.some((r) => r.includes('Upload')), rows.slice(0, 6).join(' | '));
    check(tag('launcher lists files and open tabs'), (await menu.getByTestId('tab-launcher-result').count()) > 0 && (await menu.getByTestId('tab-launcher-tab-result').count()) > 0);
    await shot(page, `${label}-09-launcher`);
    await menu.locator('button', { hasText: 'New sketch' }).first().click();
    const editor = page.getByTestId('sketch-excalidraw-editor');
    await editor.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const canvas = editor.locator('canvas.interactive, canvas').last();
    const box = await canvas.boundingBox();
    const rectangleTool = editor.locator('[data-testid="toolbar-rectangle"]');
    if (await rectangleTool.count()) await rectangleTool.first().click({ force: true });
    else await page.keyboard.press('r');
    // Draw in the middle of the canvas, clear of the toolbar and style panel.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 110, cy - 70);
    await page.mouse.down();
    await page.mouse.move(cx + 110, cy + 70, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(2200);
    await shot(page, `${label}-10-sketch`);
    const tabName = await page.locator('.ws-tab.active').getAttribute('title');
    check(tag('new sketch opens in the sketch editor'), Boolean(tabName?.endsWith('.sketch.json')), tabName ?? '');
    const state = await page.getByTestId('sketch-save-state').textContent().catch(() => '');
    check(tag('sketch autosaves'), /saved/i.test(state ?? ''), state ?? '');
    if (dir && tabName) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, tabName), 'utf8'));
      check(tag('sketch written with the drawn element'), Array.isArray(doc.elements) && doc.elements.length >= 1, `${doc.elements?.length} element(s)`);
    }

    await page.getByTestId('workspace-add-tab').click();
    await page.getByTestId('tab-launcher-menu').locator('button', { hasText: 'New document' }).first().click();
    const md = page.getByTestId('markdown-editor');
    await md.waitFor({ timeout: 8000 });
    await md.press('End');
    await md.type('\n\nWritten in the standalone preview.');
    await page.waitForTimeout(1600);
    const autosave = await page.getByTestId('markdown-autosave').textContent();
    check(tag('new document autosaves edits'), /Auto-saved/i.test(autosave ?? ''), autosave ?? '');
    await shot(page, `${label}-11-document`);

    await page.getByTestId('workspace-upload-input').setInputFiles({ name: 'upload-test.txt', mimeType: 'text/plain', buffer: Buffer.from('uploaded from the review smoke test') });
    // A name already in the project gets a -2, -3… suffix.
    await page.locator('.ws-tab.active[title^="upload-test"]').waitFor({ timeout: 8000 });
    check(tag('upload adds the file and opens it'), true, (await page.locator('.ws-tab.active').getAttribute('title')) ?? '');
  });
}

try {
  // ---------------------------------------------------------------------------
  await page.goto(`${base}/?lang=en&theme=light`, { waitUntil: 'networkidle' });
  // Start from a clean demo (drop browser-kept edits / comments of earlier runs).
  await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('od-design-preview');
    req.onsuccess = req.onerror = req.onblocked = () => resolve(null);
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('design-files-panel').waitFor({ timeout: 15000 });
  await reviewSuite('demo');

  // Comments and edits survive a reload (IndexedDB).
  await attempt('[demo] persistence', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await openFromDesignFiles('index.html');
    const n = await commentCount();
    check('[demo] comments persist across reload', n >= 2, `${n} comment(s)`);
    await page.getByTestId('project-switcher').click();
    const mode = await page.getByTestId('write-mode-note').textContent();
    check('[demo] project menu says where edits go', /browser/i.test(mode ?? ''), mode ?? '');
    const discard = page.getByTestId('discard-local-changes');
    check('[demo] discard browser edits offered', await discard.isVisible());
    await page.keyboard.press('Escape');
  });

  // A folder opened through the File System Access API writes edits back in
  // place. The OS picker cannot be automated, so drive LocalSource directly
  // with an origin-private directory handle (same API surface). Dev server only.
  await attempt('[local] folder writes', async () => {
    const result = await page.evaluate(async () => {
      let mod;
      try {
        mod = await import('/src/sources/local-source.ts');
      } catch {
        return null;
      }
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('odp-smoke', { create: true });
      const fh = await dir.getFileHandle('index.html', { create: true });
      const w = await fh.createWritable();
      await w.write('<h1>On disk</h1>');
      await w.close();
      const source = await mod.LocalSource.fromDirectoryHandle(dir);
      await source.writeFile('notes/new.md', '# hello');
      await source.writeFile('index.html', '<h1>Edited</h1>');
      const md = await (await (await dir.getDirectoryHandle('notes')).getFileHandle('new.md')).getFile();
      const idx = await (await dir.getFileHandle('index.html')).getFile();
      const files = (await source.listFiles()).map((f) => f.name).sort();
      const out = { mode: source.writeMode, md: await md.text(), idx: await idx.text(), files };
      await root.removeEntry('odp-smoke', { recursive: true });
      return out;
    });
    if (!result) {
      console.log('SKIP  [local] folder writes (needs the dev server)');
      return;
    }
    check(
      '[local] File System Access folder: edits and new files written in place',
      result.mode === 'disk' && result.md === '# hello' && result.idx === '<h1>Edited</h1>' && result.files.includes('notes/new.md'),
      JSON.stringify(result),
    );
  });

  if (daemonProject && daemonDir) {
    await page.goto(`${base}/?lang=en&theme=light&source=daemon&project=${encodeURIComponent(daemonProject)}`, { waitUntil: 'networkidle' });
    await page.getByTestId('design-files-panel').waitFor({ timeout: 15000 });
    await reviewSuite('daemon', { dir: daemonDir });
    const stateFile = path.join(daemonDir, '.od-mock', 'state.json');
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      check('[daemon] comments stored through the daemon API', state.comments.some((c) => c.note.includes(NOTE1B)), `${state.comments.length} comment(s)`);
    }
  }
} catch (err) {
  check('unexpected error', false, String(err?.stack ?? err));
} finally {
  // Excalidraw (sketch editor) registers a window `unload` listener, which
  // Chrome reports as a permissions-policy violation; it is harmless.
  const relevant = consoleErrors.filter((e) => !/favicon|ERR_ABORTED|net::ERR_FILE_NOT_FOUND|unload is not allowed/.test(e));
  check('no page errors', relevant.length === 0, relevant.slice(0, 5).join(' || '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
