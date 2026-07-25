const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.argv[2] || 'http://127.0.0.1:8765/';
const viewports = [
  { width: 360, height: 844 },
  { width: 390, height: 844 },
  { width: 430, height: 844 },
  { width: 640, height: 900 },
  { width: 768, height: 1024 },
  { width: 900, height: 900 },
  { width: 1024, height: 900 },
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
    const state = await page.evaluate(() => {
      const rect = el => el?.getBoundingClientRect();
      const aboutPhoto = rect(document.querySelector('.home-about-photo'));
      const aboutCopy = rect(document.querySelector('.home-about-copy'));
      const whyPhoto = rect(document.querySelector('.home-why-photo'));
      const footerLinks = [...document.querySelectorAll('.footer-ul a')];
      const summaryColumns = getComputedStyle(document.querySelector('.hs-inner')).gridTemplateColumns.split(' ').filter(Boolean).length;
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        heroHeight: Math.round(rect(document.querySelector('.hero'))?.height || 0),
        heroImage: document.querySelector('.hero-media img')?.currentSrc || '',
        asyncCssMedia: document.querySelector('link[data-async-style]')?.media || '',
        stateRequests: performance.getEntriesByType('resource').filter(r => r.name.includes('.image-slots.state.json')).length,
        googleFontRequests: performance.getEntriesByType('resource').filter(r => /fonts\.(googleapis|gstatic)\.com/.test(r.name)).length,
        summaryColumns,
        planListDisplay: getComputedStyle(document.querySelector('.home-plan-list')).display,
        planFeatureDisplay: getComputedStyle(document.querySelector('.home-plan-feature')).display,
        aboutPhotoWidth: Math.round(aboutPhoto?.width || 0),
        aboutCopyFirst: !!(aboutPhoto && aboutCopy && aboutCopy.top < aboutPhoto.top),
        whyPhotoWidth: Math.round(whyPhoto?.width || 0),
        footerTapMin: Math.min(...footerLinks.map(link => Math.round(rect(link)?.height || 0))),
        footerFontSize: Number.parseFloat(getComputedStyle(footerLinks[0]).fontSize),
        faqWrap: getComputedStyle(document.querySelector('.faq-q-text')).textWrap,
        faqWordBreak: getComputedStyle(document.querySelector('.faq-q-text')).wordBreak,
        protectedPlan: !![...document.querySelectorAll('.faq-q-text .nobr')].find(el => el.textContent === 'プラン'),
        footerObserver: !!window.__footerUiObserver,
        catUiCount: document.querySelectorAll('.mn-mascot,.mn-recall,.pv-paws').length,
      };
    });
    if (state.overflow > 1) failures.push(`${viewport.width}px: 横はみ出し ${state.overflow}px`);
    if (state.heroHeight < 500) failures.push(`${viewport.width}px: ヒーロー高さが不正 ${state.heroHeight}px`);
    if (state.asyncCssMedia !== 'all') failures.push(`${viewport.width}px: 全量CSSが有効化されていません`);
    if (state.stateRequests) failures.push(`${viewport.width}px: 編集用JSONを${state.stateRequests}回取得しています`);
    if (state.googleFontRequests) failures.push(`${viewport.width}px: Google Fontsを取得しています`);
    if (!state.footerObserver) failures.push(`${viewport.width}px: 固定UIのObserverが初期化されていません`);
    if (state.catUiCount) failures.push(`${viewport.width}px: 撤去済みの猫UIが残っています`);
    if (viewport.width <= 640) {
      if (state.summaryColumns !== 2) failures.push(`${viewport.width}px: ヒーロー直下サマリーが2列ではありません`);
      if (state.planListDisplay !== 'none' || state.planFeatureDisplay === 'none') failures.push(`${viewport.width}px: スマホ料金カードの情報量が不正です`);
      if (state.aboutPhotoWidth < 220 || state.aboutPhotoWidth > 240 || !state.aboutCopyFirst) failures.push(`${viewport.width}px: 事務所案内の順序・画像幅が不正です`);
      if (state.whyPhotoWidth < 230 || state.whyPhotoWidth > 250) failures.push(`${viewport.width}px: 理念イラストの画像幅が不正です（${state.whyPhotoWidth}px）`);
      if (state.footerTapMin < 32 || state.footerFontSize < 13) failures.push(`${viewport.width}px: フッターリンクの文字・タップ領域が不足しています`);
      if (state.faqWrap !== 'pretty' || state.faqWordBreak !== 'auto-phrase' || !state.protectedPlan) failures.push(`${viewport.width}px: FAQの日本語改行保護が不正です`);
    }
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

  const approachPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await approachPage.goto(new URL('services.html', base).href, { waitUntil: 'load' });
  const approachLinks = await approachPage.locator('.how-grid .how-card').evaluateAll(cards => cards.map(card => ({
    href: card.getAttribute('href'),
    title: card.querySelector('.hc-title')?.textContent.trim() || '',
  })));
  const expectedApproachLinks = [
    'uploads/service-joseikin.html',
    'uploads/service-kyuyo-keisan.html',
    'uploads/service-dx.html',
  ];
  if (JSON.stringify(approachLinks.map(card => card.href)) !== JSON.stringify(expectedApproachLinks)) {
    failures.push(`サービス支援カード: リンク先が不正 ${JSON.stringify(approachLinks)}`);
  }
  results.push({ approachLinks });
  await approachPage.close();

  const supportCardResults = [];
  for (const width of [390, 1200, 1440]) {
    const supportPage = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    await supportPage.goto(new URL('support.html', base).href, { waitUntil: 'load' });
    const supportCards = await supportPage.locator('.proc-title').evaluateAll(titles => titles.map(title => {
      const style = getComputedStyle(title);
      return {
        title: title.textContent.trim(),
        overflow: Math.round(title.scrollWidth - title.clientWidth),
        height: Math.round(title.getBoundingClientRect().height),
        lineHeight: Number.parseFloat(style.lineHeight) || 0,
        whiteSpace: style.whiteSpace,
      };
    }));
    const pageOverflow = await supportPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const badCards = supportCards.filter(card => card.overflow > 1 || card.whiteSpace !== 'nowrap' || (card.lineHeight && card.height > card.lineHeight * 1.2));
    if (badCards.length || pageOverflow > 1) {
      failures.push(`${width}px 支援手順カード: 改行・横はみ出しが不正 ${JSON.stringify({ badCards, pageOverflow })}`);
    }
    supportCardResults.push({ width, cards: supportCards, pageOverflow });
    await supportPage.close();
  }
  results.push({ supportCards: supportCardResults });

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
  const pricingStructure = await simulatorPage.evaluate(() => {
    const rowText = Array.from(document.querySelectorAll('#retainer-extra-fees .sf-row, #spot-fees .sf-row'))
      .map(row => row.textContent.replace(/\s+/g, ' ').trim())
      .join('\n');
    const basicText = document.getElementById('plan-basic')?.textContent.replace(/\s+/g, ' ').trim() || '';
    const planText = document.querySelector('.price-grid')?.textContent.replace(/\s+/g, ' ').trim() || '';
    const retainerText = document.getElementById('retainer-extra-fees')?.textContent.replace(/\s+/g, ' ').trim() || '';
    const spotText = document.getElementById('spot-fees')?.textContent.replace(/\s+/g, ' ').trim() || '';
    return { rowText, basicText, planText, retainerText, spotText };
  });
  const forbiddenPriceRows = [
    '就業規則の新規作成・全面改定',
    '人事・賃金・評価制度',
    '労基署、年金事務所の調査対応',
    '勤怠・給与システム導入',
    '複雑な労災',
    '第三者行為',
    '障害・遺族給付',
  ].filter(term => pricingStructure.rowText.includes(term));
  const includedRetainerItems = ['出産手当金', '育児休業', '介護休業', '高年齢雇用継続給付']
    .filter(term => pricingStructure.basicText.includes(term));
  const ambiguousPriceTerms = ['お見積もり', '要相談']
    .filter(term => `${pricingStructure.planText} ${pricingStructure.rowText}`.includes(term));
  const rangedPriceRows = Array.from(pricingStructure.rowText.matchAll(/¥[^ ]*〜/g), match => match[0]);
  const pricingRulesOk =
    /31名以上プラン.*¥87,000.*¥107,500/.test(pricingStructure.planText) &&
    /労災発生時の初動相談.*労働者死傷病報告/.test(pricingStructure.basicText) &&
    /会社設立時の新規適用手続き.*¥30,000.*5名まで.*6名目から1名¥1,000/.test(pricingStructure.retainerText) &&
    /労働保険の年度更新.*基本 ¥12,500＋対象者1名¥500/.test(pricingStructure.retainerText) &&
    /社会保険の算定基礎届.*基本 ¥12,500＋対象者1名¥500/.test(pricingStructure.retainerText) &&
    /傷病手当金.*¥7,500/.test(pricingStructure.retainerText) &&
    /労災保険給付.*¥15,000.*初動相談.*労働者死傷病報告.*定型的な継続申請は顧問料に含まれます/.test(pricingStructure.retainerText) &&
    /賞与支払届.*¥10,000＋対象者1名¥500/.test(pricingStructure.retainerText) &&
    /成功報酬：受給額の15％/.test(pricingStructure.retainerText) &&
    /会社設立時の新規適用手続き.*¥60,000.*5名まで.*6名目から1名¥2,000/.test(pricingStructure.spotText) &&
    /労働保険の年度更新.*基本 ¥25,000＋対象者1名¥1,000/.test(pricingStructure.spotText) &&
    /算定基礎届.*基本 ¥25,000＋対象者1名¥1,000/.test(pricingStructure.spotText) &&
    /賞与支払届.*¥20,000＋対象者1名¥1,000/.test(pricingStructure.spotText) &&
    /成功報酬：受給額の20％/.test(pricingStructure.spotText) &&
    /税理士法上職務外の処理については、提携の税理士に依頼します/.test(pricingStructure.spotText);
  if (forbiddenPriceRows.length || includedRetainerItems.length !== 4 || ambiguousPriceTerms.length || rangedPriceRows.length || !pricingRulesOk) {
    failures.push(`料金体系: 指示内容との不整合 ${JSON.stringify({ forbiddenPriceRows, includedRetainerItems, ambiguousPriceTerms, rangedPriceRows, pricingRulesOk })}`);
  }
  results.push({ pricingStructure: { forbiddenPriceRows, includedRetainerItems, ambiguousPriceTerms, rangedPriceRows, pricingRulesOk } });
  await simulatorPage.locator('#simulator > summary').click();
  await simulatorPage.waitForTimeout(350);
  await simulatorPage.locator('#ksEmpN').fill('8');
  await simulatorPage.locator('label:has(#ksPayroll)').click();
  const simulatorState = await simulatorPage.evaluate(() => ({
    price: document.getElementById('ksPrice')?.textContent.trim() || '',
    plan: document.getElementById('ksBreak')?.textContent.trim() || '',
    year: document.getElementById('ksYear')?.textContent.trim() || '',
    grantControls: document.querySelectorAll('.ks-q, #ksCount, #ksTotal').length,
    grantText: /助成金/.test(document.getElementById('simulator')?.textContent || ''),
  }));
  if (!/¥55,000/.test(simulatorState.price) || !/スタンダードプラン/.test(simulatorState.plan) || !/¥660,000/.test(simulatorState.year) || simulatorState.grantControls !== 0 || simulatorState.grantText) {
    failures.push(`料金シミュレーター: 計算結果が不正 ${JSON.stringify(simulatorState)}`);
  }
  await simulatorPage.locator('#ksEmpN').fill('31');
  const largeCompanyState = await simulatorPage.evaluate(() => ({
    price: document.getElementById('ksPrice')?.textContent.trim() || '',
    plan: document.getElementById('ksBreak')?.textContent.trim() || '',
    year: document.getElementById('ksYear')?.textContent.trim() || '',
  }));
  if (!/お見積もり/.test(largeCompanyState.price) || !/31名以上/.test(largeCompanyState.plan) || largeCompanyState.year) {
    failures.push(`料金シミュレーター: 31名以上の見積もり表示が不正 ${JSON.stringify(largeCompanyState)}`);
  }
  await simulatorPage.locator('#ksEmpN').fill('50');
  const fiftyEmployeeState = await simulatorPage.evaluate(() => ({
    price: document.getElementById('ksPrice')?.textContent.trim() || '',
    plan: document.getElementById('ksBreak')?.textContent.trim() || '',
    year: document.getElementById('ksYear')?.textContent.trim() || '',
  }));
  if (!/お見積もり/.test(fiftyEmployeeState.price) || !/31名以上/.test(fiftyEmployeeState.plan) || fiftyEmployeeState.year) {
    failures.push(`料金シミュレーター: 50名の見積もり表示が不正 ${JSON.stringify(fiftyEmployeeState)}`);
  }
  await simulatorPage.locator('#ksEmpN').fill('8');
  await simulatorPage.locator('.ks-cta').click();
  await simulatorPage.waitForFunction(() => location.pathname.endsWith('/uploads/contact.html') && new URLSearchParams(location.search).get('from') === 'sim', null, { timeout: 10000 });
  await simulatorPage.locator('#optionalDetails > summary').click();
  await simulatorPage.waitForTimeout(250);
  const contactInitial = await simulatorPage.evaluate(() => {
    const details = document.getElementById('optionalDetails');
    const note = document.getElementById('contactNote');
    const privacy = document.querySelector('.privacy-consent');
    const timeField = document.getElementById('contactTimeField');
    const restoredIds = ['advKomon', 'ctxTetsuduki', 'advKyuyoKanri', 'softCheckboxes', 'ctxWorkload'];
    const expectedQuestionSelectors = {
      name: '#name',
      company: '#company',
      email: '#email',
      phone: '#tel',
      initialMessage: '#message',
      industry: '#industryCheckboxes input[type="checkbox"]',
      employeeCount: 'input[name="size"]',
      currentLaborConsultant: 'input[name="adv_komon"]',
      procedureMethod: 'input[name="ctx_tetsuduki"]',
      payrollAttendanceMethod: 'input[name="adv_kyuyo_kanri"]',
      software: '#softCheckboxes input[type="checkbox"]',
      softwareOther: 'input[name="soft_other"]',
      softwareCost: 'input[name="ctx_bo_cost"]',
      monthlyWorkload: 'input[name="ctx_workload"]',
      consultationTrigger: '#ctxTrigger input[type="checkbox"]',
      consultationCategory: '#serviceCheckboxes input[type="checkbox"]',
      subsidyWagePlan: 'input[name="br_jose_chinage"]',
      subsidyInvestment: 'input[name="br_jose_setsubi"]',
      subsidyInvestmentDetail: 'input[name="br_jose_setsubi_naiyo"]',
      workRulesStatus: 'input[name="br_kisoku_umu"]',
      workRulesRevision: 'input[name="br_kisoku_kaitei"]',
      payrollOwner: 'input[name="br_kyuyo_tantou"]',
      procedureFrequency: 'input[name="br_shaho_hindo"]',
      burdensomeProcedures: '#brShahoTema input[type="checkbox"]',
      laborConcerns: '#brRomuKanshin input[type="checkbox"]',
      retainerBackground: 'input[name="br_komon_haikei"]',
      contactMethod: 'input[name="pref_contact"]',
      contactDay: 'input[name="pref_day"]',
      contactTime: 'input[name="pref_time"]',
      finalNote: '#contactNote',
    };
    const missingQuestionSelectors = Object.entries(expectedQuestionSelectors)
      .filter(([, selector]) => !document.querySelector(selector))
      .map(([name]) => name);
    return {
      simPrefill: document.getElementById('message')?.value || '',
      detailsSummary: details?.querySelector('summary')?.textContent.replace(/\s+/g, ' ').trim() || '',
      questionInventoryCount: Object.keys(expectedQuestionSelectors).length,
      missingQuestionSelectors,
      optionalStepCount: details?.querySelectorAll('.optional-step-heading').length || 0,
      restoredQuestionsVisible: restoredIds.every(id => {
        const el = document.getElementById(id);
        return !!el && el.getBoundingClientRect().height > 0;
      }),
      branchQuestionsEnabled: document.getElementById('branchBlocks')?.hidden === false,
      finalNoteAfterDetails: !!(details && note && (details.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)),
      finalNoteBeforePrivacy: !!(note && privacy && (note.compareDocumentPosition(privacy) & Node.DOCUMENT_POSITION_FOLLOWING)),
      timeInitiallyHidden: !!timeField?.hidden,
      contactMethodVisible: !!document.querySelector('input[name="pref_contact"]:not([disabled])') &&
        document.querySelector('input[name="pref_contact"]')?.getBoundingClientRect().height > 0,
    };
  });
  await simulatorPage.locator('input[name="pref_contact"][value="電話"]').check();
  await simulatorPage.waitForFunction(() => !document.getElementById('contactTimeField')?.hidden);
  await simulatorPage.locator('input[name="pref_day"][value="土曜日"]').check();
  await simulatorPage.locator('input[name="pref_time"][value="15:00〜18:00"]').check();
  await simulatorPage.locator('input[name="pref_contact"][value="メール"]').check();
  const contactPreferenceState = await simulatorPage.evaluate(() => ({
    timeHiddenForEmail: !!document.getElementById('contactTimeField')?.hidden,
    timeSelectionCleared: !document.querySelector('input[name="pref_time"]:checked'),
    daySelectionCleared: !document.querySelector('input[name="pref_day"]:checked'),
  }));
  const contactFormOk =
    /料金シミュレーター/.test(contactInitial.simPrefill) &&
    /任意/.test(contactInitial.detailsSummary) &&
    /初回相談を具体的にするための質問/.test(contactInitial.detailsSummary) &&
    /顧問社労士の有無/.test(contactInitial.detailsSummary) &&
    contactInitial.questionInventoryCount === 30 &&
    contactInitial.missingQuestionSelectors.length === 0 &&
    contactInitial.optionalStepCount === 3 &&
    contactInitial.restoredQuestionsVisible &&
    contactInitial.branchQuestionsEnabled &&
    contactInitial.finalNoteAfterDetails &&
    contactInitial.finalNoteBeforePrivacy &&
    contactInitial.timeInitiallyHidden &&
    contactInitial.contactMethodVisible &&
    contactPreferenceState.timeHiddenForEmail &&
    contactPreferenceState.timeSelectionCleared &&
    contactPreferenceState.daySelectionCleared;
  if (!contactFormOk) {
    failures.push(`問い合わせフォーム: 導線・任意項目・連絡希望の表示が不正 ${JSON.stringify({ contactInitial, contactPreferenceState })}`);
  }
  let submittedContactPayload = null;
  await simulatorPage.route('https://formsubmit.co/**', async route => {
    try {
      submittedContactPayload = JSON.parse(route.request().postData() || '{}');
    } catch {
      submittedContactPayload = {};
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await simulatorPage.locator('#name').fill('検証 太郎');
  await simulatorPage.locator('#company').fill('検証株式会社');
  await simulatorPage.locator('#email').fill('verification@example.com');
  await simulatorPage.locator('#tel').fill('090-0000-0000');
  await simulatorPage.locator('#industryCheckboxes input[type="checkbox"]').first().check();
  await simulatorPage.locator('input[name="size"]').first().check();
  await simulatorPage.locator('#contactNote').fill('平日16時以降の電話を希望します。');
  await simulatorPage.locator('input[name="adv_komon"][value="いない"]').check();
  await simulatorPage.locator('input[name="ctx_tetsuduki"][value="自社で電子申請"]').check();
  await simulatorPage.locator('input[name="adv_kyuyo_kanri"]').first().check();
  await simulatorPage.locator('#softCheckboxes input[type="checkbox"]').first().check();
  await simulatorPage.locator('input[name="soft_other"]').fill('検証用ソフト');
  await simulatorPage.locator('input[name="ctx_bo_cost"]').first().check();
  await simulatorPage.locator('input[name="ctx_workload"]').first().check();
  await simulatorPage.locator('#ctxTrigger input[type="checkbox"]').first().check();
  await simulatorPage.locator('#serviceCheckboxes input[type="checkbox"]').evaluateAll(inputs => {
    inputs.forEach(input => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await simulatorPage.waitForFunction(() =>
    Array.from(document.querySelectorAll('.branch-block')).every(block => block.style.display !== 'none')
  );
  await simulatorPage.locator('input[name="br_jose_chinage"]').first().check();
  await simulatorPage.locator('input[name="br_jose_setsubi"]').first().check();
  await simulatorPage.locator('input[name="br_jose_setsubi_naiyo"]').fill('検証用設備');
  await simulatorPage.locator('input[name="br_kisoku_umu"]').first().check();
  await simulatorPage.locator('input[name="br_kisoku_kaitei"]').fill('2024-04');
  await simulatorPage.locator('input[name="br_kyuyo_tantou"]').first().check();
  await simulatorPage.locator('input[name="br_shaho_hindo"]').first().check();
  await simulatorPage.locator('#brShahoTema input[type="checkbox"]').first().check();
  await simulatorPage.locator('#brRomuKanshin input[type="checkbox"]').first().check();
  await simulatorPage.locator('input[name="br_komon_haikei"]').first().check();
  await simulatorPage.locator('input[name="pref_contact"][value="電話"]').check();
  await simulatorPage.locator('input[name="pref_day"][value="日曜日"]').check();
  await simulatorPage.locator('input[name="pref_time"][value="15:00〜18:00"]').check();
  await simulatorPage.locator('#privacy').check();
  await simulatorPage.locator('#contactForm .form-submit').click();
  await simulatorPage.locator('#formSuccess').waitFor({ state: 'visible' });
  const expectedContactPayloadKeys = [
    'お名前',
    '会社名',
    'メール',
    '電話番号',
    '業種',
    '従業員数',
    '顧問社労士の有無',
    '入退社などの手続きの処理方法',
    '給与勤怠の管理方法',
    '導入ソフト',
    'ソフトサービスの月額費用',
    '事務作業の毎月の負担',
    'ご相談のきっかけ',
    'ご相談内容',
    '希望の連絡方法',
    '電話してよい曜日',
    'つながりやすい時間帯',
    'ご質問',
    '補足・連絡事項',
    '【助成金】賃上げ予定',
    '【助成金】設備投資',
    '【就業規則】有無',
    '【給与計算】担当者',
    '【社会保険】入退社の頻度',
    '【社会保険】手間に感じている手続き',
    '【労務相談】気になっていること',
    '【顧問契約】検討の背景',
  ];
  const missingContactPayloadKeys = expectedContactPayloadKeys
    .filter(key => !Object.prototype.hasOwnProperty.call(submittedContactPayload || {}, key));
  const contactPayloadOk =
    missingContactPayloadKeys.length === 0 &&
    submittedContactPayload?.['希望の連絡方法'] === '電話' &&
    submittedContactPayload?.['電話してよい曜日'] === '日曜日' &&
    submittedContactPayload?.['つながりやすい時間帯'] === '15:00〜18:00' &&
    submittedContactPayload?.['顧問社労士の有無'] === 'いない' &&
    submittedContactPayload?.['入退社などの手続きの処理方法'] === '自社で電子申請' &&
    submittedContactPayload?.['補足・連絡事項'] === '平日16時以降の電話を希望します。';
  if (!contactPayloadOk) {
    failures.push(`問い合わせフォーム: 送信内容への反映が不正 ${JSON.stringify(submittedContactPayload)}`);
  }
  results.push({ contactForm: { ...contactInitial, ...contactPreferenceState, ok: contactFormOk } });
  results.push({ contactPayload: { ok: contactPayloadOk, expectedKeys: expectedContactPayloadKeys.length, missingContactPayloadKeys } });
  results.push({ simulator: simulatorState, largeCompanyState, fiftyEmployeeState, contactParameter: 'from=sim' });
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
  const expectedTemplateFragments = [
    '../services.html',
    '../pricing.html',
    '../support.html',
    '../about.html',
    'page-enter.js?v=20260725-nocat1',
    'skin-v2.css?v=20260725-nocat1',
    'link-keep.js?v=20260723-conversion1',
    'data-goatcounter-settings="{&quot;path&quot;:&quot;/blog/verification-only.html&quot;}"',
    'href="#" class="to-top"',
  ];
  const templateMissing = expectedTemplateFragments.filter(fragment => !generatedArticle.includes(fragment));
  if (templateMissing.length || /index\.html#(?:services|pricing|cases|about)|16◯|mascot\.js/.test(generatedArticle) || adminErrors.length) {
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
  const upperGuidePages = publicPages.filter(rel =>
    /\bclass=(["'])[^"']*\b(?:hub-snapshot|hub-intro-nav)\b[^"']*\1/.test(
      fs.readFileSync(path.join(process.cwd(), rel), 'utf8'),
    ),
  );
  if (upperGuidePages.length) {
    failures.push(`撤去済みのページ上部案内帯が再配置されています: ${upperGuidePages.join(', ')}`);
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
        brokenImages: [...document.images]
          .filter(img => img.complete && img.naturalWidth === 0)
          .map(img => img.currentSrc || img.src),
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
