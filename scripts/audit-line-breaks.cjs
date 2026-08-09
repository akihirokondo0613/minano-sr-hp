/**
 * 日本語の「泣き別れ」（行末に1文字だけ取り残される改行）を実測する監査（Playwright）
 *
 *   node scripts/audit-line-breaks.cjs [base] [--check] [--json] [--widths=375,402] [--page=blog/slug.html]
 *   node scripts/audit-line-breaks.cjs [base] --section=blog --engines=chromium,webkit --widths=320,390,430,768,1440
 *   node scripts/audit-line-breaks.cjs [base] --section=root --engines=webkit --widths=320,390,430
 *   例) node scripts/audit-line-breaks.cjs http://127.0.0.1:8811/
 *
 * なぜ別の道具が要るのか:
 *   audit-a11y.cjs / test-home-hero.cjs は「要素の右端がビューポートを超えるか」を見る。
 *   泣き別れははみ出しではなく組版の問題なので、それらでは原理的に検出できない。
 *   実際、最終CTA見出しの「。」が5ページで2行目に落ちていたのを長く見逃していた。
 *
 * 測り方:
 *   文字ごとに Range を作って矩形を取り、rect.top でグループ化して行に分ける。
 *   最終行の文字数が1以下なら泣き別れとして報告する。
 *
 * 対象の絞り込み:
 *   表のセルや狭いチップは折り返して当然なので、画面幅の55%以上の箱だけを見る。
 *   PCのmax-widthカラムで対象0件になる場合も、候補DOMの走査完了を別カウントする。
 *   12文字未満の短い要素も対象外。
 *
 * エンジン:
 *   既定は WebKit。iOS Safari と同じ行分割の癖（行頭禁則が効かない場面がある）を再現するため。
 *   --engine=chromium で切り替え、--engines=chromium,webkit で複数を一括測定できる。
 *
 * verify-ui.cjs / audit-a11y.cjs と同じく playwright を必要とする手元の検証ツール。
 */

const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const {
  prepareLineBreakProbe,
  probeLineBreaks,
} = require('./lib/line-break-probe.cjs');

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8811/').replace(/\/?$/, '/');
const checkOnly = args.includes('--check');
const asJson = args.includes('--json');
const engineArg = (args.find((a) => a.startsWith('--engine=')) || '').split('=')[1] || '';
const enginesArg = (args.find((a) => a.startsWith('--engines=')) || '').split('=')[1] || '';
const widthArg = args.find((a) => a.startsWith('--widths='));
const pageArg = (args.find((a) => a.startsWith('--page=')) || '').split('=')[1] || '';
const sectionArg = (args.find((a) => a.startsWith('--section=')) || '').split('=')[1] || '';
const WIDTHS = widthArg
  ? widthArg.split('=')[1].split(',').map(Number)
  : [320, 360, 375, 390, 393, 402, 414, 430, 440];

const root = path.resolve(__dirname, '..');
const MAX_ORPHAN = 1;

const UPGRADE_INSECURE_META =
  /<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">/gi;

// WebKitはローカルHTTPでもupgrade-insecure-requestsを適用し、相対CSSをHTTPS化して未適用になる。
// 本番は元からHTTPSなので、検査時のdocumentレスポンスだけmetaを除いて同じCSSを読ませる。
async function prepareLocalHttpPage(page) {
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'http:') return;
  await page.route(`${baseUrl.origin}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      const html = await response.text();
      await route.fulfill({ response, body: html.replace(UPGRADE_INSECURE_META, '') });
    } catch {
      // page.goto側の例外として集計し、未処理のroute.fetch例外で監査結果を失わない。
      await route.abort('failed');
    }
  });
}

function engines() {
  if (engineArg && enginesArg) {
    throw new Error('--engine と --engines は同時に指定できません');
  }
  const names = enginesArg ? enginesArg.split(',').filter(Boolean) : [engineArg || 'webkit'];
  if (!names.length || names.some((name) => !['chromium', 'webkit'].includes(name))) {
    throw new Error(`対応エンジンは chromium / webkit です: ${names.join(',')}`);
  }
  if (new Set(names).size !== names.length) {
    throw new Error(`--engines に重複があります: ${names.join(',')}`);
  }
  return names;
}

function blogPages() {
  const manifestPath = path.join(root, 'blog', 'articles.json');
  const articles = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(articles) || !articles.length) {
    throw new Error('blog/articles.json に記事がありません');
  }
  const targets = articles.map((article) => {
    if (!article || !/^[a-z0-9-]+$/.test(article.slug || '')) {
      throw new Error(`blog/articles.json のslugが不正です: ${article?.slug ?? '未設定'}`);
    }
    return `blog/${article.slug}.html`;
  });
  if (new Set(targets).size !== targets.length) {
    throw new Error('blog/articles.json にslugの重複があります');
  }
  for (const rel of targets) {
    if (!fs.existsSync(path.join(root, rel))) {
      throw new Error(`blog/articles.json 掲載記事が見つかりません: ${rel}`);
    }
  }
  return targets;
}

function rootPages() {
  const targets = ['index.html', 'about.html', 'pricing.html', 'services.html', 'support.html'];
  for (const rel of targets) {
    if (!fs.existsSync(path.join(root, rel))) {
      throw new Error(`ルート監査対象が見つかりません: ${rel}`);
    }
  }
  return targets;
}

function pages() {
  if (pageArg && sectionArg) {
    throw new Error('--page と --section は同時に指定できません');
  }
  if (pageArg) {
    if (!/^(?:[a-z0-9-]+\.html|(?:blog|uploads)\/[a-z0-9-]+\.html)$/.test(pageArg)) {
      throw new Error(`--page は公開HTMLの相対パスで指定してください: ${pageArg}`);
    }
    if (!fs.existsSync(path.join(root, pageArg))) {
      throw new Error(`--page の対象が見つかりません: ${pageArg}`);
    }
    return [pageArg];
  }
  if (sectionArg) {
    if (sectionArg === 'blog') return blogPages();
    if (sectionArg === 'root') return rootPages();
    throw new Error(`対応セクションは blog / root です: ${sectionArg}`);
  }
  const list = [];
  for (const f of fs.readdirSync(root)) {
    if (!f.endsWith('.html')) continue;
    if (/^(admin-post|icon-catalog|404)\.html$/.test(f)) continue;
    list.push(f);
  }
  for (const dir of ['uploads', 'blog']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (f.endsWith('.html')) list.push(`${dir}/${f}`);
    }
  }
  return list;
}

(async () => {
  if (!WIDTHS.length || WIDTHS.some((width) => !Number.isInteger(width) || width <= 0)) {
    throw new Error(`--widths は正の整数をカンマ区切りで指定してください: ${WIDTHS.join(',')}`);
  }
  if (new Set(WIDTHS).size !== WIDTHS.length) {
    throw new Error(`--widths に重複があります: ${WIDTHS.join(',')}`);
  }
  const engineNames = engines();
  const targets = pages();
  if (!targets.length) throw new Error('監査対象ページがありません');
  const found = new Map();
  const navigationFailures = [];
  const measurementFailures = [];
  const measurements = [];
  let successfulNavigations = 0;
  let recordedMeasurements = 0;
  let completedMeasurements = 0;

  for (const engineName of engineNames) {
    const browserType = engineName === 'chromium' ? chromium : webkit;
    const browser = await browserType.launch({ headless: true });
    try {
      for (const rel of targets) {
        for (const width of WIDTHS) {
          const page = await browser.newPage({
            viewport: { width, height: width < 768 ? 900 : 1000 },
          });
          await prepareLocalHttpPage(page);
          let response;
          try {
            response = await page.goto(base + rel, { waitUntil: 'domcontentloaded', timeout: 20000 });
          } catch (error) {
            navigationFailures.push(`${engineName} / ${rel} @ ${width}px: ${error.message}`);
            await page.close();
            continue;
          }
          if (!response?.ok()) {
            navigationFailures.push(`${engineName} / ${rel} @ ${width}px: HTTP ${response?.status() ?? '応答なし'}`);
            await page.close();
            continue;
          }
          successfulNavigations += 1;
          let probe;
          try {
            await prepareLineBreakProbe(page);
            probe = await page.evaluate(probeLineBreaks);
          } catch (error) {
            measurementFailures.push(`${engineName} / ${rel} @ ${width}px: ${error.message}`);
            await page.close();
            continue;
          }
          recordedMeasurements += 1;
          const validProbe = probe
            && typeof probe.measured === 'boolean'
            && Number.isInteger(probe.targetCount)
            && Number.isInteger(probe.candidateCount)
            && Number.isInteger(probe.eligibleCount)
            && Number.isInteger(probe.measuredCount)
            && Array.isArray(probe.findings);
          if (!validProbe) {
            measurementFailures.push(`${engineName} / ${rel} @ ${width}px: probe結果が不正です`);
            await page.close();
            continue;
          }
          measurements.push({
            engine: engineName,
            page: rel,
            width,
            measured: probe.measured,
            targetCount: probe.targetCount,
            candidateCount: probe.candidateCount,
            eligibleCount: probe.eligibleCount,
            measuredCount: probe.measuredCount,
            findings: probe.findings.length,
          });
          if (probe.measured) {
            completedMeasurements += 1;
          } else {
            measurementFailures.push(
              `${engineName} / ${rel} @ ${width}px: `
              + `泣き別れを実測できません（対象${probe.targetCount} / 候補${probe.candidateCount} / `
              + `適格${probe.eligibleCount} / 実測${probe.measuredCount}）`,
            );
          }
          const items = probe.findings;
          for (const item of items) {
            const key = `${engineName}|${rel}|${item.tag}.${item.cls}|${item.text}|${item.orphan}`;
            if (!found.has(key)) found.set(key, { engine: engineName, page: rel, ...item, widths: [] });
            found.get(key).widths.push(width);
          }
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }

  const list = [...found.values()].sort((a, b) => b.widths.length - a.widths.length);
  const expectedMeasurements = targets.length * WIDTHS.length * engineNames.length;
  const expectedNavigations = expectedMeasurements;
  if (asJson) {
    console.log(JSON.stringify({
      base,
      engine: engineNames.join(','),
      engines: engineNames,
      widths: WIDTHS,
      targets: targets.length,
      successfulNavigations,
      expectedNavigations,
      recordedMeasurements,
      completedMeasurements,
      expectedMeasurements,
      unmeasuredMeasurements: expectedMeasurements - completedMeasurements,
      navigationFailures,
      measurementFailures,
      measurements,
      findings: list,
    }, null, 2));
  } else {
    console.log(`対象 ${targets.length}ページ × ${WIDTHS.length}幅（${WIDTHS.join(' / ')}px）× ${engineNames.length}エンジン（${engineNames.join(' / ')}）`);
    console.log(`読込成功: ${successfulNavigations}/${expectedNavigations}`);
    console.log(
      `測定: 期待${expectedMeasurements} / 記録${recordedMeasurements} / `
      + `実測${completedMeasurements} / 未測定${expectedMeasurements - completedMeasurements}`,
    );
    console.log(`泣き別れ（最終行が${MAX_ORPHAN}文字以下）: ${list.length}件`);
    for (const f of list) {
      console.log(`\n[${f.engine} / ${f.widths.length}幅 ${f.widths.join('/')}] ${f.page}`);
      console.log(`   <${f.tag}${f.cls ? '.' + f.cls : ''}> …${f.prev} / 「${f.orphan}」`);
      console.log(`   ${f.text}`);
    }
    for (const failure of navigationFailures) console.error(`読込失敗: ${failure}`);
    for (const failure of measurementFailures) console.error(`測定失敗: ${failure}`);
    if (!list.length && !measurementFailures.length) console.log('\n泣き別れはありません。');
  }

  const incomplete =
    navigationFailures.length > 0
    || measurementFailures.length > 0
    || successfulNavigations !== expectedNavigations
    || recordedMeasurements !== expectedMeasurements
    || completedMeasurements !== expectedMeasurements;
  if (incomplete || ((checkOnly || pageArg || sectionArg) && list.length)) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
