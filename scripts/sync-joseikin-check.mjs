#!/usr/bin/env node

/**
 * 助成金ページ 02「うちは対象になる？」を data/ から生成する。
 *
 *   node scripts/sync-joseikin-check.mjs           生成
 *   node scripts/sync-joseikin-check.mjs --check    差分があれば失敗（公開前チェック用）
 *
 * 正本は2つ:
 *   data/joseikin-check.json   聞くこと（設問）と、どの制度に当たるか
 *   data/joseikin-guides.json  制度名・金額の目安・「先にやること」（解説ページと共有）
 *
 * なぜ生成するのか:
 *   金額と「先に出す書類」は年度で変わる。解説ページとチェック結果に同じ数字を
 *   手で二度書くと、片方だけ古いまま残る。数字の出どころを1か所にする。
 *
 * joseikin.html 側の差し替え区間:
 *   <!-- jk-check-q:start --> … <!-- jk-check-q:end -->      設問
 *   <!-- jk-check-data:start --> … <!-- jk-check-data:end -->  結果カード用のJSON
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(root, 'joseikin.html');
const checkOnly = process.argv.includes('--check');

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function replaceRegion(source, name, body) {
  const open = `<!-- ${name}:start -->`;
  const close = `<!-- ${name}:end -->`;
  const from = source.indexOf(open);
  const to = source.indexOf(close, from);
  if (from < 0 || to < 0) throw new Error(`joseikin.html: ${name} のマーカーがありません`);
  return `${source.slice(0, from + open.length)}\n${body}\n${' '.repeat(8)}${source.slice(to)}`;
}

const [checkRaw, guidesRaw, pageSource] = await Promise.all([
  readFile(path.join(root, 'data', 'joseikin-check.json'), 'utf8'),
  readFile(path.join(root, 'data', 'joseikin-guides.json'), 'utf8'),
  readFile(pagePath, 'utf8'),
]);
const data = JSON.parse(checkRaw);
const guides = new Map(JSON.parse(guidesRaw).guides.map((g) => [g.slug, g]));

/** 制度キーから、結果カードに出す4項目を決める */
function programOf(key) {
  const extra = data.extra?.[key];
  const guide = guides.get(key);
  if (!extra && !guide) throw new Error(`data/joseikin-check.json: 制度 ${key} の出どころがありません`);
  const anchor = data.anchors?.[key];
  // どのコースの金額を出すか。06セクションと同じコースを指すよう data/joseikin-check.json で選ぶ。
  const at = data.amountIndex?.[key] ?? 0;
  const program = extra
    ? { name: extra.name, course: extra.course ?? '', amount: extra.amount, wall: extra.wall, guide: extra.guide, guideLabel: extra.guideLabel }
    : {
      name: guide.name,
      course: guide.amounts?.[at]?.name ?? '',
      amount: guide.amounts?.[at]?.value ?? '',
      wall: guide.wall?.before ?? '',
      guide: `uploads/joseikin-${guide.slug}.html`,
      guideLabel: guide.short ?? '',
    };
  for (const field of ['name', 'amount', 'wall', 'guide']) {
    if (!program[field]) throw new Error(`制度 ${key}: ${field} が空です`);
  }
  if (anchor) program.here = `#${anchor}`;
  return program;
}

const used = new Set();
for (const group of data.groups) for (const item of group.items) for (const key of item.hits) used.add(key);
const programs = {};
for (const key of [...used].sort()) programs[key] = programOf(key);

// 設問。1グループ＝1fieldsetで、見出しをlegendに出す。
const questionHtml = data.groups.map((group) => {
  const rows = group.items.map((item) => {
    const keys = item.hits.join(' ');
    return `              <label class="jk-q-item"><input type="checkbox" data-jk="${esc(keys)}"><span>${esc(item.ask)}</span></label>`;
  });
  return [
    '          <fieldset class="jk-q">',
    `            <legend>${esc(group.title)}</legend>`,
    '            <div class="jk-q-list">',
    ...rows,
    '            </div>',
    '          </fieldset>',
  ].join('\n');
}).join('\n');

// 結果カード。HTMLに全部置いておき、JSは hidden を外すだけにする。
// こうすると（1）文節印がここにも入る（2）JSが動かなくても中身が読める
// （3）検索エンジンから見て、制度名と金額がページの本文として残る。
const order = [];
for (const group of data.groups) for (const item of group.items) for (const key of item.hits) {
  if (!order.includes(key)) order.push(key);
}
const cardsHtml = order.map((key) => {
  const p = programs[key];
  const links = [];
  if (p.here) links.push(`<a class="nw" href="${esc(p.here)}">このページで見る</a>`);
  links.push(`<a class="nw" href="${esc(p.guide)}">図解でくわしく</a>`);
  return [
    `          <li class="jk-hit" data-jk="${esc(key)}" data-name="${esc(p.name)}" hidden>`,
    '            <p class="jk-hit-name">' + esc(p.name)
      // 金額は制度の合計ではなく特定のコースの目安。06の「最大◯万円」と
      // 食い違って見えないよう、どのコースの数字かを添える。
      + `<span class="jk-hit-amt">${p.course ? `<span class="jk-hit-amt-l">${esc(p.course)}</span>` : ''}${esc(p.amount)}</span></p>`,
    '            <p class="jk-hit-wall"><span class="jk-hit-tag">先にやること</span>'
      + esc(p.wall) + '</p>',
    `            <p class="jk-hit-links">${links.join('')}</p>`,
    '          </li>',
  ].join('\n');
}).join('\n');

let generated = replaceRegion(pageSource, 'jk-check-q', markPhrases(questionHtml).html);
generated = replaceRegion(generated, 'jk-check-cards', markPhrases(cardsHtml).html);

if (generated === pageSource) {
  console.log('助成金ページの対象チェックは最新です');
  process.exit(0);
}
if (checkOnly) {
  console.error('joseikin.html: 02 対象チェックが data/joseikin-check.json と同期していません');
  process.exit(1);
}
await writeFile(pagePath, generated, 'utf8');
const count = data.groups.reduce((n, g) => n + g.items.length, 0);
console.log(`更新: joseikin.html の 02 対象チェック（設問${count}件 / 制度${order.length}件）`);
