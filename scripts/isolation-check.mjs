#!/usr/bin/env node
// Checks that the preview library's styles stay inside its own roots
// (`.odp-scope`) — i.e. that dropping it into a host app leaves the host's
// elements, CSS variables and Ant Design Vue components alone.
//
//   pnpm dev                       # in another terminal
//   pnpm check:isolation [-- http://127.0.0.1:5178]
import { chromium } from 'playwright-core';

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://127.0.0.1:5178').replace(/\/$/, '');
const browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

try {
  await page.goto(`${base}/?lang=en&theme=light`, { waitUntil: 'networkidle' });
  await page.getByTestId('design-files-panel').waitFor();

  // Host markup outside the preview roots keeps browser defaults.
  const host = await page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<button>host</button><input><p>text</p>';
    document.body.appendChild(wrap);
    const cs = (sel) => getComputedStyle(wrap.querySelector(sel));
    const out = {
      buttonHeight: cs('button').height,
      buttonFont: cs('button').fontFamily,
      inputRadius: cs('input').borderRadius,
      pFont: cs('p').fontFamily,
      pWeight: cs('p').fontWeight,
      rootToken: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      bodyToken: getComputedStyle(document.body).getPropertyValue('--text').trim(),
    };
    wrap.remove();
    return out;
  });
  check('host <button> not restyled', host.buttonHeight !== '36px' && !/Albert Sans/.test(host.buttonFont), `${host.buttonHeight}, ${host.buttonFont}`);
  check('host <input> not restyled', host.inputRadius === '0px', host.inputRadius);
  check('host text keeps its own typography', !/Albert Sans/.test(host.pFont) && host.pWeight === '400', `${host.pFont} ${host.pWeight}`);
  check('design tokens not defined on :root / body', host.rootToken === '' && host.bodyToken === '');

  // …while the preview itself is fully styled.
  const preview = await page.evaluate(() => {
    const ws = document.querySelector('[data-testid="file-workspace"]');
    const tab = document.querySelector('[data-testid="design-files-tab"]');
    return {
      token: ws ? getComputedStyle(ws).getPropertyValue('--bg').trim() : '',
      font: tab ? getComputedStyle(tab).fontFamily : '',
    };
  });
  check('preview roots carry the design tokens', preview.token !== '', preview.token);
  check('preview uses the upstream typography', /Albert Sans/.test(preview.font), preview.font);

  // The app's Ant Design Vue modal (teleported to <body>, outside the scope).
  await page.getByTestId('project-switcher').click();
  await page.locator('.odp-menu .odp-menu-item', { hasText: 'Open Design' }).click();
  await page.locator('.ant-modal').waitFor();
  const modal = await page.evaluate(() => {
    const btn = document.querySelector('.ant-modal .ant-btn');
    const cs = btn ? getComputedStyle(btn) : null;
    return cs ? { height: cs.height, font: cs.fontFamily } : null;
  });
  check('Ant Design Vue components keep their own styles', !!modal && modal.height === '32px' && !/Albert Sans/.test(modal.font), JSON.stringify(modal));
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  check('isolation run completed', false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}
console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
