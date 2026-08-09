import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const publicHtml = [];
const excludedHtml = new Set(['admin-post.html', 'icon-catalog.html']);
const sharedScripts = /(?:page-enter|image-slot|link-keep|header-motion)\.js(?:\?[^"']*)?/i;
const expectedAssets = [
  'page-enter.js',
  'skin-v2.css',
  'service.css',
  'image-slot.js',
  'blog-article.css',
  'header-motion.js',
  'link-keep.js',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadAssetVersions() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, 'assets-version.json'), 'utf8'));
  } catch (error) {
    throw new Error(`assets-version.jsonを読めません: ${error.message}`);
  }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
    throw new Error('assets-version.jsonのルートはオブジェクトにしてください');
  }

  const actual = Object.keys(manifest);
  const missing = expectedAssets.filter((asset) => !Object.hasOwn(manifest, asset));
  const unexpected = actual.filter((asset) => !expectedAssets.includes(asset));
  const invalid = expectedAssets.filter(
    (asset) => typeof manifest[asset] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest[asset]),
  );
  const problems = [];
  if (missing.length) problems.push(`不足キー: ${missing.join(', ')}`);
  if (unexpected.length) problems.push(`未定義キー: ${unexpected.join(', ')}`);
  if (invalid.length) problems.push(`版の形式が不正: ${invalid.join(', ')}`);
  if (problems.length) throw new Error(problems.join(' / '));

  return Object.freeze(Object.fromEntries(expectedAssets.map((asset) => [asset, manifest[asset]])));
}

let assetVersions;
try {
  assetVersions = await loadAssetVersions();
} catch (error) {
  console.error(`性能チェックを開始できません。資産版manifestが不正です: ${error.message}`);
  process.exit(1);
}

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
  for (const [asset, expectedVersion] of Object.entries(assetVersions)) {
    const reference = html.match(new RegExp(`${escapeRegExp(asset)}\\?v=([^"']+)`, 'i'));
    if (reference && reference[1] !== expectedVersion) {
      fail(`${rel}: ${asset}のキャッシュ版が不一致です（${reference[1]}）`);
    }
  }
  if (/mascot\.js|mn-mascot|mn-recall/i.test(html)) {
    fail(`${rel}: 撤去済みの猫UI参照が残っています`);
  }
  if (/data-goatcounter=/i.test(html)) {
    const expectedPath = rel === 'index.html' ? '/' : `/${rel}`;
    const trackingPath = html.match(/data-goatcounter-settings='\{"path":"([^"]+)"\}'/i);
    if (!trackingPath || trackingPath[1] !== expectedPath) {
      fail(`${rel}: GoatCounterの送信パスが固定されていません`);
    }
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
