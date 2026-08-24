#!/usr/bin/env node

/**
 * 公開HTMLの中に、同じ id が2つ以上ないかを見る
 *
 *   node scripts/check-duplicate-ids.mjs
 *
 * なぜ要るのか:
 *   生成器がブロックを剥がし損ねて同じ節を2つ入れても、見た目はほとんど変わらない。
 *   実際 #138 で sync-service-prices.mjs が字下げを変えた結果、sync-related-posts.mjs が
 *   既存ブロックを剥がせず、業務ページ5枚で関連記事の節が二重になった。
 *   このとき id="related-posts-t" も2つになったが、公開前チェックもCIも気づかなかった。
 *   id の重複は、支援技術が見出しを1つに解決できなくなるうえ、こういう二重挿入の
 *   いちばん安い検出手段でもある。
 *
 * 除外: admin-post.html / icon-catalog.html は非公開ページ。
 *       scripts/check-performance-budget.mjs の excludedHtml と同じ扱いにする。
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const excludedHtml = new Set(['admin-post.html', 'icon-catalog.html']);
const pages = [];

async function collectHtml(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_backup_')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (relative(root, full).split('/').length <= 2) await collectHtml(full);
    } else if (entry.name.endsWith('.html')) {
      const rel = relative(root, full);
      if (!excludedHtml.has(rel)) pages.push({ full, rel });
    }
  }
}

await collectHtml(root);

const problems = [];
for (const { full, rel } of pages) {
  const html = await readFile(full, 'utf8');
  const counts = new Map();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
    const id = match[1];
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const [id, n] of counts) {
    if (n > 1) problems.push(`${rel}: id="${id}" が${n}個あります`);
  }
}

if (problems.length) {
  console.error('公開HTMLに重複したidがあります。生成器がブロックを剥がし損ねている可能性があります。');
  for (const line of problems) console.error(`- ${line}`);
  process.exit(1);
}
console.log(`重複idチェック合格: 公開HTML ${pages.length}ページ`);
