/**
 * ブログ記事リンクの二重下線を防ぐ回帰テスト。
 *
 * 実行:
 *   node scripts/test-blog-link-decoration.cjs [base] [--json]
 *
 * article.post の汎用リンクは border-bottom を使う。一方、目次は文字の
 * 折り返しに沿う text-decoration を使うため、両方が同時に有効だと二重線になる。
 * documentの横幅では検出できないので、要素ごとの計算済みスタイルを検査する。
 * 修正前の d06ab9b では両エンジン・390/1440pxとも、目次5件すべてが
 * underline + 2px solid border（各条件で二重下線5件）となり、この検査が失敗した。
 */

const { chromium, webkit } = require('playwright');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const asJson = args.includes('--json');

const ARTICLE_PATH = 'blog/36kyotei-jogen-kanri.html';
const WIDTHS = [390, 1440];
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];
const UPGRADE_INSECURE_META =
  /<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">/gi;

async function prepareLocalHttpPage(page) {
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'http:') return;

  // WebKitが相対CSSをHTTPS化しないよう、ローカル検査時だけCSPメタを除く。
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
    const inspect = (element) => {
      const style = getComputedStyle(element);
      const hasUnderline = style.textDecorationLine.split(/\s+/).includes('underline');
      const borderWidth = Number.parseFloat(style.borderBottomWidth) || 0;
      const hasBorder = style.borderBottomStyle !== 'none' && borderWidth > 0;
      return {
        text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 80),
        href: element.getAttribute('href'),
        textDecorationLine: style.textDecorationLine,
        textDecorationColor: style.textDecorationColor,
        borderBottomWidth: style.borderBottomWidth,
        borderBottomStyle: style.borderBottomStyle,
        borderBottomColor: style.borderBottomColor,
        hasUnderline,
        hasBorder,
        hasDoubleUnderline: hasUnderline && hasBorder,
      };
    };

    return {
      toc: [...document.querySelectorAll('article.post .post-toc a')].map(inspect),
      article: [...document.querySelectorAll('article.post a')].map(inspect),
      references: [...document.querySelectorAll('.post-refs a')].map(inspect),
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
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await prepareLocalHttpPage(page);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));

        const response = await page.goto(`${base}${ARTICLE_PATH}`, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        if (!response?.ok()) {
          failures.push(`${engineName}@${width}px: 記事を取得できません（HTTP ${response?.status() ?? '不明'}）`);
          await page.close();
          continue;
        }
        await page.evaluate(() => document.fonts.ready);
        const measurement = await measure(page);
        results.push({ engine: engineName, width, errors, ...measurement });

        if (measurement.toc.length === 0) {
          failures.push(`${engineName}@${width}px: 目次リンクを測定できません`);
        }
        if (measurement.references.length === 0) {
          failures.push(`${engineName}@${width}px: 参考リンクを測定できません`);
        }
        for (const link of measurement.toc) {
          if (!link.hasUnderline || link.hasBorder) {
            failures.push(
              `${engineName}@${width}px: 目次「${link.text}」の下線が1方式ではありません `
              + `(text=${link.textDecorationLine}, border=${link.borderBottomWidth} ${link.borderBottomStyle})`,
            );
          }
        }
        for (const link of measurement.article.filter((item) => item.hasDoubleUnderline)) {
          failures.push(`${engineName}@${width}px: 記事内「${link.text}」に二重下線があります`);
        }
        for (const link of measurement.references.filter((item) => item.hasDoubleUnderline)) {
          failures.push(`${engineName}@${width}px: 参考リンク「${link.text}」に二重下線があります`);
        }
        if (errors.length) failures.push(`${engineName}@${width}px: ${errors.join(' / ')}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ base, article: ARTICLE_PATH, results, failures }, null, 2));
  } else {
    for (const result of results) {
      const toc = result.toc[0];
      console.log(
        `${result.engine}@${result.width}px toc=${result.toc.length} `
        + `refs=${result.references.length} `
        + `text=${toc?.textDecorationLine ?? '未測定'} `
        + `border=${toc?.borderBottomWidth ?? '未測定'} `
        + `double=${result.article.filter((link) => link.hasDoubleUnderline).length}`,
      );
    }
    console.log(failures.length ? `失敗: ${failures.length}件` : '合格: ブログ記事リンクの二重下線0件');
    for (const failure of failures) console.error(`- ${failure}`);
  }

  if (failures.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
