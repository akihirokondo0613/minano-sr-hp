// 記事末尾の「あわせて読みたい」を articles.json から生成して各記事へ埋め込む。
//
// 記事どうしが本文中でほとんどつながっておらず、42本の記事へはブログ一覧からの
// 1経路しかない状態だった。クロール経路と回遊の両方を増やすため、静的HTMLとして
// 出力する（JSでの後差しにしない）。
//
// 使い方:
//   node scripts/sync-related-posts.mjs           反映する
//   node scripts/sync-related-posts.mjs --check   差分があれば異常終了（CI用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const RELATED_COUNT = 3;

const raw = JSON.parse(fs.readFileSync(path.join(root, 'blog/articles.json'), 'utf8'));
const articles = Array.isArray(raw) ? raw : raw.articles;
if (!Array.isArray(articles) || articles.length === 0) {
  throw new Error('blog/articles.json から記事一覧を読めません');
}

// 新しい順。日付は画面には出さないが、関連記事の並び順には使う。
const byNewest = [...articles].sort((a, b) => String(b.date).localeCompare(String(a.date)));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 同じカテゴリを優先し、足りなければ新しい順で補う。
// system のように2本しかないカテゴリがあるため、必ず補完が要る。
function pickRelated(current) {
  const picked = [];
  const seen = new Set([current.slug]);
  for (const pool of [byNewest.filter((a) => a.cat === current.cat), byNewest]) {
    for (const article of pool) {
      if (picked.length >= RELATED_COUNT) break;
      if (seen.has(article.slug)) continue;
      seen.add(article.slug);
      picked.push(article);
    }
  }
  return picked;
}

function renderSection(current) {
  const related = pickRelated(current);
  if (related.length === 0) return '';
  const cards = related
    .map((article) =>
      [
        `      <a href="${article.slug}.html" class="rp-card">`,
        `        <span class="rp-cat">${escapeHtml(article.catLabel)}</span>`,
        `        <span class="rp-title">${escapeHtml(article.title)}</span>`,
        `        <span class="rp-read">読了 約${article.read}分</span>`,
        '      </a>',
      ].join('\n'),
    )
    .join('\n');
  return [
    '<section class="related-posts" aria-labelledby="related-posts-t">',
    '  <div class="related-posts-inner">',
    '    <h2 class="related-posts-t" id="related-posts-t">あわせて読みたい</h2>',
    '    <div class="related-posts-grid">',
    cards,
    '    </div>',
    '  </div>',
    '</section>',
    '',
  ].join('\n');
}

let changed = 0;
for (const article of articles) {
  const relativePath = `blog/${article.slug}.html`;
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}: 記事HTMLがありません`);

  const source = fs.readFileSync(file, 'utf8');
  const anchor = '<section class="next-steps">';
  if (!source.includes(anchor)) throw new Error(`${relativePath}: next-steps セクションがありません`);

  // 既存の関連記事ブロックを取り除いてから、次のステップの直前へ入れ直す。
  const stripped = source.replace(
    /<section class="related-posts"[\s\S]*?<\/section>\n/,
    '',
  );
  const next = stripped.replace(anchor, `${renderSection(article)}${anchor}`);

  if (next === source) continue;
  changed += 1;
  if (!checkOnly) {
    fs.writeFileSync(file, next);
    console.log(`更新: ${relativePath}`);
  }
}

if (checkOnly && changed) {
  console.error(`関連記事の同期が必要です（${changed}ファイル）`);
  process.exit(1);
}
console.log(
  checkOnly
    ? '関連記事は同期済みです'
    : `関連記事を同期しました（${changed}ファイル更新 / 全${articles.length}件）`,
);
