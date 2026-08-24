#!/usr/bin/env node

/**
 * 富山ローカルの単独ページ2枚を生成する。
 *
 *   node scripts/build-toyama-local-pages.mjs           生成
 *   node scripts/build-toyama-local-pages.mjs --check    差分があれば失敗（公開前チェック用）
 *
 *   - uploads/toyama-saitei-chingin.html      富山県の最低賃金（いまの額と次の額）
 *   - uploads/toyama-chinage-oen-hojokin.html 富山県賃上げ応援補助金（社労士報酬の補助）
 *
 * なぜ作るのか:
 *   どちらも実測で競合がいない語。最低賃金は「いま1,062円・10月から1,119円見込み」が
 *   検索結果上で混在しており、区別を正しく書くだけで価値がある。賃上げ応援補助金は
 *   県公式しか検索に出て来ず、解説を書けば唯一になる。しかも「社労士への報酬の一部が
 *   補助対象」という制度そのものが、依頼のハードルを下げる。
 *
 * 正本の分け方:
 *   - 地域別最低賃金のいまの額・答申額 … data/service-toyama.json の numbers（給与計算ページと共通）
 *   - 時系列・産業別・チェック手順   … data/toyama-saitei-chingin.json
 *   - 補助金の制度内容               … data/toyama-chinage-oen.json
 *   - 窓口の住所・電話               … data/toyama-madoguchi.json（id で引く。ここには書かない）
 *   骨組みは uploads/service-romu-sodan.html を型として写す（build-toyama-madoguchi.mjs と同じ方式）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownArgs.length) throw new Error(`不明な引数: ${unknownArgs.join(' ')}`);

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function hostOf(source) {
  try { return new URL(source).host; } catch { return source; }
}

/** 型ページから、差し替えたい区間の前後を取り出す（build-toyama-madoguchi.mjs と同じ切り方） */
function splitDonor(source) {
  const cut = (open, close) => {
    const start = source.indexOf(open);
    const end = source.indexOf(close, start);
    if (start < 0 || end < 0) throw new Error(`型ページの区切りが見つかりません: ${open}`);
    return [start, end + close.length];
  };
  const [headStart] = cut('<title>', '</title>');
  const cssStart = source.indexOf('<link rel="stylesheet" href="service.css');
  const schemaStart = source.indexOf('<!-- Structured Data: Service -->');
  const [, schemaEnd] = cut('<!-- Structured Data: Service -->', '</script>');
  const [mainStart, mainEnd] = cut('<main id="main">', '</main>');
  if (cssStart < 0 || schemaStart < 0 || cssStart > schemaStart) {
    throw new Error('型ページのCSS読み込み位置を特定できません');
  }
  return {
    top: source.slice(0, headStart),
    assets: source.slice(cssStart, schemaStart),
    middle: source.slice(schemaEnd, mainStart),
    tail: source.slice(mainEnd),
  };
}

function buildHead(title, desc, url) {
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    '',
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:url" content="${url}">`,
    '<meta property="og:type" content="article">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
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

function buildBreadcrumbSchema(crumbs, url) {
  const items = [
    { name: 'ホーム', item: 'https://minano-sr.com/' },
    ...crumbs.slice(0, -1),
    { name: crumbs[crumbs.length - 1].name, item: url },
  ].map((c, i) => `    { "@type": "ListItem", "position": ${i + 1}, "name": "${c.name}", "item": "${c.item}" }`);
  return `<!-- Structured Data: BreadcrumbList -->
<script type="application/ld+json" data-schema="breadcrumblist">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
${items.join(',\n')}
  ]
}
</script>`;
}

/** 窓口カード（住所・電話は data/toyama-madoguchi.json が正本） */
function officeCard(byId, id, role) {
  const office = byId.get(id);
  if (!office) throw new Error(`data/toyama-madoguchi.json に id=${id} の窓口がありません`);
  const rows = [
    office.address ? ['所在地', esc(office.address)] : null,
    office.tel ? ['電話', esc(office.tel)] : null,
  ].filter(Boolean);
  return [
    '        <div class="svct-office">',
    `          <p class="svct-office-n"><a href="toyama-madoguchi.html#mdg-${esc(office.id)}">${esc(office.name)}</a></p>`,
    `          <p class="svct-office-r">${esc(role)}</p>`,
    '          <dl class="svct-dl">',
    ...rows.map(([k, v]) => `            <dt>${k}</dt><dd>${v}</dd>`),
    '          </dl>',
    '        </div>',
  ].join('\n');
}

const CTA = `  <section class="final-cta">
    <div class="w">
      <span class="sec-kicker" style="color:rgba(255,255,255,.7)">Free Consultation</span>
      <h2>制度の確認から申請まで、こちらで引き受けます。</h2>
      <p>自社が対象になるか、どの順序で進めるか。初回のご相談は無料です。</p>
      <a href="contact.html" class="btn-white">無料で相談する</a>
    </div>
  </section>`;

/* ───────────────────────── 最低賃金ページ ───────────────────────── */

const SAITEI_STYLE = `<style id="saitei-chingin">
.stc-tl{list-style:none;margin:0;padding:0;border-left:2px solid var(--g300)}
.stc-tl li{position:relative;padding:0 0 22px 22px}
.stc-tl li:last-child{padding-bottom:0}
.stc-tl li::before{content:"";position:absolute;left:-7px;top:6px;width:12px;height:12px;border-radius:50%;background:var(--g500);border:2px solid #fff}
.stc-tl li.stc-todo::before{background:#fff;border:2px solid var(--g500)}
.stc-tl-d{font-size:12.5px;font-weight:700;color:var(--g700);letter-spacing:.04em}
.stc-tl-t{font-size:14.5px;font-weight:700;color:var(--ink);margin:2px 0 4px;line-height:1.7;text-wrap:pretty;word-break:auto-phrase}
.stc-tl-x{font-size:13px;color:var(--ink2);line-height:1.9;letter-spacing:.02em;margin:0;text-wrap:pretty;word-break:auto-phrase}
.stc-table{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:8px}
.stc-table th,.stc-table td{border-bottom:1px solid var(--line);padding:11px 12px;text-align:left;vertical-align:top;line-height:1.75}
.stc-table thead th{font-size:12px;font-weight:700;color:var(--g700);letter-spacing:.04em;border-bottom:2px solid var(--g300);white-space:nowrap}
.stc-table td.stc-amt{font-weight:700;color:var(--ink);white-space:nowrap}
.stc-tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.stc-check{display:grid;gap:12px}
.stc-check-i{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:#fff}
.stc-check-t{font-size:14px;font-weight:700;color:var(--ink);margin:0 0 6px;line-height:1.7}
.stc-check-d{font-size:13px;color:var(--ink2);line-height:1.9;letter-spacing:.02em;margin:0;text-wrap:pretty;word-break:auto-phrase}
</style>`;

function buildSaiteiMain(ctx) {
  const { numbers, tl, sangyo, check, sources, checkedAt } = ctx;
  const numCards = numbers.map((row) => [
    '        <div class="svct-num">',
    `          <p class="svct-num-l">${esc(row.label)}</p>`,
    `          <p class="svct-num-v">${esc(row.value)}</p>`,
    `          <p class="svct-num-n">${esc(row.note)}</p>`,
    row.source
      ? `          <p class="svct-num-s">出典 <a href="${esc(row.source)}" target="_blank" rel="noopener">${esc(hostOf(row.source))}</a></p>`
      : '',
    '        </div>',
  ].filter(Boolean).join('\n')).join('\n');

  const tlItems = tl.map((s) => [
    `        <li${s.done ? '' : ' class="stc-todo"'}>`,
    `          <span class="stc-tl-d">${esc(s.date)}</span>`,
    `          <p class="stc-tl-t">${esc(s.label)}</p>`,
    `          <p class="stc-tl-x">${esc(s.text)}</p>`,
    '        </li>',
  ].join('\n')).join('\n');

  const sangyoRows = sangyo.rows.map((r) =>
    `          <tr><td>${esc(r.name)}</td><td class="stc-amt">${esc(r.amount)}</td><td>${esc(r.effective)}発効</td></tr>`).join('\n');

  const checkItems = check.map((c) => [
    '        <div class="stc-check-i">',
    `          <p class="stc-check-t">${esc(c.t)}</p>`,
    `          <p class="stc-check-d">${esc(c.d)}</p>`,
    '        </div>',
  ].join('\n')).join('\n');

  return `<main id="main">
  <header class="page-hero">
    <div class="w">
      <nav class="breadcrumb" aria-label="現在の位置">
        <a href="../">ホーム</a><span aria-hidden="true">›</span>
        <a href="../support.html">支援の進め方</a><span aria-hidden="true">›</span>
        <span aria-current="page">富山県の最低賃金</span>
      </nav>
      <span class="sec-kicker">富山の数字</span>
      <h1>富山県の最低賃金。<br>いまの額と、次の額。</h1>
      <p class="lead">富山県の最低賃金はいま時間額1,062円で、令和8年度は1,119円への引上げが答申されています。ただし答申はまだ発効していません。どちらの額をいつから守るのかを、社会保険労務士が${fmtDate(checkedAt)}時点の一次資料で整理しました。</p>
    </div>
  </header>

  <section class="sec" id="ima">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">いまの額と、次の額</h2>
          <p class="sec-sub">この2つは別のものです。支払いの下限としていま守るのは、発効済みの額のほうです。</p>
        </div>
      </div>
      <div class="svct-nums rv d1">
${numCards}
      </div>
    </div>
  </section>

  <section class="sec sec-alt" id="nagare">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">改定はどこまで進んでいるか</h2>
          <p class="sec-sub">答申から発効までは、決まった手順を踏みます。${esc(checkedAt)}時点の進み具合です。</p>
        </div>
      </div>
      <ul class="stc-tl rv d1">
${tlItems}
      </ul>
    </div>
  </section>

  <section class="sec" id="sangyobetsu">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">産業別の最低賃金は、いまは使わない</h2>
          <p class="sec-sub">${esc(sangyo.note)}</p>
        </div>
      </div>
      <div class="stc-tablewrap rv d1">
        <table class="stc-table">
          <caption class="sr-only">富山県の特定（産業別）最低賃金</caption>
          <thead>
            <tr><th scope="col">産業</th><th scope="col">時間額</th><th scope="col">発効日</th></tr>
          </thead>
          <tbody>
${sangyoRows}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="sec sec-alt" id="check">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">自社の給与の確かめ方</h2>
          <p class="sec-sub">最低賃金は時給者だけの話ではありません。月給者も時間額に直して比べます。</p>
        </div>
      </div>
      <div class="stc-check rv d1">
${checkItems}
      </div>
      <p class="svct-note rv d2">賃金の引上げには、国の業務改善助成金（設備投資とセットの制度・<a href="../blog/gyomu-kaizen-toyama-2026.html">富山の申請時期の解説</a>）や、社会保険労務士への依頼費用の一部を補助する<a href="toyama-chinage-oen-hojokin.html">富山県賃上げ応援補助金</a>があります。毎月の給与計算での適用は<a href="service-kyuyo-keisan.html">給与計算代行のページ</a>にまとめています。</p>
    </div>
  </section>

  <section class="sec" id="madoguchi">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">問い合わせ先</h2>
          <p class="sec-sub">最低賃金がいくらか・いつから変わるかの問い合わせ先です。</p>
        </div>
      </div>
      <div class="svct-offices rv d1">
${ctx.offices}
      </div>
      <p class="svct-cta rv d2"><a class="btn-secondary" href="toyama-madoguchi.html">富山の窓口一覧をすべて見る →</a></p>
      <p class="svct-num-s rv d2">出典 <a href="${esc(sources.kyoku)}" target="_blank" rel="noopener">${esc(hostOf(sources.kyoku))}</a>（富山労働局 最低賃金・最低工賃／答申の報道発表）・確認日 ${fmtDate(checkedAt)}</p>
    </div>
  </section>

${CTA}
</main>`;
}

/* ─────────────────────── 賃上げ応援補助金ページ ─────────────────────── */

const CHINAGE_STYLE = `<style id="chinage-oen">
.cho-hojo{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}
.cho-hojo-i{border:1px solid var(--line);border-radius:12px;padding:18px 20px;background:#fff;text-align:center}
.cho-hojo-w{font-size:13px;font-weight:700;color:var(--ink3);margin:0 0 6px}
.cho-hojo-r{font-size:17px;font-weight:700;color:var(--g700);margin:0;line-height:1.6}
.cho-hojo-c{font-size:12.5px;color:var(--ink3);margin:4px 0 0}
.cho-seido{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:8px}
.cho-seido th,.cho-seido td{border-bottom:1px solid var(--line);padding:12px;text-align:left;vertical-align:top;line-height:1.8}
.cho-seido thead th{font-size:12px;font-weight:700;color:var(--g700);letter-spacing:.04em;border-bottom:2px solid var(--g300);white-space:nowrap}
.cho-seido td a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--g300);font-weight:700}
.cho-seido td a:hover{color:var(--g700);border-bottom-color:var(--g700)}
.cho-tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.cho-flow{list-style:none;margin:0;padding:0;display:grid;gap:12px;counter-reset:cho}
.cho-flow li{position:relative;border:1px solid var(--line);border-radius:12px;padding:16px 18px 16px 56px;background:#fff;counter-increment:cho}
.cho-flow li::before{content:counter(cho);position:absolute;left:18px;top:16px;width:26px;height:26px;border-radius:50%;background:var(--g500);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
.cho-flow-t{font-size:14px;font-weight:700;color:var(--ink);margin:0 0 6px;line-height:1.7}
.cho-flow-d{font-size:13px;color:var(--ink2);line-height:1.9;letter-spacing:.02em;margin:0;text-wrap:pretty;word-break:auto-phrase}
</style>`;

function buildChinageMain(ctx) {
  const { data, checkedAt } = ctx;
  const hojoCards = data.hojo.map((h) => [
    '        <div class="cho-hojo-i">',
    `          <p class="cho-hojo-w">${esc(h.who)}</p>`,
    `          <p class="cho-hojo-r">${esc(h.rate)}</p>`,
    `          <p class="cho-hojo-c">${esc(h.cap)}</p>`,
    '        </div>',
  ].join('\n')).join('\n');

  const seidoRows = data.seido.map((s) => {
    const name = s.href ? `<a href="${esc(s.href)}">${esc(s.name)}</a>` : esc(s.name);
    return `          <tr><td>${name}</td><td>${esc(s.note)}</td></tr>`;
  }).join('\n');

  const flowItems = data.flow.map((f) => [
    '        <li>',
    `          <p class="cho-flow-t">${esc(f.t)}</p>`,
    `          <p class="cho-flow-d">${esc(f.d)}</p>`,
    '        </li>',
  ].join('\n')).join('\n');

  return `<main id="main">
  <header class="page-hero">
    <div class="w">
      <nav class="breadcrumb" aria-label="現在の位置">
        <a href="../">ホーム</a><span aria-hidden="true">›</span>
        <a href="../joseikin.html">助成金</a><span aria-hidden="true">›</span>
        <span aria-current="page">富山県賃上げ応援補助金</span>
      </nav>
      <span class="sec-kicker">富山県の制度</span>
      <h1>富山県賃上げ応援補助金。<br>社労士費用の一部が、補助対象です。</h1>
      <p class="lead">国の助成金の申請手続きや就業規則の整備を社会保険労務士等へ依頼したとき、その報酬費用の一部を富山県が補助する制度です。中小企業は2分の1、小規模事業者は3分の2、いずれも上限10万円。${fmtDate(checkedAt)}時点の県の公式ページで内容を確認しています。</p>
    </div>
  </header>

  <section class="sec" id="hojo">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">なにが、いくら補助されるのか</h2>
          <p class="sec-sub">補助の対象は「${esc(data.taisho.keihi)}」です。対象となるのは${esc(data.taisho.jigyosha)}です。</p>
        </div>
      </div>
      <div class="cho-hojo rv d1">
${hojoCards}
      </div>
      <p class="svct-note rv d2">${esc(data.rei)}</p>
    </div>
  </section>

  <section class="sec sec-alt" id="seido">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">対象になる国の6制度</h2>
          <p class="sec-sub">次の助成金・給付金に関する依頼が対象です。制度名から、それぞれの解説に進めます。</p>
        </div>
      </div>
      <div class="cho-tablewrap rv d1">
        <table class="cho-seido">
          <caption class="sr-only">富山県賃上げ応援補助金の対象となる国の制度</caption>
          <thead>
            <tr><th scope="col">制度</th><th scope="col">どんな制度か</th></tr>
          </thead>
          <tbody>
${seidoRows}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="sec" id="nagare">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">申請までの流れ</h2>
          <p class="sec-sub">${esc(data.taisho.kikan)}</p>
        </div>
      </div>
      <ol class="cho-flow rv d1">
${flowItems}
      </ol>
      <p class="svct-note rv d2">${esc(data.caveat)}</p>
    </div>
  </section>

  <section class="sec sec-alt" id="madoguchi">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">申請先・問い合わせ先</h2>
          <p class="sec-sub">県の担当課です。制度の詳細と様式は公式ページにあります。</p>
        </div>
      </div>
      <div class="svct-offices rv d1">
${ctx.offices}
      </div>
      <p class="svct-cta rv d2"><a class="btn-secondary" href="toyama-madoguchi.html">富山の窓口一覧をすべて見る →</a></p>
      <p class="svct-num-s rv d2">出典 <a href="${esc(data.source)}" target="_blank" rel="noopener">${esc(hostOf(data.source))}</a>（富山県公式）・確認日 ${fmtDate(checkedAt)}</p>
      <p class="svct-note rv d2">当事務所の<a href="service-joseikin.html">助成金の申請代行</a>（着手金0円・完全成功報酬）への報酬も、この補助金の対象経費に当たります。交付には県の審査があるため、依頼の前に対象かどうかもあわせてご確認いただけます。</p>
    </div>
  </section>

${CTA}
</main>`;
}

/* ───────────────────────────── 実行 ───────────────────────────── */

const [donorSource, madoguchiRaw, serviceToyamaRaw, saiteiRaw, chinageRaw] = await Promise.all([
  readFile(path.join(root, 'uploads', 'service-romu-sodan.html'), 'utf8'),
  readFile(path.join(root, 'data', 'toyama-madoguchi.json'), 'utf8'),
  readFile(path.join(root, 'data', 'service-toyama.json'), 'utf8'),
  readFile(path.join(root, 'data', 'toyama-saitei-chingin.json'), 'utf8'),
  readFile(path.join(root, 'data', 'toyama-chinage-oen.json'), 'utf8'),
]);
const donor = splitDonor(donorSource);
const madoguchi = JSON.parse(madoguchiRaw);
const byId = new Map();
for (const group of madoguchi.groups) {
  for (const office of group.offices) byId.set(office.id, office);
}

// 地域別のいまの額・答申額は給与計算ページの numbers が正本。ラベルで引き、消えたら止める。
const kyuyo = JSON.parse(serviceToyamaRaw).pages.find((p) => p.file.endsWith('service-kyuyo-keisan.html'));
if (!kyuyo?.numbers) throw new Error('data/service-toyama.json に給与計算ページの numbers がありません');
const numberByLabel = (label) => {
  const row = kyuyo.numbers.rows.find((r) => r.label === label);
  if (!row) throw new Error(`data/service-toyama.json の numbers に「${label}」がありません`);
  return row;
};

const saitei = JSON.parse(saiteiRaw);
const chinage = JSON.parse(chinageRaw);

const PAGES = [
  {
    out: 'uploads/toyama-saitei-chingin.html',
    title: '富山県の最低賃金 いまの額と次の額｜みなの社会保険労務士事務所',
    desc: '富山県の最低賃金は時間額1,062円（令和7年10月12日発効）。令和8年度は1,119円への引上げが答申され、10月1日発効の見込みですが、まだ発効していません。'
      + '産業別最低賃金との関係、月給者の確認手順、賃上げに使える制度まで社会保険労務士が整理しました。',
    crumbs: [{ name: '支援の進め方', item: 'https://minano-sr.com/support.html' }, { name: '富山県の最低賃金' }],
    style: SAITEI_STYLE,
    marker: 'stc-tl',
    build: (url) => buildSaiteiMain({
      numbers: [numberByLabel('富山県最低賃金（地域別）'), numberByLabel('令和8年度の改定（答申額）')],
      tl: saitei.timeline,
      sangyo: saitei.sangyobetsu,
      check: saitei.check,
      sources: saitei.sources,
      checkedAt: saitei.checkedAt,
      offices: officeCard(byId, 'kyoku-chingin', '最低賃金がいくらか、いつから変わるかの問い合わせ先です。'),
    }),
  },
  {
    out: 'uploads/toyama-chinage-oen-hojokin.html',
    title: '富山県賃上げ応援補助金 社労士費用の一部が補助対象｜みなの社会保険労務士事務所',
    desc: '国の助成金の申請などを社会保険労務士等へ依頼した報酬費用の一部を補助する富山県の制度です。対象は業務改善助成金・キャリアアップ助成金など6制度。'
      + '中小企業は2分の1、小規模事業者は3分の2、いずれも上限10万円。対象・流れ・提出書類を社会保険労務士が整理しました。',
    crumbs: [{ name: '助成金', item: 'https://minano-sr.com/joseikin.html' }, { name: '富山県賃上げ応援補助金' }],
    style: CHINAGE_STYLE,
    marker: 'cho-flow',
    build: () => buildChinageMain({
      data: chinage,
      checkedAt: chinage.checkedAt,
      offices: officeCard(byId, chinage.officeId, '申請書類の提出先・制度の問い合わせ先です。'),
    }),
  },
];

let changed = 0;
for (const page of PAGES) {
  const url = `https://minano-sr.com/${page.out}`;
  const generated = markPhrases(donor.top
    + buildHead(page.title, page.desc, url) + '\n'
    + donor.assets
    + buildBreadcrumbSchema(page.crumbs, url)
    + donor.middle.replace('</head>', `${page.style}\n</head>`)
    + page.build(url)
    + donor.tail.replaceAll('/uploads/service-romu-sodan.html', `/${page.out}`)).html;

  for (const must of ['service.css?v=', 'wave-skin.css?v=', 'id="brand-v2"', '<main id="main">', page.marker]) {
    if (!generated.includes(must)) throw new Error(`${page.out}: 生成物に ${must} がありません`);
  }
  if (generated.includes('data-schema="service"')) {
    throw new Error(`${page.out}: 対象外ページにServiceスキーマが混ざっています`);
  }

  const file = path.join(root, page.out);
  let current = '';
  try { current = await readFile(file, 'utf8'); } catch { current = ''; }
  if (current === generated) continue;
  changed += 1;
  if (checkOnly) {
    console.error(`${page.out}: 正本のデータと同期していません`);
    continue;
  }
  await writeFile(file, generated, 'utf8');
  console.log(`更新: ${page.out}`);
}

if (checkOnly) {
  if (changed) {
    console.error('node scripts/build-toyama-local-pages.mjs を実行してください。');
    process.exit(1);
  }
  console.log(`富山ローカルページは同期しています（${PAGES.length}ページ）。`);
  process.exit(0);
}
console.log(changed ? `富山ローカルページを更新しました（${changed}ページ）。` : `富山ローカルページに変更はありません（${PAGES.length}ページ）。`);
