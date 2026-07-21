const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.argv[2] || 'http://127.0.0.1:8765/';
const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const results = [];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      heroHeight: Math.round(document.querySelector('.hero')?.getBoundingClientRect().height || 0),
      heroImage: document.querySelector('.hero-media img')?.currentSrc || '',
      asyncCssMedia: document.querySelector('link[data-async-style]')?.media || '',
      stateRequests: performance.getEntriesByType('resource').filter(r => r.name.includes('.image-slots.state.json')).length,
      googleFontRequests: performance.getEntriesByType('resource').filter(r => /fonts\.(googleapis|gstatic)\.com/.test(r.name)).length,
    }));
    if (state.overflow > 1) failures.push(`${viewport.width}px: 横はみ出し ${state.overflow}px`);
    if (state.heroHeight < 500) failures.push(`${viewport.width}px: ヒーロー高さが不正 ${state.heroHeight}px`);
    if (state.asyncCssMedia !== 'all') failures.push(`${viewport.width}px: 全量CSSが有効化されていません`);
    if (state.stateRequests) failures.push(`${viewport.width}px: 編集用JSONを${state.stateRequests}回取得しています`);
    if (state.googleFontRequests) failures.push(`${viewport.width}px: Google Fontsを取得しています`);
    if (errors.length) failures.push(`${viewport.width}px: ${errors.join(' / ')}`);
    await page.screenshot({ path: `/tmp/minano-home-${viewport.width}.png`, fullPage: false });
    results.push({ viewport: viewport.width, ...state, errors: errors.length });
    await page.close();
  }

  const imagePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await imagePage.goto(base, { waitUntil: 'load' });
  const slotLocator = imagePage.locator('image-slot[src]');
  const slotCount = await slotLocator.count();
  for (let i = 0; i < slotCount; i++) {
    await slotLocator.nth(i).scrollIntoViewIfNeeded();
    await imagePage.waitForTimeout(80);
  }
  await imagePage.waitForTimeout(500);
  const slotState = await imagePage.evaluate(() => {
    const slots = [...document.querySelectorAll('image-slot[src]')];
    const broken = slots.filter(slot => {
      const img = slot.querySelector('img[data-image-slot-public]');
      return !img || !img.complete || img.naturalWidth === 0;
    }).map(slot => slot.id || slot.getAttribute('src'));
    return { total: slots.length, broken };
  });
  if (slotState.broken.length) failures.push(`トップ画像スロット: 読込失敗 ${slotState.broken.join(', ')}`);
  results.push({ publicImageSlots: slotState.total, broken: slotState.broken.length });
  await imagePage.close();

  const publicPages = [];
  for (const dir of ['', 'uploads', 'blog']) {
    const fullDir = path.join(process.cwd(), dir);
    for (const name of fs.readdirSync(fullDir)) {
      if (!name.endsWith('.html')) continue;
      const rel = dir ? `${dir}/${name}` : name;
      if (rel === 'admin-post.html' || rel === 'icon-catalog.html') continue;
      publicPages.push(rel);
    }
  }
  const sweepPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const rel of publicPages) {
    const errors = [];
    sweepPage.removeAllListeners('console');
    sweepPage.removeAllListeners('pageerror');
    sweepPage.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
    sweepPage.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    const response = await sweepPage.goto(new URL(rel, base).href, { waitUntil: 'load' });
    await sweepPage.waitForTimeout(100);
    const overflow = await sweepPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (!response?.ok()) failures.push(`${rel}: HTTP ${response?.status() || '応答なし'}`);
    if (overflow > 1) failures.push(`${rel}: 390px幅で横はみ出し ${overflow}px`);
    if (errors.length) failures.push(`${rel}: ${errors.join(' / ')}`);
  }
  results.push({ pageSweep: publicPages.length, viewport: 390 });
  await sweepPage.close();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const spaErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') spaErrors.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => spaErrors.push(`pageerror: ${error.message}`));
  await page.goto(base, { waitUntil: 'load' });
  await page.click('.btn-primary');
  await page.waitForURL(/\/uploads\/contact\.html$/, { timeout: 10000 });
  await page.waitForFunction(() => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift'), null, { timeout: 10000 });

  await page.locator('.nav-burger').click();
  await page.locator('.mob-nav a[href="../infographic.html"]').click();
  const scaleSamples = [];
  for (let i = 0; i < 100; i++) {
    const sample = await page.evaluate(() => {
      const html = document.documentElement;
      const veil = document.getElementById('pg-veil');
      if (!veil || !html.matches('.pv-on,.pv-mark,.pv-lift')) return null;
      const htmlZoom = Number.parseFloat(getComputedStyle(html).zoom) || 1;
      const veilZoom = Number.parseFloat(getComputedStyle(veil).zoom) || 1;
      return Number((htmlZoom * veilZoom).toFixed(3));
    });
    if (sample !== null) scaleSamples.push(sample);
    if (/\/infographic\.html$/.test(new URL(page.url()).pathname) && scaleSamples.length && sample === null) break;
    await page.waitForTimeout(30);
  }
  await page.waitForURL(/\/infographic\.html$/, { timeout: 10000 });
  await page.waitForFunction(() => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift'), null, { timeout: 10000 });
  const uniqueScales = [...new Set(scaleSamples)];
  if (!scaleSamples.length) failures.push('SPA遷移: カーテン表示を採取できませんでした');
  if (uniqueScales.some(scale => Math.abs(scale - 1) > 0.015)) {
    failures.push(`SPA遷移: カーテン実効倍率が変動 ${uniqueScales.join(', ')}`);
  }
  if (spaErrors.length) failures.push(`SPA遷移: ${spaErrors.join(' / ')}`);
  results.push({ spa: 'contact→infographic', samples: scaleSamples.length, effectiveScales: uniqueScales, errors: spaErrors.length });

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (failures.length) {
    console.error('画面検証で問題が見つかりました。');
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log('画面検証合格: 4画面幅、公開時通信、無料相談後のSPA遷移を確認しました。');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
