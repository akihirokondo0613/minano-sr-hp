/**
 * ページ内リンクの着地回帰テスト（iPhone 14相当のWebKit・Pixel 7相当のChromium）。
 *
 *   node scripts/test-anchor-landing.cjs [base] [--json] [--all]
 *
 * 共通CSSの content-visibility:auto（仮の高さ900px）のまま移動先を計算すると、スクロール中に
 * 節が実寸へ伸び縮みして移動先が数千pxずれる（2026-10-18、トップ#faqで約3,200px、
 * SPA遷移の料金#retainer-extra-feesで約3,400px）。①#付きURLの直接表示 ②リンクのクリック の両方で、
 * 着地後の移動先の上端が固定ヘッダーの下（0〜160px、または scroll-padding＋scroll-margin の近く）に
 * 入るかを測る。既定は過去にずれた代表の組み合わせだけ。--all は全公開ページの全ページ内リンク
 * （約580件×2エンジン、十数分）を測る。社内書式 shoshiki.html は scripts/test-shoshiki.cjs が測る。
 * 移動先が非表示（タブ・アコーディオン内）なら除外して記録し、測定0件は失敗にする。
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, devices } = require('playwright');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/').replace(/\/?$/, '/');
const asJson = args.includes('--json');
const all = args.includes('--all');
const root = path.resolve(__dirname, '..');
const baseUrl = new URL(base);
const UPGRADE_INSECURE_META =
  /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*content=["'][^"']*upgrade-insecure-requests[^"']*["'][^>]*>/gi;
const ENGINES = [
  ['webkit', webkit, devices['iPhone 14']],
  ['chromium', chromium, devices['Pixel 7']],
];
const MAX_TOP = 160;
const WORKERS = all ? 4 : 2;

// 過去にずれた組み合わせ（same=同じページ内のリンク、cross=他ページからのリンク）。
const CASES = [
  { page: 'index.html', id: 'faq' },
  { page: 'index.html', id: 'tools' },
  { page: 'about.html', id: 'access' },
  { page: 'infographic.html', id: 'timing' },
  { page: 'partner.html', id: 'contact' },
  { page: 'shika-baseup.html', id: 'houkoku' },
  { page: 'joseikin.html', id: 'jinzai' },
  { page: 'support.html', id: 'req-komon' },
  { page: 'uploads/lp-kyujinhyo.html', id: 'price' },
  { page: 'uploads/lp-kyujinhyo.html', id: 'form' },
  { page: 'pricing.html', id: 'retainer-extra-fees', from: 'uploads/service-romu-sodan.html' },
  { page: 'pricing.html', id: 'plan-custom', from: 'index.html' },
  { page: 'services.html', id: 'tools', from: 'index.html' },
  { page: 'index.html', id: 'faq', from: 'about.html' },
  { page: 'about.html', id: 'access', from: 'blog.html' },
];

function publicPages() {
  const skipDirs = new Set(['scripts', 'docs', '.github', '.claude', '.git', 'node_modules', 'shoshiki']);
  const skipFiles = new Set(['admin-post.html', 'icon-catalog.html', 'shoshiki.html', '404.html']);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) return skipDirs.has(relative.split('/')[0]) || entry.name.startsWith('_backup') ? [] : walk(full);
    return relative.endsWith('.html') && !skipFiles.has(relative) ? [relative] : [];
  });
  return walk(root).sort();
}

// 公開HTMLの href から、同じページ内のリンクと他ページの #付きリンクを拾う。
function collectLinks(pages) {
  const read = (page) => fs.readFileSync(path.join(root, page), 'utf8');
  const ids = new Map(pages.map((page) => [page, new Set([...read(page).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
  const links = [];
  const seen = new Set();
  for (const page of pages) {
    const html = read(page).replace(/<script[\s\S]*?<\/script>/gi, '');
    for (const match of html.matchAll(/href="([^"]*#[^"]+)"/g)) {
      const href = match[1].replace(/&amp;/g, '&');
      if (/^(https?:|mailto:|tel:|javascript:)/i.test(href)) continue;
      const url = new URL(href, `http://site.invalid/${page}`);
      let target = url.pathname.slice(1) || 'index.html';
      if (target.endsWith('/')) target += 'index.html';
      let id;
      try { id = decodeURIComponent(url.hash.slice(1)); } catch { id = url.hash.slice(1); }
      const from = target === page ? undefined : page;
      const key = from ? `${target}#${id}` : `${page}#${id}#same`;
      if (!ids.has(target)) continue;
      // 他ページからのリンクは移動先ごとに1件（ブログ記事以外の出発点を優先）。
      if (seen.has(key)) {
        const existing = links.find((link) => `${link.page}#${link.id}` === `${target}#${id}` && link.from);
        if (from && existing && existing.from.startsWith('blog/') && !from.startsWith('blog/')) existing.from = from;
        continue;
      }
      seen.add(key);
      links.push({ page: target, id, from, missingTarget: !ids.get(target).has(id) });
    }
  }
  return links;
}

async function newContext(browser, device) {
  const context = await browser.newContext({ ...device, reducedMotion: 'no-preference' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // 検査は自分の静的サーバーだけ。外部の計測・窓口の通信を切り離す。
    if (url.origin !== baseUrl.origin) return route.abort();
    if (baseUrl.protocol === 'http:' && request.resourceType() === 'document') {
      // WebKitがローカルHTTPのサブリソースをHTTPS化しないよう、文書のCSP metaだけ外す。
      // 並列取得でまれに接続が切れるので1回だけ取り直す（2回目も失敗すれば読み込み失敗として記録される）。
      let response;
      try {
        response = await route.fetch();
      } catch {
        try {
          response = await route.fetch();
        } catch {
          return route.abort().catch(() => {});
        }
      }
      if (!(response.headers()['content-type'] || '').includes('text/html')) return route.fulfill({ response });
      return route.fulfill({ response, body: (await response.text()).replace(UPGRADE_INSECURE_META, '') });
    }
    return route.continue();
  });
  return context;
}

// scroll-behavior:smooth の移動が止まるまで待つ（最低 minMs、最大6秒）。
async function settle(page, minMs) {
  const started = Date.now();
  let last = null;
  let still = 0;
  while (Date.now() - started < 6000) {
    await page.waitForTimeout(100);
    const y = await page.evaluate(() => Math.round(window.scrollY)).catch(() => null);
    still = y === last ? still + 1 : 0;
    last = y;
    if (Date.now() - started >= minMs && still >= 4) return;
  }
}

async function measure(page, id) {
  return page.evaluate((targetId) => {
    const el = document.getElementById(targetId);
    if (!el) return { missing: true };
    const de = document.documentElement;
    const rect = el.getBoundingClientRect();
    const visible = (rect.width > 0 || rect.height > 0)
      && (el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : true);
    const offset = (parseFloat(getComputedStyle(de).scrollPaddingTop) || 0) + (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
    const result = {
      top: Math.round(rect.top), expected: Math.round(offset), visible,
      scrollY: Math.round(window.scrollY), maxScroll: Math.round(de.scrollHeight - window.innerHeight),
      url: location.pathname + location.hash,
    };
    // 末尾で頭打ちか（本来届かない位置か）は、全節を描画した本来の高さで判定する。
    const style = document.createElement('style');
    style.textContent = '*{content-visibility:visible!important}';
    document.head.appendChild(style);
    result.trueTargetY = Math.round(el.getBoundingClientRect().top + window.scrollY);
    result.trueMaxScroll = Math.round(de.scrollHeight - window.innerHeight);
    style.remove();
    return result;
  }, id);
}

function verdict(m) {
  if (!m || m.missing) return 'missing';
  if (!m.visible) return 'hidden';
  const limit = Math.max(MAX_TOP, m.expected + 24);
  if (m.top >= -2 && m.top <= limit) return 'ok';
  // ページ末尾で、それ以上スクロールできない位置にある移動先は正常。
  if (m.top > limit && m.scrollY >= m.maxScroll - 2 && m.trueTargetY - m.expected > m.trueMaxScroll + 2) return 'ok-bottom';
  return 'ng';
}

async function clickLink(page, targetPage, id) {
  const found = await page.evaluate(({ targetPage, id }) => {
    const normalize = (href) => href.replace(/\/index\.html(?=#|$)/, '/');
    const want = normalize(new URL(`${targetPage}#${id}`, `${location.origin}/`).href);
    const anchors = [...document.querySelectorAll('a[href]')];
    const candidates = anchors.map((a, index) => ({ a, index })).filter(({ a }) => normalize(a.href) === want);
    if (!candidates.length) return { index: -1 };
    const visible = candidates.find(({ a }) => {
      const rect = a.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (a.checkVisibility ? a.checkVisibility({ checkVisibilityCSS: true }) : true);
    });
    const chosen = visible || candidates[0];
    // トップの書式見本の名前リンクは home-form-gallery.js が横レールごと表示する（ページ内移動ではない）。
    return { index: chosen.index, visible: Boolean(visible), widget: chosen.a.hasAttribute('data-fg-select') };
  }, { targetPage, id });
  if (found.index < 0) return 'no-link';
  if (found.widget) return 'widget';
  const link = page.locator('a[href]').nth(found.index);
  if (found.visible) {
    try {
      await link.click({ timeout: 4000 });
      return 'click';
    } catch {
      // 固定UIが被る等で押せない場合は、同じクリックイベントをリンクへ送る。
    }
  }
  // 閉じたメニュー内のリンク等。クリックイベントは同じ経路（page-enter.js）を通る。
  await link.evaluate((a) => a.click());
  return 'script-click';
}

async function runCase(page, item) {
  const record = { page: item.page, id: item.id, from: item.from || null };
  await page.goto('about:blank');
  await page.goto(new URL(`${item.page}#${encodeURIComponent(item.id)}`, base).href, { waitUntil: 'load', timeout: 30000 });
  await settle(page, 1200);
  record.direct = await measure(page, item.id);
  record.directVerdict = verdict(record.direct);

  await page.goto('about:blank');
  await page.goto(new URL(item.from || item.page, base).href, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  record.clickedBy = await clickLink(page, item.page, item.id);
  if (record.clickedBy === 'no-link' || record.clickedBy === 'widget') {
    record.clickVerdict = record.clickedBy;
    return record;
  }
  if (item.from) {
    await page.waitForURL((url) => url.pathname.endsWith(`/${item.page}`)
      || (item.page === 'index.html' && url.pathname.endsWith('/')), { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('load').catch(() => {});
    // SPA遷移はカーテンのめくりと合わせ直し（最大2秒）を待つ。
    await settle(page, 3000);
  } else {
    await settle(page, 1200);
  }
  record.click = await measure(page, item.id);
  record.clickVerdict = verdict(record.click);
  return record;
}

(async () => {
  const links = all ? collectLinks(publicPages()) : CASES;
  const missingTargets = links.filter((link) => link.missingTarget);
  const queue = links.filter((link) => !link.missingTarget);
  const results = [];
  const pageErrors = [];
  await Promise.all(ENGINES.map(async ([engine, browserType, device]) => {
    const browser = await browserType.launch();
    try {
      const context = await newContext(browser, device);
      const jobs = queue.slice();
      await Promise.all(Array.from({ length: WORKERS }, async () => {
        const page = await context.newPage();
        page.on('pageerror', (error) => pageErrors.push(`${engine} ${page.url()}: ${String(error).slice(0, 200)}`));
        while (jobs.length) {
          const item = jobs.shift();
          try {
            results.push({ engine, ...(await runCase(page, item)) });
          } catch (error) {
            results.push({ engine, page: item.page, id: item.id, from: item.from || null, error: String(error).slice(0, 300) });
          }
        }
      }));
    } finally {
      await browser.close();
    }
  }));

  const label = (r) => `${r.engine} ${r.from ? `${r.from} → ` : ''}${r.page}#${r.id}`;
  const failures = [];
  for (const r of results) {
    if (r.error) failures.push(`${label(r)}: ${r.error}`);
    if (r.directVerdict === 'ng') failures.push(`${label(r)}: #付きURLの着地 ${r.direct.top}px（想定 ${r.direct.expected}px）`);
    if (r.clickVerdict === 'ng') failures.push(`${label(r)}: クリック後の着地 ${r.click.top}px（想定 ${r.click.expected}px・${r.clickedBy}）`);
    if (!all && r.clickVerdict === 'no-link') failures.push(`${label(r)}: 出発ページにリンクがありません`);
    if (!all && (r.directVerdict === 'hidden' || r.directVerdict === 'missing')) failures.push(`${label(r)}: 移動先が${r.directVerdict === 'hidden' ? '非表示' : '見つかりません'}`);
  }
  for (const link of missingTargets) failures.push(`${link.from || link.page} → ${link.page}#${link.id}: 移動先のidがありません`);
  const measured = results.filter((r) => ['ok', 'ok-bottom', 'ng'].includes(r.directVerdict) || ['ok', 'ok-bottom', 'ng'].includes(r.clickVerdict));
  if (!measured.length) failures.push('着地を1件も測れていません');
  failures.push(...pageErrors);
  const excluded = results.filter((r) => r.directVerdict === 'hidden' || ['no-link', 'widget'].includes(r.clickVerdict))
    .map((r) => `${label(r)}（${r.directVerdict === 'hidden' ? '移動先が非表示' : r.clickVerdict === 'widget' ? 'クリックは書式見本の横レール操作' : '出発ページにリンクなし'}）`);

  const report = {
    base, mode: all ? 'all' : 'cases', cases: queue.length, measured: measured.length,
    excluded, failures,
    results: results.map((r) => ({
      engine: r.engine, page: r.page, id: r.id, from: r.from,
      direct: r.direct ? r.direct.top : null, directVerdict: r.directVerdict,
      click: r.click ? r.click.top : null, clickVerdict: r.clickVerdict, clickedBy: r.clickedBy, error: r.error,
    })),
  };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`ページ内リンク着地: ${measured.length}/${results.length}件を測定（${report.mode}）`);
    for (const line of failures) console.log(`✗ ${line}`);
    if (excluded.length) console.log(`クリック測定の除外: ${excluded.length}件`);
  }
  if (failures.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
