/**
 * 日本語の「泣き別れ」（行末に1文字だけ取り残される改行）を実測する監査（Playwright）
 *
 *   node scripts/audit-line-breaks.cjs [base] [--check] [--json] [--widths=375,402]
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
 *   --engine=chromium で切り替えられる。
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
const engineName = (args.find((a) => a.startsWith('--engine=')) || '--engine=webkit').split('=')[1];
const widthArg = args.find((a) => a.startsWith('--widths='));
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
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({ response, body: html.replace(UPGRADE_INSECURE_META, '') });
  });
}

function pages() {
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
  document.querySelectorAll('h1,h2,h3,h4,p,li,dd,figcaption,blockquote').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    // 親子で二重に数えないよう、直接の文字ノードを持つ要素だけ見る
    const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim().length);
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
  const engine = engineName === 'chromium' ? chromium : webkit;
  const browser = await engine.launch({ headless: true });
  const targets = pages();
  const found = new Map();

  for (const rel of targets) {
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await prepareLocalHttpPage(page);
      try {
        await page.goto(base + rel, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch {
        await page.close();
        continue;
      }
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
      for (const item of items) {
        const key = `${rel}|${item.tag}.${item.cls}|${item.text}|${item.orphan}`;
        if (!found.has(key)) found.set(key, { page: rel, ...item, widths: [] });
        found.get(key).widths.push(width);
      }
      await page.close();
    }
  }
  await browser.close();

  const list = [...found.values()].sort((a, b) => b.widths.length - a.widths.length);
  if (asJson) {
    console.log(JSON.stringify({ base, engine: engineName, widths: WIDTHS, findings: list }, null, 2));
  } else {
    console.log(`対象 ${targets.length}ページ × ${WIDTHS.length}幅（${WIDTHS.join(' / ')}px）／${engineName}`);
    console.log(`泣き別れ（最終行が${MAX_ORPHAN}文字以下）: ${list.length}件`);
    for (const f of list) {
      console.log(`\n[${f.widths.length}幅 ${f.widths.join('/')}] ${f.page}`);
      console.log(`   <${f.tag}${f.cls ? '.' + f.cls : ''}> …${f.prev} / 「${f.orphan}」`);
      console.log(`   ${f.text}`);
    }
    if (!list.length) console.log('\n泣き別れはありません。');
  }

  if (checkOnly && list.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
