#!/usr/bin/env node

/**
 * スポット注文ページ（spot.html）のカート品目 data/spot-items.json を
 * pricing.html の #spot-fees（.sf-row）から生成する。
 *
 *   node scripts/sync-spot-items.mjs           生成
 *   node scripts/sync-spot-items.mjs --check   差分があれば失敗（公開前チェック用）
 *
 * なぜ要るのか:
 *   spot.html でカートに入れられる23品目の価格を手で書くと、pricing.html の
 *   料金改定と必ずずれる。正本は pricing.html の1つに保ち、ここで数値を
 *   抽出して data/spot-items.json を作る。spot.html は実行時にこのJSONを
 *   fetch して読む（価格をHTMLに埋め込まない）。
 *
 * 対応外（お見積り誘導）: 就業規則・システム導入支援・助成金の申請代行（成功報酬）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

function plain(html) {
  return html.replaceAll('<wbr>', '').replace(/<[^>]+>/g, '').trim();
}

function yenAll(text) {
  return [...String(text).replaceAll(',', '').matchAll(/¥(\d+)/g)].map((m) => Number(m[1]));
}

async function loadRows() {
  const source = await readFile(path.join(root, 'pricing.html'), 'utf8');
  const at = source.indexOf('id="spot-fees"');
  if (at < 0) throw new Error('pricing.html: #spot-fees が見つかりません');
  const next = source.indexOf('<details class="spot-fees', at + 1);
  const segment = source.slice(at, next < 0 ? undefined : next);

  const rows = new Map();
  const re = /<div class="sf-row"><span class="sf-name">([\s\S]*?)<\/span><span class="sf-price">([\s\S]*?)<\/span>(?:<span class="sf-desc">([\s\S]*?)<\/span>)?<\/div>/g;
  let m;
  while ((m = re.exec(segment)) !== null) {
    const name = plain(m[1]);
    rows.set(name, { name, price: plain(m[2]), desc: plain(m[3] ?? '') });
  }
  if (!rows.size) throw new Error('pricing.html: #spot-fees の .sf-row を抽出できません');
  return rows;
}

function need(rows, name) {
  const row = rows.get(name);
  if (!row) {
    throw new Error(`pricing.html「#spot-fees」に「${name}」の行がありません。`
      + ' 行名を変えた場合は scripts/sync-spot-items.mjs の対応表も直してください。');
  }
  return row;
}

/** 単純な「¥X / 1名」等の1数値だけの行 */
function simple(rows, name) {
  const row = need(rows, name);
  const nums = yenAll(row.price);
  if (!nums.length) throw new Error(`金額を読み取れません（${name}）: ${row.price}`);
  return nums[0];
}

/** 「初回 ¥X / 1名」＋desc「◯◯は ¥Y/回」の行から初回額を取る */
function initialOf(rows, name) {
  const row = need(rows, name);
  const nums = yenAll(row.price);
  if (!nums.length) throw new Error(`初回額を読み取れません（${name}）: ${row.price}`);
  return nums[0];
}

/** 同じ行の desc から継続額（2回目以降 ¥Y/回）を取る */
function continuationOf(rows, name) {
  const row = need(rows, name);
  const nums = yenAll(row.desc);
  if (!nums.length) throw new Error(`継続額を読み取れません（${name}）: ${row.desc}`);
  return nums[0];
}

/** 「離職票の作成」の desc「合計 ¥15,000」を取る（H04＝退社と同時依頼） */
function comboOf(rows, name) {
  const row = need(rows, name);
  const m = row.desc.replaceAll(',', '').match(/合計\s*¥(\d+)/);
  if (!m) throw new Error(`合計額を読み取れません（${name}）: ${row.desc}`);
  return Number(m[1]);
}

/** 「基本 ¥X＋対象者1名¥Y」のような base + per-unit 行 */
function baseAndPer(rows, name) {
  const row = need(rows, name);
  const nums = yenAll(row.price);
  if (nums.length < 2) throw new Error(`基本額・単価を読み取れません（${name}）: ${row.price}`);
  return { base: nums[0], perUnit: nums[1] };
}

/** 「¥60,000 / 事業所（5名まで）」＋desc「6名目から1名¥2,000を加算」 */
function setupFee(rows, name) {
  const row = need(rows, name);
  const nums = yenAll(row.price);
  const freeM = row.price.match(/(\d+)名まで/);
  const perM = row.desc.replaceAll(',', '').match(/1名¥(\d+)を加算/);
  if (!nums.length || !freeM || !perM) throw new Error(`会社設立料金を読み取れません（${name}）: ${row.price} / ${row.desc}`);
  return { base: nums[0], freeUnits: Number(freeM[1]), perUnit: Number(perM[1]) };
}

/**
 * 品目ごとの入力欄（注文ページのカードに出す）。GAS 側 Code.gs の 数量ラベル／DATE_ASK と同じ文言にする。
 *   qtyLabel  … 数量欄の見出し
 *   dateLabel … 日付欄の見出し（空なら日付欄を出さない。後の「送るものリスト」画面で聞く品目）
 *   person    … 氏名欄を出すか（1名単位の手続き・給付だけ。人数が多い年次業務や相談は出さない）
 */
const FIELDS = {
  H01: { qtyLabel: '対象者の人数', dateLabel: '入社日', person: true },
  H05: { qtyLabel: '加入する従業員の人数（5名まで基本料金に含む）', dateLabel: '適用事業所となった日', person: false },
  H06: { qtyLabel: '事業所の数', dateLabel: '協定の起算日', person: false },
  H02: { qtyLabel: '対象者の人数', dateLabel: '退職日', person: true },
  H03: { qtyLabel: '対象者の人数', dateLabel: '退職日', person: true },
  H04: { qtyLabel: '対象者の人数', dateLabel: '退職日', person: true },
  K01: { qtyLabel: '対象者の人数', dateLabel: '出産日（予定日）', person: true },
  K02: { qtyLabel: '対象者の人数', dateLabel: '育児休業開始日', person: true },
  K03: { qtyLabel: '申請する回数', dateLabel: '今回申請する期間の開始日', person: true },
  K04: { qtyLabel: '対象者の人数', dateLabel: '60歳に達した日', person: true },
  K05: { qtyLabel: '申請する回数', dateLabel: '今回申請する月の初日', person: true },
  K06: { qtyLabel: '対象者の人数', dateLabel: '介護休業の開始日', person: true },
  K07: { qtyLabel: '申請する回数', dateLabel: '今回の介護休業の開始日', person: true },
  K08: { qtyLabel: '対象者の人数', dateLabel: '仕事を休み始めた日', person: true },
  K09: { qtyLabel: '件数', dateLabel: '災害が起きた日', person: true },
  G01: { qtyLabel: '対象者の人数（1回あたり）', dateLabel: '給与（賞与）の支給日', person: false },
  G02: { qtyLabel: '対象者の人数（1回あたり）', dateLabel: '賞与の支払日', person: false },
  G03: { qtyLabel: '従業員の人数', dateLabel: '', person: false },
  G04: { qtyLabel: '対象者の人数（1回あたり）', dateLabel: '', person: false },
  G05: { qtyLabel: '対象者の人数（1回あたり）', dateLabel: '', person: false },
  S01: { qtyLabel: '実施コマ数（1コマ60分）', dateLabel: '希望日', person: false },
  S02: { qtyLabel: '回数', dateLabel: '', person: false },
  S03: { qtyLabel: '件数', dateLabel: '', person: false },
};

/**
 * pricing.html の説明文（sf-desc）から、注文ページに出す1〜2文を作る。
 * 顧問料の話・料金の加算だけの文は落とす（スポットのカードには意味がない）。
 */
const DESC_DROP = /顧問料|顧問契約|顧問先|スポット料金|加算します|合計\s*¥|1本あたり|報酬率|同額です/;
function descFor(rows, name) {
  const row = rows.get(name) || rows.get(`${name}（単発）`) || rows.get(name.replace('（単発）', ''));
  const raw = row ? String(row.desc || '') : '';
  const kept = raw.split('。').map((x) => x.trim()).filter((x) => x && !DESC_DROP.test(x));
  return kept.length ? `${kept.join('。')}。` : '';
}

function buildItems(rows) {
  const items = [];
  const add = (code, name, category, unit, base, perUnit, freeUnits, note) => {
    const f = FIELDS[code];
    if (!f) throw new Error(`FIELDS に ${code} がありません`);
    items.push({ code, name, category, unit, base, perUnit, freeUnits: freeUnits || 0,
      desc: descFor(rows, name), note: note || '',
      qtyLabel: f.qtyLabel, dateLabel: f.dateLabel, person: f.person });
  };

  // 入社
  add('H01', '入社手続き（資格取得届）', '入社', '名', 0, simple(rows, '入社手続き（資格取得届）'), 0);
  const setup = setupFee(rows, '会社設立時の新規適用手続き');
  add('H05', '会社設立時の新規適用手続き', '入社', '名', setup.base, setup.perUnit, setup.freeUnits, '5名までは基本料に含みます。6名目から加算します。');
  add('H06', '労使協定の作成・届出（36協定など）', '入社', '事業所', 0, simple(rows, '労使協定の作成・届出（36協定など）'), 0);  // 事業所ごとの単価（GAS の rateSeed_ と同じ）

  // 退社
  add('H02', '退社手続き（資格喪失届）', '退社', '名', 0, simple(rows, '退社手続き（資格喪失届）'), 0,
    '離職票（雇用保険の給付を受けるための書類）が要る方は「退社手続き＋離職票（同時）」をお選びください。59歳以上の方は、本人の希望にかかわらず離職票が必要です。');
  add('H03', '離職票の作成', '退社', '名', 0, simple(rows, '離職票の作成'), 0, '退社手続きと同時にご依頼の場合は「退社手続き＋離職票（同時）」をお選びください。');
  add('H04', '退社手続き＋離職票（同時）', '退社', '名', 0, comboOf(rows, '離職票の作成'), 0);

  // 給付の申請
  add('K01', '出産手当金の支給申請', '給付の申請', '名', 0, simple(rows, '出産手当金の支給申請'), 0,
    '産前産後休業の分です。そのまま育児休業に入る方は「育児休業給付の申請（初回）」も別の手続きになります。');
  add('K02', '育児休業給付の申請（初回）', '給付の申請', '名', 0, initialOf(rows, '育児休業給付の申請'), 0,
    '育児休業の分です。産前産後休業の期間は、健康保険から出産手当金が受けられます（産休中に給与が出ない方）。あわせてご依頼の場合は「出産手当金の支給申請」もお選びください。');
  add('K03', '育児休業給付の申請（2回目以降）', '給付の申請', '回', 0, continuationOf(rows, '育児休業給付の申請'), 0);
  add('K04', '高年齢雇用継続給付の申請（初回）', '給付の申請', '名', 0, initialOf(rows, '高年齢雇用継続給付の申請'), 0);
  add('K05', '高年齢雇用継続給付の申請（継続）', '給付の申請', '回', 0, continuationOf(rows, '高年齢雇用継続給付の申請'), 0);
  add('K06', '介護休業給付の申請（初回）', '給付の申請', '名', 0, initialOf(rows, '介護休業給付の申請'), 0);
  add('K07', '介護休業給付の申請（2回目以降）', '給付の申請', '回', 0, continuationOf(rows, '介護休業給付の申請'), 0);
  add('K08', '傷病手当金の支給申請（初回）', '給付の申請', '名', 0, simple(rows, '傷病手当金の支給申請（初回）'), 0);
  add('K09', '労災保険給付の申請（初回一式）', '給付の申請', '件', 0, simple(rows, '労災保険給付の申請（初回一式）'), 0);

  // 年次・給与
  const g01 = baseAndPer(rows, '単発の給与・賞与計算');
  add('G01', '単発の給与・賞与計算', '年次', '名', g01.base, g01.perUnit, 0);
  const g02 = baseAndPer(rows, '賞与支払届');
  add('G02', '賞与支払届', '年次', '名', g02.base, g02.perUnit, 0);
  const g03 = baseAndPer(rows, '年末調整の資料整理・税理士連携');
  add('G03', '年末調整の資料整理・税理士連携', '年次', '名', g03.base, g03.perUnit, 0);
  const g04 = baseAndPer(rows, '労働保険の年度更新（単発）');
  add('G04', '労働保険の年度更新', '年次', '名', g04.base, g04.perUnit, 0);
  const g05 = baseAndPer(rows, '算定基礎届の提出（単発）');
  add('G05', '算定基礎届の提出', '年次', '名', g05.base, g05.perUnit, 0);

  // 相談・研修
  add('S01', '管理職研修・ハラスメント研修', '相談', 'コマ', 0, simple(rows, '管理職研修・ハラスメント研修'), 0, '1コマ60分の料金です。');
  add('S02', 'スポット労務相談（60分）', '相談', '回', 0, simple(rows, 'スポット労務相談（60分）'), 0, 'ご注文後、担当者が内容を確認のうえ受任します。事前のお問い合わせは不要です。');
  add('S03', '労務トラブルの初動整理', '相談', '件', 0, simple(rows, '労務トラブルの初動整理'), 0);

  return items;
}

const rows = await loadRows();
const items = buildItems(rows);
const payload = {
  generatedFrom: 'pricing.html#spot-fees',
  currency: 'JPY',
  taxNote: '表示価格はすべて税抜です。実費（郵送費・交通費など）は実額のみで、上乗せはしません。',
  items,
};
const json = `${JSON.stringify(payload, null, 2)}\n`;

const target = path.join(root, 'data/spot-items.json');
let current = '';
try {
  current = await readFile(target, 'utf8');
} catch {
  current = '';
}

// spot.html 内の埋め込み区間（<!-- spot-items:start --> … <!-- spot-items:end -->）も同じ内容にする
const pagePath = path.join(root, 'spot.html');
const page = await readFile(pagePath, 'utf8');
const embedRe = /<!-- spot-items:start -->[\s\S]*?<!-- spot-items:end -->/;
const embed = `<!-- spot-items:start -->\n<script id="spot-items" type="application/json">\n${json.trim().replace(/<\//g, '<\\/')}\n</script>\n<!-- spot-items:end -->`;
if (!embedRe.test(page)) { console.error('spot.html に spot-items の埋め込み区間がありません。'); process.exit(1); }
const pageNext = page.replace(embedRe, embed);
if (checkOnly && pageNext !== page) {
  console.error('spot.html の埋め込み品目が pricing.html と同期していません。node scripts/sync-spot-items.mjs を実行してください。');
  process.exit(1);
}
if (!checkOnly && pageNext !== page) { await writeFile(pagePath, pageNext, 'utf8'); console.log('spot.html の埋め込み品目を更新しました。'); }

if (checkOnly) {
  if (current !== json) {
    console.error('data/spot-items.json が pricing.html と同期していません。node scripts/sync-spot-items.mjs を実行してください。');
    process.exit(1);
  }
  console.log(`data/spot-items.json は pricing.html と同期しています（${items.length}品目）。`);
  process.exit(0);
}

if (current !== json) {
  await writeFile(target, json, 'utf8');
  console.log(`data/spot-items.json を更新しました（${items.length}品目）。`);
} else {
  console.log(`data/spot-items.json に変更はありません（${items.length}品目）。`);
}
