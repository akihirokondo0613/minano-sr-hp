/**
 * 文字の読みやすさと操作領域の実測監査（Playwright）
 *
 *   node scripts/audit-a11y.cjs [base] [--check] [--json]
 *   例) node scripts/audit-a11y.cjs http://127.0.0.1:8811/
 *
 * verify-ui.cjs と同じく playwright を必要とする手元の検証ツール（CIでは走らせていない）。
 * 未導入なら scratchpad 等に入れて NODE_PATH / PLAYWRIGHT_BROWSERS_PATH を渡す。
 *
 * 見るもの:
 *   1. 横はみ出し … ページ自体が横スクロールするか（overflow-x:auto の中の表は対象外）
 *   2. 文字コントラスト … 背景色から算出。写真の上の文字は色から計算できないため
 *      PHOTO_TARGETS に登録した要素だけ「文字を透明にして背景の実ピクセルを測る」方式で別に測る
 *   3. 操作領域 … a / button が 24×24px 以上か（本文中のインラインリンクは WCAG 2.2 の除外対象）
 *   4. console error / page error
 *
 * 数値の出どころを人の記憶に置かないための道具。監査結果を報告するときはこの出力を根拠にする。
 */

const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8811/').replace(/\/?$/, '/');
const checkOnly = args.includes('--check');
const asJson = args.includes('--json');

const root = path.resolve(__dirname, '..');
const WIDTHS = [320, 360, 375, 390, 402, 430, 640, 768, 900, 1024, 1440, 2560];
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];

// 写真の上に乗る文字。背景色では測れないので実ピクセルで測る対象。
const PHOTO_TARGETS = [
  { page: 'index.html', selector: '.hero-sub', widths: [320, 390, 430, 768, 1280] },
  { page: 'index.html', selector: '.hero-sub-link', widths: [320, 390, 430] },
  // aria-hidden の装飾キャプション。薄く出すのが意図だが、数値を隠さないため測っておく。
  { page: 'index.html', selector: '.hero-eng-cap', widths: [1280, 1440] },
];

const AA_NORMAL = 4.5;
const AA_LARGE = 3;
const TARGET_SIZE = 24;
const UPGRADE_INSECURE_META =
  /<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">/gi;

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
  return list;
}

const PAGE_AUDIT = `() => {
  const parse = (c) => {
    const m = (c || '').match(/[\\d.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // 背景を親へ遡って解決。画像・グラデーションが挟まれたら「算出不能」として除く。
  const bgOf = (el) => {
    let cur = el, acc = null;
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c;
        if (acc.a >= 0.999) return acc;
      }
      cur = cur.parentElement;
    }
    return acc && acc.a >= 0.999 ? acc : { r: 255, g: 255, b: 255, a: 1 };
  };
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) {
      s += '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.');
    }
    return s;
  };
  const scrollableAncestor = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };

  const vw = document.documentElement.clientWidth;
  const contrast = [], targets = [], overflow = [];
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;

    const intentionallyOffscreen = el.matches('.skip-link:not(:focus)');
    // image-slotの枠自体は監査し、構図調整で枠内だけ拡大した公開画像は除外する。
    const intentionallyClippedMedia = el.matches('image-slot > img[data-image-slot-public]')
      && getComputedStyle(el.parentElement).overflowX === 'hidden';
    if (!intentionallyOffscreen
        && !intentionallyClippedMedia
        && (r.right > vw + 1 || r.left < -1)
        && !scrollableAncestor(el)) {
      overflow.push({ sel: label(el), right: Math.round(r.right) });
    }

    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasOwnText) {
      const bg = bgOf(el), fg = parse(cs.color);
      if (bg && fg) {
        const eff = fg.a < 1 ? over(fg, bg) : fg;
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && parseFloat(cs.fontWeight) >= 700);
        const need = large ? ${AA_LARGE} : ${AA_NORMAL};
        const cr = ratio(eff, bg);
        if (cr < need) {
          contrast.push({
            sel: label(el), text: el.textContent.trim().slice(0, 30),
            ratio: +cr.toFixed(2), need, size: Math.round(size),
            color: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')',
            decorative: el.closest('[aria-hidden="true"]') !== null,
          });
        }
      }
    }

    if (/^(a|button)$/i.test(el.tagName) && r.width > 0 && (r.width < ${TARGET_SIZE} || r.height < ${TARGET_SIZE})) {
      // 本文中のインラインリンクは WCAG 2.2 の適用除外
      const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline'
        && el.parentElement && /^(P|LI|TD|DD|SPAN)$/.test(el.parentElement.tagName)
        && el.parentElement.textContent.trim() !== el.textContent.trim();
      if (!inline) {
        targets.push({ sel: label(el), text: el.textContent.trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
  });
  return {
    pageScrollsHorizontally: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowCount: overflow.length,
    overflow: overflow.slice(0, 10),
    contrast: contrast.slice(0, 20),
    targets: targets.slice(0, 10),
  };
}`;

// 文字を透明にして背景の実ピクセルからコントラストを測る（写真の上の文字用）
async function photoContrast(page, selector) {
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rects = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 4 && r.height > 4) rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }
    return { rects, color: getComputedStyle(el).color };
  }, selector);
  if (!info || !info.rects.length) return null;

  await page.addStyleTag({ content: `${selector}, ${selector} * { color: transparent !important; text-shadow: none !important }` });
  await page.waitForTimeout(120);
  const shot = await page.screenshot();
  // 呼び出し元で直後にページを閉じるため、WebKitが停止し得る不要な再読み込みはしない。

  const { PNG } = tryLoadPng();
  if (!PNG) return { selector, ratio: null, note: 'pngjs が無いため実ピクセル測定を省略' };
  const img = PNG.sync.read(shot);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  const fg = info.color.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lf = lum(fg[0], fg[1], fg[2]);

  let worst = Infinity;
  for (const r of info.rects) {
    const xs = [], ys = [];
    for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(img.width, Math.ceil(r.x + r.w)); x += 2) xs.push(x);
    for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(img.height, Math.ceil(r.y + r.h)); y += 1) ys.push(y);
    const ls = [];
    for (const y of ys) for (const x of xs) {
      const i = (img.width * y + x) << 2;
      ls.push(lum(img.data[i], img.data[i + 1], img.data[i + 2]));
    }
    if (!ls.length) continue;
    ls.sort((a, b) => a - b);
    const lb = ls[Math.floor(ls.length * 0.1)]; // 1ピクセルの外れ値に振られないよう暗い側10%
    const cr = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
    if (cr < worst) worst = cr;
  }
  return { selector, ratio: worst === Infinity ? null : +worst.toFixed(2) };
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

async function auditEngine(engine, browserType, targetPages) {
  const browser = await browserType.launch({ headless: true });
  const findings = [];
  const photo = [];
  let closeTimedOut = false;

  try {
    for (const rel of targetPages) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
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
          await page.goto(base + rel, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (e) {
          findings.push({
            engine,
            page: rel,
            width,
            pageScrollsHorizontally: 0,
            overflowCount: 0,
            overflow: [],
            contrast: [],
            targets: [],
            errors: [`読み込み失敗: ${String(e).slice(0, 80)}`],
          });
          await page.close();
          continue;
        }
        await page.waitForTimeout(350);
        await activateAsyncStyles(page);
        // content-visibility:auto の節も測るため一度末尾まで送る
        await page.evaluate(async () => {
          document.documentElement.style.scrollBehavior = 'auto';
          const h = document.documentElement.scrollHeight;
          for (let y = 0; y < h; y += 700) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 12));
          }
          window.scrollTo(0, 0);
          await new Promise((resolve) => setTimeout(resolve, 150));
        });
        const res = await page.evaluate(`(${PAGE_AUDIT})()`);
        if (!res || !Number.isInteger(res.overflowCount)) {
          throw new Error(`${engine}:${rel}@${width}px 要素監査の結果を取得できませんでした`);
        }
        findings.push({ engine, page: rel, width, ...res, errors });
        await page.close();
      }
    }

    for (const target of PHOTO_TARGETS) {
      for (const width of target.widths) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await prepareLocalHttpPage(page);
        await page.goto(base + target.page, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(500);
        await activateAsyncStyles(page);
        const result = await photoContrast(page, target.selector);
        if (result) photo.push({ engine, page: target.page, width, ...result });
        await page.close();
      }
    }
  } finally {
    closeTimedOut = await closeBrowserWithTimeout(browser, engine);
  }

  return { findings, photo, closeTimedOut };
}

(async () => {
  const targetPages = pages();
  const audited = await Promise.all(
    ENGINES.map(([engine, browserType]) => auditEngine(engine, browserType, targetPages)),
  );
  const findings = audited.flatMap((result) => result.findings);
  const photo = audited.flatMap((result) => result.photo);
  const conditions = findings.length;
  const scrolls = findings.filter((f) => (f.pageScrollsHorizontally ?? 0) > 0);
  const overflowed = findings.filter((f) => (f.overflowCount ?? 0) > 0);
  const errored = findings.filter((f) => (f.errors ?? []).length);
  const contrast = new Map();
  const targets = new Map();
  for (const f of findings) {
    for (const c of f.contrast ?? []) {
      if (c.color.startsWith('rgba(0, 0, 0, 0)')) continue; // background-clip:text の装飾数字
      contrast.set(`${f.engine}|${f.page}|${c.sel}|${c.ratio}`, {
        ...c,
        engine: f.engine,
        page: f.page,
      });
    }
    for (const t of f.targets ?? []) {
      targets.set(`${f.engine}|${f.page}|${t.sel}|${t.w}x${t.h}`, {
        ...t,
        engine: f.engine,
        page: f.page,
      });
    }
  }
  const photoFails = photo.filter((p) => p.ratio !== null && p.ratio < AA_NORMAL);

  if (asJson) {
    console.log(JSON.stringify({ base, conditions, findings, photo }, null, 2));
  } else {
    console.log(`検証: ${ENGINES.length}エンジン × ${targetPages.length}ページ × ${WIDTHS.length}画面幅 = ${conditions}通り（${WIDTHS.join(' / ')}px）`);
    console.log(`ページ自体の横スクロール: ${scrolls.length ? scrolls.map((s) => `${s.engine}:${s.page}@${s.width}`).join(', ') : '0件'}`);
    console.log(`要素単位の横はみ出し: ${overflowed.length ? `${overflowed.length}条件` : '0件'}`);
    for (const item of overflowed) {
      console.log(`- ${item.engine}:${item.page}@${item.width}px ${item.overflowCount}要素 ${item.overflow.map((entry) => `${entry.sel} right=${entry.right}`).join(', ')}`);
    }
    console.log(`console / page error: ${errored.length ? errored.map((e) => `${e.engine}:${e.page}@${e.width} ${e.errors[0]}`).join(' / ') : '0件'}`);
    console.log(`背景色から算出したコントラスト不足: ${contrast.size}件`);
    for (const c of [...contrast.values()].sort((a, b) => a.ratio - b.ratio)) {
      console.log(`- ${c.ratio}（必要${c.need}） ${c.size}px ${c.sel} ${c.engine}:${c.page}${c.decorative ? '  ※aria-hidden の装飾' : ''}\n    「${c.text}」${c.color} on ${c.bg}`);
    }
    console.log(`操作領域24px未満: ${targets.size}件`);
    for (const t of targets.values()) console.log(`- ${t.w}x${t.h} ${t.sel}「${t.text}」${t.engine}:${t.page}`);
    console.log(`写真の上の文字（実ピクセル測定）:`);
    for (const p of photo) console.log(`- ${p.engine}:${p.page}@${p.width}px ${p.selector} = ${p.ratio ?? p.note}`);
  }

  const fatal = scrolls.length + overflowed.length + errored.length + photoFails.length;
  const exitCode = checkOnly && fatal ? 1 : 0;
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
