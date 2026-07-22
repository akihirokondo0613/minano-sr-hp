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

  const renderedHomeHeights = {};
  for (const width of [390, 1440]) {
    const heightPage = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    await heightPage.goto(base, { waitUntil: 'load' });
    await heightPage.evaluate(async () => {
      for (const section of document.querySelectorAll('main > section')) {
        section.scrollIntoView({ block: 'center' });
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      scrollTo(0, 0);
    });
    renderedHomeHeights[width] = await heightPage.evaluate(() => document.documentElement.scrollHeight);
    if (renderedHomeHeights[width] > 9500) failures.push(`${width}px: トップページ全長が目標超過 ${renderedHomeHeights[width]}px`);
    await heightPage.close();
  }
  results.push({ renderedHomeHeights });

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
    'home-svc-joseikin', 'home-svc-kisoku', 'home-svc-shaho', 'home-svc-kyuyo', 'home-svc-sodan', 'home-svc-dx',
    'home-stage-startup', 'home-stage-growth', 'home-stage-org',
    'news-thumb-1', 'news-thumb-2', 'news-thumb-3',
    'home-representative',
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
    const startup = document.getElementById('home-stage-startup');
    const serviceRows = [...document.querySelectorAll('.svc-row')];
    const serviceBackgroundFailures = serviceRows.flatMap((row, index) => {
      const frame = row.querySelector('.svc-ill');
      const slot = frame?.querySelector('image-slot');
      const colors = [row, frame, slot].map(el => el && getComputedStyle(el).backgroundColor);
      return colors.every(color => color === 'rgb(254, 254, 254)') ? [] : [index + 1];
    });
    const newsRows = [...document.querySelectorAll('.news-row')];
    const newsBackgroundFailures = newsRows.flatMap((row, index) => {
      const frame = row.querySelector('.news-thumb');
      const slot = frame?.querySelector('image-slot');
      const colors = [row, frame, slot].map(el => el && getComputedStyle(el).backgroundColor);
      return colors.every(color => color === 'rgb(254, 254, 254)') ? [] : [index + 1];
    });
    return {
      startupSource: startup?.getAttribute('src') || '',
      aboutCaptions: document.querySelectorAll('.trio-cap').length,
      serviceRows: serviceRows.length,
      serviceBackgroundFailures,
      newsRows: newsRows.length,
      newsBackgroundFailures,
    };
  });
  if (visualCleanup.startupSource !== 'assets/illustrations/stage-startup-v2.webp') {
    failures.push(`創業期イラスト: 差し替え元が不正 ${visualCleanup.startupSource}`);
  }
  if (visualCleanup.aboutCaptions) failures.push(`事務所紹介: 説明ラベルが${visualCleanup.aboutCaptions}件残っています`);
  if (visualCleanup.serviceRows !== 6 || visualCleanup.serviceBackgroundFailures.length) {
    failures.push(`サービス一覧: 画像背景の継ぎ目対策が不正 ${visualCleanup.serviceBackgroundFailures.join(', ')}`);
  }
  if (visualCleanup.newsRows !== 3 || visualCleanup.newsBackgroundFailures.length) {
    failures.push(`記事一覧: 画像背景の継ぎ目対策が不正 ${visualCleanup.newsBackgroundFailures.join(', ')}`);
  }
  results.push({ publicImageSlots: slotState.total, broken: slotState.broken.length,
    adjusted: slotState.adjusted, cropFailures: slotState.cropFailures.length,
    containedIllustrations: illustrationIds.length - illustrationFailures.length,
    aboutCaptions: visualCleanup.aboutCaptions,
    seamlessServiceRows: visualCleanup.serviceRows - visualCleanup.serviceBackgroundFailures.length,
    seamlessNewsRows: visualCleanup.newsRows - visualCleanup.newsBackgroundFailures.length });
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
  await publicLinkPage.locator('#home-svc-joseikin').scrollIntoViewIfNeeded();
  await publicLinkPage.locator('#home-svc-joseikin').click();
  await publicLinkPage.waitForURL(/\/uploads\/service-joseikin\.html$/, { timeout: 10000 });
  results.push({ imageLinkPublic: true });
  await publicLinkPage.close();

  const journeyPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const journeyErrors = [];
  journeyPage.on('console', recordConsoleError(journeyErrors));
  journeyPage.on('pageerror', error => journeyErrors.push(`pageerror: ${error.message}`));
  await journeyPage.goto(base, { waitUntil: 'load' });
  await journeyPage.locator('.nav-links a[href="services.html"]').click();
  await journeyPage.waitForFunction(() => location.pathname.endsWith('/services.html'), null, { timeout: 10000 });
  await journeyPage.waitForFunction(() => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift') && !!document.querySelector('.service-catalog'), null, { timeout: 10000 });
  await journeyPage.locator('.service-catalog a[href="uploads/service-joseikin.html"]').click();
  await journeyPage.waitForFunction(() => location.pathname.endsWith('/uploads/service-joseikin.html'), null, { timeout: 10000 });
  await journeyPage.waitForFunction(() => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift') && !!document.querySelector('.page-hero'), null, { timeout: 10000 });
  await journeyPage.locator('.nav-links a[href="../pricing.html"]').click();
  await journeyPage.waitForFunction(() => location.pathname.endsWith('/pricing.html'), null, { timeout: 10000 });
  await journeyPage.waitForFunction(() => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift') && !!document.getElementById('pricing'), null, { timeout: 10000 });
  await journeyPage.locator('.nav-cta').click();
  await journeyPage.waitForFunction(() => location.pathname.endsWith('/uploads/contact.html'), null, { timeout: 10000 });
  if (journeyErrors.length) failures.push(`主要導線: ${journeyErrors.join(' / ')}`);
  results.push({ journey: 'トップ→サービス→詳細→料金→無料相談', errors: journeyErrors.length });
  await journeyPage.close();

  const legacyPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const legacyAnchors = ['services', 'pricing', 'cases', 'about'];
  for (const anchor of legacyAnchors) {
    await legacyPage.goto(`${base}#${anchor}`, { waitUntil: 'load' });
    const exists = await legacyPage.evaluate(id => !!document.getElementById(id), anchor);
    if (!exists) failures.push(`旧アンカー: #${anchor} の移動先がありません`);
  }
  results.push({ legacyAnchors: legacyAnchors.length });
  await legacyPage.close();

  const simulatorPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await simulatorPage.goto(new URL('pricing.html', base).href, { waitUntil: 'load' });
  await simulatorPage.locator('#simulator > summary').click();
  await simulatorPage.waitForTimeout(350);
  await simulatorPage.locator('#ksEmpN').fill('8');
  await simulatorPage.locator('label:has(#ksPayroll)').click();
  await simulatorPage.locator('.ks-q[data-gate="1"]').click();
  await simulatorPage.locator('.ks-q[data-name="キャリアアップ助成金"]').click();
  const simulatorState = await simulatorPage.evaluate(() => ({
    price: document.getElementById('ksPrice')?.textContent.trim() || '',
    count: document.getElementById('ksCount')?.textContent.trim() || '',
    total: document.getElementById('ksTotal')?.textContent.trim() || '',
  }));
  if (!/¥/.test(simulatorState.price) || !/1件/.test(simulatorState.count) || !/40万円/.test(simulatorState.total)) {
    failures.push(`料金シミュレーター: 計算結果が不正 ${JSON.stringify(simulatorState)}`);
  }
  await simulatorPage.locator('.ks-cta').click();
  await simulatorPage.waitForFunction(() => location.pathname.endsWith('/uploads/contact.html') && new URLSearchParams(location.search).get('from') === 'sim', null, { timeout: 10000 });
  results.push({ simulator: simulatorState, contactParameter: 'from=sim' });
  await simulatorPage.close();

  const adminPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const adminErrors = [];
  adminPage.on('console', recordConsoleError(adminErrors));
  adminPage.on('pageerror', error => adminErrors.push(`pageerror: ${error.message}`));
  await adminPage.goto(new URL('admin-post.html', base).href, { waitUntil: 'load' });
  await adminPage.locator('#f-title').fill('検証用の記事タイトル');
  await adminPage.locator('#f-slug').fill('verification-only');
  await adminPage.locator('#f-desc').fill('記事投稿テンプレートの検証用説明文です。');
  await adminPage.locator('#f-body').fill('## 検証用見出し\n\n検証用の本文です。');
  await adminPage.locator('#btn-gen').click();
  await adminPage.locator('#out:not([hidden])').waitFor();
  await adminPage.evaluate(() => {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      window.__verificationArticleBlob = blob;
      return originalCreateObjectURL(blob);
    };
  });
  await adminPage.locator('#btn-dl').evaluate(button => button.click());
  const generatedArticle = await adminPage.evaluate(() => window.__verificationArticleBlob.text());
  const expectedTemplateFragments = ['../services.html', '../pricing.html', '../support.html', '../about.html', 'skin-v2.css?v=20260723-split1', 'href="#" class="to-top"'];
  const templateMissing = expectedTemplateFragments.filter(fragment => !generatedArticle.includes(fragment));
  if (templateMissing.length || /index\.html#(?:services|pricing|cases|about)|16◯/.test(generatedArticle) || adminErrors.length) {
    failures.push(`記事投稿テンプレート: ${JSON.stringify({ templateMissing, adminErrors })}`);
  }
  results.push({ articleTemplate: 'generated', requiredLinks: expectedTemplateFragments.length - templateMissing.length, errors: adminErrors.length });
  await adminPage.close();

  const editPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await editPage.addInitScript(() => {
    window.omelette = { writeFile: () => Promise.resolve() };
  });
  await editPage.goto(base, { waitUntil: 'load' });
  const editSlot = editPage.locator('#home-svc-kisoku');
  await editSlot.scrollIntoViewIfNeeded();
  await editSlot.click();
  const editState = await editSlot.evaluate(slot => ({
    editable: slot.hasAttribute('data-editable'),
    fit: slot.getAttribute('fit'),
    path: location.pathname,
  }));
  const coverSlot = editPage.locator('#home-why-main');
  await coverSlot.scrollIntoViewIfNeeded();
  await coverSlot.dblclick();
  const coverReframe = await coverSlot.evaluate(slot => slot.hasAttribute('data-reframe'));
  if (!editState.editable || editState.fit !== 'contain' || !/\/$/.test(editState.path) || !coverReframe) {
    failures.push(`編集画面: 画像の差し替え・手調整が機能しません ${JSON.stringify({ ...editState, coverReframe })}`);
  }
  results.push({ linkedImageEditable: editState.editable, linkedImageStayedOnHome: /\/$/.test(editState.path), coverImageReframe: coverReframe });
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
  const sweepWidths = [360, 390, 430, 640, 768, 900, 1024, 1200, 1440, 1560, 1920, 2560];
  const sweepPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const width of sweepWidths) {
    await sweepPage.setViewportSize({ width, height: width <= 430 ? 844 : width <= 768 ? 1024 : width <= 1440 ? 900 : 1200 });
    for (const rel of publicPages) {
      const errors = [];
      sweepPage.removeAllListeners('console');
      sweepPage.removeAllListeners('pageerror');
      sweepPage.on('console', recordConsoleError(errors));
      sweepPage.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
      const response = await sweepPage.goto(new URL(rel, base).href, { waitUntil: 'load' });
      await sweepPage.evaluate(async () => {
        const targets = [...document.querySelectorAll('main > *, footer')];
        if (!targets.length) targets.push(document.body);
        for (const target of targets) {
          target.scrollIntoView({ block: 'center' });
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        scrollTo(0, 0);
      });
      await sweepPage.waitForTimeout(60);
      const state = await sweepPage.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        brokenImages: [...document.images].filter(img => img.complete && img.naturalWidth === 0).map(img => img.currentSrc || img.src),
      }));
      if (!response?.ok()) failures.push(`${rel}: HTTP ${response?.status() || '応答なし'}`);
      if (state.overflow > 1) failures.push(`${rel}: ${width}px幅で横はみ出し ${state.overflow}px`);
      if (state.brokenImages.length) failures.push(`${rel}: ${width}px幅で画像読込失敗 ${state.brokenImages.join(', ')}`);
      if (errors.length) failures.push(`${rel}: ${width}px幅 ${errors.join(' / ')}`);
    }
  }
  results.push({ pageSweep: publicPages.length, viewports: sweepWidths.length, conditions: publicPages.length * sweepWidths.length });
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
  console.log('画面検証合格: 全公開ページ×12画面幅、主要導線、料金計算機、記事テンプレート、SPA遷移を確認しました。');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
