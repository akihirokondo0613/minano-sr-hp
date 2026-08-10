#!/usr/bin/env node

/**
 * モバイル見出しの要素ボックスと、実際に操作できる横スクロールを検査する。
 *
 * hanging-punctuation: allow-end による行末約物のRange超過は仕様なので記録だけ残す。
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
const UPGRADE_INSECURE_META =
  /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*content=["'][^"']*upgrade-insecure-requests[^"']*["'][^>]*>/gi;

async function prepareLocalHttpPage(page) {
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
  return page.evaluate(async ({ selectors, expectedSelectorCounts, epsilon }) => {
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
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let index = 0; index < node.textContent.length; index += 1) {
          const character = node.textContent[index];
          if (/\s/.test(character)) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const rect = range.getBoundingClientRect();
          if (!rect.width && !rect.height) continue;
          chars.push({ character, top: rect.top, left: rect.left, right: rect.right });
        }
      }
      const lines = [];
      for (const item of chars) {
        let line = lines.find((candidate) => Math.abs(candidate.top - item.top) <= 3);
        if (!line) {
          line = { top: item.top, text: '', left: item.left, right: item.right };
          lines.push(line);
        }
        line.text += item.character;
        line.left = Math.min(line.left, item.left);
        line.right = Math.max(line.right, item.right);
      }
      lines.sort((left, right) => left.top - right.top);
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
        lineCount: lines.length,
        lines: lines.map((line) => ({ text: line.text, left: line.left, right: line.right })),
        measuredCharacters: chars.length,
        rangeOverflow: lines.some((line) => line.left < -epsilon || line.right > viewportWidth + epsilon),
        boxOverflow: box.left < -epsilon || box.right > viewportWidth + epsilon,
        orphanLine: lines.some((line) => [...line.text].length <= 1),
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
  }, { selectors, expectedSelectorCounts, epsilon: EPSILON });
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
          const failures = [];
          if (!measurement.completed) failures.push('見出しの実測未完了');
          if (measurement.headingCount !== target.expectedHeadingCount) {
            failures.push(`見出し件数 ${measurement.headingCount}/${target.expectedHeadingCount}`);
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
            if (heading.orphanLine) failures.push(`${heading.selector} に1文字だけの行`);
          }
          if (errors.length) failures.push(...errors);
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
  for (const [engine, browserType] of ENGINES) {
    results.push(...await auditEngine(engine, browserType));
  }
  const expectedConditions = ENGINES.length * PAGES.length * WIDTHS.length;
  const recordedConditions = results.length;
  const completedConditions = results.filter((result) => result.completed).length;
  const unmeasuredConditions = expectedConditions - completedConditions;
  const failedConditions = results.filter((result) => result.failures.length > 0);
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
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    results,
  };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`モバイル見出し: 期待${expectedConditions} / 記録${recordedConditions} / 実測${completedConditions} / 未測定${unmeasuredConditions}`);
    console.log(`box横はみ出し・実スクロール・1文字行・読込エラー: ${failedConditions.length}条件`);
    for (const item of failedConditions) {
      console.log(`- ${item.engine}:${item.page}@${item.width}px ${item.failures.join(' / ')}`);
    }
  }
  if (recordedConditions !== expectedConditions || unmeasuredConditions > 0 || failedConditions.length > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
