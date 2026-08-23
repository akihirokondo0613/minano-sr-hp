#!/usr/bin/env node

/**
 * トップページ 06 TOPICS の自動生成部分を blog/articles.json から同期する。
 *
 * 生成対象は次の2か所。手作業で書き換えず、記事を追加したらこのスクリプトを実行する。
 *   - 公開状況の数値（公開記事の本数・分野数・最新記事の日付）
 *   - 流れるカード列（新しい順の記事カード）
 *
 * カードのサムネイルは blog.html の一覧が持つ記事ごとのSVGをそのまま取り出して使う。
 * 図はここで作らず、正本を blog.html の一覧に一本化する。
 *
 * --check を付けると差分の有無だけを判定し、ズレていれば失敗する（公開前チェック用）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const blogPath = path.join(root, 'blog.html');
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

/** blog.html の一覧から slug ごとの .art-thumb のSVGを取り出す。 */
function collectThumbs(blogSource) {
  const thumbs = new Map();
  const rowPattern = /<a\s+href="blog\/([a-z0-9-]+)\.html"[^>]*class="art-row"[\s\S]*?<div class="art-thumb">([\s\S]*?)<\/div>/g;
  for (const match of blogSource.matchAll(rowPattern)) {
    const [, slug, svg] = match;
    const trimmed = svg.trim();
    if (!trimmed.startsWith('<svg') || !trimmed.endsWith('</svg>')) continue;
    if (thumbs.has(slug)) throw new Error(`blog.html: ${slug} の記事行が重複しています`);
    thumbs.set(slug, trimmed);
  }
  if (!thumbs.size) throw new Error('blog.html: 記事一覧のサムネイルを取得できません');
  return thumbs;
}

function normalizeArticles(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('blog/articles.json: 記事が1件もありません');
  }
  for (const article of raw) {
    for (const key of ['slug', 'cat', 'catLabel', 'date', 'title']) {
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

function buildCards(articles, thumbs) {
  const lines = articles.slice(0, CARD_COUNT).map((article) => {
    const href = `blog/${article.slug}.html`;
    const thumb = thumbs.get(article.slug);
    if (!thumb) throw new Error(`blog.html: ${article.slug} のサムネイルが見つかりません`);
    return [
      '        <li class="tp-item"><a class="tp-card" href="' + escapeHtml(href) + '">',
      `          <span class="tp-thumb" aria-hidden="true">${thumb}</span>`,
      `          <span class="tp-cat">${escapeHtml(article.catLabel)}</span>`,
      `          <span class="tp-title">${escapeHtml(article.title)}</span>`,
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

  const [indexSource, blogSource, articlesSource] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(blogPath, 'utf8'),
    readFile(articlesPath, 'utf8'),
  ]);
  const articles = normalizeArticles(JSON.parse(articlesSource));
  if (articles.length < CARD_COUNT) {
    throw new Error(`blog/articles.json: カードに必要な${CARD_COUNT}件に足りません（現在${articles.length}件）`);
  }

  let generated = replaceRegion(indexSource, 'home-topics-stats', buildStats(articles));
  generated = replaceRegion(generated, 'home-topics-cards', buildCards(articles, collectThumbs(blogSource)));

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
