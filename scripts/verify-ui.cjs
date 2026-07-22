const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.argv[2] || 'http://127.0.0.1:8765/';
const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1298, height: 900 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
];

function recordConsoleError(target) {
  return msg => {
    if (msg.type() !== 'error') return;
    const url = msg.location().url || 'unknown';
    // GoatCounterは自動ブラウザの計測リクエストを400で拒否する。画面機能とは無関係。
    if (/minano-sr\.goatcounter\.com\/count/.test(url)) return;
    target.push(`console ${url}: ${msg.text()}`);
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const results = [];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', recordConsoleError(errors));
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
    const adjusted = slots.filter(slot => {
      const s = Number.parseFloat(slot.getAttribute('crop-scale')) || 1;
      const x = Number.parseFloat(slot.getAttribute('crop-x')) || 0;
      const y = Number.parseFloat(slot.getAttribute('crop-y')) || 0;
      return Math.abs(s - 1) > 0.000001 || Math.abs(x) > 0.000001 || Math.abs(y) > 0.000001;
    });
    const cropFailures = adjusted.filter(slot => {
      const img = slot.querySelector('img[data-image-slot-public]');
      if (!img || img.style.position !== 'absolute') return true;
      const frame = slot.getBoundingClientRect();
      const image = img.getBoundingClientRect();
      return image.left > frame.left + 1 || image.top > frame.top + 1 ||
        image.right < frame.right - 1 || image.bottom < frame.bottom - 1;
    }).map(slot => slot.id || slot.getAttribute('src'));
    return { total: slots.length, broken, adjusted: adjusted.length, cropFailures };
  });
  if (slotState.broken.length) failures.push(`トップ画像スロット: 読込失敗 ${slotState.broken.join(', ')}`);
  if (slotState.cropFailures.length) failures.push(`トップ画像スロット: 手調整の反映失敗 ${slotState.cropFailures.join(', ')}`);
  const illustrationIds = [
    'svc-ill-joseikin', 'svc-ill-kisoku', 'svc-ill-shaho', 'svc-ill-kyuyo', 'svc-ill-sodan', 'svc-ill-dx',
    'stage-startup', 'stage-growth', 'stage-org',
    'news-thumb-1', 'news-thumb-2', 'news-thumb-3', 'news-thumb-4',
    'rep-portrait', 'office-exterior', 'office-interior', 'office-staff', 'office-area',
  ];
  const illustrationFailures = await imagePage.evaluate(ids => ids.flatMap(id => {
    const slot = document.getElementById(id);
    const img = slot?.querySelector('img[data-image-slot-public]');
    const hasCrop = ['crop-scale', 'crop-x', 'crop-y'].some(name => slot?.hasAttribute(name));
    if (!slot || !img || slot.getAttribute('fit') !== 'contain' || getComputedStyle(img).objectFit !== 'contain' || hasCrop) {
      return [id];
    }
    return [];
  }), illustrationIds);
  if (illustrationFailures.length) failures.push(`トップのイラスト全体表示: 設定不正 ${illustrationFailures.join(', ')}`);
  const visualCleanup = await imagePage.evaluate(() => {
    const startup = document.getElementById('stage-startup');
    const serviceRows = [...document.querySelectorAll('.svc-row')];
    const serviceBackgroundFailures = serviceRows.flatMap((row, index) => {
      const frame = row.querySelector('.svc-ill');
      const slot = frame?.querySelector('image-slot');
      const colors = [row, frame, slot].map(el => el && getComputedStyle(el).backgroundColor);
      return colors.every(color => color === 'rgb(254, 254, 254)') ? [] : [index + 1];
    });
    return {
      startupSource: startup?.getAttribute('src') || '',
      aboutCaptions: document.querySelectorAll('.trio-cap').length,
      serviceRows: serviceRows.length,
      serviceBackgroundFailures,
    };
  });
  if (visualCleanup.startupSource !== 'assets/illustrations/stage-startup-v2.webp') {
    failures.push(`創業期イラスト: 差し替え元が不正 ${visualCleanup.startupSource}`);
  }
  if (visualCleanup.aboutCaptions) failures.push(`事務所紹介: 説明ラベルが${visualCleanup.aboutCaptions}件残っています`);
  if (visualCleanup.serviceRows !== 6 || visualCleanup.serviceBackgroundFailures.length) {
    failures.push(`サービス一覧: 画像背景の継ぎ目対策が不正 ${visualCleanup.serviceBackgroundFailures.join(', ')}`);
  }
  results.push({ publicImageSlots: slotState.total, broken: slotState.broken.length,
    adjusted: slotState.adjusted, cropFailures: slotState.cropFailures.length,
    containedIllustrations: illustrationIds.length - illustrationFailures.length,
    aboutCaptions: visualCleanup.aboutCaptions,
    seamlessServiceRows: visualCleanup.serviceRows - visualCleanup.serviceBackgroundFailures.length });
  await imagePage.close();

  const cropPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let adjustedSubpageSlots = 0;
  for (const rel of ['joseikin.html', 'uploads/service-joseikin.html', 'uploads/service-shugyo-kisoku.html']) {
    await cropPage.goto(new URL(rel, base).href, { waitUntil: 'load' });
    const adjustedSlots = cropPage.locator('image-slot[crop-scale], image-slot[crop-x], image-slot[crop-y]');
    const count = await adjustedSlots.count();
    adjustedSubpageSlots += count;
    for (let i = 0; i < count; i++) {
      await adjustedSlots.nth(i).scrollIntoViewIfNeeded();
      await cropPage.waitForTimeout(80);
    }
    const bad = await cropPage.evaluate(() => [...document.querySelectorAll('image-slot[crop-scale], image-slot[crop-x], image-slot[crop-y]')]
      .filter(slot => {
        const img = slot.querySelector('img[data-image-slot-public]');
        if (!img || !img.complete || !img.naturalWidth || img.style.position !== 'absolute') return true;
        const frame = slot.getBoundingClientRect();
        const image = img.getBoundingClientRect();
        return image.left > frame.left + 1 || image.top > frame.top + 1 ||
          image.right < frame.right - 1 || image.bottom < frame.bottom - 1;
      }).map(slot => slot.id || slot.getAttribute('src')));
    if (bad.length) failures.push(`${rel}: 手調整の反映失敗 ${bad.join(', ')}`);
  }
  results.push({ adjustedSubpageSlots });
  await cropPage.close();

  const grantPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await grantPage.goto(new URL('joseikin.html', base).href, { waitUntil: 'load' });
  const grantIllustrationIds = [
    'jk-hero-ill', 'jk-ill-career', 'jk-ill-gyomu', 'jk-ill-ryoritsu', 'jk-ill-jinzai', 'jk-ill-trial',
  ];
  for (const id of grantIllustrationIds) {
    await grantPage.locator(`#${id}`).scrollIntoViewIfNeeded();
    await grantPage.waitForTimeout(80);
  }
  await grantPage.waitForTimeout(300);
  const grantFailures = await grantPage.evaluate(ids => ids.flatMap(id => {
    const slot = document.getElementById(id);
    const img = slot?.querySelector('img[data-image-slot-public]');
    const hasCrop = ['crop-scale', 'crop-x', 'crop-y'].some(name => slot?.hasAttribute(name));
    const frame = slot?.parentElement?.getBoundingClientRect();
    const ratio = frame && frame.height ? frame.width / frame.height : 0;
    if (!slot || !img || slot.getAttribute('fit') !== 'contain' || getComputedStyle(img).objectFit !== 'contain' ||
        hasCrop || !img.complete || img.naturalWidth < 960 || Math.abs(ratio - 4 / 3) > 0.02) {
      return [id];
    }
    return [];
  }), grantIllustrationIds);
  if (grantFailures.length) failures.push(`助成金ページの4:3イラスト: 設定不正 ${grantFailures.join(', ')}`);
  results.push({ grantIllustrations: grantIllustrationIds.length - grantFailures.length });
  await grantPage.close();

  const publicLinkPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await publicLinkPage.goto(base, { waitUntil: 'load' });
  await publicLinkPage.locator('#how-img-1').scrollIntoViewIfNeeded();
  await publicLinkPage.locator('#how-img-1').click();
  await publicLinkPage.waitForURL(/\/uploads\/service-joseikin\.html$/, { timeout: 10000 });
  results.push({ imageLinkPublic: true });
  await publicLinkPage.close();

  const editPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await editPage.addInitScript(() => {
    window.omelette = { writeFile: () => Promise.resolve() };
  });
  await editPage.goto(base, { waitUntil: 'load' });
  const editSlot = editPage.locator('#how-img-2');
  await editSlot.scrollIntoViewIfNeeded();
  await editSlot.dblclick();
  const editState = await editSlot.evaluate(slot => ({
    reframe: slot.hasAttribute('data-reframe'),
    path: location.pathname,
  }));
  if (!editState.reframe || !/\/$/.test(editState.path)) {
    failures.push(`編集画面: リンク内画像を手調整できません ${JSON.stringify(editState)}`);
  }
  results.push({ imageReframeEdit: editState.reframe, stayedOnHome: /\/$/.test(editState.path) });
  await editPage.close();

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
    sweepPage.on('console', recordConsoleError(errors));
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
  page.on('console', recordConsoleError(spaErrors));
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
  const imageStyleState = await page.evaluate(() => {
    const slot = document.querySelector('image-slot[src]');
    const img = slot && slot.querySelector('img[data-image-slot-public]');
    const slotBox = slot && slot.getBoundingClientRect();
    const imgBox = img && img.getBoundingClientRect();
    return {
      kept: !!document.getElementById('mn-image-slot-public-style'),
      boxMatches: !!(slotBox && imgBox && Math.abs(slotBox.width - imgBox.width) <= 1 && Math.abs(slotBox.height - imgBox.height) <= 1),
    };
  });
  const uniqueScales = [...new Set(scaleSamples)];
  if (!scaleSamples.length) failures.push('SPA遷移: カーテン表示を採取できませんでした');
  if (uniqueScales.some(scale => Math.abs(scale - 1) > 0.015)) {
    failures.push(`SPA遷移: カーテン実効倍率が変動 ${uniqueScales.join(', ')}`);
  }
  if (!imageStyleState.kept) failures.push('SPA遷移: 軽量画像用スタイルがhead差し替えで失われました');
  if (!imageStyleState.boxMatches) failures.push('SPA遷移: 画像とスロット枠の大きさが一致しません');
  if (spaErrors.length) failures.push(`SPA遷移: ${spaErrors.join(' / ')}`);
  results.push({ spa: 'contact→infographic', samples: scaleSamples.length, effectiveScales: uniqueScales, imageStyleKept: imageStyleState.kept, imageBoxMatches: imageStyleState.boxMatches, errors: spaErrors.length });

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (failures.length) {
    console.error('画面検証で問題が見つかりました。');
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log('画面検証合格: 5画面幅、公開時通信、無料相談後のSPA遷移を確認しました。');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
