/**
 * 文字の読みやすさと操作領域の実測監査（Playwright）
 *
 *   node scripts/audit-a11y.cjs [base] [--check] [--json]
 *   node scripts/audit-a11y.cjs [base] --check-measurement [--json]
 *   node scripts/audit-a11y.cjs [base] --json --output=/tmp/a11y.json
 *   例) node scripts/audit-a11y.cjs http://127.0.0.1:8811/
 *
 * verify-ui.cjs と同じく playwright を必要とする検証ツール。
 * 未導入なら scratchpad 等に入れて NODE_PATH / PLAYWRIGHT_BROWSERS_PATH を渡す。
 *
 * 見るもの:
 *   1. 横はみ出し … ページ自体が横スクロールするか（overflow-x:auto の中の表は対象外）
 *   2. 文字コントラスト … 背景色から算出。写真の上の文字は色から計算できないため
 *      PHOTO_TARGETS に登録した要素だけ「文字を透明にして背景の実ピクセルを測る」方式で別に測る
 *   3. 操作領域 … 操作要素が24×24px以上、またはWCAG 2.2のSpacing例外に適合するか
 *   4. console error / page error
 *
 * 数値の出どころを人の記憶に置かないための道具。監査結果を報告するときはこの出力を根拠にする。
 */

const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { probeA11y } = require('./lib/a11y-probe.cjs');

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8811/').replace(/\/?$/, '/');
const checkOnly = args.includes('--check');
const checkMeasurement = args.includes('--check-measurement');
const asJson = args.includes('--json');
const startedAt = Date.now();

function optionValue(name) {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function csvOption(name, fallback) {
  const value = optionValue(name);
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback;
}

const outputFile = optionValue('--output');
if (outputFile && !asJson) throw new Error('--output は --json と一緒に指定してください');

const root = path.resolve(__dirname, '..');
const DEFAULT_WIDTHS = [320, 360, 375, 390, 402, 430, 640, 768, 900, 1024, 1440, 2560];
const WIDTHS = csvOption('--widths', DEFAULT_WIDTHS).map(Number);
if (!WIDTHS.length || WIDTHS.some((width) => !Number.isInteger(width) || width < 240 || width > 4096)) {
  throw new Error(`--widths が不正です: ${optionValue('--widths')}`);
}
const ALL_ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];
const engineNames = new Set(csvOption('--engines', ALL_ENGINES.map(([name]) => name)));
const ENGINES = ALL_ENGINES.filter(([name]) => engineNames.has(name));
if (!ENGINES.length || ENGINES.length !== engineNames.size) {
  throw new Error(`--engines が不正です: ${optionValue('--engines')}`);
}
const PAGE_FILTER = csvOption('--pages', []);

// 写真の上に乗る文字。背景色では測れないので実ピクセルで測る対象。
const PHOTO_TARGETS = [
  { page: 'index.html', selector: '.hero-h1' },
  { page: 'index.html', selector: '.hero-sub' },
  { page: 'recruit.html', selector: '.rc-cta h2' },
  { page: 'recruit.html', selector: '.rc-cta > p' },
  { page: 'recruit.html', selector: '.rc-cta .btn-secondary' },
];

const AA_NORMAL = 4.5;
const AA_LARGE = 3;
const TARGET_SIZE = 24;
const MENU_MAX_WIDTH = 1199;
const SETTLE_TIMEOUT_MS = 10000;
const PROBE_TIMEOUT_MS = 10000;
const PHOTO_TIMEOUT_MS = 40000;
const UPGRADE_INSECURE_META =
  /<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">/gi;

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}が${timeoutMs}msを超えました`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function prepareLocalHttpPage(page) {
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'http:') return;

  // WebKitはローカルHTTPでもupgrade-insecure-requestsを適用し、相対CSSをHTTPS化する。
  // 本番は元からHTTPSなので、検査時のdocumentレスポンスだけmetaを除いて同じCSSを読ませる。
  await page.route(`${baseUrl.origin}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({ response, body: html.replace(UPGRADE_INSECURE_META, '') });
  });
}

function pages() {
  const list = [];
  for (const f of fs.readdirSync(root)) {
    if (!f.endsWith('.html')) continue;
    if (/^(admin-post|icon-catalog|404)\.html$/.test(f)) continue;
    list.push(f);
  }
  for (const dir of ['uploads', 'blog']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (f.endsWith('.html')) list.push(`${dir}/${f}`);
    }
  }
  if (!PAGE_FILTER.length) return list;
  const unknown = PAGE_FILTER.filter((page) => !list.includes(page));
  if (unknown.length) throw new Error(`--pages に公開対象外または存在しないページがあります: ${unknown.join(', ')}`);
  return PAGE_FILTER;
}


// 文字を透明にして背景の実ピクセルからコントラストを測る（写真の上の文字用）
async function photoContrast(page, selector) {
  const { PNG } = tryLoadPng();
  if (!PNG) return { selector, status: 'unresolved', reason: 'pngjs-missing' };
  const locator = page.locator(selector).first();
  if (await locator.count()) {
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
    await page.waitForTimeout(50);
  }
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { status: 'unresolved', reason: 'selector-missing' };
    if (el.closest('[aria-hidden="true"]')) {
      return { status: 'excluded', reason: 'aria-hidden' };
    }
    const runs = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const owner = n.parentElement || el;
      let unresolved = null;
      for (let current = owner; current && el.contains(current); current = current.parentElement) {
        const currentStyle = getComputedStyle(current);
        const opacity = Number.parseFloat(currentStyle.opacity);
        if (Number.isFinite(opacity) && opacity > 0 && opacity < 1) unresolved ||= 'partial-opacity';
        if (currentStyle.filter && currentStyle.filter !== 'none') unresolved ||= 'filter';
        if (currentStyle.mixBlendMode && currentStyle.mixBlendMode !== 'normal') unresolved ||= 'mix-blend-mode';
      }
      if (unresolved) return { status: 'unresolved', reason: unresolved };
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const rects = [...rg.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
      if (!rects.length) continue;

    // CSS Color 4のcolor(srgb …)／display-p3も、Canvas経由でsRGBへ正規化する。
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: true });
      const style = getComputedStyle(owner);
      const strokeWidth = Number.parseFloat(style.webkitTextStrokeWidth || '0');
      const sourceColor = (style.color === 'rgba(0, 0, 0, 0)' || style.color === 'transparent') && strokeWidth > 0
        ? style.webkitTextStrokeColor
        : style.color;
      try {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = 'rgba(1, 2, 3, 1)';
        context.fillStyle = sourceColor;
        context.fillRect(0, 0, 1, 1);
      } catch {
        return { status: 'unresolved', reason: 'foreground-color-unparsed', color: sourceColor };
      }
      const foreground = [...context.getImageData(0, 0, 1, 1).data];
      if (foreground[3] === 0) continue;
      const size = Number.parseFloat(style.fontSize);
      const parsedWeight = Number.parseFloat(style.fontWeight);
      const weight = Number.isFinite(parsedWeight) ? parsedWeight : (/bold/i.test(style.fontWeight) ? 700 : 400);
      if (!Number.isFinite(size) || !Number.isFinite(weight)) {
        return { status: 'unresolved', reason: 'unparsed-font-metrics' };
      }
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      runs.push({
        text,
        rects,
        foreground,
        need: large ? 3 : 4.5,
        size: Number(size.toFixed(2)),
        weight,
      });
    }
    if (!runs.length) return { status: 'unresolved', reason: 'text-run-missing' };
    return { status: 'ready', runs };
  }, selector);
  if (info.status !== 'ready') return { selector, ...info };

  const styleHandle = await page.addStyleTag({ content: '/* 写真上文字のコントラスト測定用 */' });
  const setMaskColor = async (color) => {
    await styleHandle.evaluate((style, value) => {
      style.textContent = `${value.selector}, ${value.selector} * {`
        + `color:${value.color} !important;`
        + `-webkit-text-fill-color:${value.color} !important;`
        + '-webkit-text-stroke:0 !important;text-shadow:none !important}';
    }, { selector, color });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  };

  await setMaskColor('#000');
  const blackShot = await page.screenshot({ timeout: 10000 });
  await setMaskColor('#fff');
  const whiteShot = await page.screenshot({ timeout: 10000 });
  await setMaskColor('transparent');
  const backgroundShot = await page.screenshot({ timeout: 10000 });
  // WebKitの画像デコード待ちが解けない場合も、監査全体を無期限に止めない。
  // 失敗は呼び出し元で unresolved として集計し、--check を必ず失敗させる。
  // 呼び出し元で直後にページを閉じるため、WebKitが停止し得る不要な再読み込みはしない。

  const black = PNG.sync.read(blackShot);
  const white = PNG.sync.read(whiteShot);
  const background = PNG.sync.read(backgroundShot);
  if (black.width !== white.width || black.width !== background.width
      || black.height !== white.height || black.height !== background.height) {
    return { selector, status: 'unresolved', reason: 'screenshot-size-mismatch' };
  }
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  const measuredRuns = [];
  for (const run of info.runs) {
    const [fr, fg, fb, faByte] = run.foreground;
    const fa = faByte / 255;
    let worst = Infinity;
    let sampledPixels = 0;
    for (const rect of run.rects) {
      for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(background.height, Math.ceil(rect.y + rect.h)); y += 1) {
        for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(background.width, Math.ceil(rect.x + rect.w)); x += 1) {
          const index = (background.width * y + x) << 2;
          const mask = Math.max(
            Math.abs(white.data[index] - black.data[index]),
            Math.abs(white.data[index + 1] - black.data[index + 1]),
            Math.abs(white.data[index + 2] - black.data[index + 2]),
          ) / 255;
          // アンチエイリアスの縁ではなく、実際の文字strokeが半分以上乗る画素を使う。
          if (mask < 0.5) continue;
          sampledPixels += 1;
          const br = background.data[index];
          const bg = background.data[index + 1];
          const bb = background.data[index + 2];
          const er = fr * fa + br * (1 - fa);
          const eg = fg * fa + bg * (1 - fa);
          const eb = fb * fa + bb * (1 - fa);
          const lf = lum(er, eg, eb);
          const lb = lum(br, bg, bb);
          const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
          if (ratio < worst) worst = ratio;
        }
      }
    }
    if (!sampledPixels || worst === Infinity) {
      return { selector, status: 'unresolved', reason: 'glyph-mask-missing', text: run.text };
    }
    measuredRuns.push({
      text: run.text,
      ratio: Number(worst.toFixed(3)),
      need: run.need,
      size: run.size,
      weight: run.weight,
      sampledPixels,
      failed: worst + Number.EPSILON < run.need,
      rawRatio: worst,
    });
  }
  const worstRun = [...measuredRuns].sort(
    (first, second) => first.rawRatio / first.need - second.rawRatio / second.need,
  )[0];
  return {
    selector,
    status: 'measured',
    ratio: worstRun.ratio,
    need: worstRun.need,
    size: worstRun.size,
    failed: measuredRuns.some((run) => run.failed),
    runs: measuredRuns.map(({ rawRatio: _rawRatio, ...run }) => run),
  };
}

function tryLoadPng() {
  try { return { PNG: require('pngjs').PNG }; } catch { return { PNG: null }; }
}

async function activateAsyncStyles(page) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('link[data-async-style]')].every((link) => link.media === 'all'),
      null,
      { timeout: 1500 },
    );
  } catch {
    // Playwright WebKitではlink.onloadが発火しないことがある。監査時だけ全量CSSを確実に有効化する。
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('link[data-async-style]')) link.media = 'all';
    });
    await page.waitForTimeout(100);
  }
}

async function settleA11yMeasurement(page) {
  await activateAsyncStyles(page);
  // コントラストはスクロール途中の0.85秒リビールではなく、利用者が読み始める
  // 最終表示を測る。content-visibilityも監査時だけ展開し、0件測定を防ぐ。
  await page.addStyleTag({ content: `
    html { scroll-behavior: auto !important; }
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
    }
    .rv, .rvl { opacity: 1 !important; transform: none !important; }
    main > section, .hub-page > section { content-visibility: visible !important; }
  ` });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(50);
}

async function measureElementAudit(page, rel, overrides = {}) {
  const res = await withTimeout(page.evaluate(probeA11y, {
    aaNormal: AA_NORMAL,
    aaLarge: AA_LARGE,
    targetSize: TARGET_SIZE,
    overflowTolerance: 1,
    photoSelectors: PHOTO_TARGETS
      .filter((target) => target.page === rel)
      .map((target) => target.selector),
    ...overrides,
  }), PROBE_TIMEOUT_MS, '要素監査');
  const contrastMeasured = (res?.contrastCounts?.measured ?? 0)
    + (res?.contrastCounts?.unresolved ?? 0);
  const targetsMeasured = (res?.targetCounts?.eligible ?? 0)
    + (res?.targetCounts?.unresolved ?? 0);
  if (!res
      || !Number.isInteger(res.overflowCount)
      || !res.contrastCounts?.consistent
      || !res.targetCounts?.consistent
      || res.contrastCounts.scanned <= 0
      || contrastMeasured <= 0
      || res.targetCounts.scanned <= 0
      || targetsMeasured <= 0) {
    throw new Error('要素監査の件数整合性または最低実測件数が成立しません');
  }
  // passした全要素は条件別件数へ集約し、JSON肥大化を避ける。
  const { contrastResults: _contrastResults, targetResults: _targetResults, ...condition } = res;
  return condition;
}

async function closeBrowserWithTimeout(browser, engine) {
  let timer;
  const closeTimedOut = await Promise.race([
    browser.close().then(() => false).catch(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), 5000);
    }),
  ]);
  clearTimeout(timer);
  if (closeTimedOut) {
    console.error(`${engine}: 監査完了後のブラウザー終了が5秒を超えたため強制終了します`);
  }
  return closeTimedOut;
}

async function closePageWithTimeout(page) {
  let timer;
  const closeTimedOut = await Promise.race([
    page.close().then(() => false).catch(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), 3000);
    }),
  ]);
  clearTimeout(timer);
  return closeTimedOut;
}

function incompleteCondition(engine, rel, width, errors, state = 'default') {
  return {
    engine,
    page: rel,
    width,
    state,
    auditCompleted: false,
    pageScrollsHorizontally: 0,
    overflowCount: 0,
    overflow: [],
    contrast: [],
    contrastResults: [],
    contrastUnresolved: [],
    contrastCounts: null,
    targets: [],
    targetResults: [],
    targetUnresolved: [],
    targetCounts: null,
    errors,
  };
}

async function auditEngine(engine, browserType, targetPages) {
  const browser = await browserType.launch({ headless: true });
  const findings = [];
  const photo = [];
  let closeTimedOut = false;

  try {
    for (const rel of targetPages) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await prepareLocalHttpPage(page);
          const errors = [];
          page.on('console', (m) => {
            if (m.type() !== 'error') return;
            const message = m.text();
            if (/goatcounter/.test(m.location().url || '')) return; // 自動ブラウザの計測は400で拒否される
            if (/Failed to load resource: A TLS error/.test(message)) return; // WebKitの外部計測通信
            errors.push(message.slice(0, 140));
          });
          page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

          // about.html の地図など外部埋め込みは load が返らないことがあるため domcontentloaded で待つ
          try {
            const response = await page.goto(base + rel, { waitUntil: 'domcontentloaded', timeout: 20000 });
            if (!response?.ok()) errors.push(`HTTP ${response?.status() ?? '応答なし'}`);
          } catch (error) {
            errors.push(`読み込み失敗: ${String(error).slice(0, 80)}`);
            findings.push(incompleteCondition(engine, rel, width, errors));
            if (width <= MENU_MAX_WIDTH) {
              findings.push(incompleteCondition(
                engine,
                rel,
                width,
                [...errors, 'モバイルナビ監査はページ読込失敗のため未実施'],
                'nav-open',
              ));
            }
            continue;
          }

          try {
            await page.waitForTimeout(350);
            await withTimeout(
              settleA11yMeasurement(page),
              SETTLE_TIMEOUT_MS,
              '表示安定待ち',
            );
            const condition = await measureElementAudit(page, rel);
            findings.push({ engine, page: rel, width, state: 'default', auditCompleted: true, ...condition, errors });
          } catch (error) {
            errors.push(`監査失敗: ${String(error).slice(0, 120)}`);
            findings.push(incompleteCondition(engine, rel, width, errors));
          }

          if (width <= MENU_MAX_WIDTH) {
            const menuErrors = [];
            try {
              const burger = page.locator('.nav-burger');
              const menu = page.locator('#mobNav');
              if (await burger.count() !== 1 || await menu.count() !== 1 || !await burger.isVisible()) {
                throw new Error('モバイルナビの操作要素が一意かつ可視ではありません');
              }
              await burger.click({ timeout: 3000 });
              await page.waitForFunction(
                () => document.querySelector('#mobNav')?.classList.contains('open')
                  && document.querySelector('#mobNav')?.getAttribute('aria-hidden') === 'false'
                  && document.querySelector('.nav-burger')?.getAttribute('aria-expanded') === 'true',
                null,
                { timeout: 3000 },
              );
              await page.waitForTimeout(50);
              const menuCondition = await measureElementAudit(page, rel, {
                scopeSelectors: ['#mobNav', '.nav-burger'],
                auditLayout: false,
                photoSelectors: [],
              });
              findings.push({
                engine,
                page: rel,
                width,
                state: 'nav-open',
                auditCompleted: true,
                ...menuCondition,
                errors: menuErrors,
              });
            } catch (error) {
              menuErrors.push(`モバイルナビ監査失敗: ${String(error).slice(0, 120)}`);
              findings.push(incompleteCondition(engine, rel, width, menuErrors, 'nav-open'));
            }
          }
        } finally {
          const closeTimedOut = await closePageWithTimeout(page);
          if (closeTimedOut) {
            for (const condition of findings.filter(
              (item) => item.engine === engine && item.page === rel && item.width === width,
            )) {
              condition.auditCompleted = false;
              condition.errors.push('ページ終了が3秒を超えました');
            }
          }
        }
      }
    }

    for (const target of PHOTO_TARGETS.filter((item) => targetPages.includes(item.page))) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await prepareLocalHttpPage(page);
          const response = await page.goto(base + target.page, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });
          if (!response?.ok()) {
            photo.push({
              engine,
              page: target.page,
              width,
              selector: target.selector,
              status: 'unresolved',
              reason: `http-${response?.status() ?? 'no-response'}`,
            });
            continue;
          }
          await page.waitForTimeout(500);
          await withTimeout(
            settleA11yMeasurement(page),
            SETTLE_TIMEOUT_MS,
            '写真測定の表示安定待ち',
          );
          const result = await withTimeout(
            photoContrast(page, target.selector),
            PHOTO_TIMEOUT_MS,
            '写真上文字の測定',
          );
          photo.push({ engine, page: target.page, width, ...result });
        } catch (error) {
          photo.push({
            engine,
            page: target.page,
            width,
            selector: target.selector,
            status: 'unresolved',
            reason: `measurement-error:${String(error).slice(0, 80)}`,
          });
        } finally {
          const closeTimedOut = await closePageWithTimeout(page);
          if (closeTimedOut) {
            const record = photo.at(-1);
            if (record?.engine === engine && record?.page === target.page && record?.width === width) {
              record.status = 'unresolved';
              record.reason = 'page-close-timeout';
              delete record.ratio;
              delete record.failed;
            }
          }
        }
      }
    }
  } finally {
    closeTimedOut = await closeBrowserWithTimeout(browser, engine);
  }

  return { findings, photo, closeTimedOut };
}

function pageFamily(page) {
  if (page.startsWith('blog/')) return 'blog';
  if (page.startsWith('uploads/')) return 'uploads';
  return 'root';
}

function sumCounts(conditions, key, fields) {
  const total = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const condition of conditions) {
    const counts = condition[key];
    if (!counts) continue;
    for (const field of fields) total[field] += counts[field] ?? 0;
  }
  return total;
}

function enrichOccurrences(conditions, key) {
  return conditions.flatMap((condition) => (condition[key] ?? []).map((item) => ({
    ...item,
    engine: condition.engine,
    page: condition.page,
    pageFamily: pageFamily(condition.page),
    width: condition.width,
    state: condition.state || 'default',
  })));
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function validMeasuredPhoto(item) {
  if (item.status !== 'measured'
      || !Array.isArray(item.runs)
      || item.runs.length === 0
      || !Number.isFinite(item.ratio)
      || !Number.isFinite(item.need)
      || typeof item.failed !== 'boolean') return false;
  for (const run of item.runs) {
    if (!Number.isFinite(run.ratio)
        || !Number.isFinite(run.need)
        || !Number.isFinite(run.sampledPixels)
        || run.sampledPixels <= 0
        || typeof run.failed !== 'boolean') return false;
    // JSONへは小数第3位まで保存するため、閾値直近だけは丸め幅を許容する。
    const derivedFailed = run.ratio < run.need - 0.0005;
    if (Math.abs(run.ratio - run.need) > 0.0005 && run.failed !== derivedFailed) return false;
  }
  const worst = [...item.runs].sort(
    (first, second) => first.ratio / first.need - second.ratio / second.need,
  )[0];
  return Math.abs(item.ratio - worst.ratio) <= 0.001
    && item.need === worst.need
    && item.failed === item.runs.some((run) => run.failed);
}

function clusterOccurrences(items, kind) {
  const clusters = new Map();
  for (const item of items) {
    const key = kind === 'contrast'
      ? [item.component, item.selector, item.foreground, item.bg, item.need].join('|')
      : [item.component, item.selector, item.reason || item.outcome || 'failure'].join('|');
    if (!clusters.has(key)) clusters.set(key, { key, kind, items: [] });
    clusters.get(key).items.push(item);
  }
  return [...clusters.values()].map((cluster) => {
    const pages = [...new Set(cluster.items.map((item) => item.page))].sort();
    const widths = [...new Set(cluster.items.map((item) => item.width))].sort((a, b) => a - b);
    const engines = [...new Set(cluster.items.map((item) => item.engine))].sort();
    const logicalElements = new Set(cluster.items.map((item) => `${item.page}|${item.key}`)).size;
    const summary = {
      key: cluster.key,
      kind,
      component: cluster.items[0]?.component,
      selector: cluster.items[0]?.selector,
      reason: cluster.items[0]?.reason,
      occurrences: cluster.items.length,
      logicalElements,
      affectedPages: pages.length,
      pages,
      widths,
      engines,
      representatives: cluster.items.slice(0, 3),
    };
    if (kind === 'contrast') {
      const ratios = cluster.items.map((item) => item.ratio).filter(Number.isFinite).sort((a, b) => a - b);
      summary.need = cluster.items[0]?.need;
      summary.worstRatio = ratios[0] ?? null;
      summary.medianRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
      summary.bestRatio = ratios.at(-1) ?? null;
      summary.foreground = cluster.items[0]?.foreground;
      summary.background = cluster.items[0]?.bg;
    } else if (kind === 'target') {
      const widthsPx = cluster.items.map((item) => item.w).filter(Number.isFinite);
      const heightsPx = cluster.items.map((item) => item.h).filter(Number.isFinite);
      summary.minimumWidth = widthsPx.length ? Math.min(...widthsPx) : null;
      summary.minimumHeight = heightsPx.length ? Math.min(...heightsPx) : null;
    }
    return summary;
  }).sort((a, b) => b.affectedPages - a.affectedPages || b.occurrences - a.occurrences);
}

(async () => {
  const targetPages = pages();
  const audited = await Promise.all(
    ENGINES.map(([engine, browserType]) => auditEngine(engine, browserType, targetPages)),
  );
  const conditions = audited.flatMap((result) => result.findings);
  const photo = audited.flatMap((result) => result.photo);
  const menuWidths = WIDTHS.filter((width) => width <= MENU_MAX_WIDTH);
  const expectedConditionKeys = [];
  for (const [engine] of ENGINES) for (const page of targetPages) for (const width of WIDTHS) {
    expectedConditionKeys.push(`${engine}|${page}|${width}|default`);
    if (width <= MENU_MAX_WIDTH) expectedConditionKeys.push(`${engine}|${page}|${width}|nav-open`);
  }
  const expectedConditions = expectedConditionKeys.length;
  const recordedConditionKeys = conditions.map(
    (condition) => `${condition.engine}|${condition.page}|${condition.width}|${condition.state || 'default'}`,
  );
  const expectedConditionSet = new Set(expectedConditionKeys);
  const recordedConditionSet = new Set(recordedConditionKeys);
  const missingConditionKeys = expectedConditionKeys.filter((key) => !recordedConditionSet.has(key));
  const unexpectedConditionKeys = recordedConditionKeys.filter((key) => !expectedConditionSet.has(key));
  const duplicateConditionKeys = duplicateValues(recordedConditionKeys);
  const recordedConditions = conditions.length;
  const completedConditions = conditions.filter((condition) => condition.auditCompleted).length;
  const unmeasuredConditions = Math.max(0, expectedConditions - completedConditions);
  const coverage = {
    expectedConditions,
    recordedConditions,
    completedConditions,
    unmeasuredConditions,
    missingConditionKeys,
    unexpectedConditionKeys,
    duplicateConditionKeys,
    consistent: recordedConditions === expectedConditions
      && completedConditions === expectedConditions
      && missingConditionKeys.length === 0
      && unexpectedConditionKeys.length === 0
      && duplicateConditionKeys.length === 0,
  };
  const scrolls = conditions.filter((condition) => (condition.pageScrollsHorizontally ?? 0) > 0);
  const overflowed = conditions.filter((condition) => (condition.overflowCount ?? 0) > 0);
  const errored = conditions.filter((condition) => (condition.errors ?? []).length);

  const contrastOccurrences = enrichOccurrences(conditions, 'contrast');
  const contrastUnresolved = enrichOccurrences(conditions, 'contrastUnresolved');
  const targetOccurrences = enrichOccurrences(conditions, 'targets');
  const targetUnresolved = enrichOccurrences(conditions, 'targetUnresolved');
  const contrastCounts = sumCounts(conditions, 'contrastCounts', [
    'scanned', 'excluded', 'unresolved', 'measured', 'passed', 'failed',
  ]);
  const targetCounts = sumCounts(conditions, 'targetCounts', [
    'scanned', 'excluded', 'unresolved', 'eligible', 'passedSize', 'passedSpacing', 'passed', 'failed',
  ]);
  contrastCounts.consistent = contrastCounts.scanned
    === contrastCounts.excluded
      + contrastCounts.unresolved
      + contrastCounts.passed
      + contrastCounts.failed
    && contrastCounts.measured === contrastCounts.passed + contrastCounts.failed;
  targetCounts.consistent = targetCounts.scanned
    === targetCounts.excluded
      + targetCounts.unresolved
      + targetCounts.passedSize
      + targetCounts.passedSpacing
      + targetCounts.failed
    && targetCounts.eligible
      === targetCounts.passedSize + targetCounts.passedSpacing + targetCounts.failed
    && targetCounts.passed === targetCounts.passedSize + targetCounts.passedSpacing;
  const contrastClusters = clusterOccurrences(contrastOccurrences, 'contrast');
  const contrastUnresolvedClusters = clusterOccurrences(contrastUnresolved, 'unresolved');
  const targetClusters = clusterOccurrences(targetOccurrences, 'target');
  const targetUnresolvedClusters = clusterOccurrences(targetUnresolved, 'unresolved');
  const contrastLogicalElements = new Set(
    contrastOccurrences.map((item) => `${item.page}|${item.key}`),
  ).size;
  const targetLogicalElements = new Set(
    targetOccurrences.map((item) => `${item.page}|${item.key}`),
  ).size;

  const selectedPhotoTargets = PHOTO_TARGETS.filter((item) => targetPages.includes(item.page));
  const configuredPhotoTargetKeys = selectedPhotoTargets.map((item) => `${item.page}|${item.selector}`);
  const duplicateConfiguredPhotoTargets = duplicateValues(configuredPhotoTargetKeys);
  const expectedPhotoKeys = [];
  for (const [engine] of ENGINES) for (const target of selectedPhotoTargets) for (const width of WIDTHS) {
    expectedPhotoKeys.push(`${engine}|${target.page}|${width}|${target.selector}`);
  }
  const expectedPhotoConditions = expectedPhotoKeys.length;
  const recordedPhotoKeys = photo.map(
    (item) => `${item.engine}|${item.page}|${item.width}|${item.selector}`,
  );
  const expectedPhotoSet = new Set(expectedPhotoKeys);
  const recordedPhotoSet = new Set(recordedPhotoKeys);
  const missingPhotoKeys = expectedPhotoKeys.filter((key) => !recordedPhotoSet.has(key));
  const unexpectedPhotoKeys = recordedPhotoKeys.filter((key) => !expectedPhotoSet.has(key));
  const duplicatePhotoKeys = duplicateValues(recordedPhotoKeys);
  const measuredPhoto = photo.filter((item) => item.status === 'measured');
  const excludedPhoto = photo.filter((item) => item.status === 'excluded');
  const unresolvedPhoto = photo.filter((item) => item.status === 'unresolved');
  const invalidMeasuredPhoto = measuredPhoto.filter((item) => !validMeasuredPhoto(item));
  const unknownPhotoStatus = photo.filter(
    (item) => !['measured', 'excluded', 'unresolved'].includes(item.status),
  );
  const photoFails = measuredPhoto.filter((item) => item.failed);
  const photoSummary = {
    expected: expectedPhotoConditions,
    recorded: photo.length,
    measured: measuredPhoto.length,
    excluded: excludedPhoto.length,
    unresolved: unresolvedPhoto.length,
    failed: photoFails.length,
    missingKeys: missingPhotoKeys,
    unexpectedKeys: unexpectedPhotoKeys,
    duplicateKeys: duplicatePhotoKeys,
    duplicateConfiguredTargets: duplicateConfiguredPhotoTargets,
    invalidMeasured: invalidMeasuredPhoto.length,
    unknownStatus: unknownPhotoStatus.length,
    // PHOTO_TARGETSは存在と実測を要求する明示契約。除外・未解決を
    // 「記録済み」として合格にせず、期待した全条件が測れた場合だけ整合とする。
    consistent: photo.length === expectedPhotoConditions
      && measuredPhoto.length === expectedPhotoConditions
      && excludedPhoto.length === 0
      && unresolvedPhoto.length === 0
      && missingPhotoKeys.length === 0
      && unexpectedPhotoKeys.length === 0
      && duplicatePhotoKeys.length === 0
      && duplicateConfiguredPhotoTargets.length === 0
      && invalidMeasuredPhoto.length === 0
      && unknownPhotoStatus.length === 0,
  };

  const report = {
    schemaVersion: 3,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    base,
    config: {
      engines: ENGINES.map(([engine]) => engine),
      pages: targetPages,
      widths: WIDTHS,
      thresholds: { normalContrast: AA_NORMAL, largeContrast: AA_LARGE, targetSize: TARGET_SIZE },
    },
    coverage,
    counts: { contrast: contrastCounts, targets: targetCounts, photo: photoSummary },
    occurrences: {
      contrast: contrastOccurrences,
      contrastUnresolved,
      targets: targetOccurrences,
      targetUnresolved,
    },
    clusters: {
      contrast: contrastClusters,
      contrastUnresolved: contrastUnresolvedClusters,
      targets: targetClusters,
      targetUnresolved: targetUnresolvedClusters,
    },
    photo,
    conditions,
  };

  if (asJson) {
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (outputFile) {
      const resolvedOutput = path.resolve(outputFile);
      fs.writeFileSync(resolvedOutput, serialized, 'utf8');
      console.log(`JSON保存: ${resolvedOutput}（${report.elapsedSeconds}秒）`);
    } else {
      console.log(serialized.trimEnd());
    }
  } else {
    console.log(`検証: ${ENGINES.length}エンジン × ${targetPages.length}ページ × ${WIDTHS.length}通常幅 + ナビ展開${menuWidths.length}幅 = ${expectedConditions}通り（${WIDTHS.join(' / ')}px）`);
    console.log(`条件カバレッジ: 期待${expectedConditions} / 記録${recordedConditions} / 実測${completedConditions} / 未測定${unmeasuredConditions}`);
    console.log(`ページ自体の横スクロール: ${scrolls.length ? scrolls.map((s) => `${s.engine}:${s.page}@${s.width}`).join(', ') : '0件'}`);
    console.log(`要素単位の横はみ出し: ${overflowed.length ? `${overflowed.length}条件` : '0件'}`);
    for (const item of overflowed) {
      console.log(`- ${item.engine}:${item.page}@${item.width}px ${item.overflowCount}要素 ${item.overflow.slice(0, 10).map((entry) => `${entry.selector} right=${entry.right}`).join(', ')}`);
    }
    console.log(`console / page error: ${errored.length ? errored.map((e) => `${e.engine}:${e.page}@${e.width} ${e.errors[0]}`).join(' / ') : '0件'}`);
    console.log(`文字コントラスト: 候補${contrastCounts.scanned} / 実測${contrastCounts.measured} / 除外${contrastCounts.excluded} / 未解決${contrastCounts.unresolved}`);
    console.log(`コントラスト不足: 実測${contrastOccurrences.length}件 / 論理要素${contrastLogicalElements}件 / 修正パターン${contrastClusters.length}件`);
    for (const cluster of contrastClusters) {
      const sample = cluster.representatives[0];
      console.log(`- 最悪${cluster.worstRatio}（必要${cluster.need}） ${cluster.affectedPages}ページ / ${cluster.occurrences}条件 ${cluster.component} ${cluster.selector}\n    「${sample.text}」${cluster.foreground} on ${cluster.background}`);
    }
    for (const cluster of contrastUnresolvedClusters) {
      console.log(`- 未解決 ${cluster.reason}: ${cluster.affectedPages}ページ / ${cluster.occurrences}条件 ${cluster.component} ${cluster.selector}`);
    }
    console.log(`操作領域: 候補${targetCounts.scanned} / 24px以上${targetCounts.passedSize} / Spacing例外${targetCounts.passedSpacing} / Inline等除外${targetCounts.excluded} / 未解決${targetCounts.unresolved}`);
    console.log(`操作領域の実違反: 実測${targetOccurrences.length}件 / 論理要素${targetLogicalElements}件 / 修正パターン${targetClusters.length}件`);
    for (const cluster of targetClusters) {
      const sample = cluster.representatives[0];
      console.log(`- ${cluster.minimumWidth}×${cluster.minimumHeight}px ${cluster.affectedPages}ページ / ${cluster.occurrences}条件 ${cluster.component} ${cluster.selector}「${sample.text}」`);
    }
    for (const cluster of targetUnresolvedClusters) {
      console.log(`- 未解決 ${cluster.reason}: ${cluster.affectedPages}ページ / ${cluster.occurrences}条件 ${cluster.component} ${cluster.selector}`);
    }
    console.log(`写真上の文字: 期待${photoSummary.expected} / 記録${photoSummary.recorded} / 実測${photoSummary.measured} / 除外${photoSummary.excluded} / 未解決${photoSummary.unresolved} / 不足${photoSummary.failed}`);
    for (const item of photo) {
      const detail = item.status === 'measured'
        ? `${item.ratio}（必要${item.need}）`
        : `${item.status}:${item.reason}`;
      console.log(`- ${item.engine}:${item.page}@${item.width}px ${item.selector} = ${detail}`);
    }
  }

  const fatal = (coverage.consistent ? 0 : 1)
    + (contrastCounts.consistent ? 0 : 1)
    + (targetCounts.consistent ? 0 : 1)
    + scrolls.length
    + overflowed.length
    + errored.length
    + contrastOccurrences.length
    + contrastUnresolved.length
    + targetOccurrences.length
    + targetUnresolved.length
    + photoFails.length
    + unresolvedPhoto.length
    + (photoSummary.consistent ? 0 : 1);
  const measurementFatal = (coverage.consistent ? 0 : 1)
    + (contrastCounts.consistent ? 0 : 1)
    + (targetCounts.consistent ? 0 : 1)
    + errored.length
    + contrastUnresolved.length
    + targetUnresolved.length
    + (photoSummary.consistent ? 0 : 1);
  const exitCode = (checkOnly && fatal) || (checkMeasurement && measurementFatal) ? 1 : 0;
  if (audited.some((result) => result.closeTimedOut)) {
    // Playwright WebKitの残ったパイプでNodeが待ち続けないよう、出力後にだけ終了する。
    setTimeout(() => process.exit(exitCode), 50);
  } else if (exitCode) {
    process.exitCode = exitCode;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
