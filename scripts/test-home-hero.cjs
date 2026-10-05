/**
 * トップヒーローの横はみ出し・登場演出回帰テスト。
 *
 * 実行:
 *   node scripts/test-home-hero.cjs [base] [--json]
 *
 * 修正前の bf25281^ をCSPメタ除去だけで測ると、390 / 402 / 430pxで
 * Chromiumはh1右端370 / 382 / 410px・はみ出し0、WebKitは
 * 504.53 / 519.44 / 537.66px・各12要素がはみ出した。両エンジンとも
 * documentElement.scrollWidthとviewportの差は0で、横はみ出し判定は
 * WebKitだけが失敗した。そのためフィクスチャを使わず、実際の要素矩形で判定する。
 */

const { chromium, webkit } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const asJson = args.includes('--json');

const WIDTHS = [320, 360, 375, 390, 402, 429, 430, 431, 539, 540, 541, 600, 640, 641, 699, 700, 701, 733, 767, 768, 820, 900, 901, 1024, 1100, 1101, 1280, 1440, 1599, 1600, 1601, 1920, 2560, 2774];
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];
const EPSILON = 1;
const FORM_GALLERY_INTERACTION_WIDTHS = [320, 390, 900, 901, 1280];
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
  'assets/previews/onboarding-personal-sample.webp',
  'assets/previews/onboarding-bank-sample.webp',
  'assets/previews/onboarding-commute-sample.webp',
  'assets/previews/onboarding-emergency-sample.webp',
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
const MOTION_WIDTHS = [390, 540, 541, 640, 733, 767, 768, 1280, 1920];
// External reference, rather than values read from home-hero.js:
// https://gaaboo.jp/wp/wp-content/themes/gaaboo/assets/js/top.js?ver=1766493868
// O() / people1+people2: 30ms stagger, 160ms linear opacity,
// SP 2400ms / PC 2000ms, elastic.out(0.8, 1.1). Fixed curve checkpoints below
// allow one 16.7ms RAF interval, without sharing the production easing function.
// User override: start during initialization, without the reference site's delay.
const MOTION_REFERENCE = {
  sp: { distance: -600, duration: 2400, count: 6, checkpoints: [
    { fraction: 0.2, y: -91.597182, angle: -9.159718, yTolerance: 11, angleTolerance: 1.05 },
    { fraction: 0.4, y: 9.533188, angle: 0.953319, yTolerance: 2, angleTolerance: 0.2 },
    { fraction: 0.5, y: 12.278639, angle: 1.227864, yTolerance: 1.5, angleTolerance: 0.15 },
  ] },
  pc: { distance: -1200, duration: 2000, count: 10, checkpoints: [
    { fraction: 0.2, y: -183.194364, angle: -9.159718, yTolerance: 23, angleTolerance: 1.2 },
    { fraction: 0.4, y: 19.066375, angle: 0.953319, yTolerance: 3.2, angleTolerance: 0.22 },
    { fraction: 0.5, y: 24.557278, angle: 1.227864, yTolerance: 1.8, angleTolerance: 0.15 },
  ] },
};
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

async function measure(page) {
  // ギャラリーの位置と行高を、未読込の簡易スタイルで測らないように、
  // 実際のstylesheetの読込を待つ。
  await page.waitForFunction(() => Boolean(
    document.getElementById('home-form-gallery-style')?.sheet
      || document.querySelector('link[href^="home-form-gallery.css"]')?.sheet,
  ), null, { timeout: 10000 });
  return page.evaluate(({ epsilon }) => {
    const viewportWidth = document.documentElement.clientWidth;
    const selectorOf = (element) => {
      if (element.id) return `#${element.id}`;
      const classes = [...element.classList].slice(0, 3);
      return `${element.tagName.toLowerCase()}${classes.length ? `.${classes.join('.')}` : ''}`;
    };
    const rectOf = (selector) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return {
        width: Number(rect.width.toFixed(2)),
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
      };
    };
    const phrasesOf = (selector) => [...document.querySelectorAll(`${selector} .nw`)]
      .map((phrase) => {
        const range = document.createRange();
        range.selectNodeContents(phrase);
        const rects = [...range.getClientRects()]
          .filter((rect) => rect.width > 0 && rect.height > 0);
        return {
          text: phrase.textContent,
          rectCount: rects.length,
          rects: rects.map((rect) => ({
            top: Number(rect.top.toFixed(2)),
            left: Number(rect.left.toFixed(2)),
            right: Number(rect.right.toFixed(2)),
          })),
        };
      });
    const boundariesOf = (selector) => {
      const phrases = [...document.querySelectorAll(`${selector} .nw`)];
      return phrases.slice(0, -1).map((phrase, index) => {
        const nextPhrase = phrases[index + 1];
        const range = document.createRange();
        range.setStartAfter(phrase);
        range.setEndBefore(nextPhrase);
        const between = range.cloneContents();
        const meaningfulText = between.textContent.replace(/\s+/g, '');
        const replacedElementCount = between.querySelectorAll(
          'img,svg,video,audio,canvas,input,button,select,textarea,iframe,object,embed',
        ).length;
        const unexpectedElementCount = [...between.querySelectorAll('*')]
          .filter((element) => !['BR', 'WBR', 'STRONG'].includes(element.tagName)).length;
        const brCount = between.querySelectorAll('br').length;
        const wbrCount = between.querySelectorAll('wbr').length;
        return {
          before: phrase.textContent,
          after: nextPhrase.textContent,
          brCount,
          wbrCount,
          meaningfulText,
          replacedElementCount,
          unexpectedElementCount,
          valid: meaningfulText.length === 0 && replacedElementCount === 0
            && unexpectedElementCount === 0
            && (brCount === 0 ? wbrCount === 1 : brCount === 1 && wbrCount === 0),
        };
      });
    };
    const textCoveredBy = (selector, phrases) => {
      const target = document.querySelector(selector);
      const normalizeText = (text) => text.replace(/\s+/g, '');
      return Boolean(target) && normalizeText(target.textContent)
        === normalizeText(phrases.map((phrase) => phrase.text).join(''));
    };
    const linesOf = (phrases) => {
      const lines = [];
      for (const phrase of phrases) {
        if (phrase.rectCount !== 1) continue;
        const [rect] = phrase.rects;
        let line = lines.find((item) => Math.abs(item.top - rect.top) < epsilon);
        if (!line) {
          line = { top: rect.top, text: '' };
          lines.push(line);
        }
        line.text += phrase.text;
      }
      return lines.sort((a, b) => a.top - b.top).map((item) => ({
        text: item.text,
        characterCount: [...item.text.replace(/\s+/g, '')].length,
      }));
    };
    const offenders = [...document.querySelectorAll('.hero, .hero *')]
      .filter((element) => {
        // 見本レール内の画面外カードは、局所的な横送りの範囲。レール自身と
        // その外側の要素・全ページ幅は引き続き検査する。
        const rail = element.closest('#tools .fg-rail');
        if (rail && rail !== element && ['auto', 'scroll'].includes(getComputedStyle(rail).overflowX)) {
          return false;
        }
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0
          && (rect.left < -epsilon || rect.right > viewportWidth + epsilon);
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: selectorOf(element),
          width: Number(rect.width.toFixed(2)),
          left: Number(rect.left.toFixed(2)),
          right: Number(rect.right.toFixed(2)),
        };
      });
    const h1Phrases = phrasesOf('.hero-h1');
    const subPhrases = phrasesOf('.hero-sub');
    const canvas = [...document.querySelectorAll('#top .hero-scene')]
      .find((element) => getComputedStyle(element).display !== 'none');
    const boxOf = (element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    // Actor wrappers give the settled layout, independently of the entrance transform.
    const actorBoxes = [...canvas.querySelectorAll('.hero-actor')]
      .map((actor) => ({ actor: actor.dataset.actor, ...boxOf(actor) }))
      .sort((a, b) => a.left - b.left);
    const canvasBox = boxOf(canvas);
    const titleBox = boxOf(document.querySelector('.hero-h1'));
    const stage = document.querySelector('#top .hero-stage');
    const overlay = document.querySelector('#top .hero-overlay');
    const intro = document.querySelector('#top .hero-intro');
    const updates = document.querySelector('#top .hero-updates');
    const tools = document.querySelector('#tools');
    const toolsBox = tools ? boxOf(tools) : null;
    const kit = tools?.querySelector('.fg-kit');
    const kitLink = kit?.querySelector('.fg-kit-link');
    const kitDownload = kit?.querySelector('.fg-kit-download');
    const galleryCards = [...document.querySelectorAll('#tools .fg-rail > .fg-item:not(.fg-copy)')];
    const pickerLinks = [...document.querySelectorAll('#tools .fg-picker a[data-fg-select]')];
    const galleryRail = document.querySelector('#form-gallery-rail');
    const railBox = galleryRail ? boxOf(galleryRail) : null;

    return {
      viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      formGallery: {
        oldEntryCount: document.querySelectorAll('.hero-onboarding-link').length,
        sectionCount: document.querySelectorAll('#tools').length,
        galleryCount: document.querySelectorAll('.fg-gallery').length,
        railCount: document.querySelectorAll('#form-gallery-rail').length,
        inStage: tools?.parentElement === stage,
        followsOverlay: overlay.nextElementSibling === tools,
        precedesIntro: tools?.nextElementSibling === intro,
        rows: [canvas, tools, intro, updates].map((element) => element
          ? getComputedStyle(element).gridRowStart : null),
        box: toolsBox,
        cardCount: galleryCards.length,
        cardKeys: galleryCards.map((card) => card.dataset.fgKey),
        pickerGroups: [...document.querySelectorAll('#tools .fg-picker-group h3')]
          .map((heading) => heading.textContent),
        pickerLinks: pickerLinks.map((link) => {
          const style = getComputedStyle(link);
          const rect = link.getBoundingClientRect();
          return { key: link.dataset.fgSelect, href: link.getAttribute('href'),
            text: link.textContent, visible: style.display !== 'none'
              && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            left: rect.left, right: rect.right, width: rect.width, height: rect.height };
        }),
        cloneIdCount: galleryRail?.querySelectorAll('.fg-copy[id], .fg-copy [id]').length,
        cloneFocusableCount: [...(galleryRail?.querySelectorAll('.fg-copy a') || [])]
          .filter((link) => link.tabIndex >= 0).length,
        previewSources: galleryCards.map((card) => {
          const image = card.querySelector('.fg-paper > img');
          return image?.getAttribute('src') || image?.dataset.src || null;
        }),
        cardLinks: galleryCards.map((card) => {
          const link = card.querySelector('.fg-card');
          return { href: link?.getAttribute('href'), download: link?.getAttribute('download'),
            type: link?.getAttribute('type'), label: link?.getAttribute('aria-label'),
            text: link?.textContent, heading: link?.querySelector('h3')?.textContent };
        }),
        railWidth: galleryRail?.clientWidth,
        firstThreeAtStart: railBox ? galleryCards.slice(0, 3).map((card) => {
          const rect = boxOf(card);
          return { left: rect.left - railBox.left + galleryRail.scrollLeft,
            right: rect.right - railBox.left + galleryRail.scrollLeft, width: rect.width };
        }) : [],
        kitCount: document.querySelectorAll('.fg-kit').length,
        kitText: kit?.textContent,
        kitLinkCount: document.querySelectorAll('.fg-kit-link').length,
        kitHref: kitLink?.getAttribute('href'),
        kitDownloadCount: document.querySelectorAll('.fg-kit-download').length,
        downloadHref: kitDownload?.getAttribute('href'),
        downloadAttribute: kitDownload?.getAttribute('download'),
      },
      titleFonts: {
        primary: parseFloat(getComputedStyle(document.querySelector('.hero-services')).fontSize),
        secondary: parseFloat(getComputedStyle(document.querySelector('.hero-h1 strong')).fontSize),
      },
      composition: {
        canvas: canvasBox, actors: actorBoxes,
        gaps: actorBoxes.slice(1).map((actor, index) => actor.left - actorBoxes[index].right),
        titleGap: Math.min(...actorBoxes.map((actor) => actor.top)) - titleBox.bottom,
        galleryGap: toolsBox ? toolsBox.top - canvasBox.bottom : null,
        introGap: toolsBox ? boxOf(intro).top - toolsBox.bottom : null,
        backgroundOpacity: Number(getComputedStyle(canvas.querySelector('.hero-town')).opacity),
        backgroundSource: canvas.querySelector('.hero-town img').currentSrc,
      },
      summaryColumns: getComputedStyle(document.querySelector('.hs-inner'))
        .gridTemplateColumns.split(' ').filter(Boolean).length,
      summaryLayout: getComputedStyle(document.querySelector('.hs-inner')).display,
      summaryDisplay: getComputedStyle(document.querySelector('.hero-summary')).display,
      h1Phrases,
      subPhrases,
      startupPhrases: phrasesOf('.home-startup-sentence'),
      h1Boundaries: boundariesOf('.hero-h1'),
      subBoundaries: boundariesOf('.hero-sub'),
      h1TextCovered: textCoveredBy('.hero-h1', h1Phrases),
      subTextCovered: textCoveredBy('.hero-sub', subPhrases),
      h1Lines: linesOf(h1Phrases),
      subLines: linesOf(subPhrases),
      metrics: {
        stage: rectOf('.hero-stage'),
        overlay: rectOf('.hero-overlay'),
        label: rectOf('.why-label.hero-label'),
        h1: rectOf('.hero-h1'),
        sub: rectOf('.hero-sub'),
        buttons: rectOf('.hero-btns'),
        trust: rectOf('.hero-trust'),
      },
      offenders,
    };
  }, { epsilon: EPSILON });
}

async function readMotion(page, label) {
  return page.evaluate((label) => {
    const stage = document.querySelector('#top .hero-stage');
    const canvas = [...stage.querySelectorAll('.hero-scene')]
      .find((element) => getComputedStyle(element).display !== 'none');
    const actors = [...canvas.querySelectorAll('.hero-actor')].map((actor) => {
      const pose = actor.querySelector('.hero-poses');
      const style = getComputedStyle(pose);
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      return {
        actor: actor.dataset.actor, y: matrix.m42,
        angle: Math.atan2(-matrix.m13, matrix.m11) * 180 / Math.PI,
        opacity: Number(style.opacity),
        inlineTransform: pose.style.transform, inlineOpacity: pose.style.opacity,
      };
    });
    return {
      label, now: performance.now(), classes: [...stage.classList],
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      canvas: canvas.classList.contains('hero-canvas-sp') ? 'sp' : 'pc', actors,
      titleGap: Math.min(...[...canvas.querySelectorAll('.hero-poses')]
        .map((pose) => pose.getBoundingClientRect().top))
        - document.querySelector('.hero-h1').getBoundingClientRect().bottom,
      overflow: [document.querySelector('#top'), canvas].map((element) => ({
        x: getComputedStyle(element).overflowX, y: getComputedStyle(element).overflowY,
      })),
      normalLoading: [...canvas.querySelectorAll('.hero-media:not(.actor-after) img')]
        .map((image) => image.loading),
    };
  }, label);
}

async function advanceMotionTo(page, time) {
  const now = await page.evaluate(() => performance.now());
  if (now > time + 1) throw new Error(`Clock checkpoint was already passed: ${now} > ${time}`);
  if (time > now) await page.clock.runFor(time - now);
}

async function openMotionPage(browser, width, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepareLocalHttpPage(page);
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  // Freeze before parsing: an immediate entrance can already be past its first
  // frame by DOMContentLoaded. Parsing, CSS, and network loading are not mocked.
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.addInitScript(() => {
    let initialize, lastStage;
    Object.defineProperty(window, 'mnInitHomeHero', {
      configurable: true, enumerable: true,
      get() { return initialize; },
      set(callback) {
        initialize = function (...args) {
          const stage = document.querySelector('#top .hero-stage');
          const fresh = stage && stage !== lastStage;
          const audit = fresh ? { now: performance.now(), readyState: document.readyState } : null;
          const result = callback.apply(this, args);
          if (fresh) {
            audit.classesAfterInit = [...stage.classList];
            window.__heroAuditInit = audit;
            lastStage = stage;
          }
          return result;
        };
      },
    });
  });
  const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
  // runFor, not fastForward, visits every scheduled animation frame.
  const initialization = await page.evaluate(() => window.__heroAuditInit);
  if (!initialization) throw new Error('The home hero initializer was not called');
  return { page, errors, origin: initialization.now, initialization,
    html: await response.text() };
}

function motionChecks(engine, width, scenario, failures) {
  return (condition, message) => {
    if (!condition) failures.push(`${engine}@${width}px motion/${scenario}: ${message}`);
  };
}

function restingConditions(state) {
  return {
    classes: state.classes.includes('hero-settled')
      && !state.classes.includes('hero-pending') && !state.classes.includes('hero-entering'),
    actors: state.actors.every((actor) => Math.abs(actor.y) < 0.01
      && Math.abs(actor.angle) < 0.01 && Math.abs(actor.opacity - 1) < 0.001),
    gap: state.titleGap >= 8,
  };
}

function isResting(state) {
  return Object.values(restingConditions(state)).every(Boolean);
}

function checkResting(state, check) {
  const resting = restingConditions(state);
  check(resting.classes,
  `${state.label}: 終端クラスが一致しません (${state.classes.join(' ')})`);
  check(resting.actors,
  `${state.label}: 定位置・角度0・不透明度1へ戻っていません`);
  check(resting.gap, `${state.label}: タイトルと着地後の人物の間隔が不足 (${state.titleGap}px)`);
}

async function motionScreenshot(page, engine, width, phase, screenshots) {
  if (!process.env.RUNNER_TEMP || !MOTION_WIDTHS.includes(width)) return;
  // performance.yml uploads this directory; run-layout-checks.cjs inherits env.
  const directory = path.join(process.env.RUNNER_TEMP, 'layout-results', 'hero-motion');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${engine}-${width}-${phase}.png`);
  await page.screenshot({ path: target });
  screenshots.push({ phase, path: target });
}

async function entryScreenshots(page, engine, width) {
  if (!process.env.RUNNER_TEMP || ![390, 1280].includes(width)) return [];
  const directory = path.join(process.env.RUNNER_TEMP, 'layout-results', 'hero-motion');
  await fs.mkdir(directory, { recursive: true });
  const screenshots = [];
  for (const [name, selector] of [['startup-offer', '#startup-offer'], ['shortcuts', '.home-shortcuts']]) {
    const target = path.join(directory, `${engine}-${width}-${name}.png`);
    await page.locator(selector).screenshot({ path: target });
    screenshots.push({ name, path: target });
  }
  return screenshots;
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

async function checkMotionTimeline(browser, engine, width, failures) {
  const { page, origin, initialization, errors, html } = await openMotionPage(browser, width);
  const check = motionChecks(engine, width, 'timeline', failures);
  const reference = MOTION_REFERENCE[width <= 767 ? 'sp' : 'pc'];
  const samples = [], screenshots = [];
  const sample = async (label, elapsed) => {
    if (elapsed !== undefined) await advanceMotionTo(page, origin + elapsed);
    const state = await readMotion(page, label); samples.push(state); return state;
  };
  try {
    const initial = await sample('immediate-start');
    check(initial.canvas === (width <= 767 ? 'sp' : 'pc'), '767/768pxのキャンバス境界が不一致です');
    check(initial.actors.length === reference.count, `人物数が${reference.count}ではありません`);
    check(initialization.readyState === 'loading'
      && initialization.classesAfterInit.includes('hero-entering')
      && !initialization.classesAfterInit.includes('hero-pending'),
    'DCL前の初期化で登場が開始せず、待機が残っています');
    check(initial.classes.includes('hero-entering') && !initial.classes.includes('hero-pending'),
      '初期化直後に登場状態へ移りません');
    check(initial.actors.every((actor) => Math.abs(actor.y - reference.distance) < 0.01
      && Math.abs(actor.angle + 60) < 0.01 && actor.opacity === 0),
    '初期位置・rotateY=-60deg・不透明度0が不一致です');
    check(initial.overflow.every((overflow) => overflow.x === 'clip' && overflow.y === 'visible'),
      '親の横clip/縦visibleが不一致です');
    check(initial.normalLoading.every((loading) => loading === 'eager'),
      '有効キャンバスの人物画像が登場前に読み込まれません');

    const onset = await sample('first-animation-frame', 17);
    check(onset.classes.includes('hero-entering') && !onset.classes.includes('hero-pending'),
      '初期化直後に登場へ移りません');
    check(onset.actors[0].opacity > 0 && onset.actors[0].y > reference.distance,
      '初期化後17ms以内に第1人物が落下しません');

    const stagger = await sample('opacity-stagger', 128);
    stagger.actors.slice(0, 3).forEach((actor, index) => {
      check(Math.abs(actor.opacity - (128 - index * 30) / 160) <= 0.11,
        `${actor.actor}: 160msの線形不透明度が不一致 (${actor.opacity})`);
    });
    for (let index = 1; index < 3; index += 1) {
      const delay = (stagger.actors[index - 1].opacity - stagger.actors[index].opacity) * 160;
      check(Math.abs(delay - 30) < 0.1, `DOM順の間隔が30msではありません (${delay}ms)`);
    }
    for (const point of reference.checkpoints) {
      const state = await sample(`fall-${point.fraction * 100}%`, reference.duration * point.fraction);
      const actor = state.actors[0];
      check(Math.abs(actor.y - point.y) <= point.yTolerance
        && Math.abs(actor.angle - point.angle) <= point.angleTolerance,
      `${state.label}: 参照曲線から外れています (y=${actor.y}, rotateY=${actor.angle})`);
      check(actor.opacity === 1, `${state.label}: 不透明度が1ではありません`);
      if (point.fraction >= 0.4) check(actor.y > 0, `${state.label}: 着地後の行き過ぎがありません`);
      if (point.fraction === 0.2) await page.evaluate(() => window.mnInitHomeHero());
      if (point.fraction === 0.5) await motionScreenshot(page, engine, width, 'overshoot', screenshots);
    }
    const end = reference.duration + (reference.count - 1) * 30;
    const beforeEnd = await sample('before-last-landing', end - 17);
    check(beforeEnd.classes.includes('hero-entering'), '最後の人物が着地する前に終端化されました');
    checkResting(await sample('settled', end + 17), check);
    await motionScreenshot(page, engine, width, 'settled', screenshots);
    await page.evaluate(() => window.mnInitHomeHero());
    checkResting(await sample('same-stage-no-replay'), check);
    checkResting(await sample('same-stage-still-settled', end + 100), check);

    // Replace with the server's fresh body, the same operation the SPA performs.
    // Retain detached poses to verify cancellation, not merely their disappearance.
    const replaceBody = async () => page.evaluate((source) => {
      window.__heroDetachedPoses = [...document.querySelectorAll('#top .hero-poses')];
      const body = document.adoptNode(new DOMParser().parseFromString(source, 'text/html').body);
      document.documentElement.replaceChild(body, document.body);
    }, html);
    await replaceBody();
    await page.evaluate(() => window.mnInitHomeHero());
    const freshOrigin = await page.evaluate(() => window.__heroAuditInit.now);
    const fresh = await readMotion(page, 'fresh-SPA-stage'); samples.push(fresh);
    check(fresh.classes.includes('hero-entering') && !fresh.classes.includes('hero-pending')
      && fresh.actors.every((actor) => actor.opacity === 0),
    '新しいSPA stageの初期化で直ちに登場が始まりません');
    await advanceMotionTo(page, freshOrigin + 17);
    const freshEntering = await readMotion(page, 'SPA-entering'); samples.push(freshEntering);
    check(freshEntering.classes.includes('hero-entering') && freshEntering.actors[0].opacity > 0,
      '新しいSPA stageが初期化後17ms以内に動きません');
    await replaceBody();
    // evaluate returns after the DOM mutation observer's microtask checkpoint.
    const detachedBefore = await page.evaluate(() => window.__heroDetachedPoses.map((pose) => pose.getAttribute('style')));
    await page.clock.runFor(6000);
    const detachedAfter = await page.evaluate(() => window.__heroDetachedPoses.map((pose) => pose.getAttribute('style')));
    check(JSON.stringify(detachedBefore) === JSON.stringify(detachedAfter),
      'SPA離脱後も旧人物のrAFがDOMを書き換えています');
    check(errors.length === 0, `pageerror: ${errors.join(' / ')}`);
    return { engine, width, scenario: 'timeline+SPA', initialization, samples, screenshots, errors };
  } finally { await page.close(); }
}

async function checkMotionCancellation(browser, engine, failures) {
  const { page, html, origin, errors } = await openMotionPage(browser, 390);
  const check = motionChecks(engine, 390, 'cancel', failures);
  const samples = [];
  const screenshots = [];
  let stageOrigin = origin;
  try {
    for (const reason of ['offscreen', 'hidden-event', 'breakpoint', 'reduced-motion']) {
      await advanceMotionTo(page, stageOrigin + 128);
      if (reason === 'offscreen') {
        // 実際にフッターへ移動して描画を待ち、画面外という検査条件を成立させる。
        // 未描画節の仮のscrollHeightとWebKitのIO通知タイミングに依存しない。
        await page.locator('footer').scrollIntoViewIfNeeded({ timeout: 10000 });
        check(await page.locator('#top .hero-stage').evaluate((stage) =>
          stage.getBoundingClientRect().bottom <= 0), 'フッターへの移動でヒーローが画面外になりません');
      } else if (reason === 'hidden-event') {
        // Explicit event simulation; this does not claim to test OS/tab visibility.
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      } else if (reason === 'breakpoint') await page.setViewportSize({ width: 768, height: 900 });
      else await page.emulateMedia({ reducedMotion: 'reduce' });
      let state;
      // IO/media style updates are delivered by rendering, independently of fake timers.
      // Keep the existing 10 x 17ms bound; a terminal class alone is not a painted resting pose.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.clock.runFor(17);
        state = await readMotion(page, `cancel-${reason}`);
        if (isResting(state)) break;
      }
      samples.push(state); checkResting(state, check);
      if (!isResting(state)) {
        await motionScreenshot(page, engine, 390, `cancel-${reason}-failure`, screenshots);
      }
      if (reason === 'offscreen') await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      else if (reason === 'hidden-event') await page.evaluate(() => {
        delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
      });
      else if (reason === 'breakpoint') await page.setViewportSize({ width: 390, height: 900 });
      else await page.emulateMedia({ reducedMotion: 'no-preference' });
      if (reason === 'reduced-motion') {
        let restoredImmediate;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await page.clock.runFor(17);
          restoredImmediate = await readMotion(page, 'restored-reduced-motion-immediate');
          if (isResting(restoredImmediate)) break;
        }
        samples.push(restoredImmediate); checkResting(restoredImmediate, check);
      }
      await page.clock.runFor(7000);
      const restored = await readMotion(page, `restored-${reason}`); samples.push(restored);
      checkResting(restored, check);
      if (reason !== 'reduced-motion') {
        await page.evaluate((source) => {
          const body = document.adoptNode(new DOMParser().parseFromString(source, 'text/html').body);
          document.documentElement.replaceChild(body, document.body);
        }, html);
        await page.evaluate(() => window.mnInitHomeHero());
        stageOrigin = await page.evaluate(() => window.__heroAuditInit.now);
      }
    }
    check(errors.length === 0, `pageerror: ${errors.join(' / ')}`);
    return { engine, width: 390, scenario: 'cancellation', samples, screenshots, errors };
  } finally { await page.close(); }
}

async function checkReducedMotion(browser, engine, width, failures) {
  const { page, errors } = await openMotionPage(browser, width, 'reduce');
  const check = motionChecks(engine, width, 'reduced-motion', failures);
  try {
    const initial = await readMotion(page, 'reduce-initial'); checkResting(initial, check);
    await page.clock.runFor(7000);
    const after = await readMotion(page, 'reduce-after-7000ms'); checkResting(after, check);
    check(errors.length === 0, `pageerror: ${errors.join(' / ')}`);
    return { engine, width, scenario: 'reduced-motion', samples: [initial, after], errors };
  } finally { await page.close(); }
}

(async () => {
  const results = [];
  const motionResults = [];
  const containerResults = [];
  const failures = [];

  for (const [engineName, browserType] of ENGINES) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const width of WIDTHS) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        });
        await prepareLocalHttpPage(page);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));

        // 外部解析スクリプトの遅延を合否へ混ぜず、必要なフォントだけ明示的に待つ。
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.evaluate(() => document.fonts.ready);
        const result = await measure(page);
        const report = { engine: engineName, width, errors, ...result,
          entryScreenshots: await entryScreenshots(page, engineName, width) };
        results.push(report);

        const composition = result.composition;
        const gallery = result.formGallery;
        if (gallery.oldEntryCount !== 0 || gallery.sectionCount !== 1
          || gallery.galleryCount !== 1 || gallery.railCount !== 1
          || !gallery.inStage || !gallery.followsOverlay || !gallery.precedesIntro
          || gallery.rows.join('/') !== '2/3/4/5') {
          failures.push(`${engineName}@${width}px: タイトル・イラスト→書式見本→説明/CTAの配置が一致しません`
            + ` (${JSON.stringify(gallery)})`);
        }
        if (gallery.cardCount !== FORM_GALLERY_PREVIEWS.length
          || gallery.previewSources.some((source, index) => source !== FORM_GALLERY_PREVIEWS[index])) {
          failures.push(`${engineName}@${width}px: 入社書類と社内基本書式の32プレビューが一致しません`
            + ` (${JSON.stringify(gallery.previewSources)})`);
        }
        if (gallery.cardKeys.join('/') !== FORM_GALLERY_KEYS.join('/')
          || gallery.pickerLinks.length !== FORM_GALLERY_KEYS.length
          || gallery.pickerGroups.join('/') !== '入社/勤務・休暇/休職・退職/証明・その他'
          || gallery.pickerLinks.some((link) => !FORM_GALLERY_KEYS.includes(link.key)
            || link.href !== `#fg-preview-${link.key}` || !link.visible || !link.text
            || link.height < 24 - EPSILON || link.left < -EPSILON
            || link.right > result.viewportWidth + EPSILON)
          || new Set(gallery.pickerLinks.map((link) => link.key)).size !== FORM_GALLERY_KEYS.length
          || gallery.cloneIdCount !== 0 || gallery.cloneFocusableCount !== 0) {
          failures.push(`${engineName}@${width}px: 全32書式の名称一覧・参照先・複製の読み上げ除外が不正です`
            + ` (${JSON.stringify(gallery.pickerLinks)})`);
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
          failures.push(`${engineName}@${width}px: 見本の配布先・労働条件通知書のExcel表示が一致しません`
            + ` (${JSON.stringify(gallery.cardLinks)})`);
        }
        if (width >= 901 && (gallery.firstThreeAtStart.length !== 3
          || gallery.firstThreeAtStart.some((card) => card.width <= 0
            || card.left < -EPSILON || card.right > gallery.railWidth + EPSILON))) {
          failures.push(`${engineName}@${width}px: PCの初期位置で先頭3枚の見本が収まりません`
            + ` (${JSON.stringify(gallery.firstThreeAtStart)})`);
        }
        if (gallery.kitCount !== 1 || !gallery.kitText?.replace(/\s+/g, '').includes('入社書類8点セット')
          || gallery.kitLinkCount !== 1 || gallery.kitHref !== 'shoshiki.html#onboarding-kit'
          || gallery.kitDownloadCount !== 1 || gallery.downloadHref !== 'assets/download/onboarding-kit.zip'
          || gallery.downloadAttribute === null || gallery.downloadAttribute === undefined) {
          failures.push(`${engineName}@${width}px: 書式見本内の入社書類セット案内・ZIP導線が一致しません`
            + ` (${JSON.stringify(gallery)})`);
        }
        if (!composition.backgroundSource
          || composition.backgroundSource.includes('portrait') !== (width <= 540)) {
          failures.push(`${engineName}@${width}px: 背景画像の縦横構図が人物帯と揃っていません`);
        }
        if (width >= 541 && width <= 767 && (composition.canvas.width < result.metrics.h1.width
          || composition.canvas.width > result.metrics.h1.width * 1.1)) {
          failures.push(`${engineName}@${width}px: 中間幅の人物帯と見出しの幅が揃っていません`);
        }
        if (width === 733 && composition.canvas.height > width * 0.5) {
          failures.push(`${engineName}@${width}px: 中間幅でもスマホの縦長構図が残っています`);
        }
        if (width >= 1600 && result.metrics.h1.width > composition.canvas.width + EPSILON) {
          failures.push(`${engineName}@${width}px: 大画面の見出し器が人物帯より広がっています`);
        }
        const expectedActors = width <= 767 ? 6 : 10;
        if (composition.actors.length !== expectedActors || composition.gaps.length !== expectedActors - 1) {
          failures.push(`${engineName}@${width}px: 人物の配置数・間隔を測定できません`);
        }
        // Restored layered crowd intentionally overlaps horizontally; text must stay clear.
        if (composition.titleGap < 8 || composition.titleGap > 80
          || !gallery.box || gallery.box.width <= 0 || gallery.box.height <= 0
          || composition.galleryGap === null || Math.abs(composition.galleryGap - 36) > EPSILON
          || composition.introGap === null || Math.abs(composition.introGap - 32) > EPSILON) {
          failures.push(`${engineName}@${width}px: 見出し・人物・書式見本・説明の余白が適切ではありません`
            + ` (title=${composition.titleGap}, scene→gallery=${composition.galleryGap}, gallery→intro=${composition.introGap})`);
        }
        if (composition.actors.some((actor) => actor.left < composition.canvas.left - EPSILON
          || actor.right > composition.canvas.right + EPSILON
          || actor.top < composition.canvas.top - EPSILON
          || actor.bottom > composition.canvas.bottom + EPSILON)) {
          failures.push(`${engineName}@${width}px: 人物が画像帯からはみ出しています`);
        }
        if (result.startupPhrases.length < 3 || result.startupPhrases.some((phrase) => phrase.rectCount !== 1)) {
          failures.push(`${engineName}@${width}px: 料金案内の文節・スタート顧問・金額が途中で割れています`);
        }

        if (width === 390 || width === 1280) {
          const minimum = width === 390 ? { primary: 34, secondary: 28 } : { primary: 72, secondary: 50 };
          if (result.titleFonts.primary < minimum.primary || result.titleFonts.secondary < minimum.secondary) {
            failures.push(`${engineName}@${width}px: タイトルが指定した大きさへ拡大されていません`
              + ` (primary=${result.titleFonts.primary}, secondary=${result.titleFonts.secondary})`);
          }
        }

        if (result.offenders.length) {
          failures.push(
            `${engineName}@${width}px: ${result.offenders
              .map((item) => `${item.selector} right=${item.right}`)
              .join(', ')}`,
          );
        }
        for (const [section, phrases] of [
          ['見出し', result.h1Phrases],
          ['説明文', result.subPhrases],
        ]) {
          if (phrases.length === 0) {
            failures.push(`${engineName}@${width}px: ${section}の文節を測定できません`);
          }
          for (const phrase of phrases.filter((item) => item.rectCount !== 1)) {
            failures.push(
              `${engineName}@${width}px: ${section}の文節「${phrase.text}」が`
              + `1行に収まっていません（rect=${phrase.rectCount}）`,
            );
          }
        }
        for (const [section, textCovered] of [
          ['見出し', result.h1TextCovered],
          ['説明文', result.subTextCovered],
        ]) {
          if (!textCovered) {
            failures.push(`${engineName}@${width}px: ${section}に.nwで覆われていない文字があります`);
          }
        }
        for (const [section, boundaries] of [
          ['見出し', result.h1Boundaries],
          ['説明文', result.subBoundaries],
        ]) {
          for (const boundary of boundaries.filter((item) => !item.valid)) {
            failures.push(
              `${engineName}@${width}px: ${section}の文節境界`
              + `「${boundary.before}｜${boundary.after}」の<wbr>がちょうど1個ではありません`
              + `（br=${boundary.brCount}, wbr=${boundary.wbrCount}, `
              + `文字=${boundary.meaningfulText.length}, 置換要素=${boundary.replacedElementCount}, `
              + `予期しない要素=${boundary.unexpectedElementCount}）`,
            );
          }
        }
        for (const [section, lines] of [
          ['見出し', result.h1Lines],
          ['説明文', result.subLines],
        ]) {
          const lastLine = lines.at(-1);
          if (!lastLine || lastLine.characterCount < 2) {
            failures.push(
              `${engineName}@${width}px: ${section}の最終行が2文字未満です`
              + `（${lastLine?.text ?? '未測定'}）`,
            );
          }
        }
        if (result.documentScrollWidth > result.viewportWidth) {
          failures.push(
            `${engineName}@${width}px: ページ横スクロールがあります `
            + `(scrollWidth=${result.documentScrollWidth}, viewport=${result.viewportWidth})`,
          );
        }
        if (width <= 700 && result.metrics.label.width >= result.metrics.h1.width - EPSILON) {
          failures.push(`${engineName}@${width}px: 淡緑ラベルが本文幅まで引き伸ばされています`);
        }
        // スマホ（640px以下）はヒーローの情報を絞るためサマリー帯を出さない
        if (width <= 640) {
          if (result.summaryDisplay !== 'none') {
            failures.push(
              `${engineName}@${width}px: スマホではヒーロー直下サマリーを表示しません`
              + `（display=${result.summaryDisplay}）`,
            );
          }
        } else if (width < 1024 && result.summaryColumns !== 2) {
          failures.push(
            `${engineName}@${width}px: ヒーロー直下サマリーが2列ではありません（${result.summaryColumns}列）`,
          );
        } else if (width >= 1024 && result.summaryLayout !== 'flex') {
          failures.push(`${engineName}@${width}px: PCのサマリーが既存のflex配列ではありません`);
        }
        if (FORM_GALLERY_INTERACTION_WIDTHS.includes(width)) {
          report.galleryAfterScroll = await checkFormGallery(page, engineName, width, failures);
        }
        if (errors.length) failures.push(`${engineName}@${width}px: ${errors.join(' / ')}`);
        await page.close();
      }
      const beforeSpread = results.find((item) => item.engine === engineName && item.width === 540).composition;
      const afterSpread = results.find((item) => item.engine === engineName && item.width === 541).composition;
      if (Math.abs(beforeSpread.canvas.height - afterSpread.canvas.height) > 2
        || beforeSpread.actors.some((actor) => {
          const next = afterSpread.actors.find((item) => item.actor === actor.actor);
          return !next || Math.abs(actor.width - next.width) > 2
            || Math.abs((actor.left - beforeSpread.canvas.left) - (next.left - afterSpread.canvas.left)) > 2
            || Math.abs((actor.top - beforeSpread.canvas.top) - (next.top - afterSpread.canvas.top)) > 2;
        })) {
        failures.push(`${engineName}@540/541px: 中間幅への切替で人物帯の高さ・位置が急変しています`);
      }
      const beforePC = results.find((item) => item.engine === engineName && item.width === 767);
      const afterPC = results.find((item) => item.engine === engineName && item.width === 768);
      if (afterPC.titleFonts.secondary < beforePC.titleFonts.secondary - EPSILON) {
        failures.push(`${engineName}@767/768px: 画面を広げると緑の見出しが小さくなっています`);
      }
      // A classic scrollbar can make the stage narrower than 100vw. Exercise
      // that width difference even on runners with overlay scrollbars.
      for (const width of [541, 733]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await prepareLocalHttpPage(page);
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.evaluate(() => document.fonts.ready);
        await page.locator('#top .hero-stage').evaluate((stage) => {
          stage.style.flex = '0 0 auto';
          stage.style.width = 'calc(100% - 17px)';
        });
        const result = await measure(page);
        containerResults.push({ engine: engineName, width, errors, ...result });
        const { canvas, actors } = result.composition;
        if (Math.abs(result.metrics.stage.width - (result.viewportWidth - 17)) > EPSILON
          || canvas.width > result.metrics.stage.width + EPSILON || actors.length !== 6
          || actors.some((actor) => actor.width <= 0 || actor.height <= 0
            || actor.left < canvas.left - EPSILON || actor.right > canvas.right + EPSILON
            || actor.top < canvas.top - EPSILON || actor.bottom > canvas.bottom + EPSILON)
          || result.offenders.length) {
          failures.push(`${engineName}@${width}px: 表示領域が17px狭くなると人物・文字が切れます`);
        }
        if (errors.length) failures.push(`${engineName}@${width}px narrowed stage: ${errors.join(' / ')}`);
        await page.close();
      }
      for (const width of MOTION_WIDTHS) {
        motionResults.push(await checkMotionTimeline(browser, engineName, width, failures));
      }
      motionResults.push(await checkMotionCancellation(browser, engineName, failures));
      for (const width of [390, 768]) {
        motionResults.push(await checkReducedMotion(browser, engineName, width, failures));
      }
    } finally {
      await browser.close();
    }
  }

  if (asJson) {
    // 失敗要点はstderrへ先に出し、JSONも自然終了までflushして保存する。
    if (failures.length) {
      console.error(`失敗: ${failures.length}件`);
      for (const failure of failures) console.error(`- ${failure}`);
    }
    console.log(JSON.stringify({ base, epsilon: EPSILON, results, containerResults, motionResults, failures }, null, 2));
  } else {
    for (const result of results) {
      const {
        stage, overlay, label, h1, sub, buttons, trust,
      } = result.metrics;
      console.log(
        `${result.engine}@${result.width}px `
        + `stage=${stage.width}/${stage.right} overlay=${overlay.width}/${overlay.right} `
        + `label=${label.width}/${label.right} h1=${h1.width}/${h1.right} `
        + `sub=${sub.width}/${sub.right} buttons=${buttons.width}/${buttons.right} `
        + `trust=${trust.width}/${trust.right} `
        + `scroll=${result.documentScrollWidth - result.viewportWidth} `
        + `overflow=${result.offenders.length}`,
      );
      if (result.width === 402) {
        console.log(`  h1 lines: ${result.h1Lines.map((line) => line.text).join(' / ')}`);
      }
    }
    console.log(`登場演出: ${motionResults.length}条件（即時開始・落下・着地・中断・SPA・動きの抑制）`);
    console.log(failures.length ? `失敗: ${failures.length}件` : '合格: ヒーローの横はみ出し・登場演出');
    for (const failure of failures) console.error(`- ${failure}`);
  }

  if (failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
