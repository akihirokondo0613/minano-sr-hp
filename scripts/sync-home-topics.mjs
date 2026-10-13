#!/usr/bin/env node

/**
 * トップページの記事一覧部分を blog/articles.json から同期する。
 *
 * 生成対象は次の3か所。手作業で書き換えず、記事を追加したらこのスクリプトを実行する。
 *   - home-notice-list … 「法改正・重要なお知らせ」（法改正情報の新しい順）
 *   - home-topics-tabs … インフォメーションの分野別タブ（新着＋分野ごと）
 *   - home-topics-stats … 公開状況の数値（公開記事の本数・分野数・最新記事の日付）
 *
 * --check を付けると差分の有無だけを判定し、ズレていれば失敗する（公開前チェック用）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const articlesPath = path.join(root, 'blog', 'articles.json');

/** 「法改正・重要なお知らせ」に出す件数と、インフォメーションの各タブに出す件数。増減はここだけを変える。 */
const NOTICE_COUNT = 5;
const TAB_COUNT = 6;
/** タブの並び。先頭は分野をまたいだ新着。分野は articles.json の cat キーで、表示名は記事側の catLabel を使う。 */
const TAB_ORDER = ['all', 'kaisei', 'hoken', 'joseikin', 'shugyo', 'trouble', 'keiei', 'system'];
const NOTICE_CAT = 'kaisei';

const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function replaceRegion(source, name, body) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`index.html: ${name} の生成マーカーが見つかりません`);
  }
  if (source.indexOf(start, startIndex + start.length) >= 0
    || source.indexOf(end, endIndex + end.length) >= 0) {
    throw new Error(`index.html: ${name} の生成マーカーが複数あります`);
  }
  return source.slice(0, startIndex + start.length) + body + source.slice(endIndex);
}

function normalizeArticles(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('blog/articles.json: 記事が1件もありません');
  }
  for (const article of raw) {
    for (const key of ['slug', 'cat', 'catLabel', 'date', 'title', 'description']) {
      if (typeof article?.[key] !== 'string' || !article[key].trim()) {
        throw new Error(`blog/articles.json: ${key} が空の記事があります（slug: ${article?.slug ?? '不明'}）`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(article.date)) {
      throw new Error(`blog/articles.json: 日付の形式が不正です（${article.slug}: ${article.date}）`);
    }
  }
  // 同じ日付の記事はarticles.jsonの並び順を保つ（安定ソート）。
  return [...raw].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function buildStats(articles) {
  const categories = new Set(articles.map((article) => article.cat));
  const latest = articles[0].date.replaceAll('-', '.');
  // 数値の並びは文節で割らない（nwの塊のあいだでだけ折る）。
  return `<span class="nw">公開記事 <b>${articles.length}</b>本</span> ／ <span class="nw"><b>${categories.size}</b>分野</span> ／ <span class="nw">最新記事 <b>${latest}</b></span>`;
}

// 記事タイトルの「｜」以降は副題なので一覧では主部だけを出す（記事ページは全文のまま）。
function shortTitle(article) {
  return article.title.split('｜')[0].trim();
}

function dateText(article) {
  return article.date.replaceAll('-', '.');
}

// 一覧は li ではなく div[role=listitem] で組む。li は文節印（<wbr>）の対象で、日付の数字と
// 記事名がひと続きに解析されて「歯/科」のような不自然な位置に印が入るため。
function buildNotice(articles) {
  const picked = articles.filter((article) => article.cat === NOTICE_CAT).slice(0, NOTICE_COUNT);
  if (picked.length < NOTICE_COUNT) {
    throw new Error(`blog/articles.json: 「${NOTICE_CAT}」の記事が${NOTICE_COUNT}件に足りません（現在${picked.length}件）`);
  }
  const lines = picked.map((article) => `<div role="listitem"><time datetime="${escapeHtml(article.date)}">${dateText(article)}</time>`
    + `<a href="blog/${escapeHtml(article.slug)}.html">${escapeHtml(shortTitle(article))}</a></div>`);
  return `\n${lines.join('\n')}\n`;
}

function buildTabs(articles) {
  const labels = new Map(articles.map((article) => [article.cat, article.catLabel]));
  const unknown = [...labels.keys()].filter((cat) => !TAB_ORDER.includes(cat));
  if (unknown.length) {
    throw new Error(`scripts/sync-home-topics.mjs: TAB_ORDER に無い分野があります（${unknown.join(', ')}）`);
  }
  const tabs = TAB_ORDER.filter((key) => key === 'all' || labels.has(key));
  const buttons = tabs.map((key, index) => {
    const label = key === 'all' ? '新着' : labels.get(key);
    return `<button class="nt-tab" type="button" role="tab" id="nt-tab-${key}" aria-controls="nt-${key}" aria-selected="${index === 0}">${escapeHtml(label)}</button>`;
  });
  const panels = tabs.map((key) => {
    const list = (key === 'all' ? articles : articles.filter((article) => article.cat === key)).slice(0, TAB_COUNT);
    const label = key === 'all' ? '新着' : labels.get(key);
    const items = list.map((article) => `<div role="listitem"><time datetime="${escapeHtml(article.date)}">${dateText(article)}</time>`
      + `<span class="nt-cat">${escapeHtml(article.catLabel)}</span>`
      + `<a href="blog/${escapeHtml(article.slug)}.html">${escapeHtml(shortTitle(article))}</a></div>`);
    return `<div class="nt-panel" role="tabpanel" id="nt-${key}" aria-labelledby="nt-tab-${key}" tabindex="0">`
      + `<h3 class="nt-panel-h">${escapeHtml(label)}</h3>\n<div class="nt-list" role="list">\n${items.join('\n')}\n</div></div>`;
  });
  return `\n<div class="nt-tabs" role="tablist" aria-label="お知らせ・コラムの分野">\n${buttons.join('\n')}\n</div>\n`
    + `<div class="nt-panels">\n${panels.join('\n')}\n</div>\n`;
}

async function main() {
  if (unknownArgs.length) {
    throw new Error(`未対応の引数です: ${unknownArgs.join(', ')}`);
  }

  const [indexSource, articlesSource] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(articlesPath, 'utf8'),
  ]);
  const articles = normalizeArticles(JSON.parse(articlesSource));

  // 生成した見出しにも文節印（<wbr>）を入れておく。あとから
  // sync-phrase-breaks.mjs に差し込ませると、この生成器の --check が毎回落ちる。
  let generated = replaceRegion(indexSource, 'home-topics-stats', buildStats(articles));
  generated = replaceRegion(generated, 'home-notice-list', markPhrases(buildNotice(articles)).html);
  generated = replaceRegion(generated, 'home-topics-tabs', markPhrases(buildTabs(articles)).html);

  if (generated === indexSource) {
    console.log('トップのお知らせ・インフォメーションは最新です');
    return;
  }
  if (checkOnly) {
    console.error('index.html: お知らせ・インフォメーションが blog/articles.json と同期していません');
    process.exitCode = 1;
    return;
  }

  await writeFile(indexPath, generated, 'utf8');
  console.log(`更新: index.html のお知らせ${NOTICE_COUNT}件・インフォメーション各${TAB_COUNT}件（公開記事${articles.length}本）`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
