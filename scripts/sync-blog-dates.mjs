import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const articles = JSON.parse(fs.readFileSync(path.join(root, 'blog/articles.json'), 'utf8'));
let changed = 0;

function formatDate(value) {
  return value.replaceAll('-', '.');
}

function write(relativePath, source) {
  const file = path.join(root, relativePath);
  const current = fs.readFileSync(file, 'utf8');
  if (current === source) return;
  changed += 1;
  console.log(`${checkOnly ? '要更新' : '更新'}: ${relativePath}`);
  if (!checkOnly) fs.writeFileSync(file, source, 'utf8');
}

function replaceArticleSchema(source, article, relativePath) {
  let found = 0;
  const result = source.replace(
    /(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    (block, open, json, close) => {
      let schema;
      try {
        schema = JSON.parse(json);
      } catch {
        return block;
      }
      if (schema?.['@type'] !== 'Article') return block;
      schema.datePublished = article.date;
      schema.dateModified = article.updated;
      found += 1;
      return `${open}${JSON.stringify(schema)}${close}`;
    },
  );
  if (found !== 1) {
    throw new Error(`${relativePath}: Article JSON-LDが1件ではありません（${found}件）`);
  }
  return result;
}

function postMeta(article) {
  const values = [
    `<time datetime="${article.date}">公開 ${formatDate(article.date)}</time>`,
  ];
  if (article.updated !== article.date) {
    values.push(`<time datetime="${article.updated}">更新 ${formatDate(article.updated)}</time>`);
  }
  values.push(`<span>読了 約${article.read}分</span>`);
  return [
    '    <div class="post-meta">',
    ...values.flatMap((value, index) => [
      ...(index ? ['      <span class="dot" aria-hidden="true">・</span>'] : []),
      `      ${value}`,
    ]),
    '    </div>',
  ].join('\n');
}

for (const article of articles) {
  const relativePath = `blog/${article.slug}.html`;
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}: 記事HTMLがありません`);

  let source = fs.readFileSync(file, 'utf8');
  source = source
    .replace(
      /<meta property=["']article:published_time["'] content=["'][^"']+["']>/i,
      `<meta property="article:published_time" content="${article.date}">`,
    )
    .replace(
      /<meta property=["']article:modified_time["'] content=["'][^"']+["']>/i,
      `<meta property="article:modified_time" content="${article.updated}">`,
    )
    .replace(/    <div class="post-meta">[\s\S]*?    <\/div>/, postMeta(article));
  source = replaceArticleSchema(source, article, relativePath);
  write(relativePath, source);
}

let listing = fs.readFileSync(path.join(root, 'blog.html'), 'utf8');
for (const article of articles) {
  const slug = article.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = new RegExp(
    `(<a href="blog/${slug}\\.html" class="art-row"[^>]*>[\\s\\S]*?<div class="art-thumb">[\\s\\S]*?<\\/div>\\n)(?:\\s*<time class="art-date"[^>]*>[^<]*<\\/time>\\n)?`,
  );
  if (!row.test(listing)) throw new Error(`blog.html: ${article.slug}の記事行がありません`);
  listing = listing.replace(
    row,
    `$1        <time class="art-date" datetime="${article.date}">${formatDate(article.date)}</time>\n`,
  );
}
write('blog.html', listing);

if (checkOnly && changed) {
  console.error(`ブログ日付の同期が必要です（${changed}ファイル）`);
  process.exitCode = 1;
} else {
  console.log(checkOnly ? 'ブログ日付は同期済みです' : `ブログ日付を同期しました（${changed}ファイル）`);
}
