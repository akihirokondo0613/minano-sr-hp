#!/usr/bin/env node

/**
 * 業務ページの料金抜粋を pricing.html から生成する
 *
 *   node scripts/sync-service-prices.mjs           生成
 *   node scripts/sync-service-prices.mjs --check    差分があれば失敗（公開前チェック用）
 *
 * なぜ要るのか:
 *   「富山 就業規則 費用」「給与計算 代行 料金」のような検索は、実額のあるページを
 *   求めている。しかし実額を業務ページへ手で書くと、料金改定のとき pricing.html と
 *   必ずずれる。正本は pricing.html の1つに保ち、ここから抽出して差し込む。
 *
 * 抽出元（pricing.html）:
 *   - #retainer-extra-fees … 顧問先の個別料金（.sf-row）
 *   - #spot-fees           … スポット依頼の料金（.sf-row）
 *   - #plan-basic / #plan-standard … 顧問プランのカード
 *   業務ページに出すのはスポット価格（検索した人はまだ顧問先ではない）。
 *   顧問先50%は注記で示す。
 *
 * 差し込み先: uploads/service-*.html の <!-- svc-fee:start --> 〜 <!-- svc-fee:end -->
 * 見た目: uploads/service.css の .svc-fee 系。
 * 文節印（<wbr>）はこの生成器が markPhrases で入れる（後入れは --check が落ちる）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** <wbr>とタグを外した素の文字列（照合用） */
function plain(html) {
  return html.replaceAll('<wbr>', '').replace(/<[^>]+>/g, '').trim();
}

/** pricing.html から料金の正本を取り出す */
async function loadPricing() {
  const source = await readFile(path.join(root, 'pricing.html'), 'utf8');

  const sectionOf = (id) => {
    const at = source.indexOf(`id="${id}"`);
    if (at < 0) throw new Error(`pricing.html: #${id} が見つかりません`);
    const next = source.indexOf('<details class="spot-fees', at + 1);
    return source.slice(at, next < 0 ? undefined : next);
  };

  const parseRows = (segment, sectionName) => {
    const rows = [];
    const re = /<div class="sf-row"><span class="sf-name">([\s\S]*?)<\/span><span class="sf-price">([\s\S]*?)<\/span>(?:<span class="sf-desc">([\s\S]*?)<\/span>)?<\/div>/g;
    let m;
    while ((m = re.exec(segment)) !== null) {
      rows.push({ section: sectionName, name: plain(m[1]), price: plain(m[2]), desc: plain(m[3] ?? '') });
    }
    if (!rows.length) throw new Error(`pricing.html: ${sectionName} の .sf-row を抽出できません`);
    return rows;
  };

  const rows = [
    ...parseRows(sectionOf('retainer-extra-fees'), 'retainer'),
    ...parseRows(sectionOf('spot-fees'), 'spot'),
  ];

  const planOf = (id) => {
    const at = source.indexOf(`id="${id}"`);
    if (at < 0) throw new Error(`pricing.html: #${id} が見つかりません`);
    const seg = source.slice(at, at + 3000);
    const pick = (cls) => {
      const mm = seg.match(new RegExp(`<(?:p|div) class="${cls}">([\\s\\S]*?)</(?:p|div)>`));
      return mm ? plain(mm[1]) : '';
    };
    const plan = { name: pick('plan-name'), price: pick('plan-price'), unit: pick('plan-unit'), founder: pick('plan-founder') };
    const add = seg.replace(/<wbr>/g, '').match(/(\d+人目以降1名あたり[^<]+)/);
    plan.add = add ? add[1].trim() : '';
    for (const f of ['name', 'price', 'unit']) {
      if (!plan[f]) throw new Error(`pricing.html: #${id} の ${f} を抽出できません`);
    }
    return plan;
  };

  return { rows, plans: { basic: planOf('plan-basic'), standard: planOf('plan-standard') } };
}

function findRow(rows, section, name) {
  const hit = rows.find((r) => r.section === section && r.name === name);
  if (!hit) {
    throw new Error(`pricing.html に「${name}」（${section === 'spot' ? 'スポット' : '顧問先'}）の行がありません。`
      + ' pricing.html の行名を変えた場合は scripts/sync-service-prices.mjs の対応表も直してください。');
  }
  return hit;
}

/** 成功報酬の率（%）を価格文字列から取り出す */
function rateOf(price) {
  const m = price.match(/受給額の(\d+)[％%]/);
  if (!m) throw new Error(`助成金の率を読み取れません: ${price}`);
  return Number(m[1]);
}

function feeRow(row, label) {
  return [
    '        <div class="svc-fee-row">',
    `          <span class="svc-fee-name">${esc(label ?? row.name)}</span>`,
    `          <span class="svc-fee-price">${esc(row.price)}</span>`,
    row.desc ? `          <span class="svc-fee-desc">${esc(row.desc)}</span>` : '',
    '        </div>',
  ].filter(Boolean).join('\n');
}

function planRow(plan) {
  const bits = [`月額 ${plan.price}${plan.unit.replace(/^\s*\/\s*/, ' / ')}`];
  if (plan.add) bits.push(plan.add);
  return [
    '        <div class="svc-fee-row">',
    `          <span class="svc-fee-name">${esc(plan.name)}</span>`,
    `          <span class="svc-fee-price">${esc(`${plan.price}${plan.unit.startsWith('/') ? ` ${plan.unit}` : ` / ${plan.unit}`}`)}</span>`,
    plan.add ? `          <span class="svc-fee-desc">${esc(plan.add)}${plan.founder ? `。${esc(plan.founder)}` : ''}</span>` : '',
    '        </div>',
  ].filter(Boolean).join('\n');
}

function section({ heading, sub, body, note, alt }) {
  return [
    `<section class="sec${alt ? ' sec-alt' : ''}" id="fee">`,
    '  <div class="w">',
    '    <div class="sec-head rv">',
    '      <div class="sec-head-body">',
    `        <h2 class="sec-h">${heading}</h2>`,
    `        <p class="sec-sub">${sub}</p>`,
    '      </div>',
    '    </div>',
    '    <div class="svc-fee rv d1">',
    '      <div class="svc-fee-list">',
    body,
    '      </div>',
    `      <p class="svc-fee-note">${note}</p>`,
    '      <p class="svc-fee-cta"><a class="btn-secondary" href="../pricing.html">料金の全体を見る →</a></p>',
    '    </div>',
    '  </div>',
    '</section>',
  ].join('\n');
}

/** ページごとの構成。行は pricing.html の行名で指す（実額はここに書かない）。 */
function buildPages({ rows, plans }) {
  const spot = (name) => feeRow(findRow(rows, 'spot', name));
  const spotRate = rateOf(findRow(rows, 'spot', '助成金の申請代行').price);
  const retainerRate = rateOf(findRow(rows, 'retainer', '助成金の申請代行').price);

  const COMMON_NOTE = '表示は税抜のスポット料金（顧問契約のない方の固定額）です。'
    + '顧問先は対応するスポット料金の50％で、入退社などの定例手続き・年度更新・算定基礎届・賞与支払届は顧問料に含まれます。';

  return [
    {
      file: 'uploads/service-shakai-hoken.html',
      html: section({
        heading: '手続き代行の料金（税抜）',
        sub: '顧問契約がなくても、1件から固定額でご依頼いただけます。オンラインで全国に対応します。',
        alt: false,
        body: [
          spot('入社手続き（資格取得届）'),
          spot('退社手続き（資格喪失届）'),
          spot('離職票の作成'),
          spot('会社設立時の新規適用手続き'),
          spot('労使協定の作成・届出（36協定など）'),
          spot('労働保険の年度更新（単発）'),
          spot('算定基礎届の提出（単発）'),
          spot('育児休業給付の申請'),
        ].join('\n'),
        note: COMMON_NOTE,
      }),
    },
    {
      file: 'uploads/service-kyuyo-keisan.html',
      html: section({
        heading: '給与計算の料金（税抜）',
        sub: '毎月の給与計算は顧問とセットの月額で、単発のご依頼は回ごとの固定額でお受けします。',
        alt: false,
        body: [
          planRow(plans.standard),
          spot('単発の給与・賞与計算'),
          spot('賞与支払届'),
          spot('年末調整の資料整理・税理士連携'),
        ].join('\n'),
        note: '表示は税抜です。スタンダードプランは顧問（相談・手続き）と給与計算をあわせた月額です。'
          + '年末調整の税額計算そのものは税理士法上の税理士業務のため、提携税理士へ連携します。',
      }),
    },
    {
      file: 'uploads/service-romu-sodan.html',
      html: section({
        heading: 'ご相談の料金（税抜）',
        sub: '1回だけのご相談から。初回相談は無料です。',
        alt: true,
        body: [
          spot('スポット労務相談（60分）'),
          spot('労務トラブルの初動整理'),
          spot('管理職研修・ハラスメント研修'),
        ].join('\n'),
        note: '表示は税抜のスポット料金です。顧問先は対応するスポット料金の50％で、日常の労務相談は顧問料に含まれます。',
      }),
    },
    {
      file: 'uploads/service-shugyo-kisoku.html',
      html: section({
        heading: '費用の考え方（税抜）',
        sub: '就業規則の新規作成・全面改定は、規程の数と現状により内容が大きく変わるため、無料相談のうえ個別にお見積もりします。',
        alt: true,
        body: [
          spot('労使協定の作成・届出（36協定など）'),
          spot('スポット労務相談（60分）'),
          planRow(plans.basic),
        ].join('\n'),
        note: '顧問プラン（スタート・スタンダード）には就業規則の年次レビュー・改定提案が含まれます。'
          + '常時10人以上の事業場は、作成・変更のたびに労働基準監督署への届出が必要です。',
      }),
    },
    {
      file: 'uploads/service-joseikin.html',
      html: section({
        heading: '料金 ── 着手金0円・完全成功報酬（税抜）',
        sub: '報酬が発生するのは、受給が決まったときだけです。受給に至らなかった場合、報酬はいただきません。',
        alt: true,
        body: [
          // 同名の2行はスポット/顧問先の区別が付かないので、表示名だけ注記を足す（価格は正本のまま）
          feeRow(findRow(rows, 'spot', '助成金の申請代行'), '助成金の申請代行（スポット）'),
          feeRow(findRow(rows, 'retainer', '助成金の申請代行'), '助成金の申請代行（顧問先）'),
          [
            '        <div class="svc-fee-row">',
            '          <span class="svc-fee-name">計算例：100万円を受給した場合</span>',
            `          <span class="svc-fee-price">報酬 ${100 * (spotRate / 100)}万円（顧問先 ${100 * (retainerRate / 100)}万円）</span>`,
            '          <span class="svc-fee-desc">着手金・調査費用はいただきません。受給に至らなかった場合の費用は0円です（郵送費などの実費を除く）。</span>',
            '        </div>',
          ].join('\n'),
        ].join('\n'),
        note: 'スポットは顧問契約のない方の率です。金額は料金ページと同じ基準です。',
      }),
    },
  ];
}

const pricing = await loadPricing();
const pages = buildPages(pricing);

const changed = [];
for (const page of pages) {
  const file = path.join(root, page.file);
  const source = await readFile(file, 'utf8');
  const open = '<!-- svc-fee:start -->';
  const close = '<!-- svc-fee:end -->';
  const from = source.indexOf(open);
  const to = source.indexOf(close, from);
  if (from < 0 || to < 0) throw new Error(`${page.file}: svc-fee のマーカーがありません`);
  const generated = `${source.slice(0, from + open.length)}\n${markPhrases(page.html).html}\n${source.slice(to)}`;
  if (generated === source) continue;
  changed.push(page.file);
  if (!checkOnly) await writeFile(file, generated, 'utf8');
}

if (checkOnly) {
  if (changed.length) {
    console.error('業務ページの料金が pricing.html と同期していません。node scripts/sync-service-prices.mjs を実行してください。');
    for (const rel of changed) console.error(`- ${rel}`);
    process.exit(1);
  }
  console.log(`業務ページの料金は pricing.html と同期しています（${pages.length}ページ）。`);
  process.exit(0);
}
console.log(changed.length
  ? `業務ページの料金を更新しました: ${changed.join(' / ')}`
  : `業務ページの料金に変更はありません（${pages.length}ページ）。`);
