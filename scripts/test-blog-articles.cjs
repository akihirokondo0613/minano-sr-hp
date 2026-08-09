/**
 * 全ブログ記事の共通UI回帰テスト。
 *
 *   node scripts/test-blog-articles.cjs [base] [--json]
 *
 * Chromium / WebKit × 320 / 390 / 430 / 768 / 1440px で、全記事を実際に描画する。
 * scrollWidthだけに依存せず、記事内の各要素矩形も測ってクリップ内のはみ出しを拾う。
 * 対象要素や測定件数が0のときは合格にしない。
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const asJson = args.includes('--json');
const root = path.resolve(__dirname, '..');
const allArticles = JSON.parse(fs.readFileSync(path.join(root, 'blog/articles.json'), 'utf8'));
const slugFilter = args.find((arg) => arg.startsWith('--slug='))?.slice('--slug='.length);
const widthFilter = Number(args.find((arg) => arg.startsWith('--width='))?.slice('--width='.length));
const engineFilter = args.find((arg) => arg.startsWith('--engine='))?.slice('--engine='.length);
const articles = slugFilter ? allArticles.filter((article) => article.slug === slugFilter) : allArticles;
const widths = Number.isFinite(widthFilter) && widthFilter > 0
  ? [widthFilter]
  : [320, 390, 430, 768, 1440];
const engines = [
  ['chromium', chromium],
  ['webkit', webkit],
].filter(([name]) => !engineFilter || name === engineFilter);
const expected = articles.length * widths.length * engines.length;
if (!articles.length) throw new Error(`対象記事がありません: ${slugFilter || 'articles.json'}`);
if (!engines.length) throw new Error(`対象エンジンが不正です: ${engineFilter}`);
const epsilon = 1;
const upgradeInsecureMeta =
  /<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">/gi;

function ignoreConsoleError(message) {
  const location = message.location().url || '';
  const text = message.text();
  return /minano-sr\.goatcounter\.com\/count/.test(location)
    || /Failed to load resource: A TLS error/.test(text);
}

async function prepareLocalHttp(page) {
  const url = new URL(base);
  if (url.protocol !== 'http:') return;
  await page.route(`${url.origin}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({ response, body: html.replace(upgradeInsecureMeta, '') });
  });
}

async function settleAndMeasure(page) {
  await page.waitForFunction(() => {
    const style = document.querySelector('link[data-async-style]');
    return !style || style.media === 'all';
  }, null, { timeout: 8000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    const targets = document.querySelectorAll(
      '.post-reader, figure.post-viz, .post-hard, .post-action',
    );
    for (const target of targets) {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  return page.evaluate((allowedOverflow) => {
    const article = document.querySelector('article.post');
    if (!article) return { measured: false, reason: 'article.postがありません' };
    const readerCount = article.querySelectorAll('[data-reader-map]').length;
    const hardCount = article.querySelectorAll('.post-hard').length;
    const actionCount = article.querySelectorAll('.post-action').length;
    const viewportWidth = document.documentElement.clientWidth;

    function hasScrollableAncestor(element, stopAt = document.body) {
      for (let node = element.parentElement; node && node !== stopAt; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + allowedOverflow) {
          return true;
        }
      }
      return false;
    }

    const offenders = [article, ...article.querySelectorAll('*')].flatMap((element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || hasScrollableAncestor(element)) return [];
      if (rect.left >= -allowedOverflow && rect.right <= viewportWidth + allowedOverflow) return [];
      return [{
        tag: element.tagName.toLowerCase(),
        className: String(element.className || '').slice(0, 100),
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
      }];
    });
    const pageOffenders = [...document.body.querySelectorAll('*')].flatMap((element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || hasScrollableAncestor(element)) return [];
      if (rect.left >= -allowedOverflow && rect.right <= viewportWidth + allowedOverflow) return [];
      return [{
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: String(element.className || '').slice(0, 100),
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
      }];
    });
    const internalOverflow = [document.body, ...document.body.querySelectorAll('*')].flatMap((element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
      if (element.scrollWidth <= element.clientWidth + allowedOverflow) return [];
      if (/(auto|scroll)/.test(style.overflowX)) return [];
      const range = document.createRange();
      range.selectNodeContents(element);
      const textRects = [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0);
      const contentLeft = Math.min(...textRects.map((rect) => rect.left));
      const contentRight = Math.max(...textRects.map((rect) => rect.right));
      let clipLeft = 0;
      let clipRight = viewportWidth;
      let clipSource = 'viewport';
      for (let node = element; node; node = node.parentElement) {
        const nodeStyle = getComputedStyle(node);
        if (!/(hidden|clip)/.test(nodeStyle.overflowX)) continue;
        const nodeRect = node.getBoundingClientRect();
        clipLeft = Math.max(clipLeft, nodeRect.left);
        clipRight = Math.min(clipRight, nodeRect.right);
        clipSource = node === document.body ? 'body' : (
          node.id ? `#${node.id}` : node.tagName.toLowerCase()
        );
      }
      if (
        !textRects.length
        || (
          contentLeft >= clipLeft - allowedOverflow
          && contentRight <= clipRight + allowedOverflow
        )
      ) return [];
      return [{
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: String(element.className || '').slice(0, 100),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        contentLeft: Number(contentLeft.toFixed(2)),
        contentRight: Number(contentRight.toFixed(2)),
        clipLeft: Number(clipLeft.toFixed(2)),
        clipRight: Number(clipRight.toFixed(2)),
        clipSource,
        overflowX: style.overflowX,
      }];
    });

    const smallText = [...article.querySelectorAll(
      '.post-reader *, figure.post-viz *, .post-hard *, .post-action *',
    )].flatMap((element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
      const hasOwnText = [...element.childNodes]
        .some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const size = Number.parseFloat(style.fontSize);
      if (!hasOwnText || !Number.isFinite(size) || size >= 11) return [];
      return [{
        tag: element.tagName.toLowerCase(),
        className: String(element.className || '').slice(0, 100),
        size: Number(size.toFixed(2)),
        text: element.textContent.trim().slice(0, 80),
      }];
    });

    const draftMarkers = /\bTODO\b|<!--\s*TODO|class="draft-(?:reader|placeholder)"/.test(
      article.innerHTML,
    );
    const legacyHardHeading = [...article.querySelectorAll('h2')]
      .some((heading) => heading.textContent.includes('判断'));
    const postH1 = document.querySelector('.post-h1');
    const postH1Style = postH1 ? getComputedStyle(postH1) : null;
    const postH1Range = document.createRange();
    if (postH1) postH1Range.selectNodeContents(postH1);
    return {
      measured: article.getBoundingClientRect().width > 0,
      navMode: document.body.dataset.nav || '',
      readerCount,
      visualCount: article.querySelectorAll(
        'figure.post-viz[data-visual], .sb-fig, .fig-figure',
      ).length,
      hardCount: hardCount || (legacyHardHeading ? 1 : 0),
      actionCount,
      pageOverflow: document.documentElement.scrollWidth - viewportWidth,
      offenders,
      pageOffenders,
      internalOverflow,
      postH1: postH1 ? {
        clientWidth: postH1.clientWidth,
        scrollWidth: postH1.scrollWidth,
        wordBreak: postH1Style.wordBreak,
        overflowWrap: postH1Style.overflowWrap,
        textRects: [...postH1Range.getClientRects()].map((rect) => ({
          left: Number(rect.left.toFixed(2)),
          right: Number(rect.right.toFixed(2)),
          top: Number(rect.top.toFixed(2)),
        })),
      } : null,
      smallText,
      draftMarkers,
    };
  }, epsilon);
}

(async () => {
  const results = [];
  for (const [engine, browserType] of engines) {
    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await prepareLocalHttp(page);
      for (const article of articles) {
        for (const width of widths) {
          await page.setViewportSize({ width, height: width < 768 ? 900 : 1000 });
          const runtimeErrors = [];
          const onConsole = (message) => {
            if (message.type() === 'error' && !ignoreConsoleError(message)) {
              runtimeErrors.push(`console: ${message.text()}`);
            }
          };
          const onPageError = (error) => runtimeErrors.push(`pageerror: ${error.message}`);
          page.on('console', onConsole);
          page.on('pageerror', onPageError);

          let responseOk = false;
          let measurement = { measured: false, reason: '未測定' };
          let loadError = '';
          try {
            const response = await page.goto(
              new URL(`blog/${article.slug}.html`, base).href,
              { waitUntil: 'domcontentloaded', timeout: 20000 },
            );
            responseOk = Boolean(response?.ok());
            measurement = await settleAndMeasure(page);
          } catch (error) {
            loadError = String(error);
          }
          page.off('console', onConsole);
          page.off('pageerror', onPageError);

          const failures = [];
          if (!responseOk) failures.push('HTTP応答が成功ではありません');
          if (loadError) failures.push(`読込失敗: ${loadError}`);
          if (!measurement.measured) failures.push(measurement.reason || '記事を実測できません');
          if (measurement.navMode !== 'B') failures.push(`body data-nav=${measurement.navMode || '未設定'}`);
          if (measurement.readerCount !== 1) failures.push(`reader map=${measurement.readerCount ?? 0}`);
          if ((measurement.visualCount ?? 0) < 3) failures.push(`visual=${measurement.visualCount ?? 0}`);
          if (measurement.hardCount !== 1) failures.push(`hard=${measurement.hardCount ?? 0}`);
          if (measurement.actionCount !== 1) failures.push(`action=${measurement.actionCount ?? 0}`);
          if ((measurement.pageOverflow ?? 0) > epsilon) failures.push(`page overflow=${measurement.pageOverflow}px`);
          if (measurement.offenders?.length) failures.push(`element overflow=${measurement.offenders.length}`);
          if (measurement.pageOffenders?.length) failures.push(`page element overflow=${measurement.pageOffenders.length}`);
          if (measurement.internalOverflow?.length) failures.push(`internal overflow=${measurement.internalOverflow.length}`);
          if (measurement.postH1 && measurement.postH1.scrollWidth > measurement.postH1.clientWidth + epsilon) {
            failures.push(`post-h1 content overflow=${measurement.postH1.scrollWidth - measurement.postH1.clientWidth}px`);
          }
          if (measurement.smallText?.length) failures.push(`図解内11px未満=${measurement.smallText.length}`);
          if (measurement.draftMarkers) failures.push('下書きマーカーが残っています');
          if (runtimeErrors.length) failures.push(`runtime error=${runtimeErrors.length}`);

          results.push({
            engine,
            slug: article.slug,
            width,
            responseOk,
            loadError,
            runtimeErrors,
            ...measurement,
            failures,
            ok: failures.length === 0,
          });
        }
      }
      await page.close();
    } finally {
      await browser.close();
    }
  }

  const failed = results.filter((result) => !result.ok);
  const output = {
    expected,
    measured: results.length,
    failed: failed.length,
    engines: engines.map(([name]) => name),
    widths,
    articles: articles.length,
    results,
  };
  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`ブログ実測 ${results.length}/${expected}条件、失敗${failed.length}件`);
    for (const result of failed.slice(0, 100)) {
      console.error(`${result.engine} ${result.width}px ${result.slug}: ${result.failures.join(' / ')}`);
    }
    if (failed.length > 100) console.error(`ほか${failed.length - 100}件`);
  }
  if (results.length !== expected || failed.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
