/**
 * 改行位置を文節でそろえる（iPhone対策）
 *
 *   node scripts/sync-phrase-breaks.mjs           生成（HTMLを書き換える）
 *   node scripts/sync-phrase-breaks.mjs --check    差分があれば失敗（preflight用）
 *   node scripts/sync-phrase-breaks.mjs --stats    増える量だけ数えて終わる
 *
 * なぜ要るのか:
 *   word-break:auto-phrase は Chromium にしか無い。Safari では normal に解決されるので、
 *   iPhone では「正社員 / 化で」「機 / 械やシステム」「準 / 備が早く」のように
 *   語の途中で折れる。CSSでは解けないため、文節の切れ目に <wbr> を置いておく。
 *
 * 効かせ方（CSS側と対）:
 *   <wbr> を入れただけでは何も変わらない。日本語はもともとどこでも折れるからで、
 *   「文節以外では折らない」を word-break:keep-all で足して初めて位置が決まる。
 *   CSSは p:has(wbr) のように <wbr> を持つ要素だけへ当てるので、
 *   この生成器が触っていない要素は今までどおり auto-phrase のまま残る。
 *
 * 判定と対象は scripts/lib/phrase-breaks.mjs 側にある。
 * 生成物（トップTOPICS・関連記事・助成金の解説ページ）は各生成器が
 * 同じ関数を通しているので、ここを通しても結果は変わらない。
 *
 * preflight では最後に置く。ほかの生成器を回したあとで印が欠けても、
 * ここで気づけるようにするため。
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const statsOnly = args.includes('--stats');

/** 公開しないHTML。記事生成テンプレートと社内カタログ。 */
const SKIP_FILES = new Set(['admin-post.html', 'icon-catalog.html']);
// shoshiki/ は社内書式の印刷用ページ（独自CSS・.t が nowrap・contenteditable）。サイトの keep-all CSS を
// 読まないので印は効かず、nowrap の中に入って test-phrase-breaks に落ちる。一覧 shoshiki.html はルートなので対象のまま。
const SKIP_DIRS = new Set(['node_modules', 'scripts', 'docs', '.github', 'shoshiki']);

function htmlFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || name.startsWith('_backup') || SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.html') || SKIP_FILES.has(name)) continue;
      out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out;
}

const changed = [];
let addedTotal = 0;
let bytesBefore = 0;
let bytesAfter = 0;

for (const rel of htmlFiles()) {
  const full = path.join(root, rel);
  const source = readFileSync(full, 'utf8');
  const { html, added } = markPhrases(source);
  bytesBefore += Buffer.byteLength(source);
  bytesAfter += Buffer.byteLength(html);
  addedTotal += added;
  if (html === source) continue;
  changed.push(rel);
  if (!checkOnly && !statsOnly) writeFileSync(full, html);
}

if (statsOnly) {
  console.log(`書き換え対象: ${changed.length}ファイル / <wbr> 合計 ${addedTotal}個`);
  const diff = bytesAfter - bytesBefore;
  console.log(`HTML合計: ${bytesBefore} → ${bytesAfter} bytes（${diff >= 0 ? '+' : ''}${diff}, ${((bytesAfter / bytesBefore - 1) * 100).toFixed(2)}%）`);
  process.exit(0);
}

if (checkOnly) {
  if (changed.length) {
    console.error('文節印（<wbr>）が最新ではありません。node scripts/sync-phrase-breaks.mjs を実行してください。');
    for (const rel of changed) console.error(`- ${rel}`);
    process.exit(1);
  }
  console.log('文節印（<wbr>）は最新です。');
  process.exit(0);
}

console.log(changed.length
  ? `文節印を更新しました: ${changed.length}ファイル / <wbr> 合計 ${addedTotal}個`
  : '文節印に変更はありません。');
