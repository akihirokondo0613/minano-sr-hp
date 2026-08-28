#!/usr/bin/env node

/**
 * トップページ 06 TOPICS の自動生成部分を blog/articles.json から同期する。
 *
 * 生成対象は次の2か所。手作業で書き換えず、記事を追加したらこのスクリプトを実行する。
 *   - 公開状況の数値（公開記事の本数・分野数・最新記事の日付）
 *   - 横送りのカード列（新しい順の記事カード）
 *
 * カードは 帯（分野名）→タイトル→概要→日付 の並びで統一する。帯は図ではなく分野名の文字で何の話かを示す。色は分野ごとに
 * index.html の .tp-thumb[data-cat] が持ち、ここは分野キーと表示名だけを出す。
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

/** マーキーは1周の見た目を保つため件数を固定する。増減はここだけを変える。 */
const CARD_COUNT = 14;

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
  return '<span class="pub-live-txt">'
    + `公開記事 <b>${articles.length}</b>本 ／ <b>${categories.size}</b>分野`
    + `<span class="pub-live-latest"> ／ 最新記事 <b>${latest}</b></span>`
    + '</span>';
}

function buildCards(articles) {
  const lines = articles.slice(0, CARD_COUNT).map((article) => {
    const href = `blog/${article.slug}.html`;
    // カードは「タイトル→概要」の2段で統一する。記事タイトルの「｜」以降は
    // 副題で概要と重複するため、カードでは主部だけを出す（記事ページは全文のまま）。
    const title = article.title.split('｜')[0].trim();
    return [
      '        <li class="tp-item"><a class="tp-card" href="' + escapeHtml(href) + '">',
      `          <span class="tp-thumb" data-cat="${escapeHtml(article.cat)}">${escapeHtml(article.catLabel)}</span>`,
      `          <span class="tp-title">${escapeHtml(title)}</span>`,
      `          <span class="tp-desc">${escapeHtml(article.description)}</span>`,
      `          <time class="tp-date" datetime="${escapeHtml(article.date)}">${escapeHtml(article.date.replaceAll('-', '.'))}</time>`,
      '        </a></li>',
    ].join('\n');
  });
  return `\n${lines.join('\n')}\n      `;
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
  if (articles.length < CARD_COUNT) {
    throw new Error(`blog/articles.json: カードに必要な${CARD_COUNT}件に足りません（現在${articles.length}件）`);
  }

  // 生成した見出しにも文節印（<wbr>）を入れておく。あとから
  // sync-phrase-breaks.mjs に差し込ませると、この生成器の --check が毎回落ちる。
  let generated = replaceRegion(indexSource, 'home-topics-stats', markPhrases(buildStats(articles)).html);
  generated = replaceRegion(generated, 'home-topics-cards', markPhrases(buildCards(articles)).html);

  if (generated === indexSource) {
    console.log('トップのTOPICSは最新です');
    return;
  }
  if (checkOnly) {
    console.error('index.html: 06 TOPICS が blog/articles.json と同期していません');
    process.exitCode = 1;
    return;
  }

  await writeFile(indexPath, generated, 'utf8');
  console.log(`更新: index.html の 06 TOPICS（カード${CARD_COUNT}件・公開記事${articles.length}本）`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
