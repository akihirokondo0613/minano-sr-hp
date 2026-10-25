#!/usr/bin/env node
// 簡素トップモードの適用（公開工程 deploy-public.yml から呼ぶ。main の中身は変えない）
//
// ルート直下に `.simple-home` があるとき、public ブランチへ載せる直前に次を行う。
//   1. index.html を .github/simple-home.html（他ページへのリンクが無い1ページ）で置き換える
//   2. index.html 以外の公開HTMLすべての robots meta を noindex,nofollow にする
//      （ページ自体は残るので、URLを知っている人には今までどおり表示される）
//   3. sitemap.xml をトップ1件だけにし、llms.txt を事務所概要だけにする
// robots.txt は触らない（Disallow にすると Google が noindex を読めず、URLだけ検索に残る）。
// 解除は `.simple-home` を削除して main へマージするだけ。次の公開で全ページが元に戻る。
//
// 使い方: node .github/apply-simple-home.mjs [ルート]   （省略時はカレント）
// 標準ライブラリだけで動く（CIの runner に npm install は無い）。

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'docs', 'scripts']);
const NOINDEX = '<meta name="robots" content="noindex,nofollow">';

function listHtml(dir, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${name.name}` : name.name;
    if (name.isDirectory()) {
      if (SKIP_DIRS.has(name.name) || name.name.startsWith('_backup')) continue;
      out.push(...listHtml(path.join(dir, name.name), relPath));
    } else if (name.isFile() && name.name.toLowerCase().endsWith('.html')) {
      out.push(relPath);
    }
  }
  return out;
}

function setNoindex(html) {
  const robotsRe = /<meta\s+name=["']robots["'][^>]*>/i;
  if (robotsRe.test(html)) {
    // 既存の robots meta を1つ目だけ置き換え、2つ目以降（あれば）は削る
    let first = true;
    return html.replace(new RegExp(robotsRe.source, 'gi'), () => {
      if (first) { first = false; return NOINDEX; }
      return '';
    });
  }
  const headRe = /<head(\s[^>]*)?>/i;
  if (!headRe.test(html)) throw new Error('<head> が見つかりません');
  return html.replace(headRe, (m) => `${m}\n${NOINDEX}`);
}

const simpleHome = path.join(root, '.github', 'simple-home.html');
if (!fs.existsSync(simpleHome)) {
  console.error(`簡素トップの原本がありません: ${simpleHome}`);
  process.exit(1);
}

const pages = listHtml(root).filter((p) => p !== 'index.html');
let changed = 0;
for (const rel of pages) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = setNoindex(before);
  if (after !== before) { fs.writeFileSync(file, after); changed += 1; }
}

fs.copyFileSync(simpleHome, path.join(root, 'index.html'));

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(root, 'sitemap.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  '  <url>',
  '    <loc>https://minano-sr.com/</loc>',
  `    <lastmod>${today}</lastmod>`,
  '    <changefreq>monthly</changefreq>',
  '    <priority>1.0</priority>',
  '  </url>',
  '</urlset>',
  '',
].join('\n'));

fs.writeFileSync(path.join(root, 'llms.txt'), [
  '# みなの社会保険労務士事務所',
  '',
  '> 富山市の社会保険労務士事務所。社会保険・労働保険の手続き、給与計算、雇用関係助成金の申請、就業規則の整備を扱う。',
  '',
  '所在地: 〒931-8333 富山県富山市蓮町1丁目7-4 SCOP TOYAMA',
  '連絡先: contact@minano-sr.com',
  '公式サイト: https://minano-sr.com/',
  '',
].join('\n'));

// 確認: index.html 以外に noindex でない公開HTMLが残っていないこと
const leftover = pages.filter((rel) => !/<meta\s+name=["']robots["']\s+content=["']noindex,nofollow["']>/i.test(fs.readFileSync(path.join(root, rel), 'utf8')));
if (leftover.length) {
  console.error(`noindex にできなかったページがあります:\n${leftover.join('\n')}`);
  process.exit(1);
}

console.log(`簡素トップモードを適用: index.html を差し替え、${pages.length}ページを noindex（書き換え${changed}件）、sitemap.xml はトップ1件、llms.txt は概要のみ`);
