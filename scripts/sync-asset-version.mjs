import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const manifestPath = path.join(root, 'assets-version.json');
const assetFiles = new Map([
  ['page-enter.js', 'page-enter.js'],
  ['skin-v2.css', 'skin-v2.css'],
  ['service.css', 'uploads/service.css'],
  ['image-slot.js', 'image-slot.js'],
  ['blog-article.css', 'blog-article.css'],
  ['header-motion.js', 'header-motion.js'],
  ['link-keep.js', 'link-keep.js'],
]);

function loadAssetVersions() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`assets-version.jsonを読めません: ${error.message}`);
  }

  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
    throw new Error('assets-version.jsonのルートはオブジェクトにしてください');
  }

  const errors = [];
  const expected = [...assetFiles.keys()];
  const actual = Object.keys(manifest);
  const missing = expected.filter((asset) => !Object.hasOwn(manifest, asset));
  const unexpected = actual.filter((asset) => !assetFiles.has(asset));
  if (missing.length) errors.push(`不足キー: ${missing.join(', ')}`);
  if (unexpected.length) errors.push(`未定義キー: ${unexpected.join(', ')}`);

  for (const [asset, relativePath] of assetFiles) {
    const version = manifest[asset];
    if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
      errors.push(`${asset}: 版は英数字で始まる英数字・ピリオド・アンダースコア・ハイフンの文字列にしてください`);
    }
    if (!fs.existsSync(path.join(root, relativePath))) {
      errors.push(`${asset}: 対応する資産 ${relativePath} がありません`);
    }
  }

  if (errors.length) throw new Error(errors.join(' / '));
  return Object.freeze(Object.fromEntries(expected.map((asset) => [asset, manifest[asset]])));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let assetVersions;
try {
  // manifestを完全検証してからHTMLを読み、書き込み前の部分更新を防ぐ。
  assetVersions = loadAssetVersions();
} catch (error) {
  console.error(`資産版manifestが不正です: ${error.message}`);
  process.exit(1);
}

function htmlFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name.startsWith('_backup_')) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...htmlFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(target);
  }
  return files;
}

const updates = [];
for (const file of htmlFiles(root)) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before
    .replace(
      /\n?<script defer src="(?:\.\.\/)?mascot\.js\?[^"]+"><(?:\\\/|\/)script>\n?/g,
      '',
    )
    // 記事生成テンプレート内は改行が「\n」という文字列で表現される。
    // HTML用の置換で実改行を混ぜるとJavaScript文字列を壊すため、既存の混入もここで修復する。
    .replace(
      /\\n\r?\n\\n<script defer src="\.\.\/header-motion\.js/g,
      '\\n\\n<script defer src="../header-motion.js',
    );

  for (const [asset, version] of Object.entries(assetVersions)) {
    const reference = new RegExp(`${escapeRegExp(asset)}\\?v=[^"'\\\\<\\s]+`, 'g');
    after = after.replace(reference, `${asset}?v=${version}`);
  }

  if (after === before) continue;
  updates.push({ file, after, relative: path.relative(root, file) });
}

for (const { file, after, relative } of updates) {
  if (!checkOnly) fs.writeFileSync(file, after, 'utf8');
  console.log(`${checkOnly ? '要更新' : '更新'}: ${relative}`);
}

if (checkOnly && updates.length) {
  console.error(`猫UIまたは資産版が未同期です（${updates.length}ファイル）`);
  process.exitCode = 1;
} else {
  console.log(
    checkOnly
      ? '猫UI参照の撤去と資産版は同期済みです'
      : `猫UI参照を撤去し、資産版を同期しました（${updates.length}ファイル更新）`,
  );
}
