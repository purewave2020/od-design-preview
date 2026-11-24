import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:5178';
const lang = process.argv[2] ?? 'zh-CN';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const rect = async (sel, label = sel) => {
  const r = await page.locator(sel).first().boundingBox().catch(() => null);
  console.log(label.padEnd(34), r ? `x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)}` : 'MISSING');
  return r;
};
const style = async (sel, props) => {
  const v = await page.locator(sel).first().evaluate((el, p) => { const cs = getComputedStyle(el); return Object.fromEntries(p.map((k) => [k, cs.getPropertyValue(k)])); }, props).catch(() => null);
  console.log(`  style ${sel}`, JSON.stringify(v));
};
await page.goto(`${base}/?lang=${lang}&theme=light&source=daemon&project=proj_demo&file=index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const viewer = '[data-testid="retained-file-viewer"]:not([aria-hidden])';
await rect('.ws-tabs-shell', 'tab strip');
await rect(`${viewer} .viewer-toolbar`, 'viewer toolbar');
await rect(`${viewer} .viewer-body`, 'viewer body');
for (const id of ['board-mode-toggle', 'draw-overlay-toggle', 'manual-edit-mode-toggle', 'comment-panel-toggle']) {
  const label = await page.locator(`${viewer} [data-testid="${id}"]`).getAttribute('aria-label');
  await rect(`${viewer} [data-testid="${id}"]`, `${id} (${label})`);
}
// comments panel
await page.locator(`${viewer} [data-testid="comment-panel-toggle"]`).click();
await page.waitForTimeout(600);
await rect('[data-testid="comment-float-host"]', 'comment float host');
await rect('[data-testid="comment-side-panel"]', 'comment side panel');
await rect('.comment-side-header', 'panel header');
await rect('.comment-side-new-comment', 'panel new-comment form');
await rect(`${viewer} [data-testid="comment-preview-canvas"]`, 'preview canvas (panel open)');
await style('[data-testid="comment-float-host"]', ['position', 'background-color', 'border-radius', 'z-index']);
const pins = await page.locator(`${viewer} .comment-saved-pin`).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return `${e.textContent}@${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
console.log('pins', pins.join(' | '));
// open composer by clicking an element
const frame = await (await page.locator(`${viewer} [data-testid="artifact-preview-frame"]`).elementHandle()).contentFrame();
const h2 = await frame.locator('h2').first().boundingBox();
await frame.locator('h2').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const h2b = await frame.locator('h2').first().boundingBox();
await page.mouse.click(h2b.x + h2b.width - 10, h2b.y + h2b.height / 2);
await page.waitForTimeout(500);
await rect('[data-testid="comment-popover"]', 'composer popover');
await rect('[data-testid="comment-active-pin"]', 'active pin');
await page.keyboard.press('Escape');
await page.locator(`${viewer} [data-testid="comment-panel-toggle"]`).click();
// mark
await page.locator(`${viewer} [data-testid="draw-overlay-toggle"]`).click();
await page.waitForTimeout(600);
const toolbar = await page.locator('.preview-draw-toolbar, [aria-label="标记工具"], [aria-label="Mark tool"]').first().boundingBox().catch(() => null);
console.log('draw toolbar', toolbar);
const btns = await page.locator('.preview-draw-icon-action').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
console.log('draw submit buttons', btns.join(' | '));
await page.locator(`${viewer} [data-testid="draw-overlay-toggle"]`).click();
// edit
await page.locator(`${viewer} [data-testid="manual-edit-mode-toggle"]`).click();
await page.waitForTimeout(800);
const f2 = await (await page.locator(`${viewer} [data-testid="artifact-preview-frame"]`).elementHandle()).contentFrame();
await f2.locator('h2').first().hover();
await page.waitForTimeout(300);
await rect('[data-testid="manual-edit-hover-open"]', 'edit hover affordance');
await page.getByTestId('manual-edit-hover-open').click();
await page.waitForTimeout(400);
await rect('.manual-edit-titlebar', 'edit panel titlebar');
const panelBox = await page.locator('.manual-edit-titlebar').first().evaluate((el) => { const p = el.parentElement; const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cls: p.className }; }).catch(() => null);
console.log('edit panel', JSON.stringify(panelBox));
const tabs = await page.locator('.manual-edit-scroll [role="tab"], .manual-edit-scroll button').evaluateAll((els) => els.slice(0, 12).map((e) => e.textContent?.trim()).filter(Boolean));
console.log('edit panel controls', tabs.join(' | '));
await page.locator('.manual-edit-footer-btn.subtle').last().click();
await page.locator(`${viewer} [data-testid="manual-edit-mode-toggle"]`).click();
// launcher
await page.getByTestId('workspace-add-tab').click();
await page.waitForTimeout(300);
await rect('[data-testid="workspace-add-tab"]', '+ button');
await rect('[data-testid="tab-launcher-menu"]', 'launcher menu');
const sections = await page.locator('[data-testid="tab-launcher-menu"] [class*="sectionHeader"]').allTextContents();
const rows = await page.locator('[data-testid="tab-launcher-menu"] [class*="rowName"]').allTextContents();
console.log('launcher sections', sections.join(' | '));
console.log('launcher rows', rows.join(' | '));
console.log('search placeholder', await page.getByTestId('tab-launcher-search').getAttribute('placeholder'));
await browser.close();
