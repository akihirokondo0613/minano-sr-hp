#!/usr/bin/env node

/**
 * 助成金の制度別解説ページ（顧客向け）を data/joseikin-guides.json から生成する。
 *
 * 出力は uploads/joseikin-<slug>.html。骨組み（head・ナビ・フッター・末尾script）は
 * uploads/service-romu-sodan.html を型として写すので、共通部分の変更が自動で追随する。
 * 中身の正本はJSONだけ。HTMLを手で直さない。
 *
 * --check を付けると差分の有無だけを判定し、ズレていれば失敗する（公開前チェック用）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data', 'joseikin-guides.json');
const donorPath = path.join(root, 'uploads', 'service-romu-sodan.html');

const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** 型ページから、差し替えたい区間の前後を取り出す。 */
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

function buildHead(guide, meta) {
  const url = `https://minano-sr.com/uploads/joseikin-${guide.slug}.html`;
  const title = `${guide.name}とは｜${meta.fiscalYear}の要件・金額・順序｜みなの社会保険労務士事務所`;
  const desc = `${guide.name}を図解で解説。${guide.short}。${meta.fiscalYear}の金額の目安、申請の順序、先に動くと対象外になる境目、期限を社会保険労務士がまとめました。`;
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

function buildBreadcrumbSchema(guide) {
  const url = `https://minano-sr.com/uploads/joseikin-${guide.slug}.html`;
  return `<!-- Structured Data: BreadcrumbList -->
<script type="application/ld+json" data-schema="breadcrumblist">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "ホーム", "item": "https://minano-sr.com/" },
    { "@type": "ListItem", "position": 2, "name": "助成金", "item": "https://minano-sr.com/joseikin.html" },
    { "@type": "ListItem", "position": 3, "name": ${JSON.stringify(guide.name)}, "item": "${url}" }
  ]
}
</script>`;
}

function buildMain(guide, meta, guides) {
  const others = guides.filter((item) => item.slug !== guide.slug);
  const step = (item, index) => `
        <li class="jgd-step">
          <span class="jgd-step-n">${index + 1}</span>
          <span class="jgd-step-b">${esc(item.label)}</span>
          <span class="jgd-step-t">${esc(item.note)}</span>
        </li>`;
  const amount = (item) => `
        <div class="jgd-amount">
          <span class="jgd-amount-n">${esc(item.name)}</span>
          <span class="jgd-amount-v">${esc(item.value)}</span>
          <span class="jgd-amount-t">${esc(item.note)}</span>
        </div>`;
  const officialLinks = [
    `<a href="${esc(guide.official)}" target="_blank" rel="noopener">${esc(guide.officialName)}</a>`,
    guide.official2
      ? `<a href="${esc(guide.official2)}" target="_blank" rel="noopener">${esc(guide.official2Name)}</a>`
      : '',
  ].filter(Boolean).join('\n          ');

  return `<main id="main">
  <header class="page-hero">
    <div class="page-hero-inner">
      <nav class="breadcrumb">
        <a href="../">ホーム</a><span>›</span>
        <a href="../joseikin.html">助成金</a><span>›</span>
        <span>${esc(guide.name)}</span>
      </nav>
      <span class="page-kicker">制度の解説</span>
      <h1>${esc(guide.name)}</h1>
      <p class="lead">${esc(guide.lead)}</p>
      <div class="page-hero-cta">
        <a href="contact.html?from=joseikin-${esc(guide.slug)}" class="btn-primary">対象になるか無料で相談する →</a>
        <a href="../joseikin.html#check" class="btn-secondary">ほかの制度も見る</a>
      </div>
    </div>
  </header>

  <section class="sec">
    <div class="w">
      <div class="sec-head-c">
        <span class="sec-kicker">いちばん大事な境目</span>
        <h2 class="sec-h">先に動くと、あとから戻せません。</h2>
        <p class="sec-sub">${esc(guide.wall.rule)}<br>下の図の「境目」より前に動いてしまうと、ほかの要件をすべて満たしていても支給されません。</p>
      </div>
      <div class="jgd-wall rv">
        <div class="jgd-wall-side is-ok">
          <span class="jgd-wall-tag">先にやること</span>
          <p>${esc(guide.wall.before)}</p>
        </div>
        <div class="jgd-wall-bar" aria-hidden="true"><span>境目</span></div>
        <div class="jgd-wall-side is-ng">
          <span class="jgd-wall-tag">そのあと</span>
          <p>${esc(guide.wall.after)}</p>
        </div>
      </div>
      <p class="jgd-wall-note">${esc(guide.wall.lost)}</p>
    </div>
  </section>

  <section class="sec sec-alt">
    <div class="w">
      <div class="sec-head-c">
        <span class="sec-kicker">進め方</span>
        <h2 class="sec-h">相談から受給までの順序</h2>
      </div>
      <ol class="jgd-steps rv">${guide.steps.map(step).join('')}
      </ol>
    </div>
  </section>

  <section class="sec">
    <div class="w">
      <div class="sec-head-c">
        <span class="sec-kicker">金額の目安</span>
        <h2 class="sec-h">主なコースと、いくら出るか</h2>
        <p class="sec-sub">${esc(meta.fiscalYear)}の金額です。要件を満たしても審査があり、受給をお約束するものではありません。</p>
      </div>
      <div class="jgd-amounts rv">${guide.amounts.map(amount).join('')}
      </div>
    </div>
  </section>

  <section class="sec sec-alt">
    <div class="w">
      <div class="grid-2">
        <div class="rv">
          <span class="sec-kicker">向いている会社</span>
          <h2 class="sec-h">こんな状況なら、検討する価値があります</h2>
          <ul class="jgd-fit">${guide.fit.map((item) => `
            <li>${esc(item)}</li>`).join('')}
          </ul>
        </div>
        <div class="rv jgd-care">
          <span class="sec-kicker">つまずきやすい点</span>
          <ul>${guide.cautions.map((item) => `
            <li>${esc(item)}</li>`).join('')}
          </ul>
        </div>
      </div>
      ${guide.toyama ? `<p class="jgd-toyama"><b>富山の場合</b>${esc(guide.toyama)}${guide.toyamaOffice ? `<a class="jgd-toyama-l" href="toyama-madoguchi.html#mdg-${esc(guide.toyamaOffice)}">この窓口の所在地・電話を見る →</a>` : ''}</p>` : ''}
    </div>
  </section>

  <section class="sec">
    <div class="w">
      <div class="sec-head-c">
        <span class="sec-kicker">出典と、ほかの制度</span>
        <h2 class="sec-h">公式ページ</h2>
        <p class="sec-sub">このページは${esc(meta.fiscalYear)}の公式資料をもとに、社会保険労務士がかみくだいてまとめたものです（最終更新 ${esc(meta.updated)}）。要件と金額は年度により変わります。</p>
      </div>
      <p class="jgd-official">
          ${officialLinks}
      </p>
      <div class="jgd-others">${others.map((item) => `
        <a href="joseikin-${esc(item.slug)}.html">
          <span class="jgd-others-n">${esc(item.name)}</span>
          <span class="jgd-others-t">${esc(item.short)}</span>
        </a>`).join('')}
      </div>
    </div>
  </section>

  <section class="final-cta">
    <div class="final-cta-inner">
      <h2>使えるかどうか、一緒に確かめませんか。</h2>
      <p>対象になるかの確認までは費用がかかりません。着手金は0円で、報酬は受給できたときだけです。取り組みを始める前のご相談がいちばん動きやすいです。</p>
      <a href="contact.html?from=joseikin-${esc(guide.slug)}-final" class="btn-white">無料で相談する →</a>
    </div>
  </section>
</main>`;
}

const STYLE = `<style id="joseikin-guide">
/* 制度解説ページ専用。順序の境目（壁）と手順を、図形でなく文字と色で示す。 */
.jgd-wall{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:clamp(12px,2vw,22px);align-items:stretch}
.jgd-wall-side{border-radius:var(--r);padding:clamp(18px,2.4vw,26px);border:1px solid var(--line,#E0E4DE)}
.jgd-wall-side.is-ok{background:#EDF6F0;border-color:#BFE0CD}
.jgd-wall-side.is-ng{background:#FBF3EE;border-color:#E6C7B6}
.jgd-wall-tag{display:inline-block;font-size:11.5px;font-weight:700;letter-spacing:.06em;padding:3px 12px;border-radius:999px;margin-bottom:10px}
.jgd-wall-side.is-ok .jgd-wall-tag{background:#123F30;color:#fff}
.jgd-wall-side.is-ng .jgd-wall-tag{background:#8C4A3C;color:#fff}
.jgd-wall-side p{margin:0;font-size:14.5px;font-weight:700;line-height:1.85;color:#1E2721;word-break:auto-phrase}
.jgd-wall-bar{position:relative;inline-size:6px;border-radius:3px;background:repeating-linear-gradient(180deg,#B03A2E 0 9px,transparent 9px 17px)}
.jgd-wall-bar span{position:absolute;inset-block-start:50%;inset-inline-start:50%;transform:translate(-50%,-50%);white-space:nowrap;font-size:11.5px;font-weight:800;letter-spacing:.1em;color:#B03A2E;background:#fff;padding:5px 12px;border-radius:999px;border:1.5px solid #E6C7B6;box-shadow:0 2px 8px rgba(30,39,33,.08)}
.jgd-wall-note{margin:clamp(16px,2.2vw,22px) 0 0;font-size:13.5px;line-height:2;color:#4A554D;max-width:46em;text-wrap:pretty}
.jgd-steps{list-style:none;margin:0;padding:0;counter-reset:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:12px}
.jgd-step{display:flex;flex-direction:column;gap:6px;background:#fff;border:1px solid var(--line,#E0E4DE);border-radius:var(--r);padding:clamp(16px,2.2vw,20px)}
.jgd-step-n{display:grid;place-items:center;inline-size:26px;block-size:26px;border-radius:50%;background:#123F30;color:#fff;font-size:12.5px;font-weight:700}
.jgd-step-b{font-size:14px;font-weight:800;color:#1E2721;line-height:1.6;word-break:auto-phrase}
.jgd-step-t{font-size:12.5px;color:#4A554D;line-height:1.9;text-wrap:pretty}
.jgd-amounts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:14px}
.jgd-amount{display:flex;flex-direction:column;gap:8px;background:#EDF6F0;border:1px solid #BFE0CD;border-radius:var(--r);padding:clamp(18px,2.4vw,24px)}
.jgd-amount-n{font-size:12.5px;font-weight:700;color:#1C5842;line-height:1.6}
.jgd-amount-v{font-size:clamp(19px,2.6vw,24px);font-weight:900;color:#123F30;line-height:1.45;word-break:auto-phrase}
.jgd-amount-t{font-size:12.5px;color:#4A554D;line-height:1.9;text-wrap:pretty}
.jgd-fit{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.jgd-fit li{position:relative;padding-left:26px;font-size:14px;color:#37423B;line-height:1.9}
.jgd-fit li::before{content:'';position:absolute;left:2px;top:9px;inline-size:10px;block-size:10px;border-radius:50%;background:#2E9E63}
.jgd-care{background:#FBF3EE;border:1px solid #E6C7B6;border-radius:var(--r);padding:clamp(18px,2.4vw,26px)}
.jgd-care ul{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.jgd-care li{position:relative;padding-left:26px;font-size:13.5px;color:#37423B;line-height:1.9;text-wrap:pretty}
.jgd-care li::before{content:'!';position:absolute;left:0;top:4px;inline-size:17px;block-size:17px;border-radius:5px;background:#E5A63C;color:#1E2721;font-size:11.5px;font-weight:700;display:grid;place-items:center}
.jgd-toyama{margin:clamp(18px,2.4vw,24px) 0 0;font-size:13.5px;line-height:2;color:#37423B;background:#fff;border-left:3px solid #2E9E63;padding:14px 18px;border-radius:0 var(--r) var(--r) 0;text-wrap:pretty}
.jgd-toyama-l{display:inline-block;margin-top:8px;font-size:12.5px;font-weight:700;color:#1C5842;text-decoration:none;border-bottom:1px solid #9ED0B6}
.jgd-toyama-l:hover{border-bottom-color:#1C5842}
.jgd-toyama b{display:block;font-size:12.5px;color:#1C5842;letter-spacing:.04em;margin-bottom:4px}
.jgd-official{margin:0 0 clamp(20px,2.6vw,26px);font-size:13px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.jgd-official a{display:inline-flex;align-items:center;gap:7px;color:#1E7A4B;font-weight:700;border-bottom:1.5px solid #2E9E63;padding-bottom:2px}
.jgd-official a::after{content:'↗';font-size:11px}
.jgd-others{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:10px}
.jgd-others a{display:flex;flex-direction:column;gap:4px;background:#fff;border:1px solid var(--line,#E0E4DE);border-radius:var(--r);padding:14px 16px;color:#1E2721;transition:border-color .3s,transform .3s}
.jgd-others a:hover{border-color:#2E9E63;transform:translateY(-2px)}
.jgd-others-n{font-size:13px;font-weight:800;line-height:1.55;word-break:auto-phrase}
.jgd-others-t{font-size:11.5px;color:#5D6962}
@media (max-width:760px){
  .jgd-wall{grid-template-columns:1fr;gap:10px}
  .jgd-wall-bar{inline-size:auto;block-size:6px;background:repeating-linear-gradient(90deg,#B03A2E 0 9px,transparent 9px 17px)}
}
@media (prefers-reduced-motion:reduce){.jgd-others a{transition:none}}
</style>`;

async function main() {
  if (unknownArgs.length) throw new Error(`未対応の引数です: ${unknownArgs.join(', ')}`);

  const [dataSource, donorSource, madoguchiSource] = await Promise.all([
    readFile(dataPath, 'utf8'),
    readFile(donorPath, 'utf8'),
    readFile(path.join(root, 'data/toyama-madoguchi.json'), 'utf8'),
  ]);
  const meta = JSON.parse(dataSource);
  // 「富山の場合」から窓口一覧へ深く結ぶ。窓口の住所・電話はあちらが正本なので、
  // ここは id で指すだけにする。id が消えたら黙ってリンク切れにせず止める。
  const madoguchiIds = new Set(
    JSON.parse(madoguchiSource).groups.flatMap((g) => g.offices.map((o) => o.id)),
  );
  const guides = meta.guides;
  if (!Array.isArray(guides) || !guides.length) throw new Error('data/joseikin-guides.json: guidesが空です');

  const donor = splitDonor(donorSource);
  const outdated = [];

  for (const guide of guides) {
    for (const key of ['slug', 'name', 'short', 'official', 'officialName', 'lead']) {
      if (typeof guide[key] !== 'string' || !guide[key].trim()) {
        throw new Error(`data/joseikin-guides.json: ${guide.slug ?? '不明'} の ${key} が空です`);
      }
    }
    if (!/^[a-z0-9-]+$/.test(guide.slug)) throw new Error(`slugが不正です: ${guide.slug}`);
    if (guide.toyamaOffice && !madoguchiIds.has(guide.toyamaOffice)) {
      throw new Error(`${guide.slug}: toyamaOffice=${guide.toyamaOffice} が data/toyama-madoguchi.json にありません`);
    }
    if (guide.toyamaOffice && !guide.toyama) {
      throw new Error(`${guide.slug}: toyamaOffice を書くなら toyama の本文も要ります`);
    }

    const rel = `uploads/joseikin-${guide.slug}.html`;
    // 文節印（<wbr>）はここで入れる。あとから sync-phrase-breaks.mjs に
    // 差し込ませると、この生成器の --check が毎回落ちる。
    const generated = markPhrases(donor.top
      + buildHead(guide, meta) + '\n'
      + donor.assets
      + buildBreadcrumbSchema(guide)
      + donor.middle.replace('</head>', `${STYLE}\n</head>`)
      + buildMain(guide, meta, guides)
      + donor.tail.replaceAll('/uploads/service-romu-sodan.html', `/${rel}`)).html;

    for (const must of ['service.css?v=', 'wave-skin.css?v=', 'id="brand-v2"', '<main id="main">', 'jgd-wall']) {
      if (!generated.includes(must)) throw new Error(`${rel}: 生成物に ${must} がありません`);
    }
    if (generated.includes('data-schema="service"')) {
      throw new Error(`${rel}: 対象外ページにServiceスキーマが混ざっています`);
    }

    let current = null;
    try { current = await readFile(path.join(root, rel), 'utf8'); } catch { /* 新規 */ }
    if (current === generated) continue;
    outdated.push(rel);
    if (!checkOnly) await writeFile(path.join(root, rel), generated, 'utf8');
  }

  if (!outdated.length) {
    console.log(`助成金の解説ページは最新です（${guides.length}件）`);
    return;
  }
  if (checkOnly) {
    console.error(`助成金の解説ページが data/joseikin-guides.json と同期していません: ${outdated.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`更新: ${outdated.length}件\n  ${outdated.join('\n  ')}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
