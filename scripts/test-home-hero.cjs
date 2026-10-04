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

const WIDTHS = [320, 360, 375, 390, 402, 429, 430, 431, 699, 700, 701, 767, 768, 1024, 1100, 1101, 1280, 1440, 1599, 1600, 1601, 1920, 2560, 2774];
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];
const EPSILON = 1;
const MOTION_WIDTHS = [390, 767, 768, 1280, 1920];
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

    return {
      viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      titleFonts: {
        primary: parseFloat(getComputedStyle(document.querySelector('.hero-services')).fontSize),
        secondary: parseFloat(getComputedStyle(document.querySelector('.hero-h1 strong')).fontSize),
      },
      composition: {
        canvas: canvasBox, actors: actorBoxes,
        gaps: actorBoxes.slice(1).map((actor, index) => actor.left - actorBoxes[index].right),
        titleGap: Math.min(...actorBoxes.map((actor) => actor.top)) - titleBox.bottom,
        introGap: boxOf(document.querySelector('.hero-intro')).top
          - Math.max(...actorBoxes.map((actor) => actor.bottom)),
        backgroundOpacity: Number(getComputedStyle(canvas.querySelector('.hero-town')).opacity),
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
      const style = getComputedStyle(actor.querySelector('.hero-poses'));
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      return {
        actor: actor.dataset.actor, y: matrix.m42,
        angle: Math.atan2(-matrix.m13, matrix.m11) * 180 / Math.PI,
        opacity: Number(style.opacity),
      };
    });
    return {
      label, now: performance.now(), classes: [...stage.classList],
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

function checkResting(state, check) {
  check(state.classes.includes('hero-settled')
    && !state.classes.includes('hero-pending') && !state.classes.includes('hero-entering'),
  `${state.label}: 終端クラスが一致しません (${state.classes.join(' ')})`);
  check(state.actors.every((actor) => Math.abs(actor.y) < 0.01
    && Math.abs(actor.angle) < 0.01 && Math.abs(actor.opacity - 1) < 0.001),
  `${state.label}: 定位置・角度0・不透明度1へ戻っていません`);
  check(state.titleGap >= 8, `${state.label}: タイトルと着地後の人物の間隔が不足 (${state.titleGap}px)`);
}

async function motionScreenshot(page, engine, width, phase, screenshots) {
  if (!process.env.RUNNER_TEMP || ![390, 768, 1280, 1920].includes(width)) return;
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
  let stageOrigin = origin;
  try {
    for (const reason of ['offscreen', 'hidden-event', 'breakpoint', 'reduced-motion']) {
      await advanceMotionTo(page, stageOrigin + 128);
      if (reason === 'offscreen') {
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      } else if (reason === 'hidden-event') {
        // Explicit event simulation; this does not claim to test OS/tab visibility.
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      } else if (reason === 'breakpoint') await page.setViewportSize({ width: 768, height: 900 });
      else await page.emulateMedia({ reducedMotion: 'reduce' });
      let state;
      // IntersectionObserver is delivered by rendering, independently of fake timers.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.clock.runFor(17);
        state = await readMotion(page, `cancel-${reason}`);
        if (state.classes.includes('hero-settled')) break;
      }
      samples.push(state); checkResting(state, check);
      if (reason === 'offscreen') await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      else if (reason === 'hidden-event') await page.evaluate(() => {
        delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
      });
      else if (reason === 'breakpoint') await page.setViewportSize({ width: 390, height: 900 });
      else await page.emulateMedia({ reducedMotion: 'no-preference' });
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
    return { engine, width: 390, scenario: 'cancellation', samples, errors };
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
        results.push({ engine: engineName, width, errors, ...result,
          entryScreenshots: await entryScreenshots(page, engineName, width) });

        const composition = result.composition;
        const expectedActors = width <= 767 ? 6 : 10;
        if (composition.actors.length !== expectedActors || composition.gaps.length !== expectedActors - 1) {
          failures.push(`${engineName}@${width}px: 人物の配置数・間隔を測定できません`);
        }
        // Restored layered crowd intentionally overlaps horizontally; text must stay clear.
        if (composition.titleGap < 8 || composition.titleGap > 80 || composition.introGap < 32) {
          failures.push(`${engineName}@${width}px: 人物と見出し・説明の余白が適切ではありません`
            + ` (title=${composition.titleGap}, intro=${composition.introGap})`);
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
        if (errors.length) failures.push(`${engineName}@${width}px: ${errors.join(' / ')}`);
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
    // JSONは巨大で、失敗時に process.exit するとログ側で末尾が切れて failures が読めない。
    // 失敗の要点だけ先に stderr へ出す（実行ログはこちらを優先表示する）。
    if (failures.length) {
      console.error(`失敗: ${failures.length}件`);
      for (const failure of failures) console.error(`- ${failure}`);
    }
    console.log(JSON.stringify({ base, epsilon: EPSILON, results, motionResults, failures }, null, 2));
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

  if (failures.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
