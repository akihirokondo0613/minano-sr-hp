/**
 * 文節印（<wbr>）が効かない場所に置かれていないかを実測する
 *
 *   node scripts/test-phrase-breaks.cjs [base] [--json]
 *
 * なぜ静的検査では足りないのか:
 *   sync-phrase-breaks.mjs はHTMLしか見ないので、CSSの子孫セレクタで
 *   white-space:nowrap になる箱（.sec-h strong、.nav-links a など）を
 *   自力では判定できない。nowrapの中の <wbr> は WebKit で折り返しに使われず、
 *   それでいて「折れる」と数えられるらしく、収まらない塊が前の行に残って溢れる
 *   （uploads/service-joseikin.html の320pxで h2.sec-h > strong が31pxはみ出した）。
 *
 * flex/gridの箱の直下にある <wbr> も見る。<wbr> は要素なので、
 * 前後が要素だとそれ自体が1個のアイテムとして数えられ、列がずれる
 * （ブログの li が display:grid で、右の説明が32pxまで潰れた実測がある）。
 * terms.js が実行時に <span class="term"> で包む語の前後も同じことが起きる。
 *
 * 併せて、印が本文へ文字として混ざっていないことも見る。
 * <wbr> は文字を持たない要素なので、textContent に何も足してはいけない。
 */

const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8811/').replace(/\/?$/, '/');
const asJson = args.includes('--json');

const SKIP = new Set(['admin-post.html', 'icon-catalog.html', '404.html']);

function pages() {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.startsWith('.') || name.startsWith('_backup')
        || ['scripts', 'docs', 'node_modules', 'assets', 'data', '.github'].includes(name)) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.html') || SKIP.has(name)) continue;
      out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out;
}

(async () => {
  const targets = pages();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const failures = [];
  let scanned = 0;
  let marks = 0;
  for (const rel of targets) {
    const response = await page.goto(base + rel, { waitUntil: 'domcontentloaded' });
    if (!response || !response.ok()) {
      failures.push(`${rel}: 読み込みに失敗しました（${response ? response.status() : '応答なし'}）`);
      continue;
    }
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '*{content-visibility:visible!important}';
      document.head.appendChild(style);
    });
    const result = await page.evaluate(() => {
      const inNowrap = [];
      const asItem = [];
      const all = document.querySelectorAll('wbr');
      const label = (el) => el.tagName.toLowerCase()
        + (typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/)[0]}` : '');
      // 前後がテキストか行内要素なら、匿名アイテムの中にいるので安全。
      const inline = (node) => !!node && (node.nodeType === 3
        ? node.nodeValue.trim().length > 0
        : (node.nodeType === 1 && getComputedStyle(node).display.startsWith('inline')));
      for (const wbr of all) {
        const parent = wbr.parentElement;
        if (!parent) continue;
        const ws = getComputedStyle(parent).whiteSpace;
        if (ws === 'nowrap' || ws.startsWith('pre')) {
          inNowrap.push(`${label(parent)}（white-space:${ws}）`);
        }
        const display = getComputedStyle(parent).display;
        if (display.includes('flex') || display.includes('grid')) {
          if (!inline(wbr.previousSibling) || !inline(wbr.nextSibling)) {
            asItem.push(`${label(parent)}（display:${display}）`);
          }
        }
      }
      // <wbr> は文字を持たない。ゼロ幅空白などが混ざっていれば検索や引用が壊れる。
      const stray = /[​﻿]/.test(document.body.textContent || '');
      return { count: all.length, inNowrap: [...new Set(inNowrap)], asItem: [...new Set(asItem)], stray };
    });
    scanned += 1;
    marks += result.count;
    if (result.inNowrap.length) {
      failures.push(`${rel}: nowrapの中に<wbr>があります → ${result.inNowrap.join(' / ')}`);
    }
    if (result.asItem.length) {
      failures.push(`${rel}: <wbr>がflex/gridの独立したアイテムになっています → ${result.asItem.join(' / ')}`);
    }
    if (result.stray) {
      failures.push(`${rel}: 本文にゼロ幅空白が混ざっています`);
    }
  }
  await browser.close();

  const report = { base, pages: scanned, marks, failures };
  if (asJson) console.log(JSON.stringify(report, null, 2));

  console.log(`文節印の実測: ${scanned}ページ / <wbr> ${marks}個`);
  if (failures.length) {
    console.error('文節印の置き場所に問題があります。');
    for (const line of failures) console.error(`- ${line}`);
    process.exit(1);
  }
  console.log('効かない場所に置かれた<wbr>はありません。');
})();
