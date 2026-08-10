#!/usr/bin/env node

/**
 * audit-a11y.cjs のCLI統合テスト。
 *
 * 実サイトのHTMLや固定ポートへ依存せず、動的ポートのHTTPサーバーから
 * 監査用fixtureを配信する。要素監査、モバイルナビ展開、写真上文字、
 * 0件測定の失敗をChromium / WebKitの両方で通して確認する。
 */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const auditScript = path.join(root, 'scripts', 'audit-a11y.cjs');
const childTimeoutMs = 60_000;

const validFixture = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>監査CLI統合テスト</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; color: #111; background: #fff; font-family: sans-serif; }
    body { padding: 20px; }
    header { display: flex; align-items: flex-start; gap: 12px; }
    .nav-burger,
    #normal-action,
    #mobNav a {
      min-width: 44px;
      min-height: 44px;
      border: 0;
      color: #fff;
      background: #111;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 14px;
      text-decoration: none;
    }
    #mobNav { display: none; width: 100%; margin-top: 8px; background: #fff; }
    #mobNav.open { display: flex; gap: 12px; }
    main { margin-top: 20px; }
    .hero-h1,
    .hero-sub {
      width: 350px;
      max-width: 100%;
      margin: 12px 0;
      padding: 8px;
      color: #fff;
      font-size: 28px;
      font-weight: 700;
      line-height: 1.5;
    }
    .hero-h1 { background: #000; }
    /*
     * 1pxだけ白、続く20pxは黒なので、白文字が白背景に重なる面積は約4.8%。
     * 旧10th-percentile判定は黒背景側を採用して見逃すが、最悪画素を測る
     * 現行実装は少数の低コントラスト画素も失敗として検出する。
     */
    .hero-sub {
      background: repeating-linear-gradient(90deg, #fff 0 1px, #000 1px 21px);
    }
    p { max-width: 340px; }
  </style>
</head>
<body>
  <header>
    <button class="nav-burger" type="button" aria-expanded="false" aria-controls="mobNav">メニュー</button>
  </header>
  <nav id="mobNav" aria-hidden="true" aria-label="モバイルナビゲーション">
    <a href="#main-copy">本文へ</a>
    <a href="#normal-action">相談する</a>
  </nav>
  <main>
    <h1 class="hero-h1">十分なコントラストの見出し</h1>
    <p class="hero-sub">少数画素だけ背景と同色になる説明文</p>
    <p id="main-copy">通常本文も監査対象として実測します。</p>
    <button id="normal-action" type="button">通常の操作対象</button>
  </main>
  <script>
    document.querySelector('.nav-burger').addEventListener('click', (event) => {
      const menu = document.querySelector('#mobNav');
      const open = !menu.classList.contains('open');
      menu.classList.toggle('open', open);
      menu.setAttribute('aria-hidden', String(!open));
      event.currentTarget.setAttribute('aria-expanded', String(open));
    });
  </script>
</body>
</html>`;

const emptyFixture = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>空</title></head><body></body></html>';

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

function runAudit(baseUrl, outputFile, checkFlag) {
  const childArgs = [
    auditScript,
    baseUrl,
    checkFlag,
    '--json',
    `--output=${outputFile}`,
    '--pages=index.html',
    '--widths=390',
    '--engines=chromium,webkit',
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      killTimer.unref();
    }, childTimeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (timedOut) {
        reject(new Error(`audit-a11y.cjs が${childTimeoutMs}ms以内に終了しませんでした\n${stderr}`));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function readReport(file) {
  assert.ok(fs.existsSync(file), `監査JSONが作成されていません: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertConditionCoverage(report) {
  assert.deepEqual(report.config.engines, ['chromium', 'webkit']);
  assert.deepEqual(report.config.pages, ['index.html']);
  assert.deepEqual(report.config.widths, [390]);
  assert.equal(report.coverage.expectedConditions, 4, 'default＋nav-openを両エンジンで期待する');
  assert.equal(report.coverage.recordedConditions, 4);
  assert.equal(report.coverage.completedConditions, 4);
  assert.equal(report.coverage.unmeasuredConditions, 0);
  assert.equal(report.coverage.consistent, true);

  const keys = report.conditions.map((condition) => (
    `${condition.engine}|${condition.width}|${condition.state}`
  )).sort();
  assert.deepEqual(keys, [
    'chromium|390|default',
    'chromium|390|nav-open',
    'webkit|390|default',
    'webkit|390|nav-open',
  ]);
  for (const condition of report.conditions) {
    assert.equal(condition.auditCompleted, true, `${condition.engine}/${condition.state}が未完了`);
    assert.ok(condition.contrastCounts.scanned > 0, `${condition.engine}/${condition.state}の文字候補が0件`);
    assert.ok(condition.contrastCounts.measured > 0, `${condition.engine}/${condition.state}の文字実測が0件`);
    assert.ok(condition.targetCounts.scanned > 0, `${condition.engine}/${condition.state}の操作候補が0件`);
    assert.ok(condition.targetCounts.eligible > 0, `${condition.engine}/${condition.state}の操作実測が0件`);
  }
}

function assertPhotoWorstPixel(report) {
  assert.equal(report.counts.photo.expected, 4);
  assert.equal(report.counts.photo.recorded, 4);
  assert.equal(report.counts.photo.measured, 4);
  assert.equal(report.counts.photo.unresolved, 0);
  assert.equal(report.counts.photo.failed, 2, '.hero-subだけが両エンジンで失敗する');
  assert.equal(report.counts.photo.consistent, true);

  for (const engine of ['chromium', 'webkit']) {
    const heading = report.photo.find((item) => item.engine === engine && item.selector === '.hero-h1');
    const sub = report.photo.find((item) => item.engine === engine && item.selector === '.hero-sub');
    assert.ok(heading, `${engine}の.hero-h1測定がない`);
    assert.ok(sub, `${engine}の.hero-sub測定がない`);
    assert.equal(heading.status, 'measured');
    assert.equal(heading.failed, false, `${engine}の十分なコントラストを誤検出した`);
    assert.ok(Array.isArray(heading.runs) && heading.runs.length > 0);
    assert.ok(heading.runs.every((run) => run.sampledPixels > 0));

    assert.equal(sub.status, 'measured');
    assert.equal(sub.failed, true, `${engine}が少数の低コントラスト画素を見逃した`);
    assert.ok(Array.isArray(sub.runs) && sub.runs.length > 0);
    assert.ok(sub.runs.some((run) => run.failed && run.sampledPixels > 0));
    assert.ok(sub.ratio < sub.need, `${engine}の最悪画素比が閾値未満になっていない`);
  }
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minano-a11y-audit-test-'));
  const validOutput = path.join(tempDir, 'valid.json');
  const emptyOutput = path.join(tempDir, 'empty.json');
  let fixture = validFixture;
  const server = http.createServer((request, response) => {
    if (request.url !== '/' && request.url !== '/index.html') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'close',
    });
    response.end(fixture);
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/`;

    const validRun = await runAudit(baseUrl, validOutput, '--check');
    assert.notEqual(validRun.code, 0, '写真上文字の不足があるfixtureを--checkが合格にした');
    assert.equal(validRun.signal, null);
    const validReport = readReport(validOutput);
    assertConditionCoverage(validReport);
    assertPhotoWorstPixel(validReport);
    assert.equal(validReport.occurrences.contrast.length, 0, '通常文字に意図しない不足がある');
    assert.equal(validReport.occurrences.contrastUnresolved.length, 0);
    assert.equal(validReport.occurrences.targets.length, 0, '通常操作領域に意図しない違反がある');
    assert.equal(validReport.occurrences.targetUnresolved.length, 0);

    fixture = emptyFixture;
    const emptyRun = await runAudit(baseUrl, emptyOutput, '--check-measurement');
    assert.notEqual(emptyRun.code, 0, 'HTTP 200の空bodyを--check-measurementが合格にした');
    assert.equal(emptyRun.signal, null);
    const emptyReport = readReport(emptyOutput);
    assert.equal(emptyReport.coverage.expectedConditions, 4);
    assert.equal(emptyReport.coverage.recordedConditions, 4);
    assert.equal(emptyReport.coverage.completedConditions, 0);
    assert.equal(emptyReport.coverage.unmeasuredConditions, 4);
    assert.equal(emptyReport.coverage.consistent, false);
    assert.ok(emptyReport.conditions.every((condition) => condition.auditCompleted === false));

    console.log('audit-a11y CLI統合: 2エンジンのdefault/nav-open・最悪画素・0件測定を確認');
  } finally {
    if (server.listening) await closeServer(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
