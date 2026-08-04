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

const WIDTHS = [320, 360, 375, 390, 402, 429, 430, 431, 699, 700, 701, 1024, 1280, 1440];
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
        height: Number(rect.height.toFixed(2)),
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
        bottom: Number(rect.bottom.toFixed(2)),
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
    const video = document.querySelector('.hero-video');
    const videoState = video ? {
      hasSrcAttribute: video.hasAttribute('src'),
      currentSrc: video.currentSrc,
      dataSrc: video.getAttribute('data-src') || '',
      autoplay: video.hasAttribute('autoplay') || video.autoplay,
      muted: video.hasAttribute('muted') || video.defaultMuted || video.muted,
      loop: video.hasAttribute('loop') || video.loop,
    } : null;

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
        copy: rectOf('.hero-copy'),
        cm: rectOf('.hero-cm'),
        cmFrame: rectOf('.hero-cm-frame'),
        label: rectOf('.why-label.hero-label'),
        h1: rectOf('.hero-h1'),
        sub: rectOf('.hero-sub'),
        buttons: rectOf('.hero-btns'),
        trust: rectOf('.hero-trust'),
      },
      offenders,
      phraseBreaks,
      videoState,
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
        const desktop = width >= 1024;
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          deviceScaleFactor: desktop ? 1 : 3,
          isMobile: !desktop,
          hasTouch: !desktop,
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
        if (result.wbrCount !== 7) {
          failures.push(`${engineName}@${width}px: ヒーローの<wbr>が7個ではありません（${result.wbrCount}個）`);
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
        if (width <= 1023) {
          const expectedSummaryColumns = width <= 430 ? 1 : 2;
          if (result.summaryColumns !== expectedSummaryColumns) {
            failures.push(
              `${engineName}@${width}px: ヒーロー直下サマリーが`
              + `${expectedSummaryColumns}列ではありません（${result.summaryColumns}列）`,
            );
          }
        }
        const { copy, cm, cmFrame } = result.metrics;
        const cmAspectRatio = cmFrame.width / cmFrame.height;
        if (Math.abs(cmAspectRatio - (16 / 9)) > 0.02) {
          failures.push(
            `${engineName}@${width}px: CM枠が16:9ではありません`
            + `（${cmFrame.width}x${cmFrame.height}）`,
          );
        }
        if (cmFrame.left < -EPSILON || cmFrame.right > result.viewportWidth + EPSILON) {
          failures.push(
            `${engineName}@${width}px: CM枠がviewportから横にはみ出しています`
            + `（left=${cmFrame.left}, right=${cmFrame.right}）`,
          );
        }
        const horizontalOverlap = Math.min(copy.right, cm.right) - Math.max(copy.left, cm.left);
        const verticalOverlap = Math.min(copy.bottom, cm.bottom) - Math.max(copy.top, cm.top);
        if (desktop) {
          if (cm.left < copy.right - EPSILON || verticalOverlap <= EPSILON) {
            failures.push(`${engineName}@${width}px: コピーとCMが左右配置ではありません`);
          }
        } else if (cm.top < copy.bottom - EPSILON || horizontalOverlap <= EPSILON) {
          failures.push(`${engineName}@${width}px: コピーとCMが上下配置ではありません`);
        }
        if (!result.videoState) {
          failures.push(`${engineName}@${width}px: .hero-videoが見つかりません`);
        } else {
          if (result.videoState.hasSrcAttribute || result.videoState.currentSrc) {
            failures.push(`${engineName}@${width}px: 初期状態の動画にsrcが設定されています`);
          }
          if (!result.videoState.dataSrc.trim()) {
            failures.push(`${engineName}@${width}px: 初期状態の動画にdata-srcがありません`);
          }
          if (result.videoState.autoplay || result.videoState.muted || result.videoState.loop) {
            failures.push(
              `${engineName}@${width}px: 動画に禁止属性があります`
              + `（autoplay=${result.videoState.autoplay}, muted=${result.videoState.muted}, `
              + `loop=${result.videoState.loop}）`,
            );
          }
        }
        if (engineName === 'chromium' && width === 1280) {
          const initialVideoRequests = await page.evaluate(() => (
            performance.getEntriesByType('resource')
              .filter((entry) => entry.name.includes('/assets/video/')).length
          ));
          if (initialVideoRequests !== 0) {
            failures.push(`chromium@1280px: クリック前に動画通信が${initialVideoRequests}件あります`);
          }
          await page.locator('.hero-cm-play').click();
          try {
            await page.waitForFunction(() => {
              const video = document.querySelector('.hero-video');
              return Boolean(video && video.currentSrc && !video.paused && video.currentTime > 0.05);
            }, null, { timeout: 10000 });
            result.videoPlayback = await page.evaluate(() => {
              const video = document.querySelector('.hero-video');
              return {
                currentSrc: video.currentSrc,
                currentTime: Number(video.currentTime.toFixed(2)),
                muted: video.muted,
                paused: video.paused,
                videoRequests: performance.getEntriesByType('resource')
                  .filter((entry) => entry.name.includes('/assets/video/')).length,
              };
            });
            if (result.videoPlayback.muted || result.videoPlayback.paused
              || result.videoPlayback.videoRequests !== 1) {
              failures.push(
                `chromium@1280px: 明示クリック後の音声付き再生状態が不正です`
                + `（muted=${result.videoPlayback.muted}, paused=${result.videoPlayback.paused}, `
                + `requests=${result.videoPlayback.videoRequests}）`,
              );
            }
          } catch (error) {
            failures.push(`chromium@1280px: CMを明示クリックで再生できません（${error.message}）`);
          }
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
        stage, overlay, copy, cm, cmFrame, label, h1, sub, buttons, trust,
      } = result.metrics;
      console.log(
        `${result.engine}@${result.width}px `
        + `stage=${stage.width}/${stage.right} overlay=${overlay.width}/${overlay.right} `
        + `copy=${copy.width}/${copy.right} cm=${cm.width}/${cm.right} `
        + `cmFrame=${cmFrame.width}x${cmFrame.height} `
        + `label=${label.width}/${label.right} h1=${h1.width}/${h1.right} `
        + `sub=${sub.width}/${sub.right} buttons=${buttons.width}/${buttons.right} `
        + `trust=${trust.width}/${trust.right} `
        + `wbr=${result.wbrCount} overflow=${result.offenders.length}`,
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
