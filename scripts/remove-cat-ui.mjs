import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const pageEnterVersion = '20260725-nocat1';
const skinVersion = '20260804-hero-video1';
const serviceVersion = '20260725-nocat1';
let changed = 0;

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
    )
    .replace(/page-enter\.js\?v=[^"'\\<\s]+/g, `page-enter.js?v=${pageEnterVersion}`)
    .replace(/skin-v2\.css\?v=[^"'\\<\s]+/g, `skin-v2.css?v=${skinVersion}`)
    .replace(/service\.css\?v=[^"'\\<\s]+/g, `service.css?v=${serviceVersion}`);

  if (after === before) continue;
  changed += 1;
  const relative = path.relative(root, file);
  if (!checkOnly) fs.writeFileSync(file, after, 'utf8');
  console.log(`${checkOnly ? '要更新' : '更新'}: ${relative}`);
}

if (checkOnly && changed) {
  console.error(`猫UIまたはキャッシュ版が未同期です（${changed}ファイル）`);
  process.exitCode = 1;
} else {
  console.log(
    checkOnly
      ? '猫UI参照の撤去とキャッシュ版は同期済みです'
      : `猫UI参照を撤去し、キャッシュ版を同期しました（${changed}ファイル更新）`,
  );
}
