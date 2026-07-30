/**
 * トップヒーローの横はみ出し回帰テスト。
 *
 * 実行:
 *   node scripts/test-home-hero.cjs [base] [--json]
 *
 * Playwrightの最新WebKitでは、実機iOSで起きた「空白のない隣接 .nw span の
 * 境界を改行機会にしない」挙動を再現しない。そのため、明示的な <wbr> が無い
 * 隣接境界だけへ WORD JOINER を挿入し、当該WebKit挙動をレイアウト上で再現する。
 * 合否は実際の要素矩形で判定し、documentElement.scrollWidthには依存しない。
 */

const { chromium, webkit } = require('playwright');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const asJson = args.includes('--json');

const WIDTHS = [320, 360, 375, 390, 402, 429, 430, 431, 699, 700, 701];
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];
const EPSILON = 1;

async function emulateAffectedIosWebKit(page) {
  return page.evaluate(() => {
    let inserted = 0;
    for (const parent of document.querySelectorAll('.hero-h1, .hero-sub')) {
      const phrases = [...parent.querySelectorAll('.nw')];
      for (let index = 1; index < phrases.length; index += 1) {
        const previous = phrases[index - 1];
        const current = phrases[index];
        if (previous.parentElement === current.parentElement && previous.nextSibling === current) {
          current.before(document.createTextNode('\u2060'));
          inserted += 1;
        }
      }
    }
    return inserted;
  });
}

async function measure(page) {
  return page.evaluate(() => {
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
    const linesOf = (selector) => {
      const lines = [];
      for (const phrase of document.querySelectorAll(`${selector} .nw`)) {
        const range = document.createRange();
        range.selectNodeContents(phrase);
        const rect = [...range.getClientRects()].find((item) => item.width > 0 && item.height > 0);
        if (!rect) continue;
        let line = lines.find((item) => Math.abs(item.top - rect.top) < 1);
        if (!line) {
          line = { top: rect.top, text: '' };
          lines.push(line);
        }
        line.text += phrase.textContent;
      }
      return lines.sort((a, b) => a.top - b.top).map((item) => item.text);
    };
    const offenders = [...document.querySelectorAll('.hero, .hero *')]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1);
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
    const phraseBreaks = [...document.querySelectorAll('.hero-h1 .nw, .hero-sub .nw')]
      .flatMap((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
        return rects.length > 1 ? [{
          text: element.textContent,
          lines: rects.length,
        }] : [];
      });

    return {
      viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      wbrCount: document.querySelectorAll('.hero-h1 wbr, .hero-sub wbr').length,
      summaryColumns: getComputedStyle(document.querySelector('.hs-inner'))
        .gridTemplateColumns.split(' ').filter(Boolean).length,
      h1Lines: linesOf('.hero-h1'),
      subLines: linesOf('.hero-sub'),
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
      phraseBreaks,
    };
  });
}

(async () => {
  const results = [];
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
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));

        // 外部解析スクリプトの遅延を合否へ混ぜず、必要なフォントだけ明示的に待つ。
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.evaluate(() => document.fonts.ready);
        const insertedJoiners = await emulateAffectedIosWebKit(page);
        await page.waitForTimeout(50);
        const result = await measure(page);
        results.push({ engine: engineName, width, insertedJoiners, errors, ...result });

        if (result.offenders.length) {
          failures.push(
            `${engineName}@${width}px: ${result.offenders
              .map((item) => `${item.selector} right=${item.right}`)
              .join(', ')}`,
          );
        }
        if (result.wbrCount !== 7) {
          failures.push(`${engineName}@${width}px: ヒーローの<wbr>が7個ではありません（${result.wbrCount}個）`);
        }
        if (insertedJoiners !== 0) {
          failures.push(
            `${engineName}@${width}px: 明示的な改行機会がない隣接.nw境界が`
            + `${insertedJoiners}か所あります`,
          );
        }
        if (result.phraseBreaks.length) {
          failures.push(
            `${engineName}@${width}px: 文節内改行 ${result.phraseBreaks
              .map((item) => `「${item.text}」=${item.lines}行`)
              .join(', ')}`,
          );
        }
        if (width <= 700 && result.metrics.label.width >= result.metrics.h1.width - EPSILON) {
          failures.push(`${engineName}@${width}px: 淡緑ラベルが本文幅まで引き伸ばされています`);
        }
        const expectedSummaryColumns = width <= 430 ? 1 : 2;
        if (result.summaryColumns !== expectedSummaryColumns) {
          failures.push(
            `${engineName}@${width}px: ヒーロー直下サマリーが`
            + `${expectedSummaryColumns}列ではありません（${result.summaryColumns}列）`,
          );
        }
        if (width === 402) {
          const firstBlock = '手続きも、給与計算も、助成金も。';
          const keepsFourPhraseLines = result.h1Lines.length === 4
            && result.h1Lines.slice(0, 2).join('') === firstBlock
            && result.h1Lines[2] === '会社の労務を、'
            && result.h1Lines[3] === 'まるごと任せられる。';
          if (!keepsFourPhraseLines) {
            failures.push(
              `${engineName}@402px: 見出しの改行が想定外です（${result.h1Lines.join(' / ')}）`,
            );
          }
        }
        if (errors.length) failures.push(`${engineName}@${width}px: ${errors.join(' / ')}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ base, epsilon: EPSILON, results, failures }, null, 2));
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
        + `wbr=${result.wbrCount} simulated=${result.insertedJoiners} `
        + `overflow=${result.offenders.length}`,
      );
      if (result.width === 402) console.log(`  h1 lines: ${result.h1Lines.join(' / ')}`);
    }
    console.log(failures.length ? `失敗: ${failures.length}件` : '合格: ヒーローの横はみ出し0件');
    for (const failure of failures) console.error(`- ${failure}`);
  }

  if (failures.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
