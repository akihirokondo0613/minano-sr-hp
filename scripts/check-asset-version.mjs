#!/usr/bin/env node
/**
 * check-asset-version.mjs — 共通JS/CSSのキャッシュ版取りこぼしを検出する
 *
 * サーバーは静的資産に max-age=604800（7日）を付ける。共通JS/CSSの中身を変えたのに
 * HTMLの `?v=` を据え置くと、既存端末は最大1週間、修正前のファイルを使い続ける。
 * 2026-08-09 に header-motion.js の修正（PR #76）で実際に発生し、後追いのPR #78で
 * 65ファイルの版番号を上げる羽目になった。運用ルールでは守れないので機械で止める。
 *
 * 検査するのは次の2つ。
 *   1) baseと比べて中身が変わった資産の `?v=` が据え置きになっていないか
 *   2) 同じ資産を参照するHTMLの `?v=` がページ間でばらついていないか（部分適用の検出）
 *
 * 使い方:
 *   node scripts/check-asset-version.mjs              # base は自動判定
 *   node scripts/check-asset-version.mjs origin/main  # base を明示
 *
 * CIでは GITHUB_BASE_REF（PRの向き先）を見る。base を解決できない場合は
 * 「差分の検査はできないが、ばらつきの検査だけは行う」という扱いにする。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const notes = [];

/** HTMLを探す範囲。uploads配下も対象（別CSS系統だが同じキャッシュ問題を持つ） */
const HTML_DIRS = ['.', 'blog', 'uploads'];
/** 版番号を持たない一時ファイル等は対象外 */
const EXCLUDE_HTML = new Set(['404.html']);

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function gitOk(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function listHtml() {
  const out = [];
  for (const dir of HTML_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!name.endsWith('.html')) continue;
      if (EXCLUDE_HTML.has(name)) continue;
      const rel = dir === '.' ? name : `${dir}/${name}`;
      if (rel.startsWith('_backup')) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

const REF = /(?:src|href)="([^"]+?\.(?:js|css))\?v=([^"]+)"/g;

/** HTML群を読み、資産（リポジトリ相対）→ {version → [参照元HTML]} を作る */
function collectRefs(readFile, htmlFiles) {
  const map = new Map();
  for (const rel of htmlFiles) {
    const src = readFile(rel);
    if (src === null) continue;
    for (const m of src.matchAll(REF)) {
      const asset = path.posix.normalize(
        path.posix.join(path.posix.dirname(rel), m[1]),
      );
      if (asset.startsWith('..')) continue; // リポジトリ外は対象外
      if (!map.has(asset)) map.set(asset, new Map());
      const byVer = map.get(asset);
      if (!byVer.has(m[2])) byVer.set(m[2], []);
      byVer.get(m[2]).push(rel);
    }
  }
  return map;
}

function resolveBase(argv) {
  const explicit = argv[2];
  const candidates = [
    explicit,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    'origin/main',
  ].filter(Boolean);
  for (const ref of candidates) {
    if (gitOk(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) return ref;
  }
  return null;
}

// ---- 1) ページ間のばらつき ----
const htmlFiles = listHtml();
const head = collectRefs(
  (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null),
  htmlFiles,
);

for (const [asset, byVer] of [...head].sort()) {
  if (byVer.size <= 1) continue;
  const detail = [...byVer]
    .map(([v, files]) => `${v}（${files.length}ファイル。例: ${files.slice(0, 2).join(', ')}）`)
    .join(' / ');
  errors.push(`${asset}: 参照している版番号がページ間でばらついています → ${detail}`);
}

// ---- 2) 中身が変わったのに版番号が据え置き ----
const base = resolveBase(process.argv);
if (!base) {
  notes.push('base ref を解決できませんでした。版番号のばらつき検査のみ実施しています。');
} else {
  const mergeBase = gitOk(['merge-base', base, 'HEAD'])
    ? git(['merge-base', base, 'HEAD'])
    : base;

  const changed = new Set(
    git(['diff', '--name-only', `${mergeBase}`, '--']).split('\n').filter(Boolean),
  );
  for (const f of git(['diff', '--name-only', `${mergeBase}`, 'HEAD', '--']).split('\n')) {
    if (f) changed.add(f);
  }

  const readBase = (rel) => {
    try {
      return execFileSync('git', ['show', `${mergeBase}:${rel}`], {
        cwd: root,
        encoding: 'utf8',
      });
    } catch {
      return null;
    }
  };
  const baseRefs = collectRefs(readBase, htmlFiles);

  for (const [asset, byVer] of [...head].sort()) {
    if (!changed.has(asset)) continue;
    if (readBase(asset) === null) continue; // 新規資産は対象外
    const headVers = [...byVer.keys()].sort().join(',');
    const baseVers = [...(baseRefs.get(asset)?.keys() ?? [])].sort().join(',');
    if (baseVers === '') continue;
    if (headVers === baseVers) {
      errors.push(
        `${asset}: 中身が変わっているのに \`?v=\` が据え置きです（${headVers}）。` +
          `参照している ${[...byVer.values()].flat().length} ファイルすべてで版番号を上げてください` +
          `（admin-post.html の記事生成テンプレートを含む）。`,
      );
    }
  }
  notes.push(`base=${base}（merge-base ${mergeBase.slice(0, 7)}）と比較しました。`);
}

// ---- 出力 ----
for (const n of notes) console.log(n);
if (errors.length) {
  console.error('\nキャッシュ版チェックで問題が見つかりました。');
  for (const e of errors) console.error(`- ${e}`);
  console.error(
    '\n対処: 変更した資産を参照する全HTMLの `?v=` を新しい値へ一括置換し、' +
      'admin-post.html の生成テンプレートも同期してください。',
  );
  process.exit(1);
}
console.log(
  `キャッシュ版チェック合格: HTML ${htmlFiles.length}ページ、` +
    `版番号付き資産 ${head.size}件、ページ間のばらつき0件。`,
);
