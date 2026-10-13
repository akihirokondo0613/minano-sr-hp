/**
 * 新トップ（環水公園の写真ヒーロー＋情報配置）の回帰テスト。
 * 旧 test-home-hero.cjs（人物イラストが動くヒーロー用）の置き換え。
 *
 * 実行:
 *   node scripts/test-home-top.cjs [base] [--json]
 *
 * 検査の約束事（マークアップ契約）:
 *   section.hero#top > .hero-stage > picture.hero-media（img は fetchpriority="high"）、
 *   .hero-overlay > .hero-label / h1.hero-h1 / p.hero-sub、nav.hero-panel（.hp-group×2・a.hp-link・a.btn-primary）、
 *   #notice / #pickup（#pk-rail・#pk-nav .pk-arrow）/ #services（タブ）/ #cases / #help / #pricing / #tools /
 *   #about（内に #why）/ #faq / #news（タブ）。旧アンカー #top #tools #why #services #cases #pricing #faq #news #about を維持。
 *
 * 判定の方針:
 *   - 幅 320/390/768/1024/1440/1920 × Chromium/WebKit。
 *   - 横はみ出しは documentElement.scrollWidth だけでなく、要素矩形（スクロール箱の外に出た要素）でも測る。
 *     isMobile 幅では scrollWidth が viewport に張り付いて隠れるため（旧テストで WebKit だけ失敗した実績）。
 *   - 書式ギャラリー（#tools）の操作・内容は旧テストの判定をそのまま引き継ぐ（幅 320/390/900/901/1280）。
 *   - 2エンジンは並列に走らせる（各エンジン内は1ページずつ）。判定条件は変えない。
 */

const { chromium, webkit } = require('playwright');
const { isForeignConsoleError } = require('./lib/console-origin.cjs');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const asJson = args.includes('--json');

const WIDTHS = [320, 390, 768, 1024, 1440, 1920];
const GALLERY_WIDTHS = [320, 390, 900, 901, 1280];
const ALL_WIDTHS = [...new Set([...WIDTHS, ...GALLERY_WIDTHS])].sort((a, b) => a - b);
// 既定は両エンジン。開発中の確認だけ --engines=chromium で絞れる（最終確認は必ず既定の両エンジン）。
const engineOption = (args.find((arg) => arg.startsWith('--engines=')) || '').slice('--engines='.length);
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
].filter(([name]) => !engineOption || engineOption.split(',').includes(name));
const EPSILON = 1;
const TARGET_MIN = 24; // WCAG 2.2 AA の最小ターゲットサイズ
const EXPECTED_SERVICE_TABS = 6;
const LEGACY_ANCHORS = ['top', 'tools', 'why', 'services', 'cases', 'pricing', 'faq', 'news', 'about'];
const CONTRACT_ANCHORS = ['notice', 'pickup', 'help'];
// 廃止した旧トップの部品。再導入されたら失敗にする。
const REMOVED_SELECTORS = [
  '.hero-actor', '.hero-scene', '[class*="hero-plaza"]', '#home-hero-init', '.home-shortcuts',
  '#tp-rail', '#tp-nav', '.tp-card', '.pen-layer', '.hero-pending',
  'link[href*="home-hero"]', 'script[src*="home-hero"]',
];

const COMMON_FORM_PREVIEWS = require('../data/shoshiki/common_previews.json');
const FORM_GALLERY_KEYS = [
  'onboarding', 'labor-notice', 'retirement', 'leave', 'guide',
  'personal', 'bank', 'commute', 'emergency', 'establishment',
  ...COMMON_FORM_PREVIEWS.map((form) => form.no),
];
const FORM_GALLERY_PREVIEWS = [
  'assets/previews/procedure-onboarding-sample.webp',
  'assets/previews/labor-notice-sample.webp',
  'assets/previews/procedure-retirement-sample.webp',
  'assets/previews/procedure-leave-sample.webp',
  'assets/previews/onboarding-guide-preview.webp',
  'assets/previews/onboarding-personal-sample-v2.webp',
  'assets/previews/onboarding-bank-sample.webp',
  'assets/previews/onboarding-commute-sample.webp',
  'assets/previews/onboarding-emergency-sample-v2.webp',
  'assets/previews/procedure-establishment-sample.webp',
  ...COMMON_FORM_PREVIEWS.map((form) => form.preview),
];
const FORM_GALLERY_DOWNLOADS = [
  'assets/download/procedure-onboarding.pdf',
  'assets/download/onboarding-kit/labor-notice.xlsx',
  'assets/download/procedure-retirement.pdf',
  'assets/download/procedure-leave.pdf',
  'assets/download/onboarding-kit/guide.pdf',
  'assets/download/onboarding-kit/personal.pdf',
  'assets/download/onboarding-kit/bank.pdf',
  'assets/download/onboarding-kit/commute.pdf',
  'assets/download/onboarding-kit/emergency.pdf',
  'assets/download/procedure-establishment.pdf',
  ...COMMON_FORM_PREVIEWS.map((form) => `shoshiki/${form.no}.html`),
];
const UPGRADE_INSECURE_META =
  /<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">/gi;

async function prepareLocalHttpPage(page) {
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'http:') return;

  // WebKitはローカルHTTPでもupgrade-insecure-requestsを適用し、相対CSSをHTTPS化する。
  // 本番は元からHTTPSなので、検査時のdocumentレスポンスだけmetaを除いて同じCSSを読ませる。
  await page.route(`${baseUrl.origin}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({ response, body: html.replace(UPGRADE_INSECURE_META, '') });
  });
}

// 全量CSSの非同期読込（link[data-async-style]）を待つ。ローカルHTTPのWebKitでは onload が
// 発火しないことがあるため、1.5秒待って有効化されなければ media を直接戻す。
async function settlePage(page) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('link[data-async-style]')].every((link) => link.media === 'all'),
      null,
      { timeout: 1500 },
    );
  } catch {
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('link[data-async-style]')) link.media = 'all';
    });
  }
  await page.addStyleTag({ content: `
    html { scroll-behavior: auto !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; }
    .rv, .rvl { opacity: 1 !important; transform: none !important; }
    main > section { content-visibility: visible !important; }
  ` });
  await page.evaluate(() => document.fonts.ready);
}

async function checkFormGallery(page, engine, width, failures) {
  const report = { previews: [], selections: [], links: [], errors: [] };
  const label = `${engine}@${width}px 書式 gallery`;
  try {
    if (await page.locator('#tools').count() !== 1) return report;
    const cards = page.locator('#tools .fg-rail > .fg-item:not(.fg-copy)');
    if (await cards.count() !== FORM_GALLERY_PREVIEWS.length) return report;
    // 移動中の見本をスクロール測定しないよう、利用者向けの一時停止操作で止める。
    const pause = page.locator('#tools .fg-pause');
    // 書式ギャラリーは近づいてから読み込む（IntersectionObserver）。料金の下にあるので先に寄せる。
    await page.locator('#tools .fg-gallery').scrollIntoViewIfNeeded({ timeout: 10000 });
    await pause.waitFor({ state: 'visible', timeout: 10000 });
    if (await pause.getAttribute('aria-pressed') !== 'true') {
      await pause.click({ timeout: 10000 });
    }
    if (await pause.getAttribute('aria-pressed') !== 'true') {
      throw new Error('見本の自動送りを一時停止できません');
    }
    const clones = await page.locator('#form-gallery-rail .fg-copy').evaluateAll((elements) => ({
      count: elements.length,
      interactive: elements.filter((element) => element.getAttribute('aria-hidden') !== 'true'
        || element.id || element.querySelector('[id]')
        || [...element.querySelectorAll('a')].some((link) => link.tabIndex >= 0)).length,
    }));
    if (clones.count !== FORM_GALLERY_KEYS.length * 2 || clones.interactive !== 0) {
      failures.push(`${label}: ループ用複製の件数・Tab移動除外が不正です (${JSON.stringify(clones)})`);
    }
    // lazy画像は利用者と同じく各見本へスクロールして読み込む。srcや読込状態を
    // 検査側で書き換えず、ページの実際の読込処理を確認する。
    for (let index = 0; index < FORM_GALLERY_PREVIEWS.length; index += 1) {
      const card = cards.nth(index);
      if (index >= 10) {
        const key = FORM_GALLERY_KEYS[index];
        const selection = page.locator(`#tools .fg-picker a[data-fg-select="${key}"]`);
        // 全32の名称一覧から、画面外のHTML書式へ移動できることを確認する。
        // 最後の書式はEnterでも選択し、マウスだけに依存させない。
        if (index === FORM_GALLERY_PREVIEWS.length - 1) {
          await selection.focus();
          await selection.press('Enter');
        } else await selection.click({ timeout: 10000 });
        const selected = await card.evaluate((element) => {
          const rail = element.closest('.fg-rail');
          const rect = element.getBoundingClientRect();
          const railRect = rail.getBoundingClientRect();
          return { key: element.dataset.fgKey, left: rect.left, right: rect.right,
            railLeft: railRect.left, railRight: railRect.right,
            focused: document.activeElement === element.querySelector('a') };
        });
        report.selections.push(selected);
        if (selected.key !== key || !selected.focused
          || selected.left < selected.railLeft - EPSILON
          || selected.right > selected.railRight + EPSILON
          || await pause.getAttribute('aria-pressed') !== 'true'
          || await selection.getAttribute('aria-current') !== 'true') {
          failures.push(`${label}: ${key}を名称一覧から表示/選択できません (${JSON.stringify(selected)})`);
        }
      } else await card.scrollIntoViewIfNeeded({ timeout: 10000 });
      const image = card.locator('.fg-paper > img');
      if (await image.count() !== 1) {
        failures.push(`${label}: 見本${index + 1}の画像が1枚ではありません`);
        continue;
      }
      const handle = await image.elementHandle();
      try {
        await page.waitForFunction((element) => element.complete
          && element.naturalWidth > 0 && element.naturalHeight > 0,
        handle, { timeout: 10000 });
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        failures.push(`${label}: 見本${index + 1}の画像を読み込めません`);
      } finally {
        await handle.dispose();
      }
      const metrics = await image.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { source: element.currentSrc, complete: element.complete,
          naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight,
          width: rect.width, height: rect.height };
      });
      report.previews.push(metrics);
      if (!metrics.source || new URL(metrics.source).pathname
        !== `/${FORM_GALLERY_PREVIEWS[index]}` || !metrics.complete
        || metrics.naturalWidth <= 0 || metrics.naturalHeight <= 0
        || metrics.width <= 0 || metrics.height <= 0) {
        failures.push(`${label}: 見本${index + 1}の画像/表示寸法が不正です (${JSON.stringify(metrics)})`);
      }
    }
    const firstSelection = page.locator('#tools .fg-picker a[data-fg-select="onboarding"]');
    await firstSelection.click({ timeout: 10000 });
    if (await page.locator('#form-gallery-rail').evaluate((element) => element.scrollLeft) > EPSILON) {
      failures.push(`${label}: 末尾の見本から先頭の入社連絡票へ戻れません`);
    }
    for (const selector of ['.fg-kit-link', '.fg-kit-download']) {
      const link = page.locator(`#tools .fg-kit ${selector}`);
      if (await link.count() !== 1) continue;
      await link.scrollIntoViewIfNeeded({ timeout: 10000 });
      const metrics = await link.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { href: element.getAttribute('href'), left: rect.left, right: rect.right,
          top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
          viewportWidth: document.documentElement.clientWidth, viewportHeight: innerHeight,
          clickable: document.elementFromPoint(rect.left + rect.width / 2,
            rect.top + rect.height / 2)?.closest('a') === element };
      });
      report.links.push({ selector, ...metrics });
      if (metrics.width <= 0 || metrics.height < 44 - EPSILON
        || metrics.left < -EPSILON || metrics.right > metrics.viewportWidth + EPSILON
        || metrics.top < -EPSILON || metrics.bottom > metrics.viewportHeight + EPSILON
        || !metrics.clickable) {
        failures.push(`${label}: 入社セットの${selector}を表示/操作できません (${JSON.stringify(metrics)})`);
      }
    }
  } catch (error) {
    report.errors.push(error.message);
    failures.push(`${label}: ${error.message}`);
  }
  return report;
}

// ---- ここから新トップの検査 -------------------------------------------------

// ページ内で一度に読む測定値。ここでは判定せず、数値だけ返す。
async function measureTop(page) {
  return page.evaluate(({ legacyAnchors, contractAnchors, removedSelectors, eps }) => {
    const vw = document.documentElement.clientWidth;
    const isShown = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height };
    };
    // 文字が実際に描かれる範囲（要素の箱ではなく行の矩形）。幅いっぱいの箱による誤検知を避ける。
    const textBox = (element) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length) return null;
      return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
        top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) };
    };

    // 行ごとの文字数（最終行が1文字だけの泣き別れを拾う）。文字単位の矩形で行を分ける。
    const lineCounts = (element) => {
      if (!element) return [];
      const lines = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let index = 0; index < node.textContent.length; index += 1) {
          if (/\s/.test(node.textContent[index])) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const line = lines.find((item) => Math.abs(item.top - rect.top) < rect.height / 2);
          if (line) line.count += 1; else lines.push({ top: rect.top, count: 1 });
        }
      }
      return lines.sort((a, b) => a.top - b.top).map((item) => item.count);
    };

    const hero = document.querySelector('section.hero#top');
    const picture = document.querySelector('#top .hero-stage picture.hero-media');
    const image = picture?.querySelector('img');
    const preload = document.querySelector('link[rel="preload"][as="image"][type="image/avif"]');
    const h1 = document.querySelector('#top h1.hero-h1');
    const sub = document.querySelector('#top p.hero-sub');
    const panel = document.querySelector('#top nav.hero-panel');
    const label = document.querySelector('#top .hero-overlay .hero-label');
    const primary = panel?.querySelector('a.btn-primary');

    const clipsX = (element) => /(auto|scroll|hidden|clip)/.test(getComputedStyle(element).overflowX);
    const offenders = [];
    for (const element of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= vw + eps && rect.left >= -eps) continue;
      // 完全に画面外へ退避した要素（スキップリンク等）は見えないので対象外。
      if (rect.right <= 0 && /^(absolute|fixed)$/.test(style.position)) continue;
      let clipped = false;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getComputedStyle(parent).display === 'none' || clipsX(parent)) { clipped = true; break; }
      }
      if (clipped) continue;
      const cls = typeof element.className === 'string' ? element.className.trim().replace(/\s+/g, '.') : '';
      offenders.push({ selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${cls ? `.${cls}` : ''}`,
        left: Math.round(rect.left * 100) / 100, right: Math.round(rect.right * 100) / 100 });
      if (offenders.length >= 8) break;
    }

    const panelLinks = [...(panel?.querySelectorAll('a') || [])].map((link) => {
      const rect = link.getBoundingClientRect();
      return { href: link.getAttribute('href') || '', text: link.textContent.trim().replace(/\s+/g, ' '),
        shown: isShown(link), width: rect.width, height: rect.height,
        left: rect.left, right: rect.right, absolute: link.href };
    });

    return {
      viewportWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      offenders,
      h1Count: document.querySelectorAll('h1').length,
      removed: removedSelectors.map((selector) => [selector, document.querySelectorAll(selector).length])
        .filter(([, count]) => count > 0),
      anchors: [...legacyAnchors, ...contractAnchors].map((id) => [id, document.querySelectorAll(`[id="${id}"]`).length]),
      hero: { present: !!hero, box: box(hero), sectionTag: hero?.tagName.toLowerCase() },
      media: {
        pictureShown: isShown(picture), imgShown: isShown(image),
        fetchpriority: image?.getAttribute('fetchpriority') || null,
        loading: image?.getAttribute('loading') || null,
        complete: !!image?.complete, naturalWidth: image?.naturalWidth || 0,
        currentSrc: image?.currentSrc || '', box: box(picture),
        preloadHref: preload?.getAttribute('href') || preload?.getAttribute('imagesrcset') || null,
        preloadFetchpriority: preload?.getAttribute('fetchpriority') || null,
      },
      h1: { shown: isShown(h1), box: box(h1), text: textBox(h1), lines: lineCounts(h1) },
      sub: { shown: isShown(sub), box: box(sub), text: textBox(sub), lines: lineCounts(sub) },
      label: { shown: isShown(label) },
      panel: { shown: isShown(panel), box: box(panel), ariaLabel: panel?.getAttribute('aria-label') || '',
        groups: panel?.querySelectorAll('.hp-group').length || 0,
        links: panelLinks, primaryHref: primary?.getAttribute('href') || null },
      notice: {
        present: !!document.querySelector('section.home-notice#notice'),
        links: document.querySelectorAll('#notice a[href]').length,
      },
    };
  }, { legacyAnchors: LEGACY_ANCHORS, contractAnchors: CONTRACT_ANCHORS, removedSelectors: REMOVED_SELECTORS, eps: EPSILON });
}

function intersects(a, b) {
  if (!a || !b) return false;
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPSILON
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > EPSILON;
}

function judgeTop(label, state, failures) {
  const fail = (message) => failures.push(`${label}: ${message}`);
  const vw = state.viewportWidth;

  if (!state.hero.present || state.hero.sectionTag !== 'section') fail('section.hero#top がありません');
  if (state.h1Count !== 1) fail(`h1 が1つではありません（${state.h1Count}）`);
  for (const [selector, count] of state.removed) fail(`廃止した旧トップの部品が残っています: ${selector} ×${count}`);
  for (const [id, count] of state.anchors) {
    if (count !== 1) fail(`アンカー #${id} が1つではありません（${count}）`);
  }

  // 写真ヒーロー: 表示・LCP属性・preload
  const media = state.media;
  if (!media.pictureShown || !media.imgShown) fail('環水公園の写真ヒーロー（picture.hero-media）が表示されていません');
  if (media.fetchpriority !== 'high') fail(`LCP画像の fetchpriority が high ではありません（${media.fetchpriority}）`);
  if (media.loading === 'lazy') fail('LCP画像が loading=lazy です');
  if (!media.complete || media.naturalWidth <= 0) fail('ヒーロー写真を読み込めていません');
  if (!/\/assets\/photos\/hero-main/.test(media.currentSrc)) fail(`ヒーロー写真の参照先が想定外です（${media.currentSrc}）`);
  if (!media.preloadHref || !/hero-main/.test(media.preloadHref)) fail('ヒーロー写真の avif preload がありません');
  if (media.box && (media.box.left < -EPSILON || media.box.right > vw + EPSILON)) {
    fail(`ヒーロー写真が画面幅からはみ出しています（${media.box.left}〜${media.box.right}/${vw}）`);
  }

  // キャッチ文・案内パネルの表示と、画面幅の中に収まっていること
  for (const [name, item] of [['h1.hero-h1', state.h1], ['p.hero-sub', state.sub]]) {
    if (!item.shown) { fail(`${name} が見えません`); continue; }
    const lastLine = item.lines.at(-1);
    if (!lastLine || lastLine < 2) fail(`${name} の最終行が2文字未満です（行ごとの文字数 ${item.lines.join('/')}）`);
    const area = item.text || item.box;
    if (area.left < -EPSILON || area.right > vw + EPSILON) {
      fail(`${name} の文字が画面幅からはみ出しています（${Math.round(area.left)}〜${Math.round(area.right)}/${vw}）`);
    }
  }
  if (!state.label.shown) fail('.hero-label が見えません');
  if (!state.panel.shown) fail('nav.hero-panel が見えません');
  else {
    if (state.panel.ariaLabel !== 'ご用件から選ぶ') fail(`hero-panel の aria-label が契約と違います（${state.panel.ariaLabel}）`);
    if (state.panel.groups !== 2) fail(`.hp-group が2つではありません（${state.panel.groups}）`);
    if (state.panel.box.left < -EPSILON || state.panel.box.right > vw + EPSILON) {
      fail(`案内パネルが画面幅からはみ出しています（${Math.round(state.panel.box.left)}〜${Math.round(state.panel.box.right)}/${vw}）`);
    }
    // 文字が実際に描かれる範囲どうしが重ならないこと（PCは写真右にパネルが重なる配置）
    if (intersects(state.h1.text, state.panel.box)) fail('見出しの文字と案内パネルが重なっています');
    if (intersects(state.sub.text, state.panel.box)) fail('説明文の文字と案内パネルが重なっています');
    if (state.panel.links.length < 3) fail(`案内パネルのリンクが少なすぎます（${state.panel.links.length}）`);
    for (const link of state.panel.links) {
      if (!link.shown) fail(`案内パネルのリンクが見えません: ${link.text}`);
      else if (link.height < TARGET_MIN - EPSILON || link.width < TARGET_MIN - EPSILON) {
        fail(`案内パネルのリンクが小さすぎます（${Math.round(link.width)}×${Math.round(link.height)}）: ${link.text}`);
      }
      if (!link.text) fail(`案内パネルに名前のないリンクがあります: ${link.href}`);
    }
    let primary;
    try { primary = new URL(state.panel.primaryHref || '', base); } catch { primary = null; }
    if (!primary || !primary.pathname.endsWith('/uploads/contact.html')
      || primary.searchParams.get('from') !== 'hero' || primary.searchParams.get('entry') !== 'home-hero-panel') {
      fail(`無料相談ボタンのリンク先が契約と違います（${state.panel.primaryHref}）`);
    }
  }
  if (!state.notice.present || state.notice.links < 5) {
    fail(`新着情報（#notice）の日付付きリンクが5件未満です（${state.notice.links}）`);
  }

  // 横はみ出し: scrollWidth と要素矩形の両方
  if (state.scrollWidth > vw + EPSILON) fail(`ページ横スクロールがあります（scrollWidth=${state.scrollWidth}, viewport=${vw}）`);
  if (state.offenders.length) {
    fail(`横はみ出しの要素があります: ${state.offenders.map((item) => `${item.selector}[${item.left}〜${item.right}]`).join(', ')}`);
  }
}

// パネルのリンク先が実在すること（同一オリジンだけ。外部は見ない）。エンジンごとに1回だけ。
async function checkPanelLinkTargets(page, state, label, failures, checked) {
  for (const link of state.panel.links) {
    if (!link.href || /^(#|javascript:|mailto:|tel:)/i.test(link.href)) {
      if (!link.href || /^javascript:/i.test(link.href) || link.href === '#') {
        failures.push(`${label}: 案内パネルのリンクが無効です（href=${JSON.stringify(link.href)}）: ${link.text}`);
      }
      continue;
    }
    const url = new URL(link.absolute);
    if (url.origin !== new URL(base).origin) continue;
    url.hash = '';
    const key = url.href;
    if (checked.has(key)) continue;
    const response = await page.request.get(key, { timeout: 15000 });
    checked.set(key, response.status());
    if (response.status() !== 200) failures.push(`${label}: 案内パネルのリンク先が ${response.status()} です: ${link.href}`);
  }
}

async function checkPanelKeyboard(page, label, failures) {
  const links = page.locator('#top nav.hero-panel a');
  const count = await links.count();
  if (!count) return;
  for (const index of [0, count - 1]) {
    await links.nth(index).focus();
    const focused = await links.nth(index).evaluate((link) => document.activeElement === link);
    if (!focused) failures.push(`${label}: 案内パネルのリンク${index + 1}番目にキーボードフォーカスが当たりません`);
  }
}

// #pickup: 矢印で横送りできる
async function checkPickup(page, label, failures) {
  const report = { items: 0, scrollable: false };
  const section = page.locator('#pickup');
  if (await section.count() !== 1) { failures.push(`${label}: #pickup がありません`); return report; }
  await page.locator('#pk-rail').scrollIntoViewIfNeeded({ timeout: 10000 });
  const read = () => page.evaluate(() => {
    const rail = document.getElementById('pk-rail');
    const nav = document.getElementById('pk-nav');
    const next = nav?.querySelector('.pk-arrow[data-pk-dir="1"]');
    const prev = nav?.querySelector('.pk-arrow[data-pk-dir="-1"]');
    const shown = (element) => !!element && !element.closest('[hidden]')
      && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0;
    return {
      railPresent: !!rail, items: rail?.querySelectorAll(':scope > li.pk-item').length || 0,
      cards: rail?.querySelectorAll('li.pk-item > a.pk-card').length || 0,
      scrollLeft: rail?.scrollLeft || 0, scrollWidth: rail?.scrollWidth || 0, clientWidth: rail?.clientWidth || 0,
      navShown: shown(nav), nextShown: shown(next), prevShown: shown(prev),
      nextDisabled: next ? next.disabled || next.getAttribute('aria-disabled') === 'true' : null,
      prevDisabled: prev ? prev.disabled || prev.getAttribute('aria-disabled') === 'true' : null,
      nextLabel: next?.getAttribute('aria-label') || '', prevLabel: prev?.getAttribute('aria-label') || '',
      progress: !!document.querySelector('#pickup .pk-progress'),
    };
  });
  const before = await read();
  report.items = before.items;
  if (!before.railPresent || before.items < 3 || before.cards !== before.items) {
    failures.push(`${label}: #pk-rail のカード構成が不正です（li.pk-item=${before.items}, a.pk-card=${before.cards}）`);
    return report;
  }
  if (!before.progress) failures.push(`${label}: 進捗バー .pk-progress がありません`);
  if (!before.nextLabel || !before.prevLabel) failures.push(`${label}: 前後ボタンに aria-label がありません`);
  report.scrollable = before.scrollWidth > before.clientWidth + EPSILON;
  if (!report.scrollable) {
    // 全カードが1画面に収まる幅。送る必要がないので、矢印は無効または非表示であること。
    if (before.navShown && !(before.nextDisabled && before.prevDisabled)) {
      failures.push(`${label}: カードが全部見えているのに矢印が有効のままです`);
    }
    return report;
  }
  if (!before.nextShown || before.nextDisabled) {
    failures.push(`${label}: 横に送れるのに「次へ」ボタンが表示/有効ではありません`);
    return report;
  }
  await page.locator('#pk-nav .pk-arrow[data-pk-dir="1"]').click({ timeout: 10000 });
  try {
    await page.waitForFunction((start) => document.getElementById('pk-rail').scrollLeft > start + 1,
      before.scrollLeft, { timeout: 4000 });
  } catch {
    failures.push(`${label}: 「次へ」で横送りできません（scrollLeft=${before.scrollLeft}）`);
    return report;
  }
  const mid = await read();
  if (!mid.prevShown || mid.prevDisabled) failures.push(`${label}: 送った後も「前へ」が有効になりません`);
  else {
    await page.locator('#pk-nav .pk-arrow[data-pk-dir="-1"]').click({ timeout: 10000 });
    try {
      await page.waitForFunction((start) => document.getElementById('pk-rail').scrollLeft < start - 1,
        mid.scrollLeft, { timeout: 4000 });
    } catch {
      failures.push(`${label}: 「前へ」で戻れません（scrollLeft=${mid.scrollLeft}）`);
    }
  }
  return report;
}

// タブの切替: aria-selected と対応パネルの hidden が常に同期していること
async function checkTabs(page, sectionSelector, name, label, failures, expectedCount = null) {
  const report = { tabs: 0 };
  const read = () => page.evaluate((selector) => {
    const tabs = [...document.querySelectorAll(`${selector} [role="tab"]`)];
    return tabs.map((tab) => {
      const panel = tab.getAttribute('aria-controls') ? document.getElementById(tab.getAttribute('aria-controls')) : null;
      const style = panel ? getComputedStyle(panel) : null;
      const rect = panel ? panel.getBoundingClientRect() : null;
      return { selected: tab.getAttribute('aria-selected'), hasPanel: !!panel,
        panelRole: panel?.getAttribute('role') || null,
        hidden: panel ? panel.hidden : null,
        shown: !!panel && style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0,
        text: tab.textContent.trim().replace(/\s+/g, ' ') };
    });
  }, sectionSelector);
  const judge = (states, expectedIndex, step) => {
    const selected = states.filter((state) => state.selected === 'true');
    if (selected.length !== 1) failures.push(`${label}: ${name}${step}で aria-selected=true が${selected.length}個です`);
    if (expectedIndex !== null && states[expectedIndex]?.selected !== 'true') {
      failures.push(`${label}: ${name}「${states[expectedIndex]?.text}」をクリックしても選択状態になりません`);
    }
    states.forEach((state, index) => {
      if (!state.hasPanel) { failures.push(`${label}: ${name}のタブ${index + 1}に対応パネル（aria-controls）がありません`); return; }
      const isSelected = state.selected === 'true';
      if (isSelected && (state.hidden !== false || !state.shown)) {
        failures.push(`${label}: ${name}${step}で選択中「${state.text}」のパネルが表示されていません（hidden=${state.hidden}）`);
      }
      if (!isSelected && (state.hidden !== true || state.shown)) {
        failures.push(`${label}: ${name}${step}で非選択「${state.text}」のパネルが隠れていません（hidden=${state.hidden}）`);
      }
    });
  };

  if (await page.locator(sectionSelector).count() !== 1) { failures.push(`${label}: ${sectionSelector} がありません`); return report; }
  const tabs = page.locator(`${sectionSelector} [role="tab"]`);
  const count = await tabs.count();
  report.tabs = count;
  if (count < 2 || (expectedCount !== null && count !== expectedCount)) {
    failures.push(`${label}: ${name}のタブ数が不正です（${count}、期待 ${expectedCount ?? '2以上'}）`);
    return report;
  }
  await tabs.first().scrollIntoViewIfNeeded({ timeout: 10000 });
  judge(await read(), null, '（初期）');
  // 最後→先頭→途中の順に押し、どの向きの切替でも同期することを見る。
  const order = [count - 1, 0, ...Array.from({ length: count - 2 }, (_, i) => i + 1)];
  for (const index of order) {
    await tabs.nth(index).click({ timeout: 10000 });
    try {
      await page.waitForFunction(({ selector, i }) => document.querySelectorAll(`${selector} [role="tab"]`)[i]
        ?.getAttribute('aria-selected') === 'true', { selector: sectionSelector, i: index }, { timeout: 3000 });
    } catch { /* 下の judge が失敗として記録する */ }
    judge(await read(), index, `（タブ${index + 1}を操作後）`);
  }
  return report;
}

// 書式ギャラリー（#tools）の内容。旧トップ検査の判定をそのまま引き継ぐ。
async function measureGallery(page) {
  return page.evaluate(() => {
    const tools = document.querySelector('#tools');
    const kit = tools?.querySelector('.fg-kit');
    const kitLink = kit?.querySelector('.fg-kit-link');
    const kitDownload = kit?.querySelector('.fg-kit-download');
    const cards = [...document.querySelectorAll('#tools .fg-rail > .fg-item:not(.fg-copy)')];
    const pickerLinks = [...document.querySelectorAll('#tools .fg-picker a[data-fg-select]')];
    const rail = document.querySelector('#form-gallery-rail');
    const railRect = rail?.getBoundingClientRect();
    return {
      sectionCount: document.querySelectorAll('#tools').length,
      galleryCount: document.querySelectorAll('.fg-gallery').length,
      railCount: document.querySelectorAll('#form-gallery-rail').length,
      cardCount: cards.length,
      cardKeys: cards.map((card) => card.dataset.fgKey),
      pickerGroups: [...document.querySelectorAll('#tools .fg-picker-group h3')].map((heading) => heading.textContent),
      pickerLinks: pickerLinks.map((link) => {
        const style = getComputedStyle(link);
        const rect = link.getBoundingClientRect();
        // スマホではグループごとの横スクロール1行になる。スクロール列の中の書式名は、
        // 列そのものが画面内にあり、列のスクロール範囲の中に収まっていれば届く。
        const list = link.closest('ul');
        const listStyle = list ? getComputedStyle(list) : null;
        const scroller = list && /^(auto|scroll)$/.test(listStyle.overflowX)
          && list.scrollWidth > list.clientWidth + 1 ? list : null;
        const listRect = scroller ? scroller.getBoundingClientRect() : null;
        const offsetLeft = scroller ? rect.left - listRect.left + scroller.scrollLeft : null;
        return { key: link.dataset.fgSelect, href: link.getAttribute('href'), text: link.textContent,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
          left: scroller ? listRect.left : rect.left, right: scroller ? listRect.right : rect.right,
          width: rect.width, height: rect.height,
          inScroller: scroller ? offsetLeft >= -0.5 && offsetLeft + rect.width <= scroller.scrollWidth + 0.5 : null };
      }),
      cloneIdCount: rail?.querySelectorAll('.fg-copy[id], .fg-copy [id]').length,
      cloneFocusableCount: [...(rail?.querySelectorAll('.fg-copy a') || [])].filter((link) => link.tabIndex >= 0).length,
      previewSources: cards.map((card) => {
        const image = card.querySelector('.fg-paper > img');
        return image?.getAttribute('src') || image?.dataset.src || null;
      }),
      cardLinks: cards.map((card) => {
        const link = card.querySelector('.fg-card');
        return { href: link?.getAttribute('href'), download: link?.getAttribute('download'),
          type: link?.getAttribute('type'), label: link?.getAttribute('aria-label'),
          text: link?.textContent, heading: link?.querySelector('h3')?.textContent };
      }),
      railWidth: rail?.clientWidth,
      firstThreeAtStart: railRect ? cards.slice(0, 3).map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left - railRect.left + rail.scrollLeft,
          right: rect.right - railRect.left + rail.scrollLeft, width: rect.width };
      }) : [],
      kitCount: document.querySelectorAll('.fg-kit').length,
      kitText: kit?.textContent,
      kitLinkCount: document.querySelectorAll('.fg-kit-link').length,
      kitHref: kitLink?.getAttribute('href'),
      kitDownloadCount: document.querySelectorAll('.fg-kit-download').length,
      downloadHref: kitDownload?.getAttribute('href'),
      downloadAttribute: kitDownload?.getAttribute('download'),
    };
  });
}

function judgeGalleryContent(label, gallery, width, viewportWidth, failures) {
  if (gallery.sectionCount !== 1 || gallery.galleryCount !== 1 || gallery.railCount !== 1) {
    failures.push(`${label}: 書式ギャラリー（#tools）が1つではありません (${JSON.stringify(gallery)})`);
  }
  if (gallery.cardCount !== FORM_GALLERY_PREVIEWS.length
    || gallery.previewSources.some((source, index) => source !== FORM_GALLERY_PREVIEWS[index])) {
    failures.push(`${label}: 入社書類と社内基本書式の32プレビューが一致しません (${JSON.stringify(gallery.previewSources)})`);
  }
  if (gallery.cardKeys.join('/') !== FORM_GALLERY_KEYS.join('/')
    || gallery.pickerLinks.length !== FORM_GALLERY_KEYS.length
    || gallery.pickerGroups.join('/') !== '入社/勤務・休暇/休職・退職/証明・その他'
    || gallery.pickerLinks.some((link) => !FORM_GALLERY_KEYS.includes(link.key)
      || link.href !== `#fg-preview-${link.key}` || !link.visible || !link.text
      || link.height < 24 - EPSILON || link.inScroller === false || link.left < -EPSILON
      || link.right > viewportWidth + EPSILON)
    || new Set(gallery.pickerLinks.map((link) => link.key)).size !== FORM_GALLERY_KEYS.length
    || gallery.cloneIdCount !== 0 || gallery.cloneFocusableCount !== 0) {
    failures.push(`${label}: 全32書式の名称一覧・参照先・複製の読み上げ除外が不正です (${JSON.stringify(gallery.pickerLinks)})`);
  }
  const noticeLink = gallery.cardLinks[1];
  if (gallery.cardLinks.length !== FORM_GALLERY_DOWNLOADS.length
    || gallery.cardLinks.some((link, index) => link.href !== FORM_GALLERY_DOWNLOADS[index])
    || noticeLink?.download !== '労働条件通知書_入力用.xlsx'
    || noticeLink?.type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || !noticeLink?.label?.includes('Excel') || !noticeLink?.label?.includes('会社が作成・交付')
    || !noticeLink?.text?.includes('入力用Excelをダウンロード')
    || gallery.cardLinks.slice(10).some((link, index) =>
      link.heading?.replace(/\s+/g, '') !== COMMON_FORM_PREVIEWS[index].title.replace(/\s+/g, '')
      || !(link.label || link.text)?.replace(/\s+/g, '').includes(COMMON_FORM_PREVIEWS[index].title.replace(/\s+/g, ''))
      || !link.text?.includes('入力前の用紙（1ページ目）')
      || !link.text?.includes('HTMLを開いて記入・印刷'))) {
    failures.push(`${label}: 見本の配布先・労働条件通知書のExcel表示が一致しません (${JSON.stringify(gallery.cardLinks)})`);
  }
  if (width >= 901 && (gallery.firstThreeAtStart.length !== 3
    || gallery.firstThreeAtStart.some((card) => card.width <= 0
      || card.left < -EPSILON || card.right > gallery.railWidth + EPSILON))) {
    failures.push(`${label}: PCの初期位置で先頭3枚の見本が収まりません (${JSON.stringify(gallery.firstThreeAtStart)})`);
  }
  if (gallery.kitCount !== 1 || !gallery.kitText?.replace(/\s+/g, '').includes('入社書類8点セット')
    || gallery.kitLinkCount !== 1 || gallery.kitHref !== 'shoshiki.html#onboarding-kit'
    || gallery.kitDownloadCount !== 1 || gallery.downloadHref !== 'assets/download/onboarding-kit.zip'
    || gallery.downloadAttribute === null || gallery.downloadAttribute === undefined) {
    failures.push(`${label}: 書式見本内の入社書類セット案内・ZIP導線が一致しません (${JSON.stringify(gallery)})`);
  }
}

async function runEngine(engineName, browserType) {
  const results = [];
  const failures = [];
  const linkStatus = new Map();
  const browser = await browserType.launch({ headless: true });
  try {
    for (const width of ALL_WIDTHS) {
      const label = `${engineName}@${width}px`;
      const page = await browser.newPage({
        viewport: { width, height: width <= 767 ? 844 : width >= 1600 ? 960 : 900 },
        isMobile: width <= 768,
        hasTouch: width <= 768,
      });
      const errors = [];
      const origin = new URL(base).origin;
      page.on('console', (message) => {
        if (message.type() !== 'error' || isForeignConsoleError(message, base)) return;
        // GoatCounterは自動ブラウザの計測リクエストを400で拒否する。画面機能とは無関係。
        if (/goatcounter\.com\/count/.test(message.location().url || '')) return;
        errors.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('requestfailed', (request) => {
        if (!request.url().startsWith(origin)) return;
        if (/abort|cancel/i.test(request.failure()?.errorText || '')) return;
        errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`);
      });
      page.on('response', (response) => {
        if (response.url().startsWith(origin) && response.status() >= 400) {
          errors.push(`HTTP ${response.status()}: ${response.url()}`);
        }
      });
      try {
        await prepareLocalHttpPage(page);
        // 外部解析スクリプトの遅延を合否へ混ぜず、必要なフォントだけ明示的に待つ。
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await settlePage(page);
        const report = { engine: engineName, width, errors };
        if (WIDTHS.includes(width)) {
          const state = await measureTop(page);
          Object.assign(report, { state });
          judgeTop(label, state, failures);
          await checkPanelLinkTargets(page, state, label, failures, linkStatus);
          await checkPanelKeyboard(page, label, failures);
          report.pickup = await checkPickup(page, label, failures);
          report.services = await checkTabs(page, '#services', 'サービスのタブ', label, failures, EXPECTED_SERVICE_TABS);
          report.news = await checkTabs(page, '#news', 'インフォメーションのタブ', label, failures);
        }
        if (GALLERY_WIDTHS.includes(width)) {
          const gallery = await measureGallery(page);
          judgeGalleryContent(label, gallery, width, await page.evaluate(() => document.documentElement.clientWidth), failures);
          report.galleryAfterScroll = await checkFormGallery(page, engineName, width, failures);
        }
        results.push(report);
        if (errors.length) failures.push(`${label}: ${errors.join(' / ')}`);
      } catch (error) {
        failures.push(`${label}: 検査を完了できません: ${error.message}`);
        results.push({ engine: engineName, width, errors: [error.message] });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { results, failures };
}

(async () => {
  // 2エンジンを並列に走らせる（各エンジン内は1ページずつ）。
  const outcomes = await Promise.all(ENGINES.map(([name, type]) => runEngine(name, type)));
  const results = outcomes.flatMap((outcome) => outcome.results);
  const failures = outcomes.flatMap((outcome) => outcome.failures);
  const expected = ENGINES.length * ALL_WIDTHS.length;
  if (results.length !== expected) failures.push(`測定条件の欠落: ${results.length}/${expected}`);

  if (asJson) {
    // 失敗要点はstderrへ先に出し、JSONも自然終了までflushして保存する。
    if (failures.length) {
      console.error(`失敗: ${failures.length}件`);
      for (const failure of failures) console.error(`- ${failure}`);
    }
    console.log(JSON.stringify({ base, widths: WIDTHS, galleryWidths: GALLERY_WIDTHS, epsilon: EPSILON, results, failures }, null, 2));
  } else {
    for (const result of results.filter((item) => item.state)) {
      const { state } = result;
      console.log(`${result.engine}@${result.width}px h1=${Math.round(state.h1.text?.right ?? 0)} panel=${Math.round(state.panel.box?.width ?? 0)}`
        + ` pickup=${result.pickup?.items}${result.pickup?.scrollable ? '(送り)' : ''} services=${result.services?.tabs} news=${result.news?.tabs}`
        + ` scroll=${state.scrollWidth - state.viewportWidth} overflow=${state.offenders.length}`);
    }
    console.log(failures.length ? `失敗: ${failures.length}件` : '合格: 新トップの表示・操作・横はみ出し');
    for (const failure of failures) console.error(`- ${failure}`);
  }
  if (failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
