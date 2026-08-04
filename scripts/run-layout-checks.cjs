/**
 * レイアウト回帰テスト用の静的サーバーを動的ポートで起動し、
 * ブラウザーテストを順番に実行して結果を保存する。
 *
 *   node scripts/run-layout-checks.cjs
 *   node scripts/run-layout-checks.cjs --full
 *   node scripts/run-layout-checks.cjs --report-dir /tmp/minano-layout-results
 */

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const args = process.argv.slice(2);
const full = args.includes('--full');
const root = path.resolve(__dirname, '..');

function optionValue(name) {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function commitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const reportDir = path.resolve(
  optionValue('--report-dir') || path.join(os.tmpdir(), `minano-layout-${Date.now()}`),
);
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.mp4', 'video/mp4'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
]);

function safeFilePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return null;
  return filePath;
}

async function createStaticServer(serverState) {
  const server = http.createServer(async (request, response) => {
    serverState.requests += 1;
    try {
      if (!['GET', 'HEAD'].includes(request.method || '')) {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
      }
      if (request.url === '/__validation_health') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end('{"ok":true}');
        return;
      }

      const filePath = safeFilePath(request.url || '/');
      if (!filePath) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        throw error;
      }
      if (!stat.isFile()) {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }

      response.writeHead(200, {
        'Content-Type': MIME.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      await pipeline(fs.createReadStream(filePath), response);
    } catch (error) {
      if (!/ECONNRESET|ERR_STREAM_PREMATURE_CLOSE/.test(String(error))) {
        serverState.errors.push(String(error));
      }
      if (!response.headersSent) response.writeHead(500);
      if (!response.destroyed) response.end('Internal Server Error');
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (error, socket) => {
    // Chromium/WebKitが不要になった画像接続を閉じる通常操作。サーバー障害に数えない。
    if (error.code === 'ECONNRESET') {
      serverState.clientResets += 1;
      return;
    }
    serverState.errors.push(`clientError: ${error.message}`);
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function runTask(task) {
  const started = Date.now();
  const child = spawn(task.command, task.args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  await fsp.writeFile(path.join(reportDir, task.output), stdout || stderr || '', 'utf8');
  if (stderr) await fsp.writeFile(path.join(reportDir, `${task.output}.stderr.log`), stderr, 'utf8');
  console.log(`${exitCode === 0 ? '✓' : '✗'} ${task.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (exitCode !== 0) {
    const detail = (stderr || stdout).trim();
    if (detail) console.error(detail.slice(-5000));
  }
  return {
    name: task.name,
    command: [task.command, ...task.args].join(' '),
    output: task.output,
    exitCode,
    durationMs: Date.now() - started,
  };
}

(async () => {
  const startedAt = new Date().toISOString();
  await fsp.mkdir(reportDir, { recursive: true });
  const serverState = { requests: 0, clientResets: 0, errors: [] };
  const server = await createStaticServer(serverState);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/`;
  const results = [];

  try {
    const health = await fetch(`${base}__validation_health`, { cache: 'no-store' });
    if (!health.ok) throw new Error(`検証サーバーの起動確認に失敗しました: HTTP ${health.status}`);
    console.log(`検証サーバー: ${base}`);
    console.log(`結果保存先: ${reportDir}`);

    const tasks = [
      {
        name: 'トップヒーロー',
        command: process.execPath,
        args: ['scripts/test-home-hero.cjs', base, '--json'],
        output: 'home-hero.json',
      },
      {
        name: '最終CTA 40条件',
        command: process.execPath,
        args: ['scripts/test-final-copy.cjs', base, '--json'],
        output: 'final-copy.json',
      },
    ];
    if (full) {
      tasks.push(
        {
          name: '全公開ページUI',
          command: process.execPath,
          args: ['scripts/verify-ui.cjs', base],
          output: 'verify-ui.log',
        },
        {
          name: 'ブログ日付',
          command: process.execPath,
          args: ['scripts/sync-blog-dates.mjs', '--check'],
          output: 'preflight-blog-dates.log',
        },
        {
          name: '構造化データ同期',
          command: process.execPath,
          args: ['scripts/sync-structured-data.mjs', '--check'],
          output: 'preflight-structured-sync.log',
        },
        {
          name: '猫UI・キャッシュ版',
          command: process.execPath,
          args: ['scripts/remove-cat-ui.mjs', '--check'],
          output: 'preflight-cat-ui.log',
        },
        {
          name: '構造化データ検査',
          command: process.execPath,
          args: ['scripts/check-structured-data.mjs'],
          output: 'preflight-structured-check.log',
        },
        {
          name: '性能予算',
          command: process.execPath,
          args: ['scripts/check-performance-budget.mjs'],
          output: 'preflight-performance.log',
        },
        {
          name: 'Git差分',
          command: 'git',
          args: ['diff', '--check'],
          output: 'preflight-git-diff.log',
        },
      );
    }

    for (const task of tasks) results.push(await runTask(task));
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  const summary = {
    commit: commitSha(),
    startedAt,
    completedAt: new Date().toISOString(),
    mode: full ? 'full' : 'pr',
    base,
    reportDir,
    server: serverState,
    tasks: results,
    success: results.every((result) => result.exitCode === 0) && serverState.errors.length === 0,
  };
  await fsp.writeFile(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await fsp.writeFile(path.join(reportDir, 'server.json'), JSON.stringify(serverState, null, 2), 'utf8');

  if (!summary.success) {
    if (serverState.errors.length) console.error(`サーバーエラー: ${serverState.errors.join(' / ')}`);
    process.exit(1);
  }
  console.log(`検証フロー合格（${results.length}タスク）`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
