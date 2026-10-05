/**
 * 書式・窓口 / 社内書式の画面、印刷、会社情報、遷移の回帰検査。
 *
 *   node scripts/test-shoshiki.cjs [base] [--json]
 *
 * Playwright は既存の Performance CI で実行する。固定幅の A4 用紙は
 * 狭い画面で横へスクロールする仕様のため、document.scrollWidth だけで
 * 不合格にせず、実際の操作到達と用紙内の要素・文字の矩形を測る。
 * 外部窓口や Google フォームへの送信は行わない。
 */

const { chromium, webkit } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const baseUrl = new URL(base);
const asJson = args.includes('--json');
const root = path.resolve(__dirname, '..');
const WIDTHS = [320, 390, 768, 1280];
const PORTAL_WIDTHS = [320, 360, 361, 390, 768, 1280];
const ENGINES = [['chromium', chromium], ['webkit', webkit]];
const EPSILON = 1;
const EXPECTED_FORM_COUNT = 50;
const EXPECTED_TABLE_CATEGORIES = 10;
const RETIRED_OFFICE_FILES = [
  'shoshiki/D-31_shukkinbo.xlsx', 'shoshiki/D-32_nenkyu-kanribo.xlsx',
  'shoshiki/dl/word-7kq3x9/shanai-shoshiki-word-202609.zip',
  'shoshiki/dl/word-7kq3x9/shanai-shoshiki-word-202610.zip',
];
const PROCEDURE_PDFS = [
  'assets/download/procedure-establishment.pdf',
  'assets/download/procedure-onboarding.pdf',
  'assets/download/procedure-retirement.pdf',
  'assets/download/procedure-leave.pdf',
];
const ONBOARDING_KIT_FILES = [
  ['assets/download/onboarding-kit/guide.pdf', '準備ガイド'],
  ['assets/download/onboarding-kit/labor-notice.xlsx', '労働条件通知書'],
  ['assets/download/onboarding-kit/personal.pdf', '本人情報'],
  ['assets/download/onboarding-kit/bank.pdf', '口座振込同意書'],
  ['assets/download/onboarding-kit/commute.pdf', '通勤経路'],
  ['assets/download/onboarding-kit/emergency.pdf', '緊急連絡先'],
  ['assets/download/onboarding-kit.zip', '入社書類セット8点'],
];
// 入社セットのExcel・ZIPだけを例外とし、旧Office配布の再開は認めない。
const ONBOARDING_OFFICE_PATHS = [
  '/assets/download/onboarding-kit/labor-notice.xlsx',
  '/assets/download/onboarding-kit.zip',
];
// CIの静的サーバーは下位ディレクトリのindexを補完しない。
// 案内本文・操作は明示indexで検査し、公開ディレクトリURLは本番GETで照合する。
const LEGACY_LANDING = 'shoshiki/dl/word-7kq3x9/index.html';
// D-27 の離職経緯に3択を用意する改訂後の全50書式。
const EXPECTED_CHECKBOX_COUNT = 380;
const PDF_FORMS = ['D-04', 'D-18', 'D-27', 'D-40', 'D-45', 'D-52'];
const COMPANY_PRINT_FORMS = [
  ['D-18', ['name', 'dept', 'tel']],
  ['D-27', ['name', 'title', 'rep']],
  ['D-40', ['name', 'title', 'rep']],
  ['D-52', ['name', 'title', 'rep']],
];
const CO_KEY = 'shoshiki.company';
const CO_FIELDS = ['name', 'title', 'rep', 'addr', 'tel', 'dept'];
const COMPANY = {
  name: 'QA株式会社', title: 'QA役職', rep: 'QA代表',
  addr: 'QA県QA市QA1', tel: 'QA-TEL-0000', dept: 'QA部署',
};
const IMPORT_COMPANY = {
  name: 'QA取込株式会社', title: 'QA取込役職', rep: 'QA取込代表',
  addr: 'QA取込所在地', tel: 'QA-IMPORT-0000', dept: 'QA取込部署',
};
const UPGRADE_INSECURE_META =
  /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']upgrade-insecure-requests["']\s*\/?\s*>/gi;
const failures = [];
const results = [];
const printResults = [];
const mergePrintResults = [];
const behaviorResults = [];
const navigationResults = [];
const mobileResults = [];
const tableScrollResults = [];
const tableNameResults = [];
const sectionResults = [];
const artifacts = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function equalCompany(actual, expected) {
  return CO_FIELDS.every((key) => (actual?.[key] || '') === (expected?.[key] || ''));
}

async function artifactPath(name) {
  if (!process.env.RUNNER_TEMP) return null;
  const directory = path.join(process.env.RUNNER_TEMP, 'layout-results', 'shoshiki');
  await fs.mkdir(directory, { recursive: true });
  return path.join(directory, name);
}

async function screenshot(page, name, fullPage = true) {
  const target = await artifactPath(`${name}.png`);
  if (!target) return;
  await page.screenshot({ path: target, fullPage, animations: 'disabled' });
  artifacts.push({ type: 'screenshot', path: target });
}

async function prepareContext(browser, initOptions, contextOptions = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce', acceptDownloads: true,
    ...contextOptions,
  });
  // 検査は自分の静的サーバーだけ。外部 analytics / 窓口の通信を切り離す。
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== baseUrl.origin) {
      await route.abort();
      return;
    }
    if (baseUrl.protocol === 'http:' && request.resourceType() === 'document') {
      // 既存検査と同じく local HTTP の document だけ CSP meta を除去。
      // 本番 HTTPS のポリシー、CSS、JS は変更しない。
      const response = await route.fetch();
      const mime = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (mime !== 'text/html') {
        // downloadがdocumentリクエストになる場合もある。バイナリを
        // UTF-8の文字列に変換せず、取得したレスポンスのまま渡す。
        await route.fulfill({ response });
        return;
      }
      const html = await response.text();
      await route.fulfill({ response, body: html.replace(UPGRADE_INSECURE_META, '') });
      return;
    }
    await route.continue();
  });
  await context.addInitScript(({ key, options }) => {
    window.__qaDocumentToken = `${Date.now()}-${Math.random()}`;
    if (!options) return;
    if (options.raw !== undefined) localStorage.setItem(key, options.raw);
    if (!options.throwMethods) return;
    for (const method of options.throwMethods) {
      const native = Storage.prototype[method];
      Storage.prototype[method] = function (...values) {
        if (values[0] === key) throw new DOMException('QA storage unavailable', 'SecurityError');
        return native.apply(this, values);
      };
    }
  }, { key: CO_KEY, options: initOptions });
  return context;
}

async function monitoredPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(20000);
  const errors = [];
  const httpErrors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (new URL(response.url()).origin === baseUrl.origin && response.status() >= 400) {
      httpErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  return { page, errors, httpErrors };
}

async function settle(page) {
  await page.evaluate(async () => {
    await Promise.race([
      document.fonts.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('font ready timeout')), 10000)),
    ]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function goto(page, relative) {
  const response = await page.goto(new URL(relative, base).href, { waitUntil: 'domcontentloaded' });
  if (!response || !response.ok()) throw new Error(`${relative}: HTTP ${response?.status() ?? 'no response'}`);
  await settle(page);
}

async function revealSections(page, details) {
  const sections = page.locator('.rv, .page-hero, main section, .bottom-cta-card');
  for (let index = 0; index < await sections.count(); index += 1) {
    await sections.nth(index).scrollIntoViewIfNeeded();
    await settle(page);
  }
  const mainSections = page.locator('main > section');
  const count = await mainSections.count();
  const expected = details.relative === 'shoshiki.html' ? 7 : 4;
  check(count === expected, `${details.engine}:${details.relative}@${details.width}px:main節数 ${count} ≠ ${expected}`);
  for (let index = 0; index < count; index += 1) {
    const section = mainSections.nth(index);
    await section.evaluate((element) => {
      element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
      const nav = document.getElementById('nav');
      const offset = (nav?.getBoundingClientRect().height || 0) + 16;
      window.scrollBy({ top: -offset, behavior: 'instant' });
    });
    await settle(page);
    let paintReady = false;
    const handle = await section.elementHandle();
    try {
      // IOの配信とCSS反映を待つ。長すぎてthresholdを満たせない節も、
      // 待ちを延長して黙って通さず、この上限後に実数を記録する。
      await page.waitForFunction((element) => {
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
            || Number(style.opacity) <= 0) return false;
          if ((ancestor.classList.contains('rv') || ancestor.classList.contains('rvl'))
            && !ancestor.classList.contains('on')) return false;
        }
        return true;
      }, handle, { timeout: 1500, polling: 100 });
      paintReady = true;
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
    } finally {
      await handle.dispose();
    }
    const metrics = await section.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const intersection = (r, bottom) => {
        const width = Math.max(0, Math.min(r.right, viewportWidth) - Math.max(r.left, 0));
        const height = Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, 0));
        return { width, height, area: width * height,
          ratio: r.width > 0 && r.height > 0 ? width * height / (r.width * r.height) : 0 };
      };
      const ancestors = [];
      let effectiveOpacity = 1;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        effectiveOpacity *= Number(style.opacity);
        ancestors.push({ selector: ancestor.id ? `#${ancestor.id}` : ancestor.tagName.toLowerCase(),
          rv: ancestor.classList.contains('rv') || ancestor.classList.contains('rvl'),
          on: ancestor.classList.contains('on'), opacity: Number(style.opacity),
          display: style.display, visibility: style.visibility });
      }
      let measuredElements = 0;
      let measuredTextRects = 0;
      let viewportTextRects = 0;
      for (const child of [element, ...element.querySelectorAll('*')]) {
        const style = getComputedStyle(child);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
          || Number(style.opacity) <= 0 || ['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(child.tagName)) continue;
        const childRect = child.getBoundingClientRect();
        if (childRect.width > 0 && childRect.height > 0) measuredElements += 1;
        for (const node of child.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const textRect of range.getClientRects()) {
            if (textRect.width <= 0 || textRect.height <= 0) continue;
            measuredTextRects += 1;
            if (intersection(textRect, viewportHeight).area > 0) viewportTextRects += 1;
          }
        }
      }
      return { id: element.id, sectionIndex: [...element.parentElement.children].indexOf(element),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: rect.width, height: rect.height }, viewportWidth, viewportHeight,
        contentVisibility: getComputedStyle(element).contentVisibility,
        viewportIntersection: intersection(rect, viewportHeight),
        // このページのIO設定: threshold .1 / rootMargin bottom -40px。
        observerIntersection: intersection(rect, Math.max(0, viewportHeight - 40)),
        observerThreshold: 0.1, observerRootMarginBottom: -40,
        ancestors, effectiveOpacity, measuredElements, measuredTextRects, viewportTextRects };
    });
    const label = `${details.engine}:${details.relative}@${details.width}px:${metrics.id || `section${index + 1}`}`;
    const visibleAncestors = metrics.ancestors.every((ancestor) => ancestor.display !== 'none'
      && !['hidden', 'collapse'].includes(ancestor.visibility) && ancestor.opacity > 0
      && (!ancestor.rv || ancestor.on));
    check(paintReady && visibleAncestors && metrics.effectiveOpacity > 0,
      `${label}:rv/on・祖先opacityが実表示になりません ${JSON.stringify({ ancestors: metrics.ancestors,
        rect: metrics.rect, observerIntersection: metrics.observerIntersection, threshold: metrics.observerThreshold })}`);
    check(metrics.rect.width > 0 && metrics.rect.height > 0 && metrics.viewportIntersection.area > 0
      && metrics.measuredElements > 0 && metrics.measuredTextRects > 0 && metrics.viewportTextRects > 0,
    `${label}:画面内の節/要素/Rangeの実測がありません ${JSON.stringify(metrics)}`);
    sectionResults.push({ ...details, sectionIndex: index + 1, paintReady, metrics });
    if ((details.actualMobile || [320, 390].includes(details.width))
      && ((details.relative === 'portal.html' && index === 0)
        || (details.relative === 'shoshiki.html' && ['onboarding-kit', 'procedure-pdfs', 'dependent-forms', 'setting', 'list'].includes(metrics.id)))) {
      const viewportName = details.actualMobile ? 'actual-mobile390' : String(details.width);
      await screenshot(page, `${details.engine}-${path.basename(details.relative, '.html')}-${viewportName}-${metrics.id}-viewport`, false);
    }
  }
}

async function duplicateIds(page) {
  return page.evaluate(() => {
    const counts = new Map();
    for (const element of document.querySelectorAll('[id]')) {
      counts.set(element.id, (counts.get(element.id) || 0) + 1);
    }
    return [...counts].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
  });
}

async function measureIndex(page) {
  return page.evaluate(({ epsilon }) => {
    const viewportWidth = document.documentElement.clientWidth;
    const selectorOf = (element) => element.id ? `#${element.id}`
      : `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 3).join('.')}`;
    const offenders = [];
    let measuredElements = 0;
    let measuredTextRects = 0;
    const roots = document.querySelectorAll('.page-hero, main, #nav');
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0 && element.getClientRects().length > 0;
    };
    const localScroll = (element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (['auto', 'scroll'].includes(style.overflowX)
          && parent.scrollWidth > parent.clientWidth + epsilon) return parent;
      }
      return null;
    };
    const clippingAncestor = (element, rect, scroller) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        // 内部スクロールの外側にあるbodyのclipは、この瞬間の非表示を
        // 示すだけ。内側のhidden/clipは調べ、スクロール境界で止める。
        if (parent === scroller) break;
        const style = getComputedStyle(parent);
        if (!['hidden', 'clip'].includes(style.overflowX)) continue;
        const pr = parent.getBoundingClientRect();
        if (rect.left < pr.left - epsilon || rect.right > pr.right + epsilon) return selectorOf(parent);
      }
      return '';
    };
    for (const scope of roots) {
      for (const element of [scope, ...scope.querySelectorAll('*')]) {
        if (!visible(element) || ['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(element.tagName)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        measuredElements += 1;
        const scroller = localScroll(element);
        if (!scroller && (rect.left < -epsilon || rect.right > viewportWidth + epsilon)) {
          offenders.push({ kind: 'element', selector: selectorOf(element), left: rect.left, right: rect.right });
        }
        for (const node of element.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const textRect of range.getClientRects()) {
            if (textRect.width <= 0 || textRect.height <= 0) continue;
            measuredTextRects += 1;
            const clip = clippingAncestor(element, textRect, scroller);
            if (clip || (!scroller && (textRect.left < -epsilon || textRect.right > viewportWidth + epsilon))) {
              offenders.push({ kind: 'text', selector: selectorOf(element), text: node.textContent.trim().slice(0, 80),
                left: textRect.left, right: textRect.right, clip });
            }
          }
        }
      }
    }
    return { viewportWidth, documentScrollWidth: document.documentElement.scrollWidth,
      measuredElements, measuredTextRects, offenders };
  }, { epsilon: EPSILON });
}

async function checkTableNameTypography(page, engine, width) {
  const links = page.locator('.sh-tbl td.nm a');
  const count = await links.count();
  check(count === EXPECTED_FORM_COUNT,
    `${engine}:shoshiki@${width}px:名称数 ${count} ≠ ${EXPECTED_FORM_COUNT}`);
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    await link.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await settle(page);
    const result = await link.evaluate((element) => {
      const cell = element.closest('td');
      const style = getComputedStyle(cell);
      const box = cell.getBoundingClientRect();
      const lines = [];
      let characters = 0;
      let measuredCharacters = 0;
      let visibleCharacters = 0;
      const offenders = [];
      let painted = true;
      for (let parent = element; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        if (parentStyle.display === 'none' || parentStyle.visibility !== 'visible'
          || Number(parentStyle.opacity) <= 0) painted = false;
      }
      const navBottom = Math.max(0, document.querySelector('#nav')?.getBoundingClientRect().bottom || 0);
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        let offset = 0;
        for (const character of node.textContent) {
          const start = offset;
          offset += character.length;
          if (!character.trim()) continue;
          characters += 1;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, offset);
          const rect = [...range.getClientRects()].find((item) => item.width > 0 && item.height > 0);
          if (!rect) continue;
          measuredCharacters += 1;
          const x = (rect.left + rect.right) / 2;
          const y = (rect.top + rect.bottom) / 2;
          if (x > 0 && x < viewportWidth && y > navBottom && y < viewportHeight) {
            const hit = document.elementFromPoint(x, y);
            if (hit && element.contains(hit)) visibleCharacters += 1;
          }
          let line = lines.find((item) => Math.abs(item.top - rect.top) <= 1);
          if (!line) {
            line = { top: rect.top, text: '' };
            lines.push(line);
          }
          line.text += character;
          if (rect.left < box.left - 1 || rect.right > box.right + 1
            || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) {
            offenders.push({ character, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
          }
        }
      }
      return { text: element.textContent.trim(), href: element.getAttribute('href'),
        cell: { width: box.width, height: box.height,
          contentWidth: box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) },
        computed: { textWrap: style.textWrap, wordBreak: style.wordBreak, fontSize: style.fontSize },
        characters, measuredCharacters, visibleCharacters, painted,
        lines: lines.sort((a, b) => a.top - b.top), offenders };
    });
    const label = `${engine}:shoshiki@${width}px:${result.text}`;
    check(result.characters > 0 && result.measuredCharacters === result.characters
      && result.cell.width > 0 && result.cell.height > 0 && result.lines.length > 0,
    `${label}:名称の文字実測が不足しています`);
    check(result.painted && result.visibleCharacters > 0,
      `${label}:名称リンクを画面内で表示・操作できません`);
    check(result.offenders.length === 0,
      `${label}:名称がセルから逸脱します ${JSON.stringify(result.offenders)}`);
    check(result.lines.length <= 3 && (result.characters > 10 || result.lines.length === 1),
      `${label}:名称が細切れになります ${JSON.stringify(result.lines)}`);
    tableNameResults.push({ engine, width, ...result });
  }
  // 名称の確認後、カテゴリ表の横移動検査を左端から始める。
  await page.locator('.sh-tblwrap').evaluateAll((elements) => {
    for (const element of elements) element.scrollLeft = 0;
  });
  await page.locator('.sh-tbl').first().evaluate((element) => {
    element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    const navHeight = document.querySelector('#nav')?.getBoundingClientRect().height || 0;
    window.scrollBy({ top: -navHeight - 16, behavior: 'instant' });
  });
  await settle(page);
  await screenshot(page, `${engine}-shoshiki-${width}-names-viewport`, false);
}

async function checkCategoryTableScroll(page, engine, width) {
  const wrappers = page.locator('.sh-tblwrap');
  const count = await wrappers.count();
  check(count === EXPECTED_TABLE_CATEGORIES,
    `${engine}:shoshiki@${width}px:スクロール検査のカテゴリ数 ${count} ≠ ${EXPECTED_TABLE_CATEGORIES}`);
  for (let index = 0; index < count; index += 1) {
    const label = `${engine}:shoshiki@${width}px:table${index + 1}`;
    const wrapper = wrappers.nth(index);
    let result = { engine, width, categoryIndex: index + 1 };
    let initialScrollLeft;
    try {
      initialScrollLeft = await wrapper.evaluate((element) => element.scrollLeft);
      await wrapper.scrollIntoViewIfNeeded();
      const lastCTA = wrapper.locator('tbody tr:last-child td.go a').last();
      check(await lastCTA.count() === 1, `${label}:最終行の記入CTAがありません`);
      // 行数の多い表でも最後のCTAが縦方向に見える位置へ移動する。
      // 横位置はその後明示的に0→最右端へ動かして移動量を測る。
      await lastCTA.evaluate((element) => element.scrollIntoView({
        block: 'center', inline: 'nearest', behavior: 'instant',
      }));
      await wrapper.evaluate((element) => { element.scrollLeft = 0; });
      await settle(page);
      const before = await wrapper.evaluate((element) => ({
        scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth, maxScrollLeft: element.scrollWidth - element.clientWidth,
      }));
      await wrapper.evaluate((element) => { element.scrollLeft = element.scrollWidth - element.clientWidth; });
      await settle(page);
      const after = await wrapper.evaluate((element) => {
        const cta = element.querySelector('tbody tr:last-child td.go a');
        if (!cta) throw new Error('last CTA missing');
        const wrapperRect = element.getBoundingClientRect();
        const rect = cta.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const rectOf = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          width: r.width, height: r.height });
        return {
          category: element.closest('.sh-cat')?.querySelector('h3')?.textContent ?? '',
          scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth, maxScrollLeft: element.scrollWidth - element.clientWidth,
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: document.documentElement.clientHeight,
          wrapper: rectOf(wrapperRect), cta: { text: cta.textContent.trim(), href: cta.getAttribute('href'),
            ...rectOf(rect), hit: Boolean(hit && (hit === cta || cta.contains(hit))) },
        };
      });
      const moved = after.scrollLeft - before.scrollLeft;
      result = { ...result, before, after, moved };
      check(before.maxScrollLeft > EPSILON && before.clientWidth > 0 && before.scrollWidth > 0
        && Math.abs(before.scrollLeft) <= EPSILON && moved > EPSILON
        && Math.abs(after.scrollLeft - after.maxScrollLeft) <= EPSILON,
      `${label}:横スクロールの幅/最右端への移動が実測できません ${JSON.stringify({ before, after: after.scrollLeft, moved })}`);
      check(/^記入する/.test(after.cta.text) && after.wrapper.width > 0 && after.wrapper.height > 0
        && after.cta.width > 0 && after.cta.height > 0
        && after.cta.left >= after.wrapper.left - EPSILON && after.cta.right <= after.wrapper.right + EPSILON
        && after.cta.left >= -EPSILON && after.cta.right <= after.viewportWidth + EPSILON
        && after.cta.top >= -EPSILON && after.cta.bottom <= after.viewportHeight + EPSILON && after.cta.hit,
      `${label}:右端CTAが表/画面内で操作できません ${JSON.stringify(after.cta)}`);
      if (index === count - 1) await screenshot(page, `${engine}-list-${width}-table-right`, false);
    } catch (error) {
      result.error = error.message;
      failures.push(`${label}: ${error.message}`);
    } finally {
      if (initialScrollLeft !== undefined) {
        await wrapper.evaluate((element, initial) => { element.scrollLeft = initial; }, initialScrollLeft);
        await settle(page);
        result.restoredScrollLeft = await wrapper.evaluate((element) => element.scrollLeft);
        check(Math.abs(result.restoredScrollLeft - initialScrollLeft) <= EPSILON,
          `${label}:横スクロールを元に戻せません`);
      }
      tableScrollResults.push(result);
    }
  }
}

async function reachableControls(page, selectors) {
  return page.evaluate(({ selectors: selected, epsilon }) => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const controls = [...document.querySelectorAll(selected)];
    const measured = [];
    for (const element of controls) {
      if (!element.getClientRects().length || getComputedStyle(element).display === 'none') continue;
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(viewportWidth - 1, r.left + r.width / 2));
      const y = Math.max(0, Math.min(viewportHeight - 1, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      measured.push({ selector: element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}:${element.textContent.trim().slice(0, 35)}`,
        width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        reachable: r.width > 0 && r.height > 0 && r.left >= -epsilon && r.right <= viewportWidth + epsilon
          && r.top >= -epsilon && r.bottom <= viewportHeight + epsilon
          && Boolean(hit && (element === hit || element.contains(hit))) });
    }
    return { viewportWidth, viewportHeight, controls: measured };
  }, { selectors, epsilon: EPSILON });
}

async function measurePaper(page) {
  return page.evaluate(({ epsilon }) => {
    const paper = document.querySelector('.page');
    if (!paper) throw new Error('A4 .page missing');
    const p = paper.getBoundingClientRect();
    const offenders = [];
    let measuredElements = 0;
    let measuredTextRects = 0;
    let tables = 0;
    let editables = 0;
    const record = (rect, element, text) => {
      if (rect.width <= 0 || rect.height <= 0) return;
      const outside = rect.left < p.left - epsilon || rect.right > p.right + epsilon
        || rect.top < p.top - epsilon || rect.bottom > p.bottom + epsilon;
      if (outside) offenders.push({ selector: `${element.tagName.toLowerCase()}.${element.className}`,
        text: (text || '').trim().slice(0, 100), left: rect.left - p.left, right: rect.right - p.left,
        top: rect.top - p.top, bottom: rect.bottom - p.top });
    };
    for (const element of paper.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        measuredElements += 1;
        if (element.tagName === 'TABLE') tables += 1;
        if (element.isContentEditable) editables += 1;
        record(rect, element, element.childElementCount ? '' : element.textContent);
      }
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const textRect of range.getClientRects()) {
          if (textRect.width <= 0 || textRect.height <= 0) continue;
          measuredTextRects += 1;
          record(textRect, element, node.textContent);
        }
      }
    }
    const hidden = [...document.querySelectorAll('.bar, .cfg, .guide')].map((element) => ({
      selector: element.className, hidden: getComputedStyle(element).display === 'none',
    }));
    return { width: p.width, height: p.height, scrollWidth: paper.scrollWidth, scrollHeight: paper.scrollHeight,
      measuredElements, measuredTextRects, tables, editables, hidden, offenders };
  }, { epsilon: EPSILON });
}

async function checkCheckboxes(page, label) {
  const stats = await page.evaluate(() => {
    const choices = [...document.querySelectorAll('.bx')];
    const bad = [];
    for (const [index, choice] of choices.entries()) {
      const initiallyChecked = choice.textContent.trim() === '☑';
      if (choice.getAttribute('role') !== 'checkbox' || choice.tabIndex !== 0
        || choice.getAttribute('aria-checked') !== String(initiallyChecked)) bad.push({ index, state: 'initial' });
      choice.click();
      if (choice.getAttribute('aria-checked') !== String(!initiallyChecked)
        || (choice.textContent.trim() === '☑') !== !initiallyChecked) bad.push({ index, state: 'click' });
      choice.click();
      if (choice.getAttribute('aria-checked') !== String(initiallyChecked)
        || (choice.textContent.trim() === '☑') !== initiallyChecked) bad.push({ index, state: 'reset' });
    }
    return { count: choices.length, bad };
  });
  check(stats.bad.length === 0, `${label}: checkboxのrole/Tab/aria/clickが不一致 ${JSON.stringify(stats.bad.slice(0, 4))}`);
  if (stats.count) {
    const choice = page.locator('.bx').first();
    const initial = await choice.getAttribute('aria-checked');
    await choice.focus();
    await choice.press('Space');
    check(await choice.getAttribute('aria-checked') === String(initial !== 'true'), `${label}: Spaceでcheckboxを変更できません`);
    await choice.press('Enter');
    check(await choice.getAttribute('aria-checked') === initial, `${label}: Enterでcheckboxを戻せません`);
  }
  return { count: stats.count, invalid: stats.bad, keyboardTested: stats.count > 0 };
}

async function readCompany(page, withStorage = true) {
  return page.evaluate(({ fields, key, withStorage: readStorage }) => {
    const inputs = Object.fromEntries(fields.map((field) => [field, document.getElementById(`co-${field}`)?.value ?? null]));
    const applied = Object.fromEntries(fields.map((field) => [field,
      [...document.querySelectorAll(`.co-${field}`)].map((element) => element.textContent)]));
    let saved;
    if (readStorage) {
      try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (error) { saved = { error: error.name }; }
    }
    const status = document.getElementById('co-status');
    return { inputs, applied, saved, status: status ? {
      role: status.getAttribute('role'), hidden: status.hidden, text: status.textContent,
    } : null };
  }, { fields: CO_FIELDS, key: CO_KEY, withStorage });
}

async function fillCompany(page, company) {
  if (await page.locator('#cfg').count() && !(await page.locator('#cfg').isVisible())) {
    await page.locator('button[onclick="coToggle()"]').click();
  }
  for (const field of CO_FIELDS) await page.locator(`#co-${field}`).fill(company[field]);
}

async function installImportProbe(page) {
  // 読込完了を待つための観測だけ。JSONの解析・保存・DOM反映には介入しない。
  await page.evaluate(() => {
    window.__qaImportStarts = 0;
    window.__qaImportPending = 0;
    const native = FileReader.prototype.readAsText;
    FileReader.prototype.readAsText = function (...args) {
      window.__qaImportStarts += 1;
      window.__qaImportPending += 1;
      this.addEventListener('loadend', () => { window.__qaImportPending -= 1; }, { once: true });
      try { return native.apply(this, args); } catch (error) { window.__qaImportPending -= 1; throw error; }
    };
  });
}

async function importJson(page, contents, name = 'QA-company.json') {
  const before = await page.evaluate(() => window.__qaImportStarts);
  await page.locator('#co-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(contents) });
  await page.waitForFunction((previous) => window.__qaImportStarts > previous && window.__qaImportPending === 0, before);
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('download stream missing');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function checkCompanyFlows(browser, engine, relative) {
  const label = `${engine}:${relative}:company`;
  const context = await prepareContext(browser);
  const { page, errors, httpErrors } = await monitoredPage(context);
  const dialogs = [];
  let confirm = false;
  page.on('dialog', async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message(), accept: confirm });
    if (dialog.type() === 'confirm' && !confirm) await dialog.dismiss();
    else await dialog.accept();
  });
  const states = [];
  try {
    await goto(page, relative);
    await fillCompany(page, COMPANY);
    let state = await readCompany(page);
    states.push({ phase: 'filled', ...state });
    check(equalCompany(state.inputs, COMPANY) && equalCompany(state.saved, COMPANY), `${label}:入力値と保存値が不一致`);
    check(state.applied.name.length > 0 && state.applied.name.every((text) => text === COMPANY.name), `${label}:会社名が反映されません`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    state = await readCompany(page);
    states.push({ phase: 'reload', ...state });
    check(equalCompany(state.inputs, COMPANY) && equalCompany(state.saved, COMPANY), `${label}:会社情報を再読込で保持できません`);
    await installImportProbe(page);
    for (const [name, contents] of [['malformed', '{'], ['null', 'null'], ['number-field', '{"name":123}'], ['array', '[]']]) {
      await importJson(page, contents);
      state = await readCompany(page);
      states.push({ phase: `invalid-${name}`, ...state });
      check(equalCompany(state.inputs, COMPANY) && equalCompany(state.saved, COMPANY), `${label}:不正JSON(${name})で会社情報が失われました`);
      check(state.applied.name.every((text) => text === COMPANY.name), `${label}:不正JSON(${name})で差込表示が変わりました`);
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await importJson(page, JSON.stringify(IMPORT_COMPANY));
      state = await readCompany(page);
      states.push({ phase: `valid-import-${attempt}`, ...state });
      check(equalCompany(state.inputs, IMPORT_COMPANY) && equalCompany(state.saved, IMPORT_COMPANY), `${label}:正常JSON(${attempt})を反映できません`);
      check(await page.locator('#co-file').inputValue() === '', `${label}:読み込み後input.valueが残り同じファイルを再選択できません`);
    }
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => window.coExport());
    const download = await downloadPromise;
    const exported = JSON.parse((await readDownload(download)).toString('utf8'));
    check(equalCompany(exported, IMPORT_COMPANY), `${label}:書き出したJSONが現在の会社情報と不一致`);
    states.push({ phase: 'export', filename: download.suggestedFilename(), exported });
    await page.evaluate(() => window.coClear());
    state = await readCompany(page);
    states.push({ phase: 'clear-cancel', ...state });
    check(equalCompany(state.inputs, IMPORT_COMPANY) && equalCompany(state.saved, IMPORT_COMPANY), `${label}:消去をキャンセルしても会社情報が消えました`);
    confirm = true;
    await page.evaluate(() => window.coClear());
    state = await readCompany(page);
    states.push({ phase: 'clear-confirm', ...state });
    check(CO_FIELDS.every((field) => state.inputs[field] === ''), `${label}:消去後に入力欄が残ります`);
    check(equalCompany(state.saved, {}), `${label}:消去後に保存値が残ります`);
    check(state.applied.name.length > 0 && state.applied.name.every((text) => text === '【会社名】'), `${label}:消去後の会社名の初期表示が不一致`);
    check(dialogs.filter((dialog) => dialog.type === 'confirm').length === 2, `${label}:消去の確認が2回実行されていません`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    await screenshot(page, `${engine}-${path.basename(relative, '.html')}-company-failure`).catch(() => {});
  } finally {
    check(errors.length === 0, `${label}:pageerror ${errors.join(' / ')}`);
    check(httpErrors.length === 0, `${label}:HTTP error ${httpErrors.join(' / ')}`);
    behaviorResults.push({ engine, relative, scenario: 'company-json-export-clear', states, dialogs, errors, httpErrors });
    await context.close();
  }
}

async function checkStorageFailures(browser, engine) {
  const scenarios = [
    { name: 'corrupt-json', raw: '{', invalidStored: true },
    { name: 'stored-null', raw: 'null', invalidStored: true },
    { name: 'stored-array', raw: '[]', invalidStored: true },
    { name: 'stored-number', raw: '{"name":123}', invalidStored: true },
    { name: 'get-throws', throwMethods: ['getItem'] },
    { name: 'set-throws', throwMethods: ['setItem'] },
    { name: 'remove-throws', raw: JSON.stringify(IMPORT_COMPANY), throwMethods: ['removeItem'] },
    { name: 'all-storage-throws', throwMethods: ['getItem', 'setItem', 'removeItem'] },
  ];
  for (const relative of ['shoshiki.html', 'shoshiki/D-18.html']) {
    for (const scenario of scenarios) {
      const label = `${engine}:${relative}:${scenario.name}`;
      const context = await prepareContext(browser, scenario);
      const { page, errors } = await monitoredPage(context);
      const states = [];
      page.on('dialog', (dialog) => dialog.accept());
      try {
        await goto(page, relative);
        const removalDenied = scenario.name === 'remove-throws';
        let state = await readCompany(page, removalDenied);
        states.push({ phase: 'initial', ...state });
        check(state.applied.name.length > 0, `${label}:会社名の測定対象がありません`);
        if (removalDenied) {
          check(equalCompany(state.inputs, IMPORT_COMPANY) && equalCompany(state.saved, IMPORT_COMPANY),
            `${label}:消去拒否検査の初期保存値が反映されていません`);
        }
        if (scenario.invalidStored || scenario.throwMethods?.includes('getItem')) {
          check(state.status?.role === 'status' && !state.status.hidden && state.status.text.trim().length > 0,
            `${label}:読込/保存例外を通知するstatusがありません`);
        }
        await fillCompany(page, COMPANY);
        // フィールドごとの書込みが失敗しても、先に入れた値をメモリで保持する。
        state = await readCompany(page, removalDenied);
        states.push({ phase: 'filled', ...state });
        check(equalCompany(state.inputs, COMPANY), `${label}:入力欄の値が失われました`);
        check(state.applied.name.every((text) => text === COMPANY.name), `${label}:保存不能時に会社名を反映できません`);
        for (const field of ['dept', 'tel']) {
          check(state.applied[field].every((text) => text === COMPANY[field]), `${label}:${field}のメモリ反映が不一致`);
        }
        if (scenario.throwMethods?.some((method) => ['getItem', 'setItem'].includes(method))) {
          check(state.status?.role === 'status' && !state.status.hidden && state.status.text.trim().length > 0,
            `${label}:会社情報を保存できないことが通知されません`);
        }
        const savedBeforeClear = state.saved;
        if (removalDenied) {
          check(equalCompany(savedBeforeClear, COMPANY), `${label}:消去前の保存値を測定できていません`);
        }
        await page.evaluate(() => window.coClear());
        state = await readCompany(page, removalDenied);
        states.push({ phase: 'clear', ...state });
        check(CO_FIELDS.every((field) => state.inputs[field] === ''), `${label}:保存例外時に会社情報を消去できません`);
        check(state.applied.name.every((text) => text === '【会社名】'), `${label}:消去後の差込表示が戻りません`);
        if (scenario.throwMethods?.includes('removeItem')) {
          check(state.status?.role === 'status' && !state.status.hidden
            && state.status.text.includes('消去できませんでした'), `${label}:保存済み情報を消去できなかったことが通知されません`);
        }
        if (removalDenied) {
          check(equalCompany(state.saved, savedBeforeClear) && equalCompany(state.saved, COMPANY),
            `${label}:removeItem拒否時に保存値が残ることを確認できません`);
        }
      } catch (error) {
        failures.push(`${label}: ${error.message}`);
      } finally {
        check(errors.length === 0, `${label}:pageerror ${errors.join(' / ')}`);
        behaviorResults.push({ engine, relative, scenario: scenario.name, states, errors });
        await context.close();
      }
    }
  }
}

async function checkCrossTabCompany(browser, engine) {
  const label = `${engine}:cross-tab-company-sync`;
  const context = await prepareContext(browser);
  const a = await monitoredPage(context);
  const b = await monitoredPage(context);
  const states = [];
  const events = {};
  try {
    await a.page.bringToFront();
    await goto(a.page, 'shoshiki.html');
    await fillCompany(a.page, COMPANY);
    await b.page.bringToFront();
    await goto(b.page, 'shoshiki/D-18.html');
    const initialB = await readCompany(b.page);
    states.push({ phase: 'A-filled-B-opened', a: await readCompany(a.page), b: initialB });
    check(equalCompany(initialB.inputs, COMPANY) && equalCompany(initialB.saved, COMPANY)
      && initialB.applied.name.length > 0 && initialB.applied.name.every((text) => text === COMPANY.name),
    `${label}:BがAの会社情報を読み込めません`);
    for (const tab of [a, b]) {
      await tab.page.evaluate((key) => {
        window.__qaStorageEvents = [];
        window.addEventListener('storage', (event) => {
          if (event.key === key) window.__qaStorageEvents.push({ key: event.key,
            oldValue: event.oldValue, newValue: event.newValue });
        });
      }, CO_KEY);
    }
    const changed = { ...COMPANY, name: 'QA別タブ株式会社', rep: 'QA別タブ代表' };
    await fillCompany(b.page, COMPANY);
    await b.page.locator('#co-name').fill(changed.name);
    await b.page.locator('#co-rep').fill(changed.rep);
    // 背景タブのRAF停止に左右されないよう、storage反映を100ms pollingで待つ。
    await a.page.waitForFunction((expected) => document.getElementById('co-name')?.value === expected.name
      && document.getElementById('co-rep')?.value === expected.rep
      && window.__qaStorageEvents.length >= 2, changed, { polling: 100 });
    const latestA = await readCompany(a.page);
    states.push({ phase: 'B-changed-A-synchronized', a: latestA, b: await readCompany(b.page) });
    check(equalCompany(latestA.inputs, changed) && equalCompany(latestA.saved, changed)
      && latestA.applied.name.length > 0 && latestA.applied.name.every((text) => text === changed.name),
    `${label}:storageイベントでAの入力欄/表示が最新になりません`);
    const afterDepartment = { ...changed, dept: 'QA別タブ更新部署' };
    await a.page.locator('#co-dept').fill(afterDepartment.dept);
    await b.page.waitForFunction((expected) => document.getElementById('co-dept')?.value === expected.dept
      && window.__qaStorageEvents.length > 0, afterDepartment, { polling: 100 });
    const finalA = await readCompany(a.page);
    const finalB = await readCompany(b.page);
    states.push({ phase: 'A-dept-edited-latest-company-preserved', a: finalA, b: finalB });
    check(equalCompany(finalA.inputs, afterDepartment) && equalCompany(finalA.saved, afterDepartment)
      && equalCompany(finalB.inputs, afterDepartment) && equalCompany(finalB.saved, afterDepartment),
    `${label}:Aで部署を変更するとBの最新会社名/代表者を上書きします`);
    check(finalB.applied.name.length > 0 && finalB.applied.name.every((text) => text === afterDepartment.name)
      && finalB.applied.dept.length > 0 && finalB.applied.dept.every((text) => text === afterDepartment.dept),
    `${label}:逆方向の同期後にBの差込表示が不一致です`);
    events.a = await a.page.evaluate(() => window.__qaStorageEvents);
    events.b = await b.page.evaluate(() => window.__qaStorageEvents);
    check(events.a.length >= 2 && events.b.length > 0, `${label}:storageイベントが実測されていません`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  } finally {
    const errors = [...a.errors, ...b.errors];
    const httpErrors = [...a.httpErrors, ...b.httpErrors];
    check(errors.length === 0, `${label}:pageerror ${errors.join(' / ')}`);
    check(httpErrors.length === 0, `${label}:HTTP error ${httpErrors.join(' / ')}`);
    behaviorResults.push({ engine, scenario: 'cross-tab-company-sync', states, events, errors, httpErrors });
    await context.close();
  }
}

async function checkEditingAndMerge(browser, engine) {
  const context = await prepareContext(browser);
  const { page, errors } = await monitoredPage(context);
  const merged = [];
  try {
    await goto(page, 'shoshiki.html');
    await fillCompany(page, COMPANY);
    for (const [id, fields] of COMPANY_PRINT_FORMS) {
      await goto(page, `shoshiki/${id}.html`);
      const state = await readCompany(page);
      merged.push({ id, ...state });
      for (const field of fields) {
        check(state.applied[field].length > 0 && state.applied[field].every((text) => text === COMPANY[field]),
          `${engine}:${id}:${field}が会社設定から差し込まれません`);
      }
      const printCompany = { ...COMPANY, name: 'QA株式会社・書式検証用業務支援センター', dept: 'QA人事総務部・書式検証担当' };
      await fillCompany(page, printCompany);
      await page.setViewportSize({ width: 1280, height: 1200 });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);
      const print = await measurePaper(page);
      check(print.measuredElements > 10 && print.measuredTextRects > 10 && print.editables > 0,
        `${engine}:${id}:会社差込後の印刷実測が不足しています`);
      check(print.offenders.length === 0, `${engine}:${id}:会社差込後に印刷用紙から逸脱 ${JSON.stringify(print.offenders.slice(0, 6))}`);
      check(print.hidden.length >= 2 && print.hidden.every((item) => item.hidden), `${engine}:${id}:差込印刷時に操作欄が残ります`);
      mergePrintResults.push({ engine, id, company: printCompany, metrics: print });
      await screenshot(page, `${engine}-${id}-company-print`, true);
      if (engine === 'chromium') {
        const target = await artifactPath(`chromium-${id}-company-A4.pdf`);
        if (target) {
          await page.pdf({ path: target, format: 'A4', preferCSSPageSize: true, printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' } });
          const stat = await fs.stat(target);
          check(stat.size > 100, `${engine}:${id}:会社差込PDF出力が空です`);
          artifacts.push({ type: 'native-pdf-company', id, path: target, bytes: stat.size });
        }
      }
      await page.emulateMedia({ media: 'screen' });
      await fillCompany(page, COMPANY);
    }
    await goto(page, 'shoshiki/D-04.html');
    const blank = page.locator('.bl[contenteditable]').first();
    await blank.fill('QA単行');
    await blank.press('Enter');
    const single = await blank.evaluate((element) => ({ text: element.textContent, html: element.innerHTML, focused: element === document.activeElement }));
    check(single.text === 'QA単行' && !single.html.includes('<br') && !single.focused, `${engine}:単行欄のEnterが確定になりません`);
    await blank.focus();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'QA貼付1\nQA貼付2\r\nQA貼付3');
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await blank.blur();
    const pasted = await blank.evaluate((element) => ({ text: element.textContent, html: element.innerHTML }));
    check(pasted.text.includes('QA貼付1 QA貼付2 QA貼付3') && !/[\r\n]/.test(pasted.text)
      && !/<br\s*\/?\s*>/i.test(pasted.html), `${engine}:単行欄の貼付で改行が混入します`);
    const beforeReload = await blank.textContent();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    const afterReload = await page.locator('.bl[contenteditable]').first().textContent();
    // 書式本文は現在のDOMだけの編集。会社情報の保存と混同して保持を保証しない。
    behaviorResults.push({ engine, scenario: 'company-merge-and-edit', merged, single, pasted,
      bodyReload: { before: beforeReload, after: afterReload, persisted: beforeReload === afterReload,
        expectation: '本文保存の保証はしない。会社情報の保存とは別に観測する。' }, errors });
  } catch (error) {
    failures.push(`${engine}:差込/本文編集: ${error.message}`);
  } finally {
    check(errors.length === 0, `${engine}:差込/本文編集:pageerror ${errors.join(' / ')}`);
    await context.close();
  }
}

async function clickPath(page, selector, relative) {
  await Promise.all([
    page.waitForURL((url) => url.pathname === new URL(relative, base).pathname),
    page.locator(selector).first().click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
  // SPAはURLを先に更新する。本文差替えとカーテン終了を待って測る。
  await page.waitForFunction(() => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift'),
    null, { timeout: 15000 });
  await settle(page);
}

async function historyPath(page, direction, relative) {
  await Promise.all([
    page.waitForURL((url) => url.pathname === new URL(relative, base).pathname),
    direction === 'back' ? page.goBack({ waitUntil: 'domcontentloaded' })
      : page.goForward({ waitUntil: 'domcontentloaded' }),
  ]);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift'),
    null, { timeout: 15000 });
  await settle(page);
}

async function checkNavigation(browser, engine) {
  // page-enter.jsはreduce時にSPA自体を無効にする。除外契約を検査する
  // このシナリオでは実際の通常モードを初期化時から有効にする。
  const context = await prepareContext(browser, undefined, { reducedMotion: 'no-preference' });
  const { page, errors, httpErrors } = await monitoredPage(context);
  const steps = [];
  const distribution = { retiredFiles: [], legacyWidths: [] };
  try {
    await goto(page, 'portal.html');
    const token = await page.evaluate(() => window.__qaDocumentToken);
    const contract = await page.evaluate(() => {
      const api = window.__mnSpa;
      return { version: api?.v ?? null,
        excludesList: Boolean(api?.isFormDest?.(new URL('shoshiki.html', location.href))),
        excludesForm: Boolean(api?.isFormDest?.(new URL('shoshiki/D-04.html', location.href))) };
    });
    check(contract.excludesList && contract.excludesForm, `${engine}:書式のSPA除外契約がありません`);
    steps.push({ path: 'portal.html', token, contract });
    await clickPath(page, '.hub-card[href="shoshiki.html"]', 'shoshiki.html');
    const listToken = await page.evaluate(() => window.__qaDocumentToken);
    check(listToken !== token, `${engine}:portal→書式一覧がdocument遷移になっていません`);
    await fillCompany(page, COMPANY);
    steps.push({ path: 'shoshiki.html', token: listToken, company: await readCompany(page) });
    const counts = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.sh-tbl tbody tr')];
      const formLinks = [...document.querySelectorAll('a[href]')].map((a) => new URL(a.href).pathname)
        .filter((pathname) => /\/shoshiki\/D-\d\d\.html$/.test(pathname));
      const procedureLinks = [...document.querySelectorAll('#procedure-pdfs a[download]')]
        .map((a) => ({ href: a.getAttribute('href'), label: a.getAttribute('aria-label') }));
      const officialLinks = [...document.querySelectorAll('#dependent-forms a[href]')]
        .map((a) => ({ href: a.href, label: a.textContent.trim(), target: a.target, rel: a.rel }));
      const kit = document.querySelector('#onboarding-kit');
      const kitLinks = [...(kit?.querySelectorAll('a[download]') || [])]
        .map((a) => ({ href: a.getAttribute('href'), label: a.getAttribute('aria-label'),
          download: a.getAttribute('download') }));
      const kitCards = [...(kit?.querySelectorAll('[data-kit-file]') || [])]
        .map((card) => ({ file: card.dataset.kitFile, title: card.querySelector('h3')?.textContent,
          text: card.textContent }));
      const kitSteps = [...(kit?.querySelectorAll('ol.sh-pdf-guide > li') || [])]
        .map((li) => ({ role: li.querySelector('strong')?.textContent, text: li.textContent }));
      const taxLinks = [...(kit?.querySelectorAll('a[href^="https://www.nta.go.jp/"]') || [])]
        .map((a) => ({ href: a.href, label: a.textContent.trim(), target: a.target, rel: a.rel }));
      return { rows: rows.length, uniqueForms: new Set(formLinks).size, procedureLinks, officialLinks,
        kitLinks, kitCards, kitSteps, taxLinks,
        officeLinks: [...document.querySelectorAll('a[href]')].filter((a) => /\.(?:xlsx?|docx?|zip)(?:[?#]|$)/i.test(a.href)
          && !(a.closest('#dependent-forms') && new URL(a.href).hostname === 'www.nenkin.go.jp'))
          .map((a) => ({ href: a.getAttribute('href'), pathname: new URL(a.href).pathname,
            local: new URL(a.href).origin === location.origin, inKit: Boolean(a.closest('#onboarding-kit')) })),
        google: [...document.querySelectorAll('a[href]')].filter((a) => a.href === 'https://forms.gle/vFUpB3fqzetNHQQKA')
          .map((a) => ({ href: a.href, target: a.target, rel: a.rel })) };
    });
    check(counts.rows === EXPECTED_FORM_COUNT && counts.uniqueForms === EXPECTED_FORM_COUNT,
      `${engine}:HTML50本の一覧が不一致 ${JSON.stringify(counts)}`);
    check(counts.google.length === 0 && counts.officeLinks.length === ONBOARDING_OFFICE_PATHS.length
      && counts.officeLinks.every((link) => link.local && link.inKit
        && ONBOARDING_OFFICE_PATHS.includes(link.pathname))
      && ONBOARDING_OFFICE_PATHS.every((pathname) => counts.officeLinks.some((link) => link.pathname === pathname)),
      `${engine}:終了したOffice配布/申込リンクが残っています ${JSON.stringify(counts)}`);
    check(counts.kitLinks.length === ONBOARDING_KIT_FILES.length
      && ONBOARDING_KIT_FILES.every(([href, title]) => counts.kitLinks.some((link) => link.href === href
        && link.label?.includes(title) && link.download)),
      `${engine}:入社書類セット7リンク/書類名が不一致 ${JSON.stringify(counts.kitLinks)}`);
    check(counts.kitCards.length === ONBOARDING_KIT_FILES.length
      && counts.kitCards.some((card) => card.file === 'guide.pdf' && card.text.includes('会社が用意'))
      && counts.kitCards.some((card) => card.file === 'labor-notice.xlsx' && card.text.includes('会社が作成・交付'))
      && counts.kitCards.some((card) => card.file === 'personal.pdf' && card.text.includes('従業員が記入'))
      && counts.kitCards.some((card) => card.file === 'bank.pdf' && card.text.includes('口座振込を希望'))
      && ['commute.pdf', 'emergency.pdf'].every((file) => counts.kitCards.some((card) => card.file === file
        && card.text.includes('会社から案内された従業員')))
      && counts.kitCards.filter((card) => ['personal.pdf', 'bank.pdf', 'commute.pdf', 'emergency.pdf'].includes(card.file))
        .every((card) => card.text.includes('赤字の記入例') && card.text.includes('全2ページ')),
      `${engine}:入社書類の記入担当/対象/記入例表示が不一致 ${JSON.stringify(counts.kitCards)}`);
    check(counts.kitSteps.length === 4
      && counts.kitSteps.map((step) => step.role).join('/') === '会社：/会社：/従業員：/会社：'
      && counts.kitSteps[0].text.includes('労働条件通知書')
      && counts.kitSteps[1].text.includes('提出先・提出期限')
      && counts.kitSteps[2].text.includes('入力・保存')
      && counts.kitSteps[3].text.includes('加入手続き'),
      `${engine}:入社書類を渡す・集める4段フローが不一致 ${JSON.stringify(counts.kitSteps)}`);
    check(counts.taxLinks.length === 1
      && counts.taxLinks[0].href === 'https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/gensen/annai/1648_01.htm'
      && counts.taxLinks[0].label.includes('支給年') && counts.taxLinks[0].target === '_blank'
      && counts.taxLinks[0].rel.split(/\s+/).includes('noopener')
      && counts.taxLinks[0].rel.split(/\s+/).includes('noreferrer'),
      `${engine}:支給年ごとの税の公式様式案内が不一致 ${JSON.stringify(counts.taxLinks)}`);
    check(counts.procedureLinks.length === PROCEDURE_PDFS.length
      && PROCEDURE_PDFS.every((href) => counts.procedureLinks.some((link) => link.href === href))
      && counts.procedureLinks.every((link) => link.label?.includes('全2ページ')),
      `${engine}:手続き連絡票・基本情報PDF4種のリンク/用途表示が不一致 ${JSON.stringify(counts.procedureLinks)}`);
    check(counts.officialLinks.length >= 4
      && counts.officialLinks.every((link) => new URL(link.href).protocol === 'https:'
        && new URL(link.href).hostname === 'www.nenkin.go.jp' && link.target === '_blank'
        && link.rel.split(/\s+/).includes('noopener') && link.rel.split(/\s+/).includes('noreferrer'))
      && counts.officialLinks.some((link) => /\.pdf$/.test(link.href) && link.label.includes('届書'))
      && counts.officialLinks.some((link) => /\.xlsx$/.test(link.href) && link.label.includes('Excel'))
      && counts.officialLinks.some((link) => /\.pdf$/.test(link.href) && link.label.includes('扶養追加の記入例')),
      `${engine}:扶養の公式届書/記入例リンクが不一致 ${JSON.stringify(counts.officialLinks)}`);
    distribution.procedurePdfs = [];
    for (const relative of PROCEDURE_PDFS) {
      const response = await context.request.get(new URL(relative, base).href);
      const body = await response.body();
      check(response.status() === 200 && body.subarray(0, 5).toString() === '%PDF-',
        `${engine}:${relative}:連絡票PDFを取得できません (${response.status()})`);
      distribution.procedurePdfs.push({ relative, status: response.status(), bytes: body.length });
    }
    distribution.onboardingKit = [];
    for (const [relative] of ONBOARDING_KIT_FILES) {
      const response = await context.request.get(new URL(relative, base).href);
      const body = await response.body();
      const validSignature = relative.endsWith('.pdf')
        ? body.subarray(0, 5).toString() === '%PDF-' : body.subarray(0, 2).toString() === 'PK';
      check(response.status() === 200 && validSignature,
        `${engine}:${relative}:入社セットのファイルを取得できません (${response.status()})`);
      distribution.onboardingKit.push({ relative, status: response.status(), bytes: body.length });
    }
    distribution.list = counts;
    for (const relative of RETIRED_OFFICE_FILES) {
      const response = await context.request.get(new URL(relative, base).href);
      const body = await response.body();
      check(response.status() === 404 && body.subarray(0, 2).toString() !== 'PK',
        `${engine}:${relative}:配布終了ファイルが提供されています (${response.status()})`);
      distribution.retiredFiles.push({ relative, status: response.status(), bytes: body.length });
    }
    await clickPath(page, 'a[href="shoshiki/D-04.html"]', 'shoshiki/D-04.html');
    const formToken = await page.evaluate(() => window.__qaDocumentToken);
    check(formToken !== listToken, `${engine}:一覧→個別書式がdocument遷移になっていません`);
    check(equalCompany((await readCompany(page)).inputs, COMPANY), `${engine}:個別書式に会社情報が保持されません`);
    steps.push({ path: 'shoshiki/D-04.html', token: formToken });
    await historyPath(page, 'back', 'shoshiki.html');
    check(new URL(page.url()).pathname === new URL('shoshiki.html', base).pathname
      && equalCompany((await readCompany(page)).inputs, COMPANY), `${engine}:戻るで一覧と会社情報が復元されません`);
    steps.push({ path: 'back:shoshiki.html', company: await readCompany(page) });
    await historyPath(page, 'forward', 'shoshiki/D-04.html');
    check(new URL(page.url()).pathname === new URL('shoshiki/D-04.html', base).pathname
      && equalCompany((await readCompany(page)).inputs, COMPANY), `${engine}:進むで個別書式と会社情報が復元されません`);
    steps.push({ path: 'forward:D-04.html', company: await readCompany(page) });
    await clickPath(page, '.bar a[href="../shoshiki.html"]', 'shoshiki.html');
    await clickPath(page, 'a[href="shoshiki/D-18.html"]', 'shoshiki/D-18.html');
    const historyCompany = { ...COMPANY, name: 'QA履歴更新株式会社', rep: 'QA履歴更新代表', dept: 'QA履歴更新部署' };
    await fillCompany(page, historyCompany);
    const changedForm = await readCompany(page);
    check(equalCompany(changedForm.inputs, historyCompany) && equalCompany(changedForm.saved, historyCompany),
      `${engine}:D-18で履歴検査用の会社設定を更新できません`);
    steps.push({ path: 'D-18-company-changed', company: changedForm, expected: historyCompany });
    await historyPath(page, 'back', 'shoshiki.html');
    const changedBack = await readCompany(page);
    check(equalCompany(changedBack.inputs, historyCompany) && equalCompany(changedBack.saved, historyCompany)
      && changedBack.applied.name.length > 0 && changedBack.applied.name.every((text) => text === historyCompany.name),
    `${engine}:D-18で設定変更後に戻ると一覧が古い会社情報になります`);
    steps.push({ path: 'changed-back:shoshiki.html', company: changedBack, expected: historyCompany });
    await historyPath(page, 'forward', 'shoshiki/D-18.html');
    const changedForward = await readCompany(page);
    check(equalCompany(changedForward.inputs, historyCompany) && equalCompany(changedForward.saved, historyCompany)
      && changedForward.applied.name.length > 0 && changedForward.applied.name.every((text) => text === historyCompany.name)
      && changedForward.applied.dept.length > 0 && changedForward.applied.dept.every((text) => text === historyCompany.dept),
    `${engine}:D-18で設定変更後に進むと書式が古い会社情報になります`);
    steps.push({ path: 'changed-forward:D-18.html', company: changedForward, expected: historyCompany });
    await clickPath(page, '.bar a[href="../shoshiki.html"]', 'shoshiki.html');
    await clickPath(page, 'a[href="portal.html"]', 'portal.html');
    check(await page.locator('.hub-card[href="shoshiki.html"]').count() === 1, `${engine}:一覧→portalの本文が復元されません`);
    steps.push({ path: 'list→portal.html' });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await goto(page, LEGACY_LANDING);
      const metrics = await measureIndex(page);
      const controls = await reachableControls(page, 'a.dl');
      const retiredLinks = await page.locator('a[download], a[href$=".zip"], a[href$=".xlsx"], a[href*="forms.gle"]').count();
      check(metrics.measuredElements > 10 && metrics.measuredTextRects > 10
        && metrics.documentScrollWidth <= metrics.viewportWidth + EPSILON && metrics.offenders.length === 0,
        `${engine}:旧配布案内@${width}px:表示の実測/横はみ出し ${JSON.stringify(metrics)}`);
      check(controls.controls.length === 1 && controls.controls[0].reachable && retiredLinks === 0,
        `${engine}:旧配布案内@${width}px:HTML版への操作導線が不正`);
      distribution.legacyWidths.push({ width, metrics, controls, retiredLinks });
      if ([390, 1280].includes(width)) await screenshot(page, `${engine}-legacy-html-only-${width}`);
    }
    await clickPath(page, 'a.dl', 'shoshiki.html');
    check(await page.locator('.sh-tbl tbody tr').count() === EXPECTED_FORM_COUNT,
      `${engine}:旧配布URLからHTML一覧に到達できません`);
    steps.push({ path: 'legacy→shoshiki.html' });
  } catch (error) {
    failures.push(`${engine}:導線/戻る進む/配布: ${error.message}`);
    await screenshot(page, `${engine}-navigation-failure`).catch(() => {});
  } finally {
    check(errors.length === 0, `${engine}:navigation:pageerror ${errors.join(' / ')}`);
    check(httpErrors.length === 0, `${engine}:navigation:HTTP error ${httpErrors.join(' / ')}`);
    navigationResults.push({ engine, steps, distribution, errors, httpErrors });
    await context.close();
  }
}

async function checkActualMobileViewport(browser, engine) {
  const context = await prepareContext(browser, undefined, {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const { page, errors } = await monitoredPage(context);
  try {
    for (const relative of ['portal.html', 'shoshiki.html', 'shoshiki/D-18.html', 'shoshiki/D-52.html']) {
      await goto(page, relative);
      const viewport = await page.evaluate(() => ({
        meta: document.querySelector('meta[name="viewport"]')?.content ?? null,
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight,
        visualViewport: window.visualViewport ? {
          width: window.visualViewport.width, height: window.visualViewport.height,
          scale: window.visualViewport.scale, offsetLeft: window.visualViewport.offsetLeft,
        } : null,
        devicePixelRatio: window.devicePixelRatio,
        documentScrollWidth: document.documentElement.scrollWidth,
      }));
      check(viewport.innerWidth > 0 && viewport.clientWidth > 0
        && viewport.visualViewport?.width > 0 && viewport.visualViewport?.scale > 0,
      `${engine}:mobile390:${relative}:実viewportの測定が不足しています`);
      let controls;
      if (relative.startsWith('shoshiki/')) {
        await page.locator('button[onclick="coToggle()"]').click();
        controls = await reachableControls(page, '.bar a, .bar button, .cfg input:not([type="file"]), .cfg button');
        check(controls.controls.length === 12 && controls.controls.every((control) => control.reachable),
          `${engine}:mobile390:${relative}:実スマホの操作欄に到達できません`);
        await page.locator('button[onclick="coToggle()"]').click();
      } else {
        await revealSections(page, { engine, relative, width: 390, actualMobile: true });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await screenshot(page, `${engine}-actual-mobile390-${path.basename(relative, '.html')}`);
      mobileResults.push({ engine, relative, physicalViewport: { width: 390, height: 844 },
        isMobile: true, viewport, controls });
    }
  } catch (error) {
    failures.push(`${engine}:実スマホviewport: ${error.message}`);
  } finally {
    check(errors.length === 0, `${engine}:実スマホviewport:pageerror ${errors.join(' / ')}`);
    await context.close();
  }
}

async function runEngine(browser, engine, forms) {
  const context = await prepareContext(browser);
  const { page, errors, httpErrors } = await monitoredPage(context);
  let checkboxCount = 0;
  try {
    for (const relative of ['portal.html', 'shoshiki.html']) {
      for (const width of relative === 'portal.html' ? PORTAL_WIDTHS : WIDTHS) {
        const label = `${engine}:${relative}@${width}px`;
        const errorStart = errors.length;
        await page.setViewportSize({ width, height: 900 });
        try {
          await goto(page, relative);
          await revealSections(page, { engine, relative, width, actualMobile: false });
          await page.evaluate(() => window.scrollTo(0, 0));
          await settle(page);
          if ([320, 360, 361].includes(width)) await screenshot(page, `${engine}-${path.basename(relative, '.html')}-${width}-hero-viewport`, false);
          const metrics = await measureIndex(page);
          const duplicates = await duplicateIds(page);
          check(metrics.measuredElements > 20 && metrics.measuredTextRects > 20, `${label}:測定対象が不足しています`);
          check(metrics.documentScrollWidth <= metrics.viewportWidth + EPSILON, `${label}:ページ全体が横にはみ出します`);
          check(metrics.offenders.length === 0, `${label}:要素/文字の見切れ ${JSON.stringify(metrics.offenders.slice(0, 5))}`);
          check(duplicates.length === 0, `${label}:重複ID ${JSON.stringify(duplicates)}`);
          if (relative === 'shoshiki.html') {
            const controls = await reachableControls(page, '#cfg-wrap input:not([type="file"]), #cfg-wrap button');
            check(controls.controls.length === 9 && controls.controls.every((control) => control.reachable), `${label}:会社設定を操作できません ${JSON.stringify(controls.controls.filter((control) => !control.reachable))}`);
            metrics.companyControls = controls;
            await checkTableNameTypography(page, engine, width);
            if ([320, 390].includes(width)) await checkCategoryTableScroll(page, engine, width);
          }
          if ([390, 1280].includes(width)) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await screenshot(page, `${engine}-${path.basename(relative, '.html')}-${width}`);
          }
          results.push({ engine, relative, width, metrics, duplicates, errors: errors.slice(errorStart) });
        } catch (error) {
          failures.push(`${label}: ${error.message}`);
        }
      }
    }
    for (const filename of forms) {
      const id = path.basename(filename, '.html');
      const relative = `shoshiki/${filename}`;
      const errorStart = errors.length;
      try {
        await page.setViewportSize({ width: 1280, height: 900 });
        await goto(page, relative);
        const duplicates = await duplicateIds(page);
        check(duplicates.length === 0, `${engine}:${id}:重複ID ${JSON.stringify(duplicates)}`);
        const checkboxes = await checkCheckboxes(page, `${engine}:${id}`);
        checkboxCount += checkboxes.count;
        const toggle = page.locator('button[onclick="coToggle()"]');
        await toggle.click();
        check(await page.locator('#cfg').isVisible(), `${engine}:${id}:会社設定を開けません`);
        await toggle.click();
        check(!(await page.locator('#cfg').isVisible()), `${engine}:${id}:会社設定を閉じられません`);
        await toggle.click();
        for (const width of WIDTHS) {
          const label = `${engine}:${id}@${width}px`;
          await page.setViewportSize({ width, height: 900 });
          await settle(page);
          const controls = await reachableControls(page, '.bar a, .bar button, .cfg input:not([type="file"]), .cfg button');
          check(controls.controls.length === 12 && controls.controls.every((control) => control.reachable), `${label}:操作欄の見切れ ${JSON.stringify(controls.controls.filter((control) => !control.reachable))}`);
          const scroll = await page.evaluate(() => {
            const paper = document.querySelector('.page');
            if (!paper) throw new Error('.page missing');
            const first = paper.firstElementChild;
            const last = paper.lastElementChild;
            const reach = (element) => {
              element.scrollIntoView({ block: 'end', inline: 'end', behavior: 'instant' });
              const r = element.getBoundingClientRect();
              return { width: r.width, height: r.height, right: r.right, bottom: r.bottom,
                viewportWidth: document.documentElement.clientWidth, viewportHeight: document.documentElement.clientHeight };
            };
            return { first: reach(first), last: reach(last),
              pageWidth: paper.getBoundingClientRect().width,
              documentScrollWidth: document.documentElement.scrollWidth,
              documentScrollHeight: document.documentElement.scrollHeight };
          });
          check(scroll.pageWidth > 700 && scroll.last.width > 0 && scroll.last.height > 0
            && scroll.last.right <= scroll.last.viewportWidth + EPSILON
            && scroll.last.bottom <= scroll.last.viewportHeight + EPSILON, `${label}:A4用紙の右端/最下段へスクロールできません`);
          results.push({ engine, relative, width, controls, scroll, checkboxes, duplicates, errors: errors.slice(errorStart) });
          if (width === 390 && PDF_FORMS.includes(id)) {
            await toggle.click();
            await page.evaluate(() => window.scrollTo(0, 0));
            await screenshot(page, `${engine}-${id}-${width}`, true);
            await toggle.click();
          }
        }
        await page.setViewportSize({ width: 1280, height: 1200 });
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        const print = await measurePaper(page);
        check(Math.abs(print.width - 210 * 96 / 25.4) <= EPSILON
          && Math.abs(print.height - 297 * 96 / 25.4) <= EPSILON, `${engine}:${id}:印刷用紙がA4 210×297mmと一致しません`);
        check(print.measuredElements > 10 && print.measuredTextRects > 10 && print.editables > 0, `${engine}:${id}:印刷の実測が不足しています`);
        check(print.hidden.length >= 2 && print.hidden.every((item) => item.hidden), `${engine}:${id}:印刷時に操作欄が残ります`);
        check(print.offenders.length === 0, `${engine}:${id}:印刷用紙から逸脱 ${JSON.stringify(print.offenders.slice(0, 6))}`);
        printResults.push({ engine, id, metrics: print });
        if (PDF_FORMS.includes(id)) {
          await screenshot(page, `${engine}-${id}-print`, true);
          if (engine === 'chromium') {
            const target = await artifactPath(`chromium-${id}-A4.pdf`);
            if (target) {
              await page.pdf({ path: target, format: 'A4', preferCSSPageSize: true, printBackground: true,
                margin: { top: '0', right: '0', bottom: '0', left: '0' } });
              const stat = await fs.stat(target);
              check(stat.size > 100, `${engine}:${id}:PDF出力が空です`);
              artifacts.push({ type: 'native-pdf', id, path: target, bytes: stat.size });
            }
          }
        }
      } catch (error) {
        failures.push(`${engine}:${id}: ${error.message}`);
        await screenshot(page, `${engine}-${id}-failure`).catch(() => {});
      } finally {
        await page.emulateMedia({ media: 'screen' });
      }
    }
    check(checkboxCount === EXPECTED_CHECKBOX_COUNT, `${engine}:全書式の選択肢数 ${checkboxCount} ≠ ${EXPECTED_CHECKBOX_COUNT}`);
    check(errors.length === 0, `${engine}:layout/print:pageerror ${errors.join(' / ')}`);
    check(httpErrors.length === 0, `${engine}:layout/print:HTTP error ${httpErrors.join(' / ')}`);
  } finally {
    await context.close();
  }
  await checkCompanyFlows(browser, engine, 'shoshiki.html');
  await checkCompanyFlows(browser, engine, 'shoshiki/D-18.html');
  await checkStorageFailures(browser, engine);
  await checkCrossTabCompany(browser, engine);
  await checkEditingAndMerge(browser, engine);
  await checkNavigation(browser, engine);
  await checkActualMobileViewport(browser, engine);
}

(async () => {
  const forms = (await fs.readdir(path.join(root, 'shoshiki')))
    .filter((filename) => /^D-\d\d\.html$/.test(filename)).sort();
  check(forms.length === EXPECTED_FORM_COUNT, `HTML書式数 ${forms.length} ≠ ${EXPECTED_FORM_COUNT}`);
  for (const [engine, browserType] of ENGINES) {
    const browser = await browserType.launch({ headless: true });
    try { await runEngine(browser, engine, forms); } finally { await browser.close(); }
  }
  const expectedScreenResults = ENGINES.length * (WIDTHS.length * (EXPECTED_FORM_COUNT + 1) + PORTAL_WIDTHS.length);
  check(results.length === expectedScreenResults, `画面検査数 ${results.length} ≠ ${expectedScreenResults}`);
  check(printResults.length === ENGINES.length * EXPECTED_FORM_COUNT, `印刷検査数 ${printResults.length} ≠ ${ENGINES.length * EXPECTED_FORM_COUNT}`);
  check(mergePrintResults.length === ENGINES.length * COMPANY_PRINT_FORMS.length,
    `会社差込印刷検査数 ${mergePrintResults.length} ≠ ${ENGINES.length * COMPANY_PRINT_FORMS.length}`);
  check(mobileResults.length === ENGINES.length * 4, `実スマホ390pxの検査数 ${mobileResults.length} ≠ ${ENGINES.length * 4}`);
  const expectedTableScrollResults = ENGINES.length * 2 * EXPECTED_TABLE_CATEGORIES;
  check(tableScrollResults.length === expectedTableScrollResults,
    `一覧表横スクロール検査数 ${tableScrollResults.length} ≠ ${expectedTableScrollResults}`);
  const expectedTableNameResults = ENGINES.length * WIDTHS.length * EXPECTED_FORM_COUNT;
  check(tableNameResults.length === expectedTableNameResults,
    `書式名称の文字検査数 ${tableNameResults.length} ≠ ${expectedTableNameResults}`);
  const expectedSectionResults = ENGINES.length * (4 * (PORTAL_WIDTHS.length + 1) + 7 * (WIDTHS.length + 1));
  check(sectionResults.length === expectedSectionResults,
    `画面内main節表示検査数 ${sectionResults.length} ≠ ${expectedSectionResults}`);
  const expectedBehaviorResults = ENGINES.length * 20;
  check(behaviorResults.length === expectedBehaviorResults, `会社/入力挙動検査数 ${behaviorResults.length} ≠ ${expectedBehaviorResults}`);
  check(behaviorResults.filter((result) => result.scenario === 'cross-tab-company-sync').length === ENGINES.length,
    '別タブ会社情報同期の2エンジン検査が揃っていません');
  check(navigationResults.length === ENGINES.length
    && navigationResults.every((result) => result.steps.some((step) => step.path === 'changed-forward:D-18.html')),
  '設定変更後に戻る/進むの2エンジン検査が揃っていません');
  check(navigationResults.length === ENGINES.length && navigationResults.every((result) =>
    result.distribution.retiredFiles.length === RETIRED_OFFICE_FILES.length
    && result.distribution.legacyWidths.length === WIDTHS.length
    && result.steps.some((step) => step.path === 'legacy→shoshiki.html')),
  '配布終了ファイル・旧URLからHTML版への2エンジン検査が揃っていません');
  if (process.env.RUNNER_TEMP) {
    check(artifacts.filter((item) => item.type === 'native-pdf').length === PDF_FORMS.length, '代表6書式のnative PDFが揃っていません');
    check(artifacts.filter((item) => item.type === 'native-pdf-company').length === COMPANY_PRINT_FORMS.length,
      '会社差込4書式のnative PDFが揃っていません');
  }
  const report = { base, widths: WIDTHS, portalWidths: PORTAL_WIDTHS, epsilon: EPSILON,
    scope: { htmlForms: EXPECTED_FORM_COUNT, excelForms: 0, wordPackages: 0, choicesPerEngine: EXPECTED_CHECKBOX_COUNT,
      screenConditions: expectedScreenResults, printConditions: ENGINES.length * EXPECTED_FORM_COUNT,
      companyMergedPrintConditions: ENGINES.length * COMPANY_PRINT_FORMS.length, actualMobileConditions: ENGINES.length * 4,
      behaviorConditions: expectedBehaviorResults, crossTabConditions: ENGINES.length,
      changedCompanyHistoryConditions: ENGINES.length, seededStorageRemovalDeniedConditions: ENGINES.length * 2,
      navigationConditions: ENGINES.length,
      categoryTableScrollConditions: expectedTableScrollResults,
      tableNameTypographyConditions: expectedTableNameResults,
      sectionVisibilityConditions: expectedSectionResults,
      retiredOfficeFileConditions: ENGINES.length * RETIRED_OFFICE_FILES.length,
      legacyLandingConditions: ENGINES.length * WIDTHS.length,
      externalFormSubmission: 'not attempted', physicalPrinter: 'not tested',
      pdf: process.env.RUNNER_TEMP ? 'Chromium six blank + four company-merged native PDFs' : 'no RUNNER_TEMP; PDF artifacts not saved' },
    results, printResults, mergePrintResults, behaviorResults, navigationResults, mobileResults,
    tableScrollResults, tableNameResults, sectionResults, artifacts, failures };
  if (failures.length) {
    console.error(`書式検査の失敗: ${failures.length}件`);
    for (const failure of failures) console.error(`- ${failure}`);
  }
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else console.log(`${failures.length ? '失敗' : '合格'}: 画面${results.length}条件 / 印刷${printResults.length}条件 / 挙動${behaviorResults.length}条件 / 導線${navigationResults.length}条件`);
  if (failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
