#!/usr/bin/env node

/**
 * ブログ本文に出てくる制度名を、その制度の解説ページへ結ぶ。
 *
 *   node scripts/sync-inline-links.mjs           生成
 *   node scripts/sync-inline-links.mjs --check    差分があれば失敗（公開前チェック用）
 *
 * なぜ要るのか:
 *   記事43本のうち41本は、本文の段落から他ページへのリンクが1本も無かった。
 *   記事末の「あわせて読みたい」とCTAはあるが、文脈の中のリンクが無いと
 *   記事どうし・記事と解説ページが繋がらず、せっかくの本数が生きない。
 *
 * なぜ実行時（terms.js）ではなくビルド時か:
 *   用語ツールチップと違い、これはリンク。HTMLに入っていないと辿ってもらえない。
 *
 * 決めごと:
 *   - 制度名の正本は data/joseikin-guides.json。名前に「・」があれば別名として分ける。
 *   - 1記事につき、1制度1回・最大3制度まで。リンクだらけにしない。
 *   - 見出し・既存のリンク・用語マーカーの中には入れない。
 *   - 目印は class="jl"。生成器はこれだけを剥がして入れ直すので、手で置いたリンクは残る。
 *   - 文節印（<wbr>）を挟んだ語にも当たるよう、1文字ずつ照合する。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

/** 1記事に入れるリンクの上限 */
const MAX_PER_PAGE = 3;
/**
 * この中の文字は触らない。
 * 表のセルを外すのは、文節改行と同じ理由（狭い枠に入れても読者の役に立たない）。
 * 記事冒頭の「この記事が役立つ方」などは本文ではなく索引なので外す。
 */
const SKIP_TAGS = new Set(['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'script', 'style', 'template', 'svg', 'code', 'pre', 'td', 'th', 'figcaption']);
const SKIP_CLASSES = new Set([
  'term', 'nw', 'nobr',
  'post-reader', 'post-toc', 'post-meta', 'related-posts', 'point-box',
]);
/**
 * 語の前後がこれらなら、より長い語の一部とみなして結ばない。
 * 「モデル就業規則」の中の「就業規則」、「カスタマーハラスメント」の中の
 * 「ハラスメント」、「ハラスメント相談窓口」の中の「ハラスメント」を拾わないため。
 */
const COMPOUND = /[0-9A-Za-z\u3005\u3006\u3007\u4E00-\u9FFF\u3400-\u4DBF\u30A1-\u30FA\u30FC]/;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function classesOf(attrs) {
  const m = attrs.match(/\bclass\s*=\s*"([^"]*)"/i) || attrs.match(/\bclass\s*=\s*'([^']*)'/i);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

/**
 * 語 → リンク先。
 *   制度名は data/joseikin-guides.json から自動（名前に「・」があれば別名に分ける）。
 *   サービス語は data/inline-links.json。
 *   用語ツールチップ（terms.js）の語は外す。同じ語に印とリンクを重ねない。
 */
async function buildTerms() {
  const guides = JSON.parse(await readFile(path.join(root, 'data', 'joseikin-guides.json'), 'utf8')).guides;
  const check = JSON.parse(await readFile(path.join(root, 'data', 'joseikin-check.json'), 'utf8'));
  const extraTerms = JSON.parse(await readFile(path.join(root, 'data', 'inline-links.json'), 'utf8')).terms ?? [];
  const termsSource = await readFile(path.join(root, 'terms.js'), 'utf8');
  const tooltip = new Set([...termsSource.matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1]));
  if (!tooltip.size) throw new Error('terms.js から用語キーを取り出せませんでした');

  const terms = [];
  for (const guide of guides) {
    for (const name of guide.name.split('・')) {
      terms.push({ key: guide.slug, text: name, href: `../uploads/joseikin-${guide.slug}.html` });
    }
  }
  for (const [key, extra] of Object.entries(check.extra ?? {})) {
    const anchor = check.anchors?.[key];
    if (!anchor) continue;
    terms.push({ key, text: extra.name, href: `../joseikin.html#${anchor}` });
  }
  for (const item of extraTerms) {
    if (!item?.text || !item?.href) throw new Error('data/inline-links.json: text と href が要ります');
    terms.push({ key: item.href, text: item.text, href: `../${item.href}` });
  }
  const dropped = terms.filter((t) => tooltip.has(t.text)).map((t) => t.text);
  if (dropped.length) console.log(`用語ツールチップと重なるので外しました: ${dropped.join('・')}`);
  const kept = terms.filter((t) => !tooltip.has(t.text));
  // 長い名前から先に当てる（「トライアル雇用助成金」が「雇用助成金」に食われないように）
  kept.sort((a, b) => b.text.length - a.text.length);
  if (!kept.length) throw new Error('リンクする語の辞書が空です');
  return kept;
}

/**
 * 記事本文をたどって「表示される文字」と、その位置・入れてよいかを並べる。
 * @returns {{text: string, at: number[], ok: boolean[]}}
 */
function scan(html, from, to) {
  const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  tagRe.lastIndex = from;
  const text = [];
  const at = [];
  const ok = [];
  const stack = [];
  let cursor = from;
  const flush = (end) => {
    for (let i = cursor; i < end; i += 1) {
      const ch = html[i];
      if (ch === '&') {           // 実体参照はまたがせない
        const semi = html.indexOf(';', i);
        if (semi > 0 && semi - i <= 10) { i = semi; continue; }
      }
      text.push(ch);
      at.push(i);
      ok.push(stack.length === 0);
    }
  };
  let m;
  while ((m = tagRe.exec(html)) !== null && m.index < to) {
    flush(m.index);
    cursor = m.index + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    const [, slash, rawName, attrs, selfClose] = m;
    const name = rawName.toLowerCase();
    const skip = SKIP_TAGS.has(name) || classesOf(attrs).some((c) => SKIP_CLASSES.has(c));
    if (!slash) {
      if (VOID_TAGS.has(name) || selfClose) continue;
      if (skip) stack.push(name);
      continue;
    }
    const idx = stack.lastIndexOf(name);
    if (idx >= 0) stack.length = idx;
  }
  flush(to);
  return { text: text.join(''), at, ok };
}

const files = readdirSync(path.join(root, 'blog'))
  .filter((n) => n.endsWith('.html')).sort().map((n) => `blog/${n}`);
const terms = await buildTerms();

const changed = [];
let added = 0;
for (const rel of files) {
  const full = path.join(root, rel);
  const source = await readFile(full, 'utf8');
  // 前回この生成器が置いたリンクだけを剥がす
  let next = source.replace(/<a class="jl" href="[^"]*">([\s\S]*?)<\/a>/g, '$1');

  const start = next.indexOf('<article class="post"');
  if (start >= 0) {
    const bodyStart = next.indexOf('>', start) + 1;
    const bodyEnd = next.indexOf('</article>', bodyStart);
    const { text, at, ok } = scan(next, bodyStart, bodyEnd);
    const picks = [];
    const used = new Set();
    for (const term of terms) {
      if (used.has(term.key) || picks.length >= MAX_PER_PAGE) continue;
      let from = 0;
      for (;;) {
        const found = text.indexOf(term.text, from);
        if (found < 0) break;
        const span = ok.slice(found, found + term.text.length);
        const before = found > 0 ? text[found - 1] : '';
        const after = text[found + term.text.length] ?? '';
        const compound = (before && COMPOUND.test(before)) || (after && COMPOUND.test(after));
        if (!compound && span.length === term.text.length && span.every(Boolean)
          && !picks.some((p) => found < p.end && p.start < found + term.text.length)) {
          picks.push({ start: found, end: found + term.text.length, term });
          used.add(term.key);
          break;
        }
        from = found + 1;
      }
    }
    // 後ろから差し込む
    picks.sort((a, b) => b.start - a.start);
    for (const pick of picks) {
      const open = at[pick.start];
      const close = at[pick.end - 1] + 1;
      next = next.slice(0, open)
        + `<a class="jl" href="${esc(pick.term.href)}">` + next.slice(open, close) + '</a>'
        + next.slice(close);
      added += 1;
    }
  }

  if (next === source) continue;
  changed.push(rel);
  if (!checkOnly) await writeFile(full, next, 'utf8');
}

if (checkOnly) {
  if (changed.length) {
    console.error('本文の制度リンクが最新ではありません。node scripts/sync-inline-links.mjs を実行してください。');
    for (const rel of changed) console.error(`- ${rel}`);
    process.exit(1);
  }
  console.log('本文の制度リンクは最新です。');
  process.exit(0);
}
console.log(changed.length
  ? `本文の制度リンクを更新しました: ${changed.length}ファイル / リンク ${added}本`
  : '本文の制度リンクに変更はありません。');
