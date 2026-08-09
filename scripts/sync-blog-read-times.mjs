/**
 * 記事本文から読了時間を再計算し、articles.jsonへ同期する。
 *
 *   node scripts/sync-blog-read-times.mjs
 *   node scripts/sync-blog-read-times.mjs --check
 *
 * 更新後は `node scripts/sync-blog-dates.mjs` で記事上の表示へ反映する。
 * 算式は new_post.py / audit-blog.mjs と同じ（550字/分、本文SVG1点=0.5分、切上げ、下限2分）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const articlesPath = path.join(root, 'blog/articles.json');
const articles = JSON.parse(fs.readFileSync(articlesPath, 'utf8'));
const charsPerMinute = 550;
const svgMinutes = 0.5;
const minimumRead = 2;
const differences = [];

function articleBody(source, relativePath) {
  const match = source.match(/<article class="post">([\s\S]*?)<\/article>/);
  if (!match) throw new Error(`${relativePath}: article.postが見つかりません`);
  return match[1];
}

function computeRead(body) {
  const plain = body
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/gi, '')
    .replace(/\s+/g, '');
  const svgCount = (body.match(/<svg\b/g) ?? []).length;
  return Math.max(minimumRead, Math.ceil(plain.length / charsPerMinute + svgCount * svgMinutes));
}

for (const article of articles) {
  const relativePath = `blog/${article.slug}.html`;
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const read = computeRead(articleBody(source, relativePath));
  const current = Number(article.read);
  if (current === read) continue;
  differences.push({ slug: article.slug, current, read });
  article.read = String(read);
}

for (const item of differences) {
  console.log(`${checkOnly ? '要同期' : '更新'}: ${item.slug} ${item.current}分 → ${item.read}分`);
}

if (checkOnly) {
  if (differences.length) {
    console.error(`読了時間の同期が必要です（${differences.length}記事）`);
    process.exitCode = 1;
  } else {
    console.log(`読了時間は同期済みです（${articles.length}記事）`);
  }
} else {
  if (differences.length) {
    fs.writeFileSync(articlesPath, `${JSON.stringify(articles, null, 2)}\n`, 'utf8');
  }
  console.log(`読了時間を再計算しました（${articles.length}記事、更新${differences.length}記事）`);
  if (differences.length) console.log('続けて node scripts/sync-blog-dates.mjs を実行してください');
}
