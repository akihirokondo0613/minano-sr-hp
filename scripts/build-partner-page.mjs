#!/usr/bin/env node

/**
 * 士業の方へ（partner.html）を生成する。
 *
 *   node scripts/build-partner-page.mjs           生成
 *   node scripts/build-partner-page.mjs --check   差分があれば失敗（公開前チェック用）
 *
 * なぜ作るのか:
 *   税理士事務所への挨拶回りで渡すカードのQRの飛び先。事業主向けの訴求（成功報酬など）は
 *   ここでは主役にしない。税理士が気にするのは「紹介して揉めないか」「自分の業務に食い込まれ
 *   ないか」「手間が増えないか」「紹介料の話にならないか」の4点で、その答えだけを置く。
 *
 * 骨組み（head・ナビ・フッター・末尾script）は support.html を型として写すので、
 * 共通部分の変更が自動で追随する。build-shiryo-page.mjs と同じ方式。
 *
 * 料金や業務範囲は pricing.html の表記に合わせる。ここで別の言い方をすると案内が割れる。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const donorPath = path.join(root, 'support.html');
const outPath = 'partner.html';
const url = `https://minano-sr.com/${outPath}`;

const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownArgs.length) throw new Error(`不明な引数: ${unknownArgs.join(' ')}`);

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const TITLE = '士業・パートナーの方へ｜顧問先のご紹介について｜みなの社会保険労務士事務所';
const DESC = '富山の社会保険労務士事務所みなのから、税理士の先生方へ。'
  + 'お引き受けする範囲とお引き受けしない範囲、顧問先をご紹介いただく場合の流れ、'
  + '年末調整の資料連携についてご案内します。紹介料は受け取らず、支払いもいたしません。';

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
  if (cssStart < 0 || mainOpen < 0 || mainClose < 0) {
    throw new Error('型ページの構造を特定できません');
  }
  return {
    top: source.slice(0, headStart),
    middle: source.slice(cssStart, mainOpen),
    tail: source.slice(mainClose + '</main>'.length),
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

function buildSchema() {
  return `<!-- Structured Data: WebPage -->
<script type="application/ld+json" data-schema="webpage">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', name: '士業・パートナーの方へ', description: DESC, url },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ホーム', item: 'https://minano-sr.com/' },
          { '@type': 'ListItem', position: 2, name: '士業・パートナーの方へ', item: url },
        ],
      },
    ],
  }, null, 2)}
</script>`;
}

/** ページ固有のCSS。スマホでは必ず1カラムに落とす（多カラムのまま残すと本文が細い柱になる）。 */
const STYLE = `<style id="partner">
.pt-two{display:grid;grid-template-columns:1fr 1fr;gap:clamp(16px,2.4vw,28px)}
.pt-card{background:var(--shiro);border:1px solid var(--line);border-radius:var(--r-lg);padding:clamp(20px,2.6vw,30px)}
.pt-card.yes{border-color:var(--moegi);background:var(--moegi-l)}
.pt-card h3{font-family:var(--disp);font-size:clamp(16px,1.8vw,19px);font-weight:800;color:var(--sugi);margin-bottom:12px}
.pt-list{list-style:none;display:flex;flex-direction:column;gap:9px}
.pt-list li{position:relative;padding-left:22px;font-size:14px;line-height:1.9;color:var(--ink2)}
.pt-list li::before{content:"";position:absolute;left:0;top:11px;width:7px;height:7px;border-radius:50%;background:var(--moegi)}
.pt-card:not(.yes) .pt-list li::before{background:var(--ink4);border-radius:1px;height:2px;width:10px;top:14px}
.pt-note{margin-top:14px;font-size:12.5px;line-height:1.85;color:var(--ink3)}

.pt-fee{background:var(--sugi);color:#fff;border-radius:var(--r-lg);padding:clamp(24px,3.2vw,40px)}
.pt-fee h3{font-family:var(--disp);font-size:clamp(19px,2.4vw,25px);font-weight:800;line-height:1.55;margin-bottom:12px}
.pt-fee p{font-size:14px;line-height:2;color:#cfe6d9}
.pt-fee .em{color:#8FC9A9;font-weight:700}

.pt-flow{display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(12px,1.6vw,18px);counter-reset:pf}
.pt-step{counter-increment:pf;background:var(--yuki);border-radius:var(--r);padding:clamp(16px,2vw,22px)}
.pt-step::before{content:counter(pf,decimal-leading-zero);font-family:var(--mono);font-size:12px;font-weight:700;color:var(--moegi-t)}
.pt-step b{display:block;margin-top:6px;font-size:14.5px;font-weight:800;color:var(--iwa);line-height:1.6}
.pt-step span{display:block;margin-top:5px;font-size:12.5px;line-height:1.8;color:var(--ink3)}

.pt-dl{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}
.pt-dl a{display:inline-flex;align-items:center;gap:9px;padding:13px 20px;border-radius:999px;background:var(--sugi);color:#fff;font-size:13.5px;font-weight:700;text-decoration:none;transition:background .3s}
.pt-dl a:hover{background:var(--sugi-7,#0d2f24)}
.pt-dl a.ghost{background:var(--shiro);color:var(--sugi);border:1px solid var(--moegi)}
.pt-dl a.ghost:hover{background:var(--moegi-l)}

.pt-contact{background:var(--moegi-l);border-radius:var(--r-lg);padding:clamp(24px,3.2vw,40px);text-align:center}
.pt-contact .tel{font-family:var(--mono);font-size:clamp(24px,3.4vw,34px);font-weight:700;color:var(--sugi);letter-spacing:.01em;display:inline-block;margin-top:10px}
.pt-contact .sub{margin-top:10px;font-size:13.5px;line-height:1.9;color:var(--ink2)}

@media (max-width: 760px){
  .pt-two{grid-template-columns:1fr}
  .pt-flow{grid-template-columns:1fr;gap:10px}
  .pt-step{display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:baseline;padding:14px 16px}
  .pt-step b{margin-top:0}
  .pt-step span{grid-column:2}
  .pt-dl a{width:100%;justify-content:center}
}
</style>`;

function buildMain() {
  return `<main id="main" class="hub-page">

<header class="page-hero">
  <div class="page-hero-inner">
    <nav class="breadcrumb"><a href="/">ホーム</a><span class="sep">›</span><span>士業・パートナーの方へ</span></nav>
    <div class="page-label">士業・パートナーの方へ</div>
    <h1 class="page-h">顧問先の労務を、<strong>安心してお任せいただける先に。</strong></h1>
    <p class="page-sub">税理士の先生方へ。顧問先から労務のご相談を受けたとき、お引き受けできる範囲と、お引き受けしない範囲をあらかじめお示しします。ご紹介にあたって、紹介料のやり取りは一切ございません。</p>
  </div>
</header>

<section class="sec">
  <div class="w">
    <div class="sec-head rv">
      <div class="sec-head-idx"><span class="idx-lat">SCOPE</span><span class="idx-jp">業務の範囲</span></div>
      <div class="sec-head-body">
        <h2 class="sec-h">先生のお仕事に、<strong>踏み込みません。</strong></h2>
        <p class="sec-sub">社会保険労務士の業務範囲を守り、税務にあたる部分はお引き受けしません。境界をはっきりさせておくことが、ご紹介いただくうえで何よりの前提だと考えています。</p>
      </div>
    </div>

    <div class="pt-two rv">
      <div class="pt-card yes">
        <h3>お引き受けする業務</h3>
        <ul class="pt-list">
          <li>社会保険・労働保険の手続き（入退社、算定、労災、給付金の請求）</li>
          <li>給与計算・賞与計算</li>
          <li>就業規則・賃金規程などの作成と見直し</li>
          <li>雇用関係助成金の申請</li>
          <li>解雇・ハラスメント・未払い残業などの労務相談</li>
          <li>勤怠・人事労務システムの導入支援</li>
        </ul>
      </div>
      <div class="pt-card">
        <h3>お引き受けしない業務</h3>
        <ul class="pt-list">
          <li>年末調整の計算と提出</li>
          <li>法定調書・給与支払報告書の作成と提出</li>
          <li>所得税・住民税に関するご相談</li>
          <li>記帳、決算、税務申告</li>
        </ul>
        <p class="pt-note">これらは税理士の先生の業務です。顧問先から税務のお尋ねをいただいた場合は、必ず顧問税理士の先生へお回しします。</p>
      </div>
    </div>
  </div>
</section>

<section class="sec sec-alt">
  <div class="w">
    <div class="pt-fee rv">
      <h3>紹介料は、受け取りませんし、お支払いもいたしません。</h3>
      <p>顧問先をご紹介いただいた場合も、当事務所から先生へ紹介料をお支払いすることはございません。反対に、当事務所からお客様を先生へおつなぎした場合も、<span class="em">紹介料は頂戴いたしません</span>。<br>
      金銭のやり取りが絡むと、先生の側にご負担が生じます。仕事の中身だけでお互いを選べる関係のほうが、結果として長く続くと考えています。</p>
    </div>
  </div>
</section>

<section class="sec">
  <div class="w">
    <div class="sec-head rv">
      <div class="sec-head-idx"><span class="idx-lat">FLOW</span><span class="idx-jp">ご紹介の流れ</span></div>
      <div class="sec-head-body">
        <h2 class="sec-h">先生のお手を、<strong>わずらわせません。</strong></h2>
        <p class="sec-sub">ご紹介いただいたあとは、当事務所から顧問先へ直接ご連絡します。日程調整や資料のやり取りで先生を経由することはありません。</p>
      </div>
    </div>

    <div class="pt-flow rv">
      <div class="pt-step"><b>ご紹介</b><span>お電話でも、当ページのURLを顧問先へお送りいただくだけでも構いません</span></div>
      <div class="pt-step"><b>無料相談（30分）</b><span>当事務所から顧問先へご連絡し、日程を調整します</span></div>
      <div class="pt-step"><b>お見積もりのご提示</b><span>ご契約の前に、業務範囲と金額を書面でお示しします</span></div>
      <div class="pt-step"><b>結果のご報告</b><span>ご希望の場合のみ、先生へ一報を入れます</span></div>
    </div>
  </div>
</section>

<section class="sec sec-alt">
  <div class="w">
    <div class="sec-head rv">
      <div class="sec-head-idx"><span class="idx-lat">RELAY</span><span class="idx-jp">年末調整の連携</span></div>
      <div class="sec-head-body">
        <h2 class="sec-h">年末調整の資料を、<strong>整えた形でお渡しします。</strong></h2>
        <p class="sec-sub">給与計算をお預かりしている顧問先については、年末調整に必要な資料の整理と、先生への連携までをお引き受けしています（計算と提出は行いません）。</p>
      </div>
    </div>

    <div class="pt-two rv">
      <div class="pt-card yes">
        <h3>当事務所で整えるもの</h3>
        <ul class="pt-list">
          <li>年間の給与・賞与データ、社会保険料の控除額</li>
          <li>扶養控除等申告書などの回収と不備の確認</li>
          <li>中途入社の方の前職分の源泉徴収票の取りまとめ</li>
        </ul>
        <p class="pt-note">料金は「年末調整の資料整理・税理士連携」として公開しています（スタート顧問プランの顧問先は基本10,000円＋従業員1名750円／税抜）。</p>
      </div>
      <div class="pt-card">
        <h3>先生にお願いすること</h3>
        <ul class="pt-list">
          <li>年末調整の計算</li>
          <li>法定調書・給与支払報告書の作成と提出</li>
        </ul>
        <p class="pt-note">受け渡しの形式（Excel・PDF・システムの共有など）は、先生のやり方に合わせます。ご指定ください。</p>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="w">
    <div class="sec-head rv">
      <div class="sec-head-idx"><span class="idx-lat">MATERIALS</span><span class="idx-jp">資料</span></div>
      <div class="sec-head-body">
        <h2 class="sec-h">顧問先へ、<strong>そのままお渡しいただけます。</strong></h2>
        <p class="sec-sub">助成金・補助金の資料をPDFで公開しています。登録は不要で、URLをお送りいただくだけでご覧いただけます。制度の根拠と、内容を確認した日を明記しています。</p>
      </div>
    </div>
    <div class="pt-dl rv">
      <a href="shiryo.html">資料室を見る<span aria-hidden="true">→</span></a>
      <a class="ghost" href="pricing.html">料金表を見る<span aria-hidden="true">→</span></a>
    </div>
    <p class="pt-note" style="margin-top:18px">料金はすべてWebで公開しています。ご紹介いただいた顧問先に、あとから想定外の金額をお示しすることはありません。</p>
  </div>
</section>

<section class="sec sec-alt">
  <div class="w">
    <div class="pt-contact rv">
      <div class="page-label" style="justify-content:center">お問い合わせ</div>
      <h2 class="sec-h" style="margin-top:6px">まずは、お電話でご確認ください。</h2>
      <a class="tel" href="tel:090-8259-8774">090-8259-8774</a>
      <p class="sub">受付 平日9:00〜18:00　／　contact@minano-sr.com<br>
      みなの社会保険労務士事務所　社会保険労務士　近藤 昭宏（富山県社会保険労務士会 所属）<br>
      〒931-8333 富山県富山市蓮町1丁目7-4　SCOP TOYAMA</p>
    </div>
  </div>
</section>

</main>`;
}

const donor = await readFile(donorPath, 'utf8');
const parts = splitDonor(donor);
const main = markPhrases(buildMain()).html;

const built = `${parts.top}${buildHead()}\n${parts.middle}${buildSchema()}\n${STYLE}\n${main}${parts.tail}`
  .replace(/data-goatcounter-settings='\{"path":"\/[^"]*"\}'/, `data-goatcounter-settings='{"path":"/${outPath}"}'`);

const target = path.join(root, outPath);
const current = await readFile(target, 'utf8').catch(() => '');

if (checkOnly) {
  if (current !== built) {
    console.error(`士業向けページが最新ではありません。node scripts/build-partner-page.mjs を実行してください（${outPath}）`);
    process.exit(1);
  }
  console.log('士業向けページは最新です。');
} else if (current === built) {
  console.log('士業向けページは最新です。');
} else {
  await writeFile(target, built, 'utf8');
  console.log(`士業向けページを生成しました: ${outPath}`);
}
