import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const publicHtml = [];
const excludedHtml = new Set(['admin-post.html', 'icon-catalog.html']);
const sharedScripts = /(?:page-enter|image-slot|link-keep|mascot|header-motion)\.js(?:\?[^"']*)?/i;

async function collectHtml(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_backup_')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (relative(root, full).split('/').length <= 2) await collectHtml(full);
    } else if (entry.name.endsWith('.html')) {
      const rel = relative(root, full);
      if (!excludedHtml.has(rel)) publicHtml.push({ full, rel });
    }
  }
}

function fail(message) {
  errors.push(message);
}

await collectHtml(root);

for (const { full, rel } of publicHtml) {
  const html = await readFile(full, 'utf8');
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) {
    fail(`${rel}: Google Fontsへの外部通信が残っています`);
  }
  for (const tag of html.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi)) {
    if (sharedScripts.test(tag[0]) && !/\bdefer\b/i.test(tag[0])) {
      fail(`${rel}: 共通スクリプトにdeferがありません: ${tag[0]}`);
    }
  }
  const pageEnter = html.match(/page-enter\.js\?v=([^"']+)/i);
  if (pageEnter && pageEnter[1] !== '20260722-1') {
    fail(`${rel}: page-enter.jsのキャッシュ版が不一致です（${pageEnter[1]}）`);
  }
  const imageSlotVersion = html.match(/image-slot\.js\?v=([^"']+)/i);
  if (imageSlotVersion && imageSlotVersion[1] !== '20260722-crop1') {
    fail(`${rel}: image-slot.jsのキャッシュ版が不一致です（${imageSlotVersion[1]}）`);
  }
  const skinVersion = html.match(/skin-v2\.css\?v=([^"']+)/i);
  if (skinVersion && skinVersion[1] !== '20260722-ill3') {
    fail(`${rel}: skin-v2.cssのキャッシュ版が不一致です（${skinVersion[1]}）`);
  }
}

const index = await readFile(join(root, 'index.html'), 'utf8');
const requiredHomePatterns = [
  [/<picture class="hero-media"/, 'LCP画像がnative pictureになっていません'],
  [/fetchpriority="high"/, 'LCP画像にfetchpriority=highがありません'],
  [/<link rel="preload" as="image" type="image\/avif"/, 'LCP画像のpreloadがありません'],
  [/data-async-style/, 'トップページの全量CSSが非同期化されていません'],
  [/id="critical-home"/, 'トップページの重要CSSがインライン化されていません'],
];
for (const [pattern, message] of requiredHomePatterns) {
  if (!pattern.test(index)) fail(`index.html: ${message}`);
}
if (/id="mn-load"/.test(index)) fail('index.html: 初回ローダーが再導入されています');

const skin = await readFile(join(root, 'skin-v2.css'), 'utf8');
const criticalMatch = index.match(/<style id="critical-home">([\s\S]*?)<\/style>/);
const criticalSource = skin.split('/* ---------- セクション見出し')[0].trim();
if (!criticalMatch || criticalMatch[1].trim() !== criticalSource) {
  fail('index.html: #critical-home と skin-v2.css のファーストビュー部分が同期していません');
}

const imageSlot = await readFile(join(root, 'image-slot.js'), 'utf8');
if (!/const EDIT_MODE\s*=\s*!!\(window\.omelette/.test(imageSlot)) {
  fail('image-slot.js: 公開表示と編集表示の分離がありません');
}

const sizeBudgets = [
  ['assets/photos/hero-main-800.avif', 40 * 1024],
  ['assets/photos/hero-main-1200.avif', 90 * 1024],
  ['assets/photos/hero-main-1600.avif', 150 * 1024],
  ['assets/cat-walk-1-256.webp', 12 * 1024],
  ['assets/cat-walk-2-256.webp', 12 * 1024],
  ['assets/cat-walk-3-256.webp', 12 * 1024],
];
for (const [rel, max] of sizeBudgets) {
  try {
    const bytes = (await stat(join(root, rel))).size;
    if (bytes > max) fail(`${rel}: ${bytes} bytes（上限 ${max} bytes）`);
  } catch {
    fail(`${rel}: 必須の軽量画像がありません`);
  }
}

if (errors.length) {
  console.error('性能チェックで問題が見つかりました。');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`性能チェック合格: 公開HTML ${publicHtml.length}ページ、外部フォント0、主要画像は上限内です。`);
