#!/usr/bin/env node

/**
 * 富山の労務手続き窓口一覧（uploads/toyama-madoguchi.html）を生成する。
 *
 *   node scripts/build-toyama-madoguchi.mjs           生成
 *   node scripts/build-toyama-madoguchi.mjs --check    差分があれば失敗（公開前チェック用）
 *
 * なぜ作るのか:
 *   「就業規則はどこに出す」「富山の年金事務所はどこ」のような検索に対して、
 *   行政サイトは縦割りで、労基署・年金事務所・ハローワーク・県を横断した一覧が無い。
 *   実務者しか正確に書けず、書けば長く使える。地域の語で拾える数少ない面になる。
 *
 * 中身の正本は data/toyama-madoguchi.json だけ。HTMLを手で直さない。
 * 骨組み（head・ナビ・フッター・末尾script）は uploads/service-romu-sodan.html を
 * 型として写すので、共通部分の変更が自動で追随する。build-joseikin-guides.mjs と同じ方式。
 *
 * 電話番号・住所は公式サイトから収集し、別のエージェントが出典を再取得して逐語で
 * 照合した値のみを使う。記憶や台帳からの転記で足さない（公開ページの誤りは信用に直結する）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data', 'toyama-madoguchi.json');
const donorPath = path.join(root, 'uploads', 'service-romu-sodan.html');
const outPath = 'uploads/toyama-madoguchi.html';
const url = `https://minano-sr.com/${outPath}`;

const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownArgs.length) throw new Error(`不明な引数: ${unknownArgs.join(' ')}`);

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** 型ページから、差し替えたい区間の前後を取り出す（build-joseikin-guides.mjs と同じ切り方） */
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
    assets: source.slice(cssStart, schemaStart),   // service.css・brand-v2・wave-skin.css・favicon
    middle: source.slice(schemaEnd, mainStart),
    tail: source.slice(mainEnd),
  };
}

const TITLE = '富山の労務手続き 窓口一覧｜どこに何を出すか｜みなの社会保険労務士事務所';
const DESC = '富山県の労働基準監督署・年金事務所・ハローワーク・労働局・県の窓口を一覧に。'
  + '就業規則の届出、社会保険の資格取得、離職票、助成金の申請先まで、手続きごとにどこへ出すかを'
  + '社会保険労務士が整理しました。所在地・電話・管轄を公式サイトで確認しています。';

function buildHead() {
  return [
    `<title>${esc(TITLE)}</title>`,
    `<meta name="description" content="${esc(DESC)}">`,
    '',
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:url" content="${url}">`,
    '<meta property="og:type" content="article">',
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

function buildBreadcrumbSchema() {
  return `<!-- Structured Data: BreadcrumbList -->
<script type="application/ld+json" data-schema="breadcrumblist">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "ホーム", "item": "https://minano-sr.com/" },
    { "@type": "ListItem", "position": 2, "name": "支援の進め方", "item": "https://minano-sr.com/support.html" },
    { "@type": "ListItem", "position": 3, "name": "富山の労務手続き 窓口一覧", "item": "${url}" }
  ]
}
</script>`;
}

/** ページ固有のCSS。共通CSSを触らずに済ませる（資産版のバンプが要らない）。 */
const STYLE = `<style id="madoguchi">
.mdg-quick{width:100%;border-collapse:collapse;border-top:1px solid var(--line);margin-top:8px}
.mdg-quick th,.mdg-quick td{text-align:left;vertical-align:top;padding:14px 4px;border-bottom:1px solid var(--line);line-height:1.8;letter-spacing:.02em}
.mdg-quick th{width:56%;font-size:14.5px;font-weight:700;color:var(--ink);padding-right:20px;text-wrap:pretty;word-break:auto-phrase}
.mdg-quick td{font-size:14px;color:var(--g700);font-weight:700;text-wrap:pretty;word-break:auto-phrase}
@media(max-width:700px){.mdg-quick th,.mdg-quick td{display:block;width:100%}.mdg-quick th{border-bottom:none;padding:14px 4px 2px}.mdg-quick td{padding:2px 4px 14px}}
.mdg-group{margin-top:clamp(30px,4vw,48px);scroll-margin-top:96px}
.mdg-group-lead{font-size:14.5px;color:var(--ink2);line-height:1.95;letter-spacing:.02em;margin:0 0 20px;max-width:44em;text-wrap:pretty;word-break:auto-phrase}
.mdg-list{display:grid;gap:14px}
.mdg-office{border:1px solid var(--line);border-radius:var(--r);padding:20px 22px;background:#fff;scroll-margin-top:96px}
.mdg-office-n{font-family:var(--serif);font-size:16px;font-weight:600;color:var(--ink);margin:0 0 10px;line-height:1.6;text-wrap:pretty;word-break:auto-phrase}
.mdg-dl{display:grid;grid-template-columns:76px minmax(0,1fr);gap:6px 16px;margin:0 0 12px}
.mdg-dl dt{font-size:12px;font-weight:700;color:var(--ink3);letter-spacing:.06em;padding-top:2px}
.mdg-dl dd{margin:0;font-size:14px;color:var(--ink2);line-height:1.85;letter-spacing:.02em;text-wrap:pretty;word-break:auto-phrase}
.mdg-dl dd a{color:var(--g700);font-weight:700;border-bottom:1.5px solid var(--g500);padding-bottom:1px}
.mdg-tasks{margin:0;padding-left:18px;font-size:13.5px;color:var(--ink2);line-height:1.9;letter-spacing:.02em}
.mdg-tasks li{margin-bottom:4px;text-wrap:pretty;word-break:auto-phrase}
.mdg-note{margin:12px 0 0;padding-top:12px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink3);line-height:1.9;letter-spacing:.02em;text-wrap:pretty;word-break:auto-phrase}
.mdg-src{margin:10px 0 0;font-size:11.5px;color:var(--ink3);word-break:break-all}
.mdg-src a{color:var(--ink3);border-bottom:1px solid var(--line2);word-break:break-all;overflow-wrap:anywhere}
.mdg-caveat{margin-top:clamp(30px,4vw,48px);border:1px solid var(--line);border-left:3px solid var(--g600);border-radius:var(--r);padding:22px 24px;background:var(--g25)}
.mdg-caveat p{margin:0 0 10px;font-size:13.5px;color:var(--ink2);line-height:1.95;letter-spacing:.02em;text-wrap:pretty;word-break:auto-phrase}
.mdg-caveat p:last-child{margin-bottom:0}
</style>`;

/**
 * 出典の表示名。URLをそのまま出すと、62文字級のURLが狭幅で折れずに器を押し広げる
 * （共通CSSの `p a { word-break: normal }` が効くため）。ホスト名だけ見せる。
 */
function hostOf(source) {
  try { return new URL(source).host; } catch { return source; }
}

function officeBlock(office) {
  const rows = [
    office.address ? ['所在地', esc(office.address)] : null,
    ['電話', esc(office.tel)],
    office.jurisdiction ? ['管轄', esc(office.jurisdiction)] : null,
  ].filter(Boolean);
  return [
    `        <div class="mdg-office" id="mdg-${esc(office.id)}">`,
    `          <p class="mdg-office-n">${esc(office.name)}</p>`,
    '          <dl class="mdg-dl">',
    ...rows.map(([k, v]) => `            <dt>${k}</dt><dd>${v}</dd>`),
    '          </dl>',
    office.tasks?.length
      ? `          <ul class="mdg-tasks">\n${office.tasks.map((t) => `            <li>${esc(t)}</li>`).join('\n')}\n          </ul>`
      : '',
    office.notes ? `          <p class="mdg-note">${esc(office.notes)}</p>` : '',
    office.source
      ? `          <p class="mdg-src">出典 <a href="${esc(office.source)}" target="_blank" rel="noopener">${esc(hostOf(office.source))}</a></p>`
      : '',
    '        </div>',
  ].filter(Boolean).join('\n');
}

function buildMain(data) {
  const quick = data.quickTable
    .map((r) => `          <tr><th>${esc(r.task)}</th><td>${esc(r.to)}</td></tr>`)
    .join('\n');

  const groups = data.groups.map((g) => `
    <div class="mdg-group rv" id="mdg-g-${esc(g.key)}">
      <h3 class="sec-h" style="font-size:clamp(20px,2.6vw,27px)">${esc(g.title)}</h3>
      <p class="mdg-group-lead">${esc(g.lead)}</p>
      <div class="mdg-list">
${g.offices.map(officeBlock).join('\n')}
      </div>
    </div>`).join('\n');

  return `<main id="main">
  <header class="page-hero">
    <div class="w">
      <nav class="breadcrumb" aria-label="現在の位置">
        <a href="../">ホーム</a><span aria-hidden="true">›</span>
        <a href="../support.html">支援の進め方</a><span aria-hidden="true">›</span>
        <span aria-current="page">富山の労務手続き 窓口一覧</span>
      </nav>
      <span class="sec-kicker">富山の窓口</span>
      <h1>どこに何を出すか。<br>富山の労務手続き 窓口一覧</h1>
      <p class="lead">就業規則は労働基準監督署、社会保険は年金事務所、離職票はハローワーク。
        助成金は制度によって申請先が分かれます。富山県内の窓口を、手続きごとにまとめました。
        所在地・電話・管轄は公式サイトで確認しています。</p>
    </div>
  </header>

  <section class="sec" id="quick">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">手続きから探す</h2>
          <p class="sec-sub">よくある手続きの提出先です。詳しい所在地と電話は、下の系統ごとの一覧にあります。</p>
        </div>
      </div>
      <table class="mdg-quick rv d1">
        <tbody>
${quick}
        </tbody>
      </table>
    </div>
  </section>

  <section class="sec sec-alt" id="offices">
    <div class="w">
      <div class="sec-head rv">
        <div class="sec-head-body">
          <h2 class="sec-h">窓口から探す</h2>
          <p class="sec-sub">事業場の所在地で管轄が決まります。複数の事業場がある会社は、事業場ごとに提出先が変わります。</p>
        </div>
      </div>
${groups}

      <div class="mdg-caveat rv">
        <p><strong>この一覧は${esc(data.checkedAt)}時点の公式サイトで確認したものです。</strong>
          移転や組織改編で変わることがあります。重要な手続きの前には、リンク先の公式ページでお確かめください。</p>
        <p>助成金は制度ごとに申請先が分かれ、同じ労働局でも部署が違います。
          提出先を間違えると書類が戻り、期限に間に合わなくなることがあります。
          どこへ出すか迷ったら、無料相談でお尋ねください。</p>
      </div>
    </div>
  </section>

  <section class="final-cta">
    <div class="w">
      <span class="sec-kicker" style="color:rgba(255,255,255,.7)">Free Consultation</span>
      <h2>提出先も、順序も、こちらで引き受けます。</h2>
      <p>窓口の振り分けから書類の作成・提出まで、一続きでお任せいただけます。初回のご相談は無料です。</p>
      <a href="contact.html" class="btn-white">無料で相談する</a>
    </div>
  </section>
</main>`;
}

const [dataRaw, donorSource] = await Promise.all([
  readFile(dataPath, 'utf8'),
  readFile(donorPath, 'utf8'),
]);
const data = JSON.parse(dataRaw);
const donor = splitDonor(donorSource);

// 電話番号・住所は照合済みのものだけ。空の行があれば公開しない。
for (const group of data.groups) {
  for (const office of group.offices) {
    if (!office.name || !office.tel) {
      throw new Error(`data/toyama-madoguchi.json: ${office.name || '(名前なし)'} に電話がありません`);
    }
  }
}

const generated = markPhrases(donor.top
  + buildHead() + '\n'
  + donor.assets
  + buildBreadcrumbSchema()
  + donor.middle.replace('</head>', `${STYLE}\n</head>`)
  + buildMain(data)
  + donor.tail.replaceAll('/uploads/service-romu-sodan.html', `/${outPath}`)).html;

for (const must of ['service.css?v=', 'wave-skin.css?v=', 'id="brand-v2"', '<main id="main">', 'mdg-quick']) {
  if (!generated.includes(must)) throw new Error(`${outPath}: 生成物に ${must} がありません`);
}
if (generated.includes('data-schema="service"')) {
  throw new Error(`${outPath}: 対象外ページにServiceスキーマが混ざっています`);
}

const file = path.join(root, outPath);
let current = '';
try { current = await readFile(file, 'utf8'); } catch { current = ''; }

if (current === generated) {
  console.log(`富山の窓口一覧は最新です（${data.groups.reduce((n, g) => n + g.offices.length, 0)}窓口）`);
  process.exit(0);
}
if (checkOnly) {
  console.error(`${outPath}: data/toyama-madoguchi.json と同期していません`);
  process.exit(1);
}
await writeFile(file, generated, 'utf8');
console.log(`更新: ${outPath}（${data.groups.reduce((n, g) => n + g.offices.length, 0)}窓口 / 早見表${data.quickTable.length}行）`);
