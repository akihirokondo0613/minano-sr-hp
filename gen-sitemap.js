#!/usr/bin/env node
/* ============================================================
   gen-sitemap.js — sitemap.xml をファイルの最終更新日から自動生成

   使い方（このフォルダで）:
     node gen-sitemap.js          … sitemap.xml を書き出す
     node gen-sitemap.js --check  … 書き出さず、現状との差分だけ表示（CI向け）

   なぜこれが要るか:
     lastmod を手で書くと「編集したのに書き忘れる」で簡単にズレる。
     Google は lastmod が不正確だとサイト全体の lastmod を無視し始める。
     → Git管理中の確定済みファイルは最終コミット日、未コミットの変更や
       Git管理外の環境では実mtimeを使い、編集＝lastmod更新を構造的に一致させる。

   運用フロー:
     ・記事公開（admin-post.html の手順A）や any 編集のあと、公開直前に一度実行。
     ・ドメインを決めたら下の DOMAIN を1行変えるだけ（HTML側は別途 minano-sr.com を一括置換）。
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── 設定（ここだけ触れば良い） ─────────────────────────────
const DOMAIN = 'https://minano-sr.com';   // ★ドメイン確定後にここを差し替え（末尾スラッシュなし）

// 公開対象から除外するファイル（管理・開発・バックアップ・エラーページ）
const EXCLUDE = [
  /^_backup/, /^node_modules/, /(^|\/)admin-post\.html$/, /(^|\/)icon-catalog\.html$/,
  /(^|\/)404\.html$/, /(^|\/)motion-lab\.html$/, /(^|\/)email-preview\.html$/, /(^|\/)_wcheck\.html$/,
];

// スキャンするディレクトリ（再帰はせず、この3つの直下 .html だけ）
const DIRS = ['.', 'uploads', 'blog'];

// priority / changefreq のルール（先にマッチしたものを採用）
const RULES = [
  { test: p => p === 'index.html',            loc: '',                     changefreq: 'monthly', priority: '1.0' },
  { test: p => p === 'services.html',         changefreq: 'monthly', priority: '0.9' },
  { test: p => p === 'pricing.html',          changefreq: 'monthly', priority: '0.9' },
  { test: p => p === 'support.html',          changefreq: 'monthly', priority: '0.8' },
  { test: p => p === 'about.html',            changefreq: 'yearly',  priority: '0.7' },
  { test: p => p === 'blog.html',             changefreq: 'weekly',  priority: '0.8' },
  { test: p => p === 'joseikin.html',         changefreq: 'monthly', priority: '0.8' },
  { test: p => p === 'portal.html',           changefreq: 'monthly', priority: '0.6' },
  { test: p => p === 'recruit.html',          changefreq: 'monthly', priority: '0.6' },
  { test: p => p === 'infographic.html',      changefreq: 'yearly',  priority: '0.5' },
  { test: p => p === 'privacy-policy.html',   changefreq: 'yearly',  priority: '0.3' },
  { test: p => p === 'uploads/contact.html',  changefreq: 'monthly', priority: '0.9' },
  { test: p => /^uploads\/service-/.test(p),  changefreq: 'monthly', priority: '0.7' },
  { test: p => /^uploads\/case-/.test(p),     changefreq: 'yearly',  priority: '0.5' },
  { test: p => /^blog\//.test(p),             changefreq: 'monthly', priority: '0.6' },
  { test: () => true,                         changefreq: 'monthly', priority: '0.5' }, // fallback
];
// ────────────────────────────────────────────────────────────

function excluded(rel) { return EXCLUDE.some(rx => rx.test(rel)); }
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// 共通資産の `?v=` を上げると全ページのHTMLが同時に変わるため、本文を一切直していない
// ページまで「その日に更新された」ことになる。lastmodが実態とずれるとGoogleはサイト全体の
// lastmodを信用しなくなるので、キャッシュ版だけが変わったコミットは更新と見なさず親へ遡る。
const VERSION_ONLY = /^[+-].*\?v=\d{8}-[A-Za-z0-9]+/;

function isVersionOnlyCommit(rel, sha) {
  const diff = gitOutput(['diff', '--unified=0', `${sha}^`, sha, '--', rel]);
  if (!diff) return false;
  const changed = diff.split('\n').filter((line) => (
    /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line)
  ));
  if (!changed.length) return false;
  return changed.every((line) => VERSION_ONLY.test(line));
}

function lastModified(rel, stat) {
  // 編集中のファイルは、コミット前でも実行日が反映されるようmtimeを優先する。
  if (gitOutput(['status', '--porcelain', '--', rel])) return ymd(stat.mtime);

  // CIではcheckoutのmtimeが全ファイル同一になるため、確定済みファイルはGit履歴を正本にする。
  // 直近コミットがキャッシュ版の付け替えだけなら、本文が変わった直近のコミットまで遡る。
  const shas = gitOutput(['log', '-12', '--format=%H', '--', rel]).split('\n').filter(Boolean);
  for (const sha of shas) {
    if (isVersionOnlyCommit(rel, sha)) continue;
    const date = gitOutput(['log', '-1', '--format=%cs', sha]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    break;
  }

  const committed = gitOutput(['log', '-1', '--format=%cs', '--', rel]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(committed)) return committed;

  // Git管理外で配布されたフォルダでも従来どおり利用できる。
  return ymd(stat.mtime);
}

function collect() {
  const rows = [];
  for (const dir of DIRS) {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of names) {
      if (!name.endsWith('.html')) continue;
      const rel = dir === '.' ? name : dir + '/' + name;
      if (excluded(rel)) continue;
      const st = fs.statSync(rel);
      const rule = RULES.find(r => r.test(rel));
      const locPath = rule.loc !== undefined ? rule.loc : rel;
      rows.push({ rel, url: DOMAIN + '/' + locPath, lastmod: lastModified(rel, st), changefreq: rule.changefreq, priority: rule.priority });
    }
  }
  // 並び順：トップ→主要→uploads→blog（priority降順→URL）で安定化
  rows.sort((a, b) => (Number(b.priority) - Number(a.priority)) || a.url.localeCompare(b.url));
  return rows;
}

function build(rows) {
  const body = rows.map(r =>
`  <url>
    <loc>${r.url}</loc>
    <lastmod>${r.lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

const rows = collect();
const xml = build(rows);
const check = process.argv.includes('--check');

if (check) {
  let cur = '';
  try { cur = fs.readFileSync('sitemap.xml', 'utf8'); } catch (e) {}
  if (cur.trim() === xml.trim()) {
    console.log('✓ sitemap.xml は最新です（' + rows.length + ' URL）');
    process.exit(0);
  } else {
    console.log('✗ sitemap.xml が古い可能性があります。`node gen-sitemap.js` で再生成してください。');
    process.exit(1);
  }
} else {
  fs.writeFileSync('sitemap.xml', xml);
  console.log('✓ sitemap.xml を生成しました（' + rows.length + ' URL / ドメイン: ' + DOMAIN + '）');
  console.log('  最終更新（新しい順・上位5件）:');
  rows.slice().sort((a, b) => b.lastmod.localeCompare(a.lastmod)).slice(0, 5)
    .forEach(r => console.log('   ' + r.lastmod + '  ' + r.rel));
}
