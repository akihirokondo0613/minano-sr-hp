/**
 * 社内書式ページの生成器（Python）を preflight から呼ぶための薄い入口。
 *
 *   node scripts/build-shoshiki-page.mjs           生成（shoshiki.html と shoshiki/*.html を書き出す）
 *   node scripts/build-shoshiki-page.mjs --check   差分があれば失敗（preflight用）
 *
 * 本体は scripts/shoshiki/build_shoshiki.py。正本は data/shoshiki/forms.json。
 * preflight は node しか起動しないので、ここで python3 に引き渡す。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'shoshiki', 'build_shoshiki.py');
const python = process.platform === 'win32' ? 'python' : 'python3';
const result = spawnSync(python, [script, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
if (result.error) {
  console.error(`python が起動できませんでした: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
