/**
 * 日本語の「泣き別れ」（行末に1文字だけ取り残される改行）を実測する監査（Playwright）
 *
 *   node scripts/audit-line-breaks.cjs [base] [--check] [--json] [--widths=375,402] [--page=blog/slug.html]
 *   node scripts/audit-line-breaks.cjs [base] --section=blog --engines=chromium,webkit --widths=320,390,430,768,1440
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
 *   表のセルや狭いチップは折り返して当然なので、本文幅（画面の55%以上）の箱だけを見る。
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
const MIN_TEXT = 12;
const MIN_BOX_RATIO = 0.55;

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
    if (sectionArg !== 'blog') {
      throw new Error(`対応セクションは blog です: ${sectionArg}`);
    }
    return blogPages();
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

const AUDIT = `() => {
  const out = [];
  const seen = new Set();
  const vw = document.documentElement.clientWidth;
  const targetSelector = 'h1,h2,h3,h4,p,li,dd,figcaption,blockquote';
  document.querySelectorAll(targetSelector).forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    // strong/a/span等のインライン要素内も含める。最寄りの監査対象が自身の文字だけを採り、
    // li内のpなどを親子双方で二重計上しない。
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim().length) continue;
      if (node.parentElement?.closest(targetSelector) !== el) continue;
      nodes.push(node);
    }
    if (!nodes.length) return;
    const full = el.textContent.replace(/\\s+/g, '');
    if (full.length < 12) return;
    const box = el.getBoundingClientRect();
    if (box.width < vw * 0.55) return;

    const lines = [];
    for (const node of nodes) {
      const t = node.textContent;
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (/\\s/.test(ch)) continue;
        const rg = document.createRange();
        rg.setStart(node, i); rg.setEnd(node, i + 1);
        const r = rg.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const top = Math.round(r.top);
        let line = lines.find((l) => Math.abs(l.top - top) <= 3);
        if (!line) { line = { top, chars: '' }; lines.push(line); }
        line.chars += ch;
      }
    }
    if (lines.length < 2) return;
    lines.sort((a, b) => a.top - b.top);
    const last = lines[lines.length - 1];
    if (last.chars.length > 1) return;

    const key = el.tagName + '|' + full.slice(0, 40) + '|' + last.chars;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 28),
      text: el.textContent.trim().slice(0, 48),
      orphan: last.chars,
      prev: lines.length >= 2 ? lines[lines.length - 2].chars.slice(-18) : '',
    });
  });
  return out;
}`;

(async () => {
  if (!WIDTHS.length || WIDTHS.some((width) => !Number.isInteger(width) || width <= 0)) {
    throw new Error(`--widths は正の整数をカンマ区切りで指定してください: ${WIDTHS.join(',')}`);
  }
  if (new Set(WIDTHS).size !== WIDTHS.length) {
    throw new Error(`--widths に重複があります: ${WIDTHS.join(',')}`);
  }
  const engineNames = engines();
  const targets = pages();
  const found = new Map();
  const navigationFailures = [];
  let successfulNavigations = 0;
  let completedMeasurements = 0;

  for (const engineName of engineNames) {
    const browserType = engineName === 'chromium' ? chromium : webkit;
    const browser = await browserType.launch({ headless: true });
    try {
      for (const rel of targets) {
        for (const width of WIDTHS) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
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
          await page.waitForTimeout(300);
          // content-visibility:auto の節も測るため一度末尾まで送る
          await page.evaluate(async () => {
            document.documentElement.style.scrollBehavior = 'auto';
            const h = document.documentElement.scrollHeight;
            for (let y = 0; y < h; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 10)); }
            window.scrollTo(0, 0);
            await new Promise((r) => setTimeout(r, 150));
          });
          const items = (await page.evaluate(AUDIT)) || [];
          completedMeasurements += 1;
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
      completedMeasurements,
      expectedMeasurements,
      navigationFailures,
      findings: list,
    }, null, 2));
  } else {
    console.log(`対象 ${targets.length}ページ × ${WIDTHS.length}幅（${WIDTHS.join(' / ')}px）× ${engineNames.length}エンジン（${engineNames.join(' / ')}）`);
    console.log(`読込成功: ${successfulNavigations}/${expectedNavigations}`);
    console.log(`測定完了: ${completedMeasurements}/${expectedMeasurements}`);
    console.log(`泣き別れ（最終行が${MAX_ORPHAN}文字以下）: ${list.length}件`);
    for (const f of list) {
      console.log(`\n[${f.engine} / ${f.widths.length}幅 ${f.widths.join('/')}] ${f.page}`);
      console.log(`   <${f.tag}${f.cls ? '.' + f.cls : ''}> …${f.prev} / 「${f.orphan}」`);
      console.log(`   ${f.text}`);
    }
    for (const failure of navigationFailures) console.error(`読込失敗: ${failure}`);
    if (!list.length) console.log('\n泣き別れはありません。');
  }

  const incomplete =
    navigationFailures.length > 0
    || successfulNavigations !== expectedNavigations
    || completedMeasurements !== expectedMeasurements;
  if (incomplete || ((checkOnly || pageArg || sectionArg) && list.length)) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
