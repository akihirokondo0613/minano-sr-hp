#!/usr/bin/env node

/**
 * 公開HTMLに電話発信リンク（href="tel:...）が入っていないかを見る
 *
 *   node scripts/check-no-tel-links.mjs
 *
 * なぜ要るのか:
 *   2026-09-23 の方針で、相談の入口はフォームに一本化し、電話番号は情報として
 *   載せるだけ（タップで発信させない）と決めた。ところが 10/14 のトップ刷新（#414）で
 *   トップと相談ページに tel: リンクが入り直し、10/20 の点検で見つかって #435 で外した。
 *   見た目では気づきにくいので、公開前チェックで機械的に止める。
 *
 * 対象: 配信される HTML すべて（deploy-public.yml の「非公開ファイルを除外」と同じ範囲を外す）。
 *       shoshiki/dl/ のような深い階層も配信されるので、階層の深さで打ち切らない。
 * 除外: admin-post.html（記事生成テンプレートの文字列）/ icon-catalog.html は非公開ページ。
 *       docs/（停止中ページの保管庫）・scripts/・data/shoshiki/・_backup_*・ドット始まりは配信されない。
 * 判定: 属性としての href="tel:" / href='tel:' / href=tel: だけを拾う。
 *       JS の /^(mailto:|tel:|https?:)/ や CSS の a[href^="tel:"] は href= の直後が tel: でないので拾わない。
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const excludedHtml = new Set(['admin-post.html', 'icon-catalog.html']);
const excludedDirs = new Set(['docs', 'scripts', 'node_modules', 'data/shoshiki']);
const telHref = /\bhref\s*=\s*["']?\s*tel:/i;
const pages = [];

async function collectHtml(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_backup_')) continue;
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (entry.isDirectory()) {
      if (!excludedDirs.has(rel)) await collectHtml(full);
    } else if (entry.name.endsWith('.html')) {
      if (!excludedHtml.has(rel)) pages.push({ full, rel });
    }
  }
}

await collectHtml(root);

const problems = [];
for (const { full, rel } of pages) {
  const lines = (await readFile(full, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (telHref.test(line)) problems.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (problems.length) {
  console.error('公開HTMLに電話発信リンク（href="tel:"）があります。電話番号は文字で載せるだけにし、相談の入口はフォームにしてください。');
  for (const line of problems) console.error(`- ${line}`);
  process.exit(1);
}
console.log(`tel:リンクチェック合格: 公開HTML ${pages.length}ページ`);
