/**
 * 最終CTA本文の文節改行回帰テスト。
 *
 *   node scripts/test-final-copy.cjs [base] [--json]
 *
 * content-visibility:auto の節を必ず表示領域へ送ってから測る。
 * 対象・文節・行のどれかが0件なら「問題0件」ではなく未測定として失敗させる。
 */

const { execFileSync } = require('node:child_process');
const { chromium, webkit } = require('playwright');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const asJson = args.includes('--json');

const PAGES = ['index.html', 'about.html', 'pricing.html', 'services.html', 'support.html'];
const WIDTHS = [320, 402, 430, 768];
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];
const PHRASES = [
  '助成金、手続きの効率化、トラブル予防——',
  'どこから手をつければいいか、',
  '一緒に考えます。',
];
const EXPECTED_LINES = new Map([
  [320, PHRASES],
  [402, [PHRASES[0], PHRASES[1] + PHRASES[2]]],
  [430, [PHRASES[0], PHRASES[1] + PHRASES[2]]],
  [768, [PHRASES.join('')]],
]);
const EPSILON = 1;
const UPGRADE_INSECURE_META =
  /<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">/gi;
const RETRYABLE_NAVIGATION = /ERR_CONNECTION_RESET|ECONNRESET|ERR_EMPTY_RESPONSE|ERR_SOCKET_NOT_CONNECTED/i;

function commitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function sameLines(actual, expected) {
  return actual.length === expected.length && actual.every((line, index) => line === expected[index]);
}

function recordConsoleError(target) {
  return (message) => {
    if (message.type() !== 'error') return;
    const url = message.location().url || '';
    const text = message.text();
    if (/minano-sr\.goatcounter\.com\/count/.test(url)) return;
    if (/Failed to load resource: A TLS error/.test(text)) return;
    target.push(`console ${url || 'unknown'}: ${text}`);
  };
}

async function prepareLocalHttpPage(page) {
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'http:') return;

  // WebKitがローカルHTTPの相対CSSをHTTPS化しないよう、文書のCSPだけ外す。
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

async function gotoWithRetry(page, url) {
  let retries = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return { response, retries };
    } catch (error) {
      if (attempt === 0 && RETRYABLE_NAVIGATION.test(String(error))) {
        retries += 1;
        await page.waitForTimeout(250);
        continue;
      }
      error.navigationRetries = retries;
      throw error;
    }
  }
  throw new Error(`${url} を読み込めませんでした`);
}

async function renderAndMeasure(page) {
  const locator = page.locator('.final-p');
  const targetCount = await locator.count();
  if (targetCount !== 1) {
    return {
      measured: false,
      targetCount,
      phraseCount: 0,
      wbrCount: 0,
      phrases: [],
      lines: [],
      offenders: [],
      pageOverflow: 0,
      targetRect: null,
    };
  }

  await page.waitForFunction(() => {
    const style = document.querySelector('link[data-async-style]');
    return !style || style.media === 'all';
  }, null, { timeout: 5000 });
  await page.waitForFunction(
    () => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift'),
    null,
    { timeout: 8000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(async (element) => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rect = element.getBoundingClientRect();
      const targetY = scrollY + rect.top - Math.max(0, (innerHeight - rect.height) / 2);
      scrollTo(0, Math.max(0, targetY));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  });

  return page.evaluate((epsilon) => {
    const target = document.querySelector('.final-p');
    const viewportWidth = document.documentElement.clientWidth;
    const targetRect = target.getBoundingClientRect();
    const phrases = [...target.querySelectorAll(':scope > .nw')].map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      const rect = rects[0];
      return {
        text: element.textContent,
        rectCount: rects.length,
        width: rect ? Number(rect.width.toFixed(2)) : 0,
        left: rect ? Number(rect.left.toFixed(2)) : 0,
        right: rect ? Number(rect.right.toFixed(2)) : 0,
        top: rect ? Number(rect.top.toFixed(2)) : null,
      };
    });
    const lines = [];
    for (const phrase of phrases.filter((item) => item.rectCount === 1)) {
      let line = lines.find((item) => Math.abs(item.top - phrase.top) < 1);
      if (!line) {
        line = { top: phrase.top, text: '' };
        lines.push(line);
      }
      line.text += phrase.text;
    }
    const offenders = [target, ...target.querySelectorAll('*')].flatMap((element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || (rect.left >= -epsilon && rect.right <= viewportWidth + epsilon)) return [];
      return [{
        selector: element === target ? '.final-p' : element.tagName.toLowerCase(),
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
      }];
    });

    return {
      measured: targetRect.width > 0 && targetRect.height > 0
        && phrases.length === 3 && phrases.every((phrase) => phrase.rectCount === 1)
        && lines.length > 0,
      targetCount: 1,
      phraseCount: phrases.length,
      wbrCount: target.querySelectorAll(':scope > wbr').length,
      phrases,
      lines: lines.sort((a, b) => a.top - b.top).map((line) => line.text),
      offenders,
      pageOverflow: document.documentElement.scrollWidth - viewportWidth,
      targetRect: {
        width: Number(targetRect.width.toFixed(2)),
        height: Number(targetRect.height.toFixed(2)),
        left: Number(targetRect.left.toFixed(2)),
        right: Number(targetRect.right.toFixed(2)),
        top: Number(targetRect.top.toFixed(2)),
        bottom: Number(targetRect.bottom.toFixed(2)),
        inViewport: targetRect.bottom > 0 && targetRect.top < innerHeight,
      },
    };
  }, EPSILON);
}

(async () => {
  const startedAt = new Date().toISOString();
  const results = [];

  for (const [engine, browserType] of ENGINES) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const pageName of PAGES) {
        for (const width of WIDTHS) {
          const page = await browser.newPage({
            viewport: { width, height: width < 768 ? 900 : 1024 },
            deviceScaleFactor: width < 768 ? 3 : 1,
            isMobile: width < 768,
            hasTouch: width < 768,
          });
          await prepareLocalHttpPage(page);
          const runtimeErrors = [];
          page.on('console', recordConsoleError(runtimeErrors));
          page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));

          let retries = 0;
          let responseOk = false;
          let measurement;
          let loadError = '';
          try {
            const navigation = await gotoWithRetry(page, new URL(pageName, base).href);
            retries = navigation.retries;
            responseOk = Boolean(navigation.response?.ok());
            measurement = await renderAndMeasure(page);
          } catch (error) {
            retries = error.navigationRetries || retries;
            loadError = String(error);
            measurement = {
              measured: false,
              targetCount: 0,
              phraseCount: 0,
              wbrCount: 0,
              phrases: [],
              lines: [],
              offenders: [],
              pageOverflow: 0,
              targetRect: null,
            };
          }

          const conditionFailures = [];
          if (!responseOk) conditionFailures.push('HTTP応答が成功ではありません');
          if (loadError) conditionFailures.push(`読み込み失敗: ${loadError}`);
          if (!measurement.measured) conditionFailures.push('対象・文節・行を実測できません');
          if (measurement.targetCount !== 1) conditionFailures.push(`.final-pが1件ではありません（${measurement.targetCount}件）`);
          if (measurement.phraseCount !== PHRASES.length) conditionFailures.push(`.nwが${PHRASES.length}件ではありません（${measurement.phraseCount}件）`);
          if (measurement.wbrCount !== 2) conditionFailures.push(`<wbr>が2件ではありません（${measurement.wbrCount}件）`);
          measurement.phrases.forEach((phrase, index) => {
            if (phrase.text !== PHRASES[index]) conditionFailures.push(`文節${index + 1}の文言が一致しません`);
            if (phrase.rectCount !== 1) conditionFailures.push(`文節${index + 1}の描画行が1本ではありません（${phrase.rectCount}本）`);
            if (phrase.left < -EPSILON || phrase.right > width + EPSILON) {
              conditionFailures.push(`文節${index + 1}が画面外です（${phrase.left}〜${phrase.right}px）`);
            }
          });
          if (!sameLines(measurement.lines, EXPECTED_LINES.get(width))) {
            conditionFailures.push(`改行が想定外です（${measurement.lines.join(' / ') || '0行'}）`);
          }
          if (!measurement.targetRect?.inViewport) conditionFailures.push('.final-pが表示領域内にありません');
          if (measurement.pageOverflow > EPSILON) conditionFailures.push(`ページが${measurement.pageOverflow}px横スクロールします`);
          if (measurement.offenders.length) conditionFailures.push(`.final-p内の横はみ出し${measurement.offenders.length}件`);
          if (runtimeErrors.length) conditionFailures.push(...runtimeErrors);

          results.push({
            engine,
            page: pageName,
            width,
            retries,
            responseOk,
            ...measurement,
            failures: conditionFailures,
          });
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }

  const expectedConditions = ENGINES.length * PAGES.length * WIDTHS.length;
  const expectedPhrases = expectedConditions * PHRASES.length;
  const measuredConditions = results.filter((result) => result.measured).length;
  const measuredPhrases = results.reduce(
    (sum, result) => sum + result.phrases.filter((phrase) => phrase.rectCount === 1).length,
    0,
  );
  const passedConditions = results.filter((result) => result.failures.length === 0).length;
  const failures = results.flatMap((result) => result.failures.map(
    (failure) => `${result.engine}:${result.page}@${result.width}px ${failure}`,
  ));
  if (results.length !== expectedConditions) failures.push(`条件数が${expectedConditions}件ではありません（${results.length}件）`);
  if (measuredConditions !== expectedConditions) failures.push(`実測済みが${expectedConditions}件ではありません（${measuredConditions}件）`);
  if (measuredPhrases !== expectedPhrases) failures.push(`文節の実測済みが${expectedPhrases}件ではありません（${measuredPhrases}件）`);

  const report = {
    commit: commitSha(),
    startedAt,
    completedAt: new Date().toISOString(),
    base,
    engines: ENGINES.map(([name]) => name),
    pages: PAGES,
    widths: WIDTHS,
    summary: {
      expectedConditions,
      recordedConditions: results.length,
      measuredConditions,
      unmeasuredConditions: expectedConditions - measuredConditions,
      passedConditions,
      expectedPhrases,
      measuredPhrases,
      retries: results.reduce((sum, result) => sum + result.retries, 0),
      failures: failures.length,
    },
    results,
    failures,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `検証: ${ENGINES.length}エンジン × ${PAGES.length}ページ × ${WIDTHS.length}画面幅 = ${expectedConditions}通り`,
    );
    console.log(
      `期待${expectedConditions} / 記録${results.length} / 実測${measuredConditions} / `
      + `合格${passedConditions} / 未測定${expectedConditions - measuredConditions}`,
    );
    console.log(failures.length ? `失敗: ${failures.length}件` : '合格: 文節どおりの改行・横スクロール0件');
    failures.forEach((failure) => console.error(`- ${failure}`));
  }

  if (failures.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
