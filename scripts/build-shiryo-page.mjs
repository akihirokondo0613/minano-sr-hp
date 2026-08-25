#!/usr/bin/env node

/**
 * 資料室（shiryo.html）を生成する。
 *
 *   node scripts/build-shiryo-page.mjs           生成
 *   node scripts/build-shiryo-page.mjs --check   差分があれば失敗（公開前チェック用）
 *
 * なぜ作るのか:
 *   配布資料（PDF）を1つのURLにまとめ、税理士や顧問先へ「資料はここです」と案内できるようにする。
 *   紙は数字と手順だけを載せ、くわしい話はWeb版へ送る設計なので、カードにはPDFとWeb版の
 *   両方の入口を置く。
 *
 * 中身の正本は data/shiryo/index.json だけ。HTMLを手で直さない。
 * ページ数と容量は実ファイルから測って埋めるので、データに書かない（書くとズレる）。
 * 骨組み（head・ナビ・フッター・末尾script）は portal.html を型として写す。
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data', 'shiryo', 'index.json');
const donorPath = path.join(root, 'support.html');
const outPath = 'shiryo.html';
const url = `https://minano-sr.com/${outPath}`;

const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownArgs.length) throw new Error(`不明な引数: ${unknownArgs.join(' ')}`);

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const TITLE = '富山の助成金・補助金 資料室｜みなの社会保険労務士事務所';
const DESC = '富山の中小企業向けに、助成金・補助金の資料をPDFで公開しています。'
  + '富山県賃上げ応援補助金、業務改善助成金など、社会保険労務士がまとめた資料を'
  + '登録不要でダウンロードいただけます。制度の根拠と確認日を明記しています。';

/** 型ページから、差し替えたい区間の前後を取り出す */
function splitDonor(source) {
  const cut = (open, close) => {
    const start = source.indexOf(open);
    const end = source.indexOf(close, start);
    if (start < 0 || end < 0) throw new Error(`型ページの区切りが見つかりません: ${open}`);
    return [start, end + close.length];
  };
  const [headStart] = cut('<title>', '</title>');
  const cssStart = source.indexOf('<link rel="stylesheet" href="skin-v2.css');
  const mainOpen = source.indexOf('<main id="main"');
  const mainClose = source.lastIndexOf('</main>');
  if (mainOpen < 0 || mainClose < 0) throw new Error('型ページの<main>が見つかりません');
  const mainStart = mainOpen;
  const mainEnd = mainClose + '</main>'.length;
  if (cssStart < 0) throw new Error('型ページのCSS読み込み位置を特定できません');
  const [, headEnd] = cut('<meta name="twitter:image"', '>');
  return {
    top: source.slice(0, headStart),
    middle: source.slice(cssStart, mainStart),
    tail: source.slice(mainEnd),
    headEnd,
  };
}

function buildHead() {
  return [
    `<title>${esc(TITLE)}</title>`,
    `<meta name="description" content="${esc(DESC)}">`,
    '',
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:url" content="${url}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(TITLE)}">`,
    `<meta property="og:description" content="${esc(DESC)}">`,
    '<meta property="og:site_name" content="みなの社会保険労務士事務所">',
    '<meta property="og:locale" content="ja_JP">',
    '<meta property="og:image" content="https://minano-sr.com/assets/og/minano-og.png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="みなの社会保険労務士事務所のトップページ｜会社の労務を、まるごと任せられる。">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:image" content="https://minano-sr.com/assets/og/minano-og.png">',
  ].join('\n');
}

function buildSchema(groups) {
  const items = groups.flatMap((g) => g.items).map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.title,
    url: `https://minano-sr.com/${item.pdf}`,
  }));
  return `<!-- Structured Data: ItemList -->
<script type="application/ld+json" data-schema="itemlist">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: '富山の助成金・補助金 資料室',
        description: DESC,
        url,
      },
      { '@type': 'ItemList', itemListElement: items },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ホーム', item: 'https://minano-sr.com/' },
          { '@type': 'ListItem', position: 2, name: '資料室', item: url },
        ],
      },
    ],
  }, null, 2)}
</script>`;
}

/** ページ固有のCSS。共通CSSを触らずに済ませる（資産版のバンプが要らない）。 */
const STYLE = `<style id="shiryo">
.sr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,246px),1fr));gap:clamp(16px,2vw,24px)}
.sr-card{display:flex;flex-direction:column;background:var(--shiro);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;text-decoration:none;color:inherit;transition:border-color .3s,box-shadow .35s var(--ease),transform .3s var(--ease)}
.sr-card:hover{border-color:var(--moegi);box-shadow:0 14px 32px rgba(18,63,48,.1);transform:translateY(-3px)}
.sr-card:focus-visible{outline:2px solid var(--sugi);outline-offset:3px}
.sr-head{background:var(--sugi);color:#fff;padding:15px 17px 14px}
.sr-tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
.sr-tag{font-size:10.5px;font-weight:700;letter-spacing:.03em;color:var(--sugi);background:var(--moegi);border-radius:999px;padding:2px 9px}
.sr-title{font-family:var(--disp);font-size:16px;font-weight:800;line-height:1.55;letter-spacing:.01em}
.sr-lead{font-size:12px;line-height:1.75;color:#cfe6d9;margin-top:6px}
.sr-cover{position:relative;background:var(--yuki);border-block:1px solid var(--line)}
.sr-cover img{display:block;width:100%;height:auto}
.sr-cover::after{content:"";position:absolute;inset:auto 0 0;height:38px;background:linear-gradient(rgba(255,255,255,0),var(--shiro))}
.sr-meta{display:flex;flex-wrap:wrap;gap:4px 12px;padding:12px 17px 0;font-family:var(--mono);font-size:11px;color:var(--ink4)}
.sr-open{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 17px 15px;font-size:12.5px;font-weight:700;color:var(--sugi)}
.sr-open span[aria-hidden]{transition:transform .3s var(--ease)}
.sr-card:hover .sr-open span[aria-hidden]{transform:translateX(4px)}
.sr-web{display:inline-flex;align-items:center;gap:6px;margin-top:9px;font-size:12px;font-weight:700;color:var(--sugi);border-bottom:1px solid var(--moegi);padding-bottom:2px;text-decoration:none}
.sr-web:hover{color:var(--sugi-7)}
.sr-item{display:flex;flex-direction:column}
.sr-note{margin-top:clamp(28px,4vw,44px);background:var(--moegi-l);border-radius:var(--r-lg);padding:clamp(18px,2.4vw,26px) clamp(20px,2.6vw,30px)}
.sr-note b{color:var(--sugi)}
.sr-note p{font-size:13.5px;line-height:1.95;color:var(--ink2)}
@media (max-width: 760px){
  .sr-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .sr-head{padding:12px 13px 11px}
  .sr-title{font-size:13.5px;line-height:1.5}
  .sr-lead{display:none}
  .sr-tag{font-size:9.5px;padding:1px 7px}
  .sr-meta{padding:9px 13px 0;font-size:10px;gap:2px 8px}
  .sr-open{padding:9px 13px 12px;font-size:11.5px}
  .sr-cover::after{height:24px}
}
</style>`;

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日現在`;
}

function fmtSize(bytes) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

async function pdfPageCount(file) {
  // 依存を増やさずに数える。線形化されたPDFでも /Type /Page の出現数で足りる。
  const buf = await readFile(file);
  const text = buf.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

async function buildCard(item) {
  const pdfAbs = path.join(root, item.pdf);
  const [{ size }, pages] = await Promise.all([stat(pdfAbs), pdfPageCount(pdfAbs)]);
  const tags = item.tags.map((t) => `<span class="sr-tag">${esc(t)}</span>`).join('');
  return `      <div class="sr-item rv">
        <a class="sr-card" href="${esc(item.pdf)}" download aria-label="${esc(item.title)}のPDFをダウンロード（${pages}ページ・${fmtSize(size)}）">
          <div class="sr-head">
            <div class="sr-tags">${tags}</div>
            <div class="sr-title">${esc(item.title)}</div>
            <p class="sr-lead">${esc(item.lead)}</p>
          </div>
          <div class="sr-cover"><img src="${esc(item.cover)}" alt="" width="760" height="601" loading="lazy" decoding="async"></div>
          <div class="sr-meta"><span>PDF・${pages}ページ・${fmtSize(size)}</span><span>${esc(fmtDate(item.checkedAt))}</span></div>
          <div class="sr-open"><span>ダウンロード</span><span aria-hidden="true">↓</span></div>
        </a>
        <a class="sr-web" href="${esc(item.web)}">Webで読む<span aria-hidden="true">→</span></a>
      </div>`;
}

async function buildMain(groups) {
  const sections = [];
  for (const g of groups) {
    const cards = [];
    for (const item of g.items) cards.push(await buildCard(item));
    sections.push(`  <section class="sec" id="${esc(g.id)}">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-idx"><span class="idx-lat">${esc(g.lat)}</span><span class="idx-jp">${esc(g.title)}</span></div>
        <div class="sec-head-body">
          <h2 class="sec-h">${esc(g.h)}</h2>
          <p class="sec-sub">${esc(g.lead)}</p>
        </div>
      </div>
      <div class="sr-grid">
${cards.join('\n')}
      </div>
    </div>
  </section>`);
  }

  return `<main id="main" class="hub-page">

<header class="page-hero">
  <div class="page-hero-inner">
    <nav class="breadcrumb"><a href="/">ホーム</a><span class="sep">›</span><span>資料室</span></nav>
    <div class="page-label">資料室</div>
    <h1 class="page-h">富山の助成金・補助金を、<strong>持ち帰れる形に。</strong></h1>
    <p class="page-sub">制度ごとに要点をまとめたPDFです。登録は不要で、そのまま保存・印刷いただけます。くわしい要件や様式は、各資料のWeb版に載せています。</p>
  </div>
</header>

${sections.join('\n\n')}

  <section class="sec sec-alt">
    <div class="w">
      <div class="sr-note">
        <p><b>資料には、根拠を確認した日を入れています。</b>助成金や補助金は年度や政策で変わります。カードに出している日付は、その資料の内容を公式の資料で確認した日です。申請の前には、必ず最新の要領をお確かめください。対象になるかどうかのご相談は無料でお受けしています。</p>
      </div>
    </div>
  </section>

</main>`;
}

const [donor, raw] = await Promise.all([
  readFile(donorPath, 'utf8'),
  readFile(dataPath, 'utf8'),
]);
const data = JSON.parse(raw);
const parts = splitDonor(donor);

const head = buildHead();
const main = markPhrases(await buildMain(data.groups)).html;
const built = `${parts.top}${head}\n${parts.middle}${buildSchema(data.groups)}\n${STYLE}\n${main}${parts.tail}`
    .replace(/data-goatcounter-settings='\{"path":"[^"]*"\}'/, `data-goatcounter-settings='{"path":"/${outPath}"}'`)
  .replace(/<body data-nav="[^"]*">/, '<body data-nav="B">');

const target = path.join(root, outPath);
const current = await readFile(target, 'utf8').catch(() => '');

if (checkOnly) {
  if (current !== built) {
    console.error(`資料室ページが最新ではありません。node scripts/build-shiryo-page.mjs を実行してください（${outPath}）`);
    process.exit(1);
  }
  console.log('資料室ページは最新です。');
} else if (current === built) {
  console.log('資料室ページは最新です。');
} else {
  await writeFile(target, built, 'utf8');
  console.log(`資料室ページを生成しました: ${outPath}`);
}
