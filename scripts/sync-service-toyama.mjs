#!/usr/bin/env node

/**
 * 業務ページに「富山では、どこに出すのか」の節を生成する
 *
 *   node scripts/sync-service-toyama.mjs           生成
 *   node scripts/sync-service-toyama.mjs --check    差分があれば失敗（公開前チェック用）
 *
 * なぜ要るのか:
 *   「富山」という語をタイトルとメタ情報に足しただけのページは、地域の検索で評価されない。
 *   必要なのは、その地域でしか書けない事実のほうで、労務でいえば「どの市町の会社が、
 *   どの窓口に出すのか」がそれにあたる。富山県は年金事務所4か所に対してハローワークが
 *   7か所あり、市町によって社会保険と雇用保険の提出先が別系統になる。この食い違いは
 *   富山県内でしか成り立たない事実で、そのまま業務ページの中身になる。
 *
 * 正本の分け方:
 *   - 窓口の住所・電話・管轄 … data/toyama-madoguchi.json（窓口一覧ページと共通）
 *   - どのページにどれを出すか・説明文 … data/service-toyama.json
 *   この生成器は住所も電話も管轄も持たない。管轄の文字列を反転して表を組み立てるだけなので、
 *   窓口側の管轄が変われば業務ページの表も自動で変わる。
 *
 * 差し込み先: uploads/service-*.html の <!-- svc-toyama:start --> 〜 <!-- svc-toyama:end -->
 * 見た目: uploads/service.css の .svct 系。
 * 文節印（<wbr>）はこの生成器が markPhrases で入れる（後入れは --check が落ちる）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const OPEN = '<!-- svc-toyama:start -->';
const CLOSE = '<!-- svc-toyama:end -->';

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const madoguchi = JSON.parse(await readFile(path.join(root, 'data/toyama-madoguchi.json'), 'utf8'));
const plan = JSON.parse(await readFile(path.join(root, 'data/service-toyama.json'), 'utf8'));

/** id から窓口を引く */
const byId = new Map();
for (const group of madoguchi.groups) {
  for (const office of group.offices) {
    if (byId.has(office.id)) throw new Error(`窓口の id が重複しています: ${office.id}`);
    byId.set(office.id, { ...office, groupKey: group.key });
  }
}

function officeOf(id) {
  const office = byId.get(id);
  if (!office) throw new Error(`data/toyama-madoguchi.json に id=${id} の窓口がありません`);
  return office;
}

const label = (office) => office.short || office.name;

/**
 * 管轄の文字列を反転して「市町村 → その市町村を管轄する窓口」の対応を作る。
 * 管轄は「富山市、高岡市、氷見市」のように読点区切りで書かれている。
 * 県全域を管轄する窓口（労働局・県）は市町村別の表には出さない。
 */
function jurisdictionIndex(groupKey) {
  const group = madoguchi.groups.find((g) => g.key === groupKey);
  if (!group) throw new Error(`data/toyama-madoguchi.json に key=${groupKey} のグループがありません`);
  const index = new Map();
  for (const office of group.offices) {
    if (!office.jurisdiction) continue;
    for (const raw of office.jurisdiction.split('、')) {
      const area = raw.trim();
      if (!area || area.includes('全域') || area.includes('県内')) continue;
      if (!index.has(area)) index.set(area, []);
      index.get(area).push(office);
    }
  }
  return index;
}

function buildTable(table) {
  const indexes = table.columns.map((c) => jurisdictionIndex(c.group));

  // municipalityOrder に載っていない管轄が出てきたら、黙って落とさずに止める。
  const seen = new Set();
  for (const index of indexes) for (const area of index.keys()) seen.add(area);
  const unknown = [...seen].filter((a) => !plan.municipalityOrder.includes(a));
  if (unknown.length) {
    throw new Error(`data/service-toyama.json の municipalityOrder に無い管轄があります: ${unknown.join('、')}`);
  }
  const missing = plan.municipalityOrder.filter((a) => !indexes.some((i) => i.has(a)));
  if (missing.length) {
    throw new Error(`どの窓口の管轄にも出てこない市町村があります: ${missing.join('、')}`);
  }

  const head = table.columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join('');
  const rows = plan.municipalityOrder.map((area) => {
    // data-label は狭い幅で表を積み上げるときの見出しになる（CSSの ::before が読む）
    const cells = indexes.map((index, i) => {
      const head = esc(table.columns[i].label);
      const offices = index.get(area) || [];
      if (!offices.length) return `<td data-label="${head}">—</td>`;
      const links = offices
        .map((o) => `<a href="toyama-madoguchi.html#mdg-${esc(o.id)}">${esc(label(o))}</a>`)
        .join('<span class="svct-sep">／</span>');
      return `<td data-label="${head}">${links}</td>`;
    }).join('');
    return `          <tr><th scope="row">${esc(area)}</th>${cells}</tr>`;
  }).join('\n');

  return [
    '      <div class="svct-tablewrap rv d1">',
    `        <table class="svct-table">`,
    `          <caption>${esc(table.caption)}</caption>`,
    '          <thead>',
    `            <tr><th scope="col">${esc(table.head)}</th>${head}</tr>`,
    '          </thead>',
    '          <tbody>',
    rows,
    '          </tbody>',
    '        </table>',
    '      </div>',
  ].join('\n');
}

function hostOf(source) {
  try { return new URL(source).host; } catch { return source; }
}

/**
 * 富山県だけ違う数字（最低賃金・協会けんぽの支部料率）を並べる。
 * 数字は年に一度は必ず変わるので、確認日と出典を必ず添える。
 * 発効前の答申額を「いまの下限」と読ませないよう、値と注記を必ず対で出す。
 */
function buildNumbers(numbers) {
  if (!numbers) return '';
  const rows = numbers.rows.map((row) => [
    '        <div class="svct-num">',
    `          <p class="svct-num-l">${esc(row.label)}</p>`,
    `          <p class="svct-num-v">${esc(row.value)}</p>`,
    `          <p class="svct-num-n">${esc(row.note)}</p>`,
    row.source
      ? `          <p class="svct-num-s">出典 <a href="${esc(row.source)}" target="_blank" rel="noopener">${esc(hostOf(row.source))}</a></p>`
      : '',
    '        </div>',
  ].filter(Boolean).join('\n')).join('\n');
  return [
    '      <div class="svct-nums rv d1">',
    `        <p class="svct-nums-c">${esc(numbers.caption)}</p>`,
    rows,
    '      </div>',
  ].join('\n');
}

function buildOffices(list) {
  if (!list.length) return '';
  const items = list.map((entry) => {
    const office = officeOf(entry.id);
    const rows = [
      office.address ? ['所在地', esc(office.address)] : null,
      office.tel ? ['電話', esc(office.tel)] : null,
    ].filter(Boolean);
    return [
      '        <div class="svct-office">',
      `          <p class="svct-office-n"><a href="toyama-madoguchi.html#mdg-${esc(office.id)}">${esc(office.name)}</a></p>`,
      `          <p class="svct-office-r">${esc(entry.role)}</p>`,
      '          <dl class="svct-dl">',
      ...rows.map(([k, v]) => `            <dt>${k}</dt><dd>${v}</dd>`),
      '          </dl>',
      '        </div>',
    ].join('\n');
  }).join('\n');
  return `      <div class="svct-offices rv d2">\n${items}\n      </div>`;
}

function buildSection(page) {
  const lead = page.lead.map((p) => `        <p class="svct-lead">${esc(p)}</p>`).join('\n');
  const parts = [
    '<section class="sec sec-alt" id="toyama">',
    '  <div class="w">',
    '    <div class="sec-head rv">',
    '      <div class="sec-head-body">',
    `        <h2 class="sec-h">${esc(page.heading)}</h2>`,
    `        <p class="sec-sub">${esc(page.sub)}</p>`,
    '      </div>',
    '    </div>',
    '    <div class="svct">',
    `      <div class="svct-leads rv">\n${lead}\n      </div>`,
    page.table ? buildTable(page.table) : '',
    buildNumbers(page.numbers),
    buildOffices(page.offices),
    page.note ? `      <p class="svct-note rv d2">${esc(page.note)}</p>` : '',
    '      <p class="svct-cta rv d3"><a class="btn-secondary" href="toyama-madoguchi.html">富山の窓口一覧をすべて見る →</a></p>',
    '    </div>',
    '  </div>',
    '</section>',
  ].filter(Boolean);
  return parts.join('\n');
}

const changed = [];
for (const page of plan.pages) {
  const file = path.join(root, page.file);
  const source = await readFile(file, 'utf8');
  const from = source.indexOf(OPEN);
  const to = source.indexOf(CLOSE, from);
  if (from < 0 || to < 0) throw new Error(`${page.file}: svc-toyama のマーカーがありません`);
  const html = markPhrases(buildSection(page)).html;
  const generated = `${source.slice(0, from + OPEN.length)}\n${html}\n${source.slice(to)}`;
  if (generated === source) continue;
  changed.push(page.file);
  if (!checkOnly) await writeFile(file, generated, 'utf8');
}

if (checkOnly) {
  if (changed.length) {
    console.error('業務ページの富山の窓口が data と同期していません。node scripts/sync-service-toyama.mjs を実行してください。');
    for (const rel of changed) console.error(`- ${rel}`);
    process.exit(1);
  }
  console.log(`業務ページの富山の窓口は同期しています（${plan.pages.length}ページ）。`);
  process.exit(0);
}
console.log(changed.length
  ? `業務ページの富山の窓口を更新しました: ${changed.join(' / ')}`
  : `業務ページの富山の窓口に変更はありません（${plan.pages.length}ページ）。`);
