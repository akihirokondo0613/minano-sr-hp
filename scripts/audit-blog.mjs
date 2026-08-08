/**
 * ブログ記事の構成監査（ブラウザ不要・HTMLの静的解析のみ）
 *
 *   node scripts/audit-blog.mjs          … 一覧と要約を表示
 *   node scripts/audit-blog.mjs --check  … 基準を外れた項目があれば exit 1
 *   node scripts/audit-blog.mjs --json   … 機械可読な出力
 *
 * 見るもの（すべて実測値。人の記憶や印象は入れない）:
 *   - この記事のポイント / 目次 / 出典（参考となる公式情報） / あわせて読みたい の有無
 *   - FAQの問数（無いこと自体は異常としない。「よくある質問が実在しない記事に無理に作らない」方針）
 *   - 読了時間の表示と本文量・図解数の整合（550字/分＋図1点0.5分・切上げ・下限2分。差が2分以上なら要修正）
 *   - 目次のアンカーと h2 の id の一致
 *   - 記事間リンクの本数と、他のどの記事からもリンクされていない記事（孤立記事）
 *   - タイトル長（検索結果での省略を避ける32字目安）と description 長（80〜110字）
 *
 * 過去に「<article> の内側だけを検索して、外側にある出典・関連記事を見落とす」という
 * 集計ミスをしたので、走査範囲は用途ごとに明示している（本文＝article内／リンク＝ページ全体）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const asJson = process.argv.includes('--json');

const CHARS_PER_MIN = 550;
const FIGURE_MINUTES = 0.5;
const MIN_READ = 2;
const READ_TOLERANCE = 2; // 丸め差では指摘しない
const TITLE_MAX = 32;
const DESC_MIN = 80;
const DESC_MAX = 110;

const articles = JSON.parse(fs.readFileSync(path.join(root, 'blog/articles.json'), 'utf8'));
const slugs = new Set(articles.map((a) => a.slug));

function stripTags(html) {
  return html
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

function bodyOf(source) {
  const m = source.match(/<article class="post">([\s\S]*?)<\/article>/);
  return m ? m[1] : '';
}

function inspect(article) {
  const rel = `blog/${article.slug}.html`;
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  const body = bodyOf(source);
  if (!body) return { slug: article.slug, errors: ['article.post が見つかりません'] };

  // new_post.py の read モードと同じ式を使い、表示値との判定ずれを防ぐ。
  const chars = stripTags(body).replace(/\s+/g, '').length;
  const figures = (body.match(/<figure\b/g) ?? []).length;
  const shownRead = Number(source.match(/読了 約(\d+)分/)?.[1] ?? 0);
  const wantRead = Math.max(MIN_READ, Math.ceil(chars / CHARS_PER_MIN + figures * FIGURE_MINUTES));

  // 目次とアンカーの整合
  const toc = body.match(/<nav class="post-toc"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const tocAnchors = [...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const headingIds = [...body.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
  const anchorsResolved = tocAnchors.every((id) => headingIds.includes(id));

  // FAQ は2つの書式がある（dl.faq と、賞与記事の ul + b）
  const dl = body.match(/<dl class="faq">([\s\S]*?)<\/dl>/)?.[1] ?? '';
  const ulFaq = body.match(/<h2[^>]*>よくある質問<\/h2>\s*<ul>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const faqCount = dl
    ? (dl.match(/<dt>/g) ?? []).length
    : (ulFaq.match(/<li>/g) ?? []).length;

  // リンクはページ全体を見る（出典・関連記事は </article> の外にある）
  const officialLinks = new Set(
    [...source.matchAll(/https?:\/\/[^"']*?(?:go\.jp|mhlw|nenkin|hellowork|e-gov|kyoukaikenpo|jeed)[^"']*/g)]
      .map((m) => m[0]),
  );
  const siblings = new Set(
    [...source.matchAll(/href="(?:\.\/)?([a-z0-9-]+)\.html"/g)]
      .map((m) => m[1])
      .filter((s) => slugs.has(s) && s !== article.slug),
  );

  return {
    slug: article.slug,
    cat: article.cat,
    date: article.date,
    updated: article.updated,
    chars,
    figures,
    shownRead,
    wantRead,
    readGap: shownRead ? Math.abs(shownRead - wantRead) : 0,
    jsonRead: Number(article.read),
    titleLength: [...article.title].length,
    descLength: [...article.description].length,
    hasPointBox: body.includes('class="point-box"'),
    hasToc: Boolean(toc),
    tocItems: tocAnchors.length,
    headings: (body.match(/<h2/g) ?? []).length,
    anchorsResolved,
    faqCount,
    hasFaqSchema: source.includes('FAQPage'),
    officialLinks: officialLinks.size,
    hasRefs: source.includes('post-refs'),
    hasRelated: source.includes('post-related'),
    outbound: [...siblings],
    errors: [],
  };
}

const rows = articles.map(inspect);

// 被リンク（孤立記事の検出）
const inbound = new Map(rows.map((r) => [r.slug, 0]));
for (const r of rows) {
  for (const to of r.outbound ?? []) inbound.set(to, (inbound.get(to) ?? 0) + 1);
}
for (const r of rows) r.inbound = inbound.get(r.slug) ?? 0;

// 基準を外れたもの
const problems = [];
for (const r of rows) {
  for (const e of r.errors) problems.push(`${r.slug}: ${e}`);
  if (!r.hasPointBox) problems.push(`${r.slug}: この記事のポイントがありません`);
  if (!r.hasRefs || r.officialLinks === 0) problems.push(`${r.slug}: 公式ソースへのリンクがありません`);
  if (!r.hasRelated) problems.push(`${r.slug}: あわせて読みたいがありません`);
  if (r.headings >= 3 && !r.hasToc) problems.push(`${r.slug}: 見出しが${r.headings}個あるのに目次がありません`);
  if (!r.anchorsResolved) problems.push(`${r.slug}: 目次のアンカーに対応する h2 id がありません`);
  if (r.readGap >= READ_TOLERANCE) problems.push(`${r.slug}: 読了時間が本文量・図解数と合いません（表示${r.shownRead}分 / 本文${r.chars}字＋図${r.figures}点＝約${r.wantRead}分）`);
  if (r.jsonRead !== r.shownRead) problems.push(`${r.slug}: 読了時間が articles.json（${r.jsonRead}分）と表示（${r.shownRead}分）で不一致です`);
  if (r.faqCount > 0 && !r.hasFaqSchema) problems.push(`${r.slug}: FAQがあるのに FAQPage 構造化データがありません`);
  if (r.inbound === 0) problems.push(`${r.slug}: 他のどの記事からもリンクされていません（孤立記事）`);
  if (r.titleLength > TITLE_MAX) problems.push(`${r.slug}: タイトルが${r.titleLength}字です（${TITLE_MAX}字目安）`);
  if (r.descLength < DESC_MIN || r.descLength > DESC_MAX) problems.push(`${r.slug}: descriptionが${r.descLength}字です（${DESC_MIN}〜${DESC_MAX}字目安）`);
}

if (asJson) {
  console.log(JSON.stringify({ articles: rows, problems }, null, 2));
} else {
  console.log(`ブログ記事 ${rows.length}本`);
  console.log('slug'.padEnd(44) + '本文  読了 目次 FAQ 出典 被link');
  for (const r of rows) {
    console.log(
      r.slug.padEnd(44) +
        String(r.chars).padStart(5) +
        String(`${r.shownRead}分`).padStart(5) +
        String(r.hasToc ? r.tocItems : '—').padStart(5) +
        String(r.faqCount || '—').padStart(4) +
        String(r.officialLinks).padStart(5) +
        String(r.inbound).padStart(6),
    );
  }
  const faqLess = rows.filter((r) => r.faqCount === 0).map((r) => r.slug);
  console.log('');
  console.log(`目次あり ${rows.filter((r) => r.hasToc).length}/${rows.length}｜FAQあり ${rows.length - faqLess.length}/${rows.length}（計${rows.reduce((s, r) => s + r.faqCount, 0)}問）｜公式ソース ${rows.filter((r) => r.officialLinks > 0).length}/${rows.length}`);
  console.log(`FAQを置いていない記事: ${faqLess.length ? faqLess.join(', ') : 'なし'}`);
  console.log(`  ※FAQが無いこと自体は異常としない（よくある質問が実在しない記事に無理に作らない方針）`);
  console.log(`孤立記事（被リンク0）: ${rows.filter((r) => r.inbound === 0).length}本`);
  console.log('');
  if (problems.length) {
    console.log(`要確認 ${problems.length}件:`);
    for (const p of problems) console.log(`- ${p}`);
  } else {
    console.log('基準を外れた項目はありません。');
  }
}

if (checkOnly && problems.length) process.exit(1);
