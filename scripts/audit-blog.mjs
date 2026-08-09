/**
 * ブログ記事の構成監査（ブラウザ不要・HTMLの静的解析のみ）
 *
 *   node scripts/audit-blog.mjs          … 一覧と要約を表示
 *   node scripts/audit-blog.mjs --check  … 基準を外れた項目があれば exit 1
 *   node scripts/audit-blog.mjs --json   … 機械可読な出力
 *
 * 見るもの（すべて実測値。人の記憶や印象は入れない）:
 *   - この記事のポイント / 目次 / 出典（参考となる公式情報） / あわせて読みたい の有無
 *   - reader/problem/outcome と記事上部の「この記事が役立つ方」の一致
 *   - HTML/CSS図解、判断が難しいところ、読後の3手の有無
 *   - FAQの問数（無いこと自体は異常としない。「よくある質問が実在しない記事に無理に作らない」方針）
 *   - 読了時間の表示と本文量・SVG図解数の整合（550字/分＋SVG図1点0.5分・切上げ・下限2分。差が2分以上なら要修正）
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
const SVG_FIGURE_MINUTES = 0.5;
const MIN_READ = 2;
const READ_TOLERANCE = 2; // 丸め差では指摘しない
const TITLE_MAX = 32;
const DESC_MIN = 80;
const DESC_MAX = 110;
const VISUAL_MIN = 3;
const VISUAL_MAX = 7;
const HARD_ITEM_MIN = 3;
const HARD_ITEM_MAX = 5;
const BODY_CHARS_MAX = 7000;
const HEADING_MAX = 12;

const articles = JSON.parse(fs.readFileSync(path.join(root, 'blog/articles.json'), 'utf8'));
const slugs = new Set(articles.map((a) => a.slug));

function stripTags(html) {
  return html
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

function textOf(html) {
  return html
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function elementsWithClass(html, className, tagName = '[a-z][a-z0-9-]*') {
  const expression = new RegExp(
    `<(${tagName})\\b[^>]*class=["']([^"']*)["'][^>]*>`,
    'gi',
  );
  return [...html.matchAll(expression)]
    .filter((match) => match[2].split(/\s+/).includes(className));
}

function elementBlock(html, open) {
  const tag = open[1];
  const token = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}>`, 'gi');
  token.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let match = token.exec(html); match; match = token.exec(html)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(open.index, token.lastIndex);
  }
  return '';
}

function firstBlockWithClass(html, className) {
  const open = elementsWithClass(html, className)[0];
  return open ? elementBlock(html, open) : '';
}

function bodyOf(source) {
  const opens = elementsWithClass(source, 'post', 'article');
  const closes = [...source.matchAll(/<\/article>/gi)];
  if (opens.length !== 1 || closes.length !== 1 || closes[0].index < opens[0].index) {
    return {
      body: '',
      error: `article.post構造が不正です（開始${opens.length}件・終了${closes.length}件）`,
    };
  }
  return {
    body: source.slice(opens[0].index + opens[0][0].length, closes[0].index),
    error: '',
  };
}

function judgmentScope(body) {
  const headings = [...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const target = headings.find((match) => /判断/.test(textOf(match[1])));
  if (!target) return '';
  const next = headings.find((match) => match.index > target.index);
  return body.slice(target.index, next?.index ?? body.length);
}

function readerValues(body) {
  const block = firstBlockWithClass(body, 'post-reader');
  if (!block || !/\bdata-reader-map(?:\s|=|>)/i.test(block.match(/^<[^>]+>/)?.[0] ?? '')) {
    return { block, values: {}, rowCount: 0 };
  }
  const rows = [];
  for (const start of elementsWithClass(block, 'post-reader-item')) {
    const row = elementBlock(block, start);
    const labelBlock = firstBlockWithClass(row, 'post-reader-label');
    const label = textOf(labelBlock);
    const value = textOf(row.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '');
    rows.push({ label, value });
  }
  const values = {};
  for (const row of rows) {
    if (row.label === '対象') values.reader = row.value;
    if (row.label === '困りごと' || row.label === 'いま困っていること') values.problem = row.value;
    if (row.label === '読後にできること') values.outcome = row.value;
  }
  return { block, values, rowCount: rows.length };
}

function hardDecision(body) {
  const standard = firstBlockWithClass(body, 'post-hard');
  if (standard) {
    const items = elementsWithClass(standard, 'post-hard-item');
    const complete = items.filter((item) => {
      const block = elementBlock(standard, item);
      return /<b\b[^>]*>[\s\S]*?<\/b>/i.test(block)
        && /<span\b[^>]*>[\s\S]*?<\/span>/i.test(block);
    }).length;
    return { count: items.length, complete, scope: standard };
  }

  const scope = judgmentScope(body);
  for (const listClass of ['fig-hard', 'sb-hard']) {
    const list = firstBlockWithClass(scope, listClass);
    if (!list) continue;
    const items = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
    const complete = items.filter((item) => /<(?:span|em|p)\b[^>]*>[\s\S]*?<\/(?:span|em|p)>/i.test(item[1])).length;
    return { count: items.length, complete, scope };
  }
  const cards = elementsWithClass(scope, 'sb-card');
  const complete = cards.filter((item) => {
    const block = elementBlock(scope, item);
    return /<(?:h3|b)\b[^>]*>[\s\S]*?<\/(?:h3|b)>/i.test(block)
      && /<(?:p|span|em)\b[^>]*>[\s\S]*?<\/(?:p|span|em)>/i.test(block);
  }).length;
  return { count: cards.length, complete, scope };
}

function slugFromHref(href, currentSlug) {
  try {
    const url = new URL(href, `https://minano-sr.com/blog/${currentSlug}.html`);
    if (url.origin !== 'https://minano-sr.com') return '';
    return url.pathname.match(/^\/blog\/([a-z0-9-]+)\.html$/)?.[1] ?? '';
  } catch {
    return '';
  }
}

function inspect(article) {
  const rel = `blog/${article.slug}.html`;
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  const articleBody = bodyOf(source);
  const body = articleBody.body;
  if (!body) return { slug: article.slug, errors: [articleBody.error || 'article.post が見つかりません'] };

  // new_post.py の read モードと同じ式を使い、表示値との判定ずれを防ぐ。
  // HTML/CSS図解は中の文字がcharsへ入るため、追加時間は文字が除去されるSVGだけにする。
  const chars = stripTags(body).replace(/\s+/g, '').length;
  const figures = (body.match(/<svg\b/g) ?? []).length;
  const hard = hardDecision(body);
  const standardVisuals = elementsWithClass(body, 'post-viz', 'figure')
    .filter((match) => /\bdata-visual=/.test(match[0])).length;
  const legacyHtmlVisuals = ['sb-fig', 'fig-figure']
    .reduce((sum, className) => sum + elementsWithClass(body, className).length, 0);
  const hardLegacyVisuals = ['sb-fig', 'fig-figure']
    .reduce((sum, className) => sum + elementsWithClass(hard.scope, className).length, 0);
  const htmlVisuals = standardVisuals + legacyHtmlVisuals - hardLegacyVisuals;
  const shownRead = Number(source.match(/読了 約(\d+)分/)?.[1] ?? 0);
  const wantRead = Math.max(MIN_READ, Math.ceil(chars / CHARS_PER_MIN + figures * SVG_FIGURE_MINUTES));

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

  // リンクはページ全体を見る（出典・関連記事は </article> の外にある）。
  // 関連記事はsectionの存在だけでなく、実在する記事リンクが入っていることを確認する。
  const officialLinks = new Set(
    [...source.matchAll(/https?:\/\/[^"']*?(?:go\.jp|mhlw|nenkin|hellowork|e-gov|kyoukaikenpo|jeed)[^"']*/g)]
      .map((m) => m[0]),
  );
  const siblings = new Set(
    [...source.matchAll(/href="(?:\.\/)?([a-z0-9-]+)\.html"/g)]
      .map((m) => m[1])
      .filter((s) => slugs.has(s) && s !== article.slug),
  );
  const relatedBlock = source.match(/<section class="post-related"[\s\S]*?<\/section>/)?.[0] ?? '';
  const relatedLinks = new Set(
    [...relatedBlock.matchAll(/href="(?:\.\/)?([a-z0-9-]+)\.html"/g)]
      .map((m) => m[1])
      .filter((s) => slugs.has(s) && s !== article.slug),
  );
  const relatedRaw = [...relatedBlock.matchAll(/href=["']([^"']+)["']/g)]
    .map((match) => slugFromHref(match[1], article.slug))
    .filter(Boolean);
  const expectedCta = {
    joseikin: 'service-joseikin.html',
    'shakai-hoken': 'service-shakai-hoken.html',
    shugyo: 'service-shugyo-kisoku.html',
    kyuyo: 'service-kyuyo-keisan.html',
    romu: 'service-romu-sodan.html',
    dx: 'service-dx.html',
  }[article.service];
  const nextSteps = source.match(/<section class="next-steps"[\s\S]*?<\/section>/)?.[0] ?? '';
  const nextStepHrefs = [...nextSteps.matchAll(/href=["']([^"']+)["']/g)].map((match) => match[1]);
  const reader = readerValues(body);
  const action = firstBlockWithClass(body, 'post-action');
  const actionItems = (action.match(/<li\b[^>]*>/g) ?? []).length;

  return {
    slug: article.slug,
    cat: article.cat,
    date: article.date,
    updated: article.updated,
    chars,
    figures,
    htmlVisuals,
    shownRead,
    wantRead,
    readGap: shownRead ? Math.abs(shownRead - wantRead) : 0,
    jsonRead: Number(article.read),
    titleLength: [...article.title].length,
    descLength: [...article.description].length,
    hasPointBox: body.includes('class="point-box"'),
    hasReaderMap: reader.rowCount === 3
      && ['reader', 'problem', 'outcome'].every((key) => article[key] && reader.values[key] === article[key]),
    hasReaderMetadata: ['reader', 'problem', 'outcome'].every((key) => typeof article[key] === 'string' && article[key].trim()),
    hardItems: hard.count,
    hardCompleteItems: hard.complete,
    hasHardDecision: hard.count >= HARD_ITEM_MIN && hard.count <= HARD_ITEM_MAX && hard.complete === hard.count,
    actionItems,
    hasPostAction: actionItems === 3,
    hasBlogArticleCss: source.includes('../blog-article.css?v='),
    hasBlogNavMode: /<body\b[^>]*\bdata-nav=["']B["'][^>]*>/i.test(source),
    hasToc: Boolean(toc),
    tocItems: tocAnchors.length,
    headings: (body.match(/<h2/g) ?? []).length,
    anchorsResolved,
    faqCount,
    hasFaqSchema: /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*"FAQPage"/i.test(source),
    officialLinks: officialLinks.size,
    hasRefs: source.includes('post-refs'),
    hasRelated: relatedLinks.size > 0,
    hasSelfRelated: relatedRaw.includes(article.slug),
    expectedCta,
    hasServiceMetadata: Boolean(expectedCta),
    ctaMatches: Boolean(expectedCta) && nextStepHrefs.some((href) => href.endsWith(`/uploads/${expectedCta}`) || href === `../uploads/${expectedCta}`),
    hasDraftMarkers: /class="draft-(?:reader|placeholder)"|<!--\s*TODO|\bTODO\b/.test(source),
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
  if (!r.hasReaderMetadata) problems.push(`${r.slug}: articles.jsonのreader/problem/outcomeが不足しています`);
  if (!r.hasReaderMap) problems.push(`${r.slug}: 記事上部の対象・困りごと・読後の行動がarticles.jsonと一致しません`);
  if (r.htmlVisuals < VISUAL_MIN || r.htmlVisuals > VISUAL_MAX) problems.push(`${r.slug}: 判断難所を除くHTML/CSS図解が${r.htmlVisuals}点です（${VISUAL_MIN}〜${VISUAL_MAX}点）`);
  if (r.figures > 0) problems.push(`${r.slug}: 本文に縮小されるSVG図解が${r.figures}点残っています`);
  if (!r.hasHardDecision) problems.push(`${r.slug}: 判断難所が3〜5項目で結果付きになっていません（項目${r.hardItems ?? 0}／結果${r.hardCompleteItems ?? 0}）`);
  if (!r.hasPostAction) problems.push(`${r.slug}: 読後にまず行う行動が3項目ではありません（${r.actionItems ?? 0}項目）`);
  if (!r.hasBlogArticleCss) problems.push(`${r.slug}: blog-article.cssを読み込んでいません`);
  if (!r.hasBlogNavMode) problems.push(`${r.slug}: bodyのdata-navがBではありません（ブログナビ下線が二重になる再発条件）`);
  if (!r.hasRefs || r.officialLinks === 0) problems.push(`${r.slug}: 公式ソースへのリンクがありません`);
  if (!r.hasRelated) problems.push(`${r.slug}: あわせて読みたいがありません`);
  if (r.hasSelfRelated) problems.push(`${r.slug}: あわせて読みたいに自記事が入っています`);
  if (!r.hasServiceMetadata) problems.push(`${r.slug}: articles.jsonのserviceが不足・不正です`);
  if (!r.ctaMatches) problems.push(`${r.slug}: articles.jsonのserviceと記事末CTAが一致しません（期待 ${r.expectedCta ?? '未設定'}）`);
  if (r.hasDraftMarkers) problems.push(`${r.slug}: 下書き用のreader・placeholder・TODOが残っています`);
  if (r.headings >= 3 && !r.hasToc) problems.push(`${r.slug}: 見出しが${r.headings}個あるのに目次がありません`);
  if (!r.anchorsResolved) problems.push(`${r.slug}: 目次のアンカーに対応する h2 id がありません`);
  if (r.readGap >= READ_TOLERANCE) problems.push(`${r.slug}: 読了時間が本文量・SVG図解数と合いません（表示${r.shownRead}分 / 本文${r.chars}字＋SVG図${r.figures}点＝約${r.wantRead}分）`);
  if (r.jsonRead !== r.shownRead) problems.push(`${r.slug}: 読了時間が articles.json（${r.jsonRead}分）と表示（${r.shownRead}分）で不一致です`);
  if (r.faqCount > 0 && !r.hasFaqSchema) problems.push(`${r.slug}: FAQがあるのに FAQPage 構造化データがありません`);
  if (r.inbound === 0) problems.push(`${r.slug}: 他のどの記事からもリンクされていません（孤立記事）`);
  if (r.chars > BODY_CHARS_MAX) problems.push(`${r.slug}: 本文が${r.chars}字です（不用意な長文化を防ぐ上限${BODY_CHARS_MAX}字）`);
  if (r.headings > HEADING_MAX) problems.push(`${r.slug}: h2が${r.headings}個です（上限${HEADING_MAX}個）`);
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
