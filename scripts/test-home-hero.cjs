/**
 * トップヒーローの横はみ出し回帰テスト。
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

    return {
      viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      summaryColumns: getComputedStyle(document.querySelector('.hs-inner'))
        .gridTemplateColumns.split(' ').filter(Boolean).length,
      h1Phrases,
      subPhrases,
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
        await prepareLocalHttpPage(page);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));

        // 外部解析スクリプトの遅延を合否へ混ぜず、必要なフォントだけ明示的に待つ。
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.evaluate(() => document.fonts.ready);
        const result = await measure(page);
        results.push({ engine: engineName, width, errors, ...result });

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
        const expectedSummaryColumns = width <= 430 ? 1 : 2;
        if (result.summaryColumns !== expectedSummaryColumns) {
          failures.push(
            `${engineName}@${width}px: ヒーロー直下サマリーが`
            + `${expectedSummaryColumns}列ではありません（${result.summaryColumns}列）`,
          );
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
        + `scroll=${result.documentScrollWidth - result.viewportWidth} `
        + `overflow=${result.offenders.length}`,
      );
      if (result.width === 402) {
        console.log(`  h1 lines: ${result.h1Lines.map((line) => line.text).join(' / ')}`);
      }
    }
    console.log(failures.length ? `失敗: ${failures.length}件` : '合格: ヒーローの横はみ出し0件');
    for (const failure of failures) console.error(`- ${failure}`);
  }

  if (failures.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
