#!/usr/bin/env node

/**
 * モバイル見出しの要素ボックスと、実際に操作できる横スクロールを検査する。
 *
 * hanging-punctuation: allow-end による行末約物1文字分を除外し、残るRange超過を検査する。
 * --disp はOSごとに字幅が異なるため、CIのNoto CJKに合わせたscaleX補正は行わない。
 * WebKitはoverflow-x:clipでもscrollToだけを受理するため、合否は実入力後のscrollXで決める。
 */

const { chromium, webkit } = require('playwright');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const asJson = args.includes('--json');
const WIDTHS = [320, 360, 375, 390, 402, 430, 431, 450, 451, 459, 460, 461, 465, 466, 768];
const PAGES = [
  {
    page: 'index.html',
    selectors: '#why .sec-h',
    expectedHeadingCount: 1,
    expectedSelectorCounts: [{ selector: '#why .sec-h', count: 1 }],
  },
  {
    page: 'services.html',
    selectors: '#approach .sec-h',
    expectedHeadingCount: 1,
    expectedSelectorCounts: [{ selector: '#approach .sec-h', count: 1 }],
  },
  {
    page: 'about.html',
    selectors: '#voice .sec-h',
    expectedHeadingCount: 1,
    expectedSelectorCounts: [{ selector: '#voice .sec-h', count: 1 }],
  },
  {
    page: 'blog.html',
    selectors: 'body[data-nav="B"] .page-h',
    expectedHeadingCount: 1,
    expectedSelectorCounts: [{ selector: 'body[data-nav="B"] .page-h', count: 1 }],
  },
  {
    page: 'recruit.html',
    selectors: '.page-hero h1, .rc-h',
    expectedHeadingCount: 7,
    expectedSelectorCounts: [
      { selector: '.page-hero h1', count: 1 },
      { selector: '.rc-h', count: 6 },
    ],
  },
];
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];
const EPSILON = 1;
const HANGING_END_PUNCTUATION = new Set([...'。、）」』】〕》〉，．・']);
const UPGRADE_INSECURE_META =
  /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*content=["'][^"']*upgrade-insecure-requests[^"']*["'][^>]*>/gi;

async function prepareLocalHttpPage(page) {
  // 見出しの測定に無関係な外部地図は、第三者スクリプトの一過性エラーで
  // レイアウト回帰テストが揺れないよう決定的な空文書へ置き換える。
  await page.route(/^https:\/\/maps\.google\.com\/maps(?:[?#]|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body></body></html>',
    });
  });

  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'http:') return;
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

async function settlePage(page) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('link[data-async-style]')]
        .every((link) => link.media === 'all'),
      null,
      { timeout: 1500 },
    );
  } catch {
    // ローカルHTTPのWebKitではlink.onloadが発火しないことがある。
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('link[data-async-style]')) link.media = 'all';
    });
    await page.waitForTimeout(100);
  }
  await page.addStyleTag({ content: `
    html { scroll-behavior: auto !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; }
    .rv, .rvl { opacity: 1 !important; transform: none !important; }
    main > section, .hub-page > section { content-visibility: visible !important; }
  ` });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const step = Math.max(240, Math.floor(innerHeight * 0.7));
    const end = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    for (let y = 0; y <= end; y += step) {
      scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function measure(page, selectors, expectedSelectorCounts) {
  return page.evaluate(async ({ selectors, expectedSelectorCounts, epsilon, hangingEndPunctuation }) => {
    const allowedHangingEndPunctuation = new Set(hangingEndPunctuation);
    const viewportWidth = document.documentElement.clientWidth;
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const headings = [...document.querySelectorAll(selectors)].filter(isVisible);
    const selectorCounts = expectedSelectorCounts.map(({ selector, count }) => ({
      selector,
      expected: count,
      actual: [...document.querySelectorAll(selector)].filter(isVisible).length,
    }));
    const measured = headings.map((element) => {
      const chars = [];
      let sourceOrder = 0;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let index = 0; index < node.textContent.length;) {
          const startIndex = index;
          const codePoint = node.textContent.codePointAt(index);
          const character = String.fromCodePoint(codePoint);
          const nextIndex = index + character.length;
          index = nextIndex;
          const characterSourceOrder = sourceOrder;
          sourceOrder += 1;
          if (/\s/.test(character)) continue;
          const range = document.createRange();
          range.setStart(node, startIndex);
          range.setEnd(node, nextIndex);
          const rect = range.getBoundingClientRect();
          if (!rect.width && !rect.height) continue;
          chars.push({
            character,
            top: rect.top,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            sourceOrder: characterSourceOrder,
          });
        }
      }
      const lines = [];
      for (const item of chars) {
        let line = lines.find((candidate) => Math.abs(candidate.top - item.top) <= 3);
        if (!line) {
          line = { top: item.top, text: '', left: item.left, right: item.right, chars: [] };
          lines.push(line);
        }
        line.text += item.character;
        line.left = Math.min(line.left, item.left);
        line.right = Math.max(line.right, item.right);
        line.chars.push(item);
      }
      lines.sort((left, right) => left.top - right.top);
      const measuredLines = lines.map((line) => {
        const orderedCharacters = [...line.chars]
          .sort((left, right) => left.sourceOrder - right.sourceOrder);
        const terminal = orderedCharacters.at(-1);
        const terminalMakesRawRight = terminal
          ? Math.abs(terminal.right - line.right) <= 0.01
          : false;
        const terminalIsAllowed = terminal
          ? allowedHangingEndPunctuation.has(terminal.character)
          : false;
        const terminalExcluded = terminalMakesRawRight && terminalIsAllowed;
        const otherCharacterRight = orderedCharacters.length > 1
          ? Math.max(...orderedCharacters.slice(0, -1).map((item) => item.right))
          : Number.NEGATIVE_INFINITY;
        const effectiveRight = terminalExcluded
          ? Math.max(line.right - terminal.width, otherCharacterRight)
          : line.right;
        return {
          text: line.text,
          left: line.left,
          rawRight: line.right,
          effectiveRight,
          rawRangeOverflow: line.left < -epsilon || line.right > viewportWidth + epsilon,
          effectiveRangeOverflow: line.left < -epsilon || effectiveRight > viewportWidth + epsilon,
          terminalCharacter: terminal?.character ?? null,
          terminalSourceOrder: terminal?.sourceOrder ?? null,
          terminalMakesRawRight,
          terminalIsAllowed,
          terminalExcluded,
          terminalRangeWidth: terminal?.width ?? 0,
          characters: orderedCharacters.map((item) => ({
            character: item.character,
            sourceOrder: item.sourceOrder,
            left: item.left,
            right: item.right,
            width: item.width,
          })),
        };
      });
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector: element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`,
        text: element.textContent.replace(/\s+/g, ' ').trim(),
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        transform: style.transform,
        box: { left: box.left, right: box.right },
        lineCount: measuredLines.length,
        lines: measuredLines,
        measuredCharacters: chars.length,
        rangeOverflow: measuredLines.some((line) => line.rawRangeOverflow),
        effectiveRangeOverflow: measuredLines.some((line) => line.effectiveRangeOverflow),
        boxOverflow: box.left < -epsilon || box.right > viewportWidth + epsilon,
        orphanLine: measuredLines.some((line) => [...line.text].length <= 1),
      };
    });

    scrollTo(9999, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const maximumScrollX = scrollX;
    scrollTo(0, 0);
    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      maximumScrollX,
      headingCount: headings.length,
      selectorCounts,
      headings: measured,
      completed: headings.length > 0
        && measured.every((item) => item.measuredCharacters > 0 && item.lineCount > 0)
        && selectorCounts.every((item) => item.actual === item.expected),
    };
  }, {
    selectors,
    expectedSelectorCounts,
    epsilon: EPSILON,
    hangingEndPunctuation: [...HANGING_END_PUNCTUATION],
  });
}

async function measureUserHorizontalScroll(page, width) {
  await page.evaluate(() => new Promise((resolve) => {
    scrollTo(0, 0);
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.mouse.move(Math.max(1, Math.floor(width / 2)), 1);
  await page.mouse.wheel(9999, 0);
  const userScrollX = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollX)));
  }));
  await page.evaluate(() => scrollTo(0, 0));
  return userScrollX;
}

function collectFailures(measurement, expectedHeadingCount, errors = []) {
  const failures = [];
  if (!measurement.completed) failures.push('見出しの実測未完了');
  if (measurement.headingCount !== expectedHeadingCount) {
    failures.push(`見出し件数 ${measurement.headingCount}/${expectedHeadingCount}`);
  }
  for (const item of measurement.selectorCounts) {
    if (item.actual !== item.expected) {
      failures.push(`${item.selector} の件数 ${item.actual}/${item.expected}`);
    }
  }
  if (measurement.userScrollX !== 0) {
    failures.push(`実入力scrollX ${measurement.userScrollX}px`);
  }
  for (const heading of measurement.headings) {
    if (heading.boxOverflow) failures.push(`${heading.selector} のboxが画面外`);
    if (heading.effectiveRangeOverflow) {
      failures.push(`${heading.selector} の補正後文字Rangeが画面外`);
    }
    if (heading.orphanLine) failures.push(`${heading.selector} に1文字だけの行`);
  }
  if (errors.length) failures.push(...errors);
  return failures;
}

const FIXTURE_WIDTH = 390;
const FIXTURE_STYLE = `
  html, body { margin: 0; padding: 0; }
  html.clip, html.clip body { overflow-x: clip; }
  #target {
    box-sizing: border-box;
    position: relative;
    width: 350px;
    height: 24px;
    margin: 0 0 0 20px;
    font: 24px/1 monospace;
    white-space: nowrap;
  }
  .terminal { position: absolute; top: 0; left: 360px; }
  .terminal-second { position: absolute; top: 0; left: 385px; }
  .left-range { position: absolute; top: 0; left: -40px; }
  .wide-document { position: absolute; top: 100px; left: 0; width: 800px; height: 1px; }
`;
const FIXTURES = [
  {
    name: '単一の行末約物は1文字分だけ控除して合格',
    html: '<h2 id="target">ABC<span class="terminal">。</span></h2>',
    clip: true,
    expectation: 'single-punctuation-pass',
  },
  {
    name: '長いASCIIのRange超過は不合格',
    html: '<h2 id="target">ABC<span class="terminal">LONGASCII</span></h2>',
    clip: true,
    expectation: 'effective-range-fail',
  },
  {
    name: '二連約物は末尾1文字だけ控除しても超過すれば不合格',
    html: '<h2 id="target">ABC<span class="terminal">。</span><span class="terminal-second">。</span></h2>',
    clip: true,
    expectation: 'double-punctuation-fail',
  },
  {
    name: '左側のRange超過は控除せず不合格',
    html: '<h2 id="target">ABC<span class="left-range">A</span></h2>',
    clip: true,
    expectation: 'effective-range-fail',
  },
  {
    name: '要素ボックスの超過は不合格',
    html: '<h2 id="target" style="width:420px">ABC</h2>',
    clip: true,
    expectation: 'box-fail',
  },
  {
    name: 'clip下のdocument幅超過は実入力で動かなければ合格',
    html: '<h2 id="target">ABC</h2><div class="wide-document"></div>',
    clip: true,
    expectation: 'clip-document-pass',
  },
  {
    name: '実際に横スクロールできるdocumentは不合格',
    html: '<h2 id="target">ABC</h2><div class="wide-document"></div>',
    clip: false,
    expectation: 'scrollable-document-fail',
  },
  {
    name: 'selector期待件数不一致と0件測定は不合格',
    html: '<h2 id="target">ABC</h2>',
    clip: true,
    selectors: '#missing',
    expectedSelectorCounts: [{ selector: '#missing', count: 1 }],
    expectedHeadingCount: 1,
    expectation: 'zero-measurement-fail',
  },
];

function validateFixture(fixture, measurement, failures) {
  const heading = measurement.headings[0];
  const line = heading?.lines[0];
  const issues = [];
  if (fixture.expectation === 'zero-measurement-fail') {
    const expected = [
      '見出しの実測未完了',
      '見出し件数 0/1',
      '#missing の件数 0/1',
    ];
    if (measurement.completed || measurement.headingCount !== 0
      || failures.length !== expected.length
      || expected.some((item) => !failures.includes(item))) {
      issues.push(`0件測定の期待した失敗 [${expected.join(', ')}] に対し [${failures.join(', ')}]`);
    }
    return issues;
  }
  if (!measurement.completed || measurement.headingCount === 0 || !heading || !line) {
    issues.push('fixtureを1件以上実測できていない');
    return issues;
  }
  const maximumSourceOrder = Math.max(...line.characters.map((item) => item.sourceOrder));
  if (line.terminalSourceOrder !== maximumSourceOrder) {
    issues.push('行末文字が同一行のsourceOrder最大値と一致しない');
  }
  const rangeFailure = `${heading.selector} の補正後文字Rangeが画面外`;
  const boxFailure = `${heading.selector} のboxが画面外`;
  const scrollFailures = failures.filter((item) => item.startsWith('実入力scrollX '));
  const expectOnly = (expected) => {
    if (failures.length !== expected.length
      || expected.some((item) => !failures.includes(item))) {
      issues.push(`期待した失敗 [${expected.join(', ')}] に対し [${failures.join(', ')}]`);
    }
  };

  switch (fixture.expectation) {
    case 'single-punctuation-pass':
      expectOnly([]);
      if (!heading.rangeOverflow || heading.effectiveRangeOverflow
        || line.terminalCharacter !== '。' || !line.terminalExcluded
        || !(line.effectiveRight < line.rawRight)) {
        issues.push('単一約物のraw/effective/terminal記録が期待と不一致');
      }
      break;
    case 'effective-range-fail':
      expectOnly([rangeFailure]);
      if (!heading.effectiveRangeOverflow) issues.push('補正後Range超過を検出していない');
      break;
    case 'double-punctuation-fail':
      expectOnly([rangeFailure]);
      if (!line.terminalExcluded || line.terminalCharacter !== '。'
        || !heading.effectiveRangeOverflow) {
        issues.push('二連約物で末尾1文字だけを控除できていない');
      }
      break;
    case 'box-fail':
      expectOnly([boxFailure]);
      if (!heading.boxOverflow) issues.push('box超過を検出していない');
      break;
    case 'clip-document-pass':
      expectOnly([]);
      if (!(measurement.documentWidth > measurement.viewportWidth)) {
        issues.push('clip fixtureのdocument幅がviewportを超えていない');
      }
      if (measurement.userScrollX !== 0) issues.push('clip下で実入力scrollXが0ではない');
      break;
    case 'scrollable-document-fail':
      if (failures.length !== 1 || scrollFailures.length !== 1) {
        issues.push(`実入力scrollXだけが失敗する想定に対し [${failures.join(', ')}]`);
      }
      if (!(measurement.documentWidth > measurement.viewportWidth)) {
        issues.push('scrollable fixtureのdocument幅がviewportを超えていない');
      }
      if (!(measurement.userScrollX > 0)) issues.push('実入力で横スクロールできていない');
      break;
    default:
      issues.push(`未知のfixture期待値: ${fixture.expectation}`);
  }
  return issues;
}

async function auditFixtures(engine, browserType) {
  const browser = await browserType.launch({ headless: true });
  const results = [];
  try {
    for (const fixture of FIXTURES) {
      const page = await browser.newPage({ viewport: { width: FIXTURE_WIDTH, height: 900 } });
      const errors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      try {
        const htmlClass = fixture.clip ? ' class="clip"' : '';
        await page.setContent(
          `<!doctype html><html${htmlClass}><head><style>${FIXTURE_STYLE}</style></head><body>${fixture.html}</body></html>`,
          { waitUntil: 'domcontentloaded' },
        );
        await page.evaluate(() => document.fonts.ready);
        const measurement = await measure(
          page,
          fixture.selectors ?? '#target',
          fixture.expectedSelectorCounts ?? [{ selector: '#target', count: 1 }],
        );
        measurement.userScrollX = await measureUserHorizontalScroll(page, FIXTURE_WIDTH);
        const expectedHeadingCount = fixture.expectedHeadingCount ?? 1;
        measurement.completed = measurement.completed
          && measurement.headingCount === expectedHeadingCount;
        const failures = collectFailures(measurement, expectedHeadingCount, errors);
        const validationErrors = validateFixture(fixture, measurement, failures);
        results.push({
          engine,
          fixture: fixture.name,
          expectation: fixture.expectation,
          ...measurement,
          errors,
          failures,
          validationErrors,
          passed: validationErrors.length === 0,
        });
      } catch (error) {
        results.push({
          engine,
          fixture: fixture.name,
          expectation: fixture.expectation,
          completed: false,
          errors: [error.message],
          failures: [error.message],
          validationErrors: [error.message],
          passed: false,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function auditEngine(engine, browserType) {
  const browser = await browserType.launch({ headless: true });
  const results = [];
  const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 900 } });
  let activeErrors = null;
  page.on('console', (message) => {
    if (activeErrors && message.type() === 'error') {
      activeErrors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    if (activeErrors) activeErrors.push(`pageerror: ${error.message}`);
  });
  try {
    await prepareLocalHttpPage(page);
    for (const target of PAGES) {
      for (const width of WIDTHS) {
        const errors = [];
        try {
          await page.setViewportSize({ width, height: 900 });
          activeErrors = errors;
          const response = await page.goto(new URL(target.page, base).href, {
            waitUntil: 'domcontentloaded',
            timeout: 20_000,
          });
          if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? '応答なし'}`);
          await settlePage(page);
          const measurement = await measure(
            page,
            target.selectors,
            target.expectedSelectorCounts,
          );
          measurement.userScrollX = await measureUserHorizontalScroll(page, width);
          measurement.completed = measurement.completed
            && measurement.headingCount === target.expectedHeadingCount;
          const failures = collectFailures(measurement, target.expectedHeadingCount, errors);
          results.push({
            engine,
            page: target.page,
            width,
            expectedHeadingCount: target.expectedHeadingCount,
            ...measurement,
            errors,
            failures,
          });
        } catch (error) {
          results.push({
            engine,
            page: target.page,
            width,
            completed: false,
            errors: [error.message],
            failures: [error.message],
          });
        } finally {
          activeErrors = null;
        }
      }
    }
  } finally {
    activeErrors = null;
    if (!page.isClosed()) await page.close();
    await browser.close();
  }
  return results;
}

(async () => {
  const startedAt = Date.now();
  const results = [];
  const fixtures = [];
  for (const [engine, browserType] of ENGINES) {
    fixtures.push(...await auditFixtures(engine, browserType));
    results.push(...await auditEngine(engine, browserType));
  }
  const expectedConditions = ENGINES.length * PAGES.length * WIDTHS.length;
  const recordedConditions = results.length;
  const completedConditions = results.filter((result) => result.completed).length;
  const unmeasuredConditions = expectedConditions - completedConditions;
  const failedConditions = results.filter((result) => result.failures.length > 0);
  const expectedFixtures = ENGINES.length * FIXTURES.length;
  const recordedFixtures = fixtures.length;
  const completedFixtures = fixtures.filter((result) => result.completed).length;
  const expectedZeroMeasurementFixtures = fixtures
    .filter((result) => result.expectation === 'zero-measurement-fail' && !result.completed).length;
  const unmeasuredFixtures = fixtures
    .filter((result) => !result.completed && result.expectation !== 'zero-measurement-fail').length;
  const failedFixtures = fixtures.filter((result) => !result.passed);
  const report = {
    base,
    widths: WIDTHS,
    pages: PAGES.map((target) => target.page),
    engines: ENGINES.map(([engine]) => engine),
    expectedConditions,
    recordedConditions,
    completedConditions,
    unmeasuredConditions,
    failedConditions: failedConditions.length,
    expectedFixtures,
    recordedFixtures,
    completedFixtures,
    expectedZeroMeasurementFixtures,
    unmeasuredFixtures,
    failedFixtures: failedFixtures.length,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    fixtures,
    results,
  };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`モバイル見出し: 期待${expectedConditions} / 記録${recordedConditions} / 実測${completedConditions} / 未測定${unmeasuredConditions}`);
    console.log(`box・補正後Range横はみ出し・実スクロール・1文字行・読込エラー: ${failedConditions.length}条件`);
    for (const item of failedConditions) {
      console.log(`- ${item.engine}:${item.page}@${item.width}px ${item.failures.join(' / ')}`);
    }
    console.log(`回帰fixture: 期待${expectedFixtures} / 記録${recordedFixtures} / 実測${completedFixtures} / 期待どおり0件${expectedZeroMeasurementFixtures} / 予期しない未測定${unmeasuredFixtures} / 期待不一致${failedFixtures.length}`);
    for (const item of failedFixtures) {
      console.log(`- ${item.engine}:${item.fixture} ${item.validationErrors.join(' / ')}`);
    }
  }
  if (recordedConditions !== expectedConditions || unmeasuredConditions > 0
    || failedConditions.length > 0 || recordedFixtures !== expectedFixtures
    || unmeasuredFixtures > 0 || failedFixtures.length > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
