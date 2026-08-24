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
import { markPhrases } from './lib/phrase-breaks.mjs';

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
  // 生成した見出しにも文節印（<wbr>）を入れておく。あとから
  // sync-phrase-breaks.mjs に差し込ませると、この生成器の --check が毎回落ちる。
  return markPhrases([
    '<section class="related-posts" aria-labelledby="related-posts-t">',
    '  <div class="related-posts-inner">',
    '    <h2 class="related-posts-t" id="related-posts-t">あわせて読みたい</h2>',
    '    <div class="related-posts-grid">',
    cards,
    '    </div>',
    '  </div>',
    '</section>',
    '',
  ].join('\n')).html;
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

// ── サービスページ → 関連記事 ─────────────────────────────
// 「検出 - インデックス未登録」が35ページ出ていた。記事へはブログ一覧からしか
// 辿れず、サービスページからのリンクは0本で、クロール上の重要度が低いままだった。
// 文脈の合うカテゴリの記事を各サービスページから3本ずつ張り、経路と重要度を上げる。
const SERVICE_MAP = [
  { file: 'uploads/service-shakai-hoken.html', cats: ['hoken', 'kaisei'], label: '社会保険の手続きに関する記事' },
  { file: 'uploads/service-shugyo-kisoku.html', cats: ['shugyo', 'trouble'], label: '就業規則に関する記事' },
  { file: 'uploads/service-joseikin.html', cats: ['joseikin'], label: '助成金に関する記事' },
  { file: 'uploads/service-kyuyo-keisan.html', cats: ['hoken', 'keiei'], label: '給与計算に関する記事' },
  { file: 'uploads/service-romu-sodan.html', cats: ['trouble', 'kaisei'], label: '労務相談に関する記事' },
  { file: 'uploads/service-dx.html', cats: ['system', 'keiei'], label: '労務DXに関する記事' },
];

function pickByCats(cats) {
  const picked = [];
  const seen = new Set();
  for (const pool of [...cats.map((cat) => byNewest.filter((a) => a.cat === cat)), byNewest]) {
    for (const article of pool) {
      if (picked.length >= RELATED_COUNT) break;
      if (seen.has(article.slug)) continue;
      seen.add(article.slug);
      picked.push(article);
    }
  }
  return picked;
}

function renderServiceSection(entry) {
  const cards = pickByCats(entry.cats)
    .map((article) =>
      [
        `      <a href="../blog/${article.slug}.html" class="rp-card">`,
        `        <span class="rp-cat">${escapeHtml(article.catLabel)}</span>`,
        `        <span class="rp-title">${escapeHtml(article.title)}</span>`,
        `        <span class="rp-read">読了 約${article.read}分</span>`,
        '      </a>',
      ].join('\n'),
    )
    .join('\n');
  // 生成した見出しにも文節印（<wbr>）を入れておく。あとから
  // sync-phrase-breaks.mjs に差し込ませると、この生成器の --check が毎回落ちる。
  return markPhrases([
    '  <section class="related-posts" aria-labelledby="related-posts-t">',
    '    <div class="related-posts-inner">',
    `      <h2 class="related-posts-t" id="related-posts-t">${escapeHtml(entry.label)}</h2>`,
    '      <div class="related-posts-grid">',
    cards,
    '      </div>',
    '    </div>',
    '  </section>',
    '  ',
  ].join('\n')).html;
}

for (const entry of SERVICE_MAP) {
  const file = path.join(root, entry.file);
  if (!fs.existsSync(file)) throw new Error(`${entry.file}: ページがありません`);
  const source = fs.readFileSync(file, 'utf8');
  const anchor = '<section class="final-cta">';
  if (!source.includes(anchor)) throw new Error(`${entry.file}: final-cta がありません`);

  // 既存ブロックは字下げごと、全部剥がしてから1つだけ入れ直す。
  // 以前は先頭2スペースを字下げに決め打ちしていたので、隣の生成器が字下げを変えると
  // 剥がれないまま新しいブロックが足され、黙って2つになった（#138 で5ページに発生）。
  const stripped = source.replace(/[ \t]*<section class="related-posts"[\s\S]*?<\/section>\n[ \t]*/g, '');
  const next = stripped.replace(anchor, `${renderServiceSection(entry)}${anchor}`);
  // 剥がす正規表現は字下げまで含めて一致させている。ページ側の字下げが変わると
  // 既存ブロックが剥がれないまま新しいブロックが足され、黙って2つになる。
  // 実際に service-dx.html でこれが起きたので、増えていたら止める。
  const sections = (next.match(/<section class="related-posts"/g) || []).length;
  if (sections !== 1) {
    throw new Error(`${entry.file}: 関連記事のセクションが${sections}個あります。字下げが変わって既存ブロックを剥がせていない可能性があります`);
  }
  if (next === source) continue;
  changed += 1;
  if (!checkOnly) {
    fs.writeFileSync(file, next);
    console.log(`更新: ${entry.file}`);
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
