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

function section({ heading, sub, body, note, alt, extra }) {
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
    extra || '',
    `      <p class="svc-fee-note">${note}</p>`,
    '      <p class="svc-fee-cta"><a class="btn-secondary" href="../pricing.html">料金の全体を見る →</a></p>',
    '    </div>',
    '  </div>',
    '</section>',
  ].filter(Boolean).join('\n');
}

/** 「¥55,000」「+¥2,500/月」のような表記から数値を取り出す */
function yen(text, label) {
  const m = String(text).replaceAll(',', '').match(/¥(\d+)/);
  if (!m) throw new Error(`金額を読み取れません（${label}）: ${text}`);
  return Number(m[1]);
}

/**
 * 給与計算の人数別早見表と、経理代行との範囲の違い。
 * 「富山 給与計算 代行 料金」で来る人は1人あたりの単価で比べる。ただし検索結果に並ぶ
 * 経理代行・BPOの公表単価は計算作業だけの値段なので、含む範囲を先に示さずに
 * 単価だけ出すと「高い」という印象だけが残る。対比→単価の順で置く。
 * 数値はすべて pricing.html から取り出して計算する（実額をここに書かない）。
 */
function kyuyoExtra({ rows, plans }) {
  const std = plans.standard;
  const stdBase = yen(std.price, 'スタンダード月額');
  const includedM = std.unit.match(/従業員(\d+)名まで/);
  if (!includedM) throw new Error(`スタンダードの人数上限を読み取れません: ${std.unit}`);
  const included = Number(includedM[1]);
  const addPer = yen(std.add, 'スタンダード加算');
  const tanpatsu = findRow(rows, 'spot', '単発の給与・賞与計算').price;
  const tanBase = yen(tanpatsu, '単発の基本');
  const tanM = tanpatsu.replaceAll(',', '').match(/1名¥(\d+)/);
  if (!tanM) throw new Error(`単発の1名単価を読み取れません: ${tanpatsu}`);
  const tanPer = Number(tanM[1]);

  const fmt = (n) => `¥${n.toLocaleString('ja-JP')}`;
  const per = (total, n) => (total % n === 0 ? fmt(total / n) : `約${fmt(Math.round(total / n / 10) * 10)}`);
  const trRows = [5, 10, 20, 30].map((n) => {
    const stdTotal = stdBase + Math.max(0, n - included) * addPer;
    const tanTotal = tanBase + n * tanPer;
    return `          <tr><th scope="row">${n}名</th>`
      + `<td>${fmt(stdTotal)}<span class="kyu-per">（1人あたり ${per(stdTotal, n)}）</span></td>`
      + `<td>${fmt(tanTotal)}<span class="kyu-per">（1人あたり ${per(tanTotal, n)}）</span></td></tr>`;
  }).join('\n');

  return [
    '      <div class="kyu-cmp rv d2">',
    '        <div class="kyu-cmp-i">',
    '          <p class="kyu-cmp-t">この料金に含まれるもの</p>',
    '          <ul>',
    '            <li>毎月の給与計算・賞与計算</li>',
    '            <li>入退社の社会保険・雇用保険手続き（顧問に含む）</li>',
    '            <li>随時改定・算定基礎届の判定と提出</li>',
    '            <li>労務相談、就業規則の年次レビュー</li>',
    '            <li>法改正や富山県の最低賃金・協会けんぽ料率の反映</li>',
    '          </ul>',
    '        </div>',
    '        <div class="kyu-cmp-i">',
    '          <p class="kyu-cmp-t">計算だけの代行と比べるときの注意</p>',
    '          <ul>',
    '            <li>経理代行・給与計算BPOの単価は、計算作業だけの値段です</li>',
    '            <li>労働社会保険の書類作成・提出代行を業として行えるのは社会保険労務士です（社会保険労務士法）</li>',
    '            <li>年末調整の税額計算は税理士業務のため、当事務所は提携税理士へ連携します</li>',
    '          </ul>',
    '        </div>',
    '      </div>',
    '      <div class="svct-tablewrap rv d2">',
    '        <table class="svct-table kyu-table">',
    '          <caption>従業員数ごとの月額の目安（税抜）。スタンダードは顧問・労務相談を含む総額を人数で割った参考値です。</caption>',
    '          <thead>',
    '            <tr><th scope="col">従業員数</th><th scope="col">スタンダード（顧問＋給与計算）</th><th scope="col">単発（給与計算のみ）</th></tr>',
    '          </thead>',
    '          <tbody>',
    trRows,
    '          </tbody>',
    '        </table>',
    '      </div>',
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
        extra: kyuyoExtra({ rows, plans }),
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
      file: 'uploads/service-dx.html',
      html: section({
        heading: 'システム導入支援の料金（税抜）',
        sub: '含まれる範囲と、それを超えたときの料金を先に出します。ソフトの利用料は含みません（各社と直接ご契約いただきます）。',
        alt: false,
        body: [
          spot('現状の棚卸し・ご提案'),
          spot('労務システムの導入支援'),
          spot('給与・勤怠データの移行'),
          spot('追加の打合せ・操作研修（オンライン）'),
          spot('訪問での操作研修'),
        ].join('\n'),
        note: '表示は顧問契約のない方のスポット料金です。顧問契約とあわせてご依頼の場合は¥60,000（5名まで）など、'
          + '低い料金を別に定めています。ソフトの利用料は各製品の提供会社へ直接お支払いいただくため、'
          + '当事務所が上乗せすることはありません。導入する製品によっては、提供会社の無料サポートで足りる場合もあります。'
          + 'その場合はそのようにお伝えします。',
      }),
    },
    {
      file: 'uploads/service-shugyo-kisoku.html',
      html: section({
        heading: '就業規則の料金（税抜）',
        sub: 'いずれも労働基準監督署への届出まで含んだ固定額です。追加請求はありません。',
        alt: true,
        body: [
          spot('就業規則の作成（本則）'),
          spot('就業規則の全面改定'),
          spot('賃金規程・退職金規程の作成'),
          spot('育児介護休業規程などの作成'),
          spot('ハラスメント防止規程・テレワーク規程の作成'),
          spot('就業規則の点検・報告書'),
          spot('はじめての就業規則セット'),
          spot('規程一式セット'),
        ].join('\n'),
        note: '表示は顧問契約のない方のスポット料金です。顧問先は本則¥120,000など、いずれも低い料金を'
          + '別に定めています（会社の実態をすでに把握しているぶん、ヒアリングと現状調査の工数が減るため）。'
          + '顧問プラン（スタート・スタンダード）には就業規則の年次点検と改定のご提案が含まれます。'
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
