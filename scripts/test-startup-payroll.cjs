/**
 * 創業LPの自然な内容表示、文字/要素の横幅、価格、FAQ、アンカー、相談入口。
 * 実ブラウザは既存 Performance CI だけで実行する。送信操作は行わない。
 *   node scripts/test-startup-payroll.cjs [base] [--json]
 */
const { chromium, webkit } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isForeignConsoleError } = require('./lib/console-origin.cjs');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/').replace(/\/?$/, '/');
const baseUrl = new URL(base);
const asJson = args.includes('--json');
const PAGE = 'startup-payroll.html';
const WIDTHS = [320, 390, 767, 768, 769, 1280];
const ENGINES = [['chromium', chromium], ['webkit', webkit]];
const SECTION_IDS = ['price', 'scope', 'first-steps', 'consultation', 'faq', 'profile', 'final-contact'];
const LEGACY_ANCHORS = ['burden', 'one-window', 'annual', 'joseikin', 'message'];
const CONTACT_SOURCES = ['startup-payroll', 'startup-payroll-price', 'startup-payroll-process', 'startup-payroll-final', 'shaho'];
const EPSILON = 1;
const UPGRADE_INSECURE_META = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*content=["'][^"']*upgrade-insecure-requests[^"']*["'][^>]*>/gi;
const artifacts = [];

async function prepareContext(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: width < 768 ? 900 : 1000 },
    isMobile: width < 768, hasTouch: width < 768,
    reducedMotion: 'no-preference',
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== baseUrl.origin) return route.abort();
    // A test must never accidentally submit the contact form or an analytics POST.
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    if (baseUrl.protocol === 'http:' && request.resourceType() === 'document') {
      const response = await route.fetch();
      const mime = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (mime !== 'text/html') return route.fulfill({ response });
      return route.fulfill({ response, body: (await response.text()).replace(UPGRADE_INSECURE_META, '') });
    }
    return route.continue();
  });
  return context;
}

async function settle(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('link[data-async-style]')]
    .every((link) => link.media === 'all'), null, { timeout: 5000 });
  await page.waitForFunction(() => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift'), null, { timeout: 8000 });
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('font ready timeout')), 10000))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function screenshot(page, engine, width, phase, fullPage = false) {
  if (!process.env.RUNNER_TEMP) return;
  const directory = path.join(process.env.RUNNER_TEMP, 'layout-results', 'startup-payroll');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${engine}-${width}-${phase}.png`);
  await page.screenshot({ path: target, fullPage, animations: 'disabled' });
  artifacts.push({ engine, width, phase, fullPage, path: target });
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    let y = 0;
    for (let step = 0; step < 200; step += 1) {
      scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const end = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      if (y >= end) break;
      y = Math.min(end, y + Math.max(240, Math.floor(innerHeight * 0.55)));
    }
    scrollTo(0, 0);
  });
  await settle(page);
}

async function measureRegion(locator) {
  return locator.evaluate((root, epsilon) => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const label = (el) => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')}`;
    const visible = (el) => {
      for (let p = el; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) <= 0) return false;
      }
      return el.getClientRects().length > 0;
    };
    const clip = (el, rect) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (!['hidden', 'clip'].includes(getComputedStyle(p).overflowX)) continue;
        const pr = p.getBoundingClientRect();
        if (rect.left < pr.left - epsilon || rect.right > pr.right + epsilon) return label(p);
      }
      return '';
    };
    const offenders = [];
    const hiddenReveal = [];
    let elements = 0, textRects = 0, viewportTextRects = 0;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'WBR', 'BR'].includes(el.tagName)) continue;
      if ((el.matches('.rv,.rvl') && !el.classList.contains('on'))
        || (el.classList.contains('lp-rise') && !el.classList.contains('is-in'))) {
        hiddenReveal.push({ selector: label(el), opacity: getComputedStyle(el).opacity, top: el.getBoundingClientRect().top });
      }
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      elements += 1;
      const elementClip = clip(el, r);
      if (elementClip || r.left < -epsilon || r.right > vw + epsilon) {
        offenders.push({ kind: 'element', selector: label(el), left: r.left, right: r.right, clip: elementClip });
      }
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const tr of range.getClientRects()) {
          if (tr.width <= 0 || tr.height <= 0) continue;
          textRects += 1;
          if (tr.bottom > 0 && tr.top < vh && tr.right > 0 && tr.left < vw) viewportTextRects += 1;
          const textClip = clip(el, tr);
          if (textClip || tr.left < -epsilon || tr.right > vw + epsilon) {
            offenders.push({ kind: 'text', selector: label(el), text: node.textContent.trim().slice(0, 80), left: tr.left, right: tr.right, clip: textClip });
          }
        }
      }
    }
    const rr = root.getBoundingClientRect();
    const intersectionWidth = Math.max(0, Math.min(vw, rr.right) - Math.max(0, rr.left));
    const intersectionHeight = Math.max(0, Math.min(vh, rr.bottom) - Math.max(0, rr.top));
    return {
      selector: label(root), viewportWidth: vw, viewportHeight: vh,
      rect: { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom, width: rr.width, height: rr.height },
      intersectionRatio: rr.width * rr.height > 0 ? intersectionWidth * intersectionHeight / (rr.width * rr.height) : 0,
      contentVisibility: getComputedStyle(root).contentVisibility, visible: visible(root),
      elements, textRects, viewportTextRects, hiddenReveal, offenders,
      measured: visible(root) && elements > 0 && textRects > 0 && viewportTextRects > 0,
    };
  }, EPSILON);
}

async function showRegion(page, locator) {
  await locator.evaluate((el) => {
    el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    scrollBy(0, -(document.querySelector('#nav')?.getBoundingClientRect().height || 0) - 14);
  });
  await settle(page);
  const handle = await locator.elementHandle();
  try {
    await page.waitForFunction((root) => {
      for (const el of [root, ...root.querySelectorAll('.rv,.rvl,.lp-rise')]) {
        if (el.matches('.rv,.rvl') && !el.classList.contains('on')) return false;
        if (el.classList.contains('lp-rise') && !el.classList.contains('is-in')) return false;
        if (Number(getComputedStyle(el).opacity) < 0.99) return false;
      }
      return true;
    }, handle, { timeout: 1800 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    // Preserve the actual opacity/geometry in measureRegion; this is a failed measurement.
  } finally {
    await handle.dispose();
  }
  return measureRegion(locator);
}

async function checkPlans(page) {
  return page.locator('.startup-price-option').evaluateAll((cards) => cards.map((card) => {
    const text = card.textContent.replace(/\s+/g, '');
    const plan = card.dataset.plan;
    const start = plan === 'start';
    return { plan, text, currentPrice: text.includes(start ? '25,000円' : '45,000円'),
      usualPrice: text.includes(start ? '35,000円' : '55,000円'),
      employeeLimit: new RegExp(start ? '5(?:名|人)' : '10(?:名|人)').test(text),
      payrollScope: start ? /給与(?:計算)?なし/.test(text) : /給与(?:・|と)?賞与計算|給与計算を含|給与計算込み/.test(text) };
  }));
}

async function faqChecks(page) {
  const results = [];
  const items = page.locator('.startup-faq-item');
  for (let i = 0; i < await items.count(); i += 1) {
    const item = items.nth(i);
    const summary = item.locator('summary');
    await summary.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    if (await item.evaluate((el) => el.open)) await summary.click();
    await summary.focus();
    await page.keyboard.press('Space');
    await settle(page);
    const spaceOpen = await item.evaluate((el) => el.open);
    const openMetrics = await measureRegion(item);
    const answer = await item.locator('.startup-faq-answer').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      return { textLength: el.textContent.trim().length, width: rect.width, height: rect.height,
        textRectCount: [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).length,
        display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility };
    });
    await page.keyboard.press('Enter');
    await settle(page);
    const enterClosed = !(await item.evaluate((el) => el.open));
    results.push({ index: i + 1, tagName: await item.evaluate((el) => el.tagName), spaceOpen, enterClosed, answer, openMetrics });
  }
  return results;
}

async function firstTextAnchorMetrics(page, target) {
  await settle(page);
  const probe = (el, epsilon) => {
    const container = el.closest('section') || el;
    const rect = el.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    const navRect = document.querySelector('#nav')?.getBoundingClientRect();
    const navHeight = navRect?.bottom || 0;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = innerHeight;
    const scrolling = document.scrollingElement || document.documentElement;
    const maxScroll = Math.max(0, scrolling.scrollHeight - scrolling.clientHeight);
    const documentY = rect.top + scrollY;
    const scrollMarginTop = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const scrollPaddingTop = parseFloat(getComputedStyle(scrolling).scrollPaddingTop) || 0;
    const clamp = (y) => Math.max(0, Math.min(maxScroll, y));
    // Existing native fragment navigation and page-enter.js's same-page
    // popstate handler use distinct offsets. Match their clamped positions,
    // including the document end; do not expand a geometric tolerance.
    const expectedScroll = [
      { source: 'native-scroll-margin-and-padding', y: clamp(documentY - scrollMarginTop - scrollPaddingTop) },
      { source: 'existing-popstate-76px-offset', y: clamp(documentY - 76) },
    ].map((candidate) => ({ ...candidate, difference: Math.abs(scrollY - candidate.y) }));
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let firstText = null, nonzeroRanges = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent.search(/\S/);
      if (offset < 0 || !node.parentElement || node.parentElement.closest('script,style,svg,[aria-hidden="true"],.sr-only')) continue;
      let visible = true;
      for (let p = node.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) < 0.99) { visible = false; break; }
      }
      if (!visible) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + (node.textContent.codePointAt(offset) > 0xffff ? 2 : 1));
      const glyphRect = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0);
      if (!glyphRect) continue;
      nonzeroRanges += 1;
      let clippedBy = '';
      for (let p = node.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p), pr = p.getBoundingClientRect();
        if ((['hidden', 'clip'].includes(style.overflowX) && (glyphRect.left < pr.left - epsilon || glyphRect.right > pr.right + epsilon))
          || (['hidden', 'clip'].includes(style.overflowY) && (glyphRect.top < pr.top - epsilon || glyphRect.bottom > pr.bottom + epsilon))) {
          clippedBy = p.id || p.tagName; break;
        }
      }
      firstText = { text: node.textContent.trim().slice(0, 80), left: glyphRect.left, right: glyphRect.right,
        top: glyphRect.top, bottom: glyphRect.bottom, width: glyphRect.width, height: glyphRect.height, clippedBy };
      break;
    }
    const positionNearExpected = expectedScroll.some((candidate) => candidate.difference <= epsilon);
    const textInViewport = !!firstText && !firstText.clippedBy && firstText.top >= navHeight - 2
      && firstText.bottom <= viewportHeight + epsilon && firstText.left >= -epsilon && firstText.right <= viewportWidth + epsilon;
    return { tag: el.tagName, top: rect.top, bottom: rect.bottom, containerId: container.id,
      containerTop: cr.top, navHeight, viewportWidth, viewportHeight, hash: location.hash,
      scrollY, documentY, maxScroll, scrollMarginTop, scrollPaddingTop, expectedScroll,
      nonzeroRanges, firstText, positionNearExpected, textInViewport,
      measured: nonzeroRanges > 0, reached: nonzeroRanges > 0 && positionNearExpected && textInViewport };
  };
  // Wait for real painting/scroll settlement with the same measurement function,
  // without injecting styles, bypassing CSP, or making hidden content visible.
  let metrics;
  for (let attempt = 0; attempt <= 15; attempt += 1) {
    metrics = await target.evaluate(probe, EPSILON);
    if (metrics.reached || attempt === 15) return metrics;
    await page.waitForTimeout(100);
  }
  return metrics;
}

async function anchorChecks(page) {
  const results = [];
  for (const id of [...SECTION_IDS, ...LEGACY_ANCHORS]) {
    const target = page.locator(`#${id}`);
    const count = await target.count();
    if (count !== 1) { results.push({ id, count, reached: false }); continue; }
    // Same-document fragment navigation uses the browser's native anchor behavior.
    await page.evaluate((fragment) => { location.hash = fragment; }, id);
    const metrics = await firstTextAnchorMetrics(page, target);
    results.push({ id, count, ...metrics });
  }
  return results;
}

async function realAnchorLinks(page) {
  const links = page.locator('main.startup-page a[href^="#"]');
  const results = [];
  for (let i = 0; i < await links.count(); i += 1) {
    const link = links.nth(i);
    const href = await link.getAttribute('href');
    const id = decodeURIComponent(href.slice(1));
    if (!id || await page.locator(`[id="${id}"]`).count() !== 1) {
      results.push({ href, reached: false, error: 'fragment target must be one' });
      continue;
    }
    await link.click();
    await page.waitForFunction((hash) => location.hash === hash, href);
    const metrics = await firstTextAnchorMetrics(page, page.locator(`[id="${id}"]`));
    results.push({ href, ...metrics });
    if (href === '#price' && [390, 1280].includes(page.viewportSize().width)) {
      const engine = page.context().browser().browserType().name();
      await screenshot(page, engine, page.viewportSize().width, 'anchor-price-first-text');
    }
  }
  return results;
}

async function ctaChecks(page) {
  const links = page.locator('main.startup-page a.startup-primary');
  const results = [];
  for (let i = 0; i < await links.count(); i += 1) {
    const link = links.nth(i);
    const href = await link.getAttribute('href');
    const url = new URL(href, page.url());
    if (url.pathname !== '/uploads/contact.html') continue;
    await link.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await settle(page);
    results.push(await link.evaluate((el, expectedOrigin) => {
      const url = new URL(el.href);
      const r = el.getBoundingClientRect();
      const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      return { href: el.getAttribute('href'), resolvedUrl: url.href, from: url.searchParams.get('from'),
        entry: url.searchParams.get('entry'), sameOrigin: url.origin === expectedOrigin,
        rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        hit: !!hit && (hit === el || el.contains(hit)), keyboardFocusable: el.tabIndex >= 0,
        inViewport: r.left >= -1 && r.right <= document.documentElement.clientWidth + 1 && r.top >= 0 && r.bottom <= innerHeight,
        text: el.textContent.trim() };
    }, baseUrl.origin));
  }
  return results;
}

async function runCondition(browser, engine, width) {
  const context = await prepareContext(browser, width);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(20000);
  const failures = [], errors = [], regions = [];
  const expect = (ok, message) => { if (!ok) failures.push(message); };
  const result = { engine, width, measured: false, failures, errors, regions, plans: [], faq: [], anchors: [], ctas: [] };
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !isForeignConsoleError(message, base)) errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (new URL(response.url()).origin === baseUrl.origin && response.status() >= 400) errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
  });
  try {
    const response = await page.goto(new URL(PAGE, base).href, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `LP HTTP ${response?.status() ?? 'no response'}`);
    await settle(page);
    result.viewport = await page.evaluate(() => ({ innerWidth, clientWidth: document.documentElement.clientWidth,
      visualWidth: visualViewport?.width, height: innerHeight, devicePixelRatio, isMobileViewport: 'ontouchstart' in window }));
    expect(Math.abs(result.viewport.clientWidth - width) <= EPSILON, `layout viewport ${result.viewport.clientWidth}/${width}`);
    expect(await page.locator('main.startup-page').count() === 1, 'main.startup-page must be one');
    expect(await page.locator('header.startup-hero.page-hero').count() === 1, 'hero must be one');
    expect(await page.locator('main.startup-page h1').count() === 1, 'h1 must be one');
    expect(await page.locator('main.startup-page > section').count() === 7, 'main sections must be seven');
    expect(await page.locator('.startup-final.bottom-cta .bottom-cta-card').count() === 1, 'common final CTA card must be one');
    await page.waitForFunction(() => [...document.querySelectorAll('main.startup-page img')]
      .every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 5000 });
    result.images = await page.locator('main.startup-page img').evaluateAll((images) => images.map((img) => ({
      src: img.getAttribute('src'), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
      objectFit: getComputedStyle(img).objectFit, hero: !!img.closest('header.startup-hero'),
    })));
    expect(result.images.length === 1 && result.images[0].hero && result.images[0].objectFit === 'contain', 'one contained hero image');
    const duplicates = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
      return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    });
    result.duplicateIds = duplicates;
    expect(!duplicates.length, `duplicate IDs: ${duplicates.join(',')}`);
    await scrollThrough(page);
    const targets = page.locator('main.startup-page > header, main.startup-page > section');
    for (let i = 0; i < await targets.count(); i += 1) {
      const region = await showRegion(page, targets.nth(i));
      regions.push(region);
      expect(region.measured, `${region.selector}: content not measured/reachable`);
      expect(!region.hiddenReveal.length, `${region.selector}: hidden reveal elements ${region.hiddenReveal.length}`);
      expect(!region.offenders.length, `${region.selector}: element/Range horizontal clipping ${region.offenders.length}`);
      if ([390, 1280].includes(width) && i === 0) await screenshot(page, engine, width, 'hero');
      if ([390, 1280].includes(width) && ['#price', '#scope', '#final-contact'].includes(region.selector)) await screenshot(page, engine, width, region.selector.slice(1));
    }
    result.plans = await checkPlans(page);
    expect(result.plans.length === 2 && result.plans.some((p) => p.plan === 'start') && result.plans.some((p) => p.plan === 'standard'), 'exactly two start/standard plans');
    for (const plan of result.plans) expect(plan.currentPrice && plan.usualPrice && plan.employeeLimit && plan.payrollScope, `${plan.plan}: price/employee/payroll scope contract`);
    expect(await page.locator('details.startup-faq-item').count() === 4, 'native FAQ details must be four');
    result.faq = await faqChecks(page);
    for (const faq of result.faq) {
      expect(faq.tagName === 'DETAILS' && faq.spaceOpen && faq.enterClosed, `FAQ ${faq.index}: keyboard toggle`);
      expect(faq.openMetrics.measured && !faq.openMetrics.offenders.length, `FAQ ${faq.index}: opened content measurement/overflow`);
      expect(faq.answer.textLength > 0 && faq.answer.width > 0 && faq.answer.height > 0 && faq.answer.textRectCount > 0
        && faq.answer.display !== 'none' && faq.answer.visibility !== 'hidden', `FAQ ${faq.index}: answer not rendered`);
    }
    result.anchors = await anchorChecks(page);
    for (const anchor of result.anchors) {
      expect(anchor.reached, `anchor #${anchor.id}: not reached below header`);
      if (LEGACY_ANCHORS.includes(anchor.id)) {
        const expectedContainer = anchor.id === 'message' ? 'profile' : 'scope';
        expect(anchor.containerId === expectedContainer, `legacy #${anchor.id} must live in #${expectedContainer}`);
      }
    }
    result.internalLinks = await realAnchorLinks(page);
    expect(result.internalLinks.some((link) => link.href === '#price'), 'hero plan link #price missing');
    for (const link of result.internalLinks) expect(link.reached, `actual anchor link ${link.href}: not reached`);
    result.ctas = await ctaChecks(page);
    for (const from of CONTACT_SOURCES) expect(result.ctas.filter((cta) => cta.from === from).length === 1, `contact CTA from=${from} must be one`);
    for (const cta of result.ctas) expect(CONTACT_SOURCES.includes(cta.from) && cta.sameOrigin && cta.hit && cta.keyboardFocusable && cta.inViewport, `CTA ${cta.from}: URL or operation reachability`);
    result.document = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(result.document.scrollWidth <= result.document.clientWidth + EPSILON, `document horizontal overflow: ${result.document.scrollWidth - result.document.clientWidth}`);
    if (width === 390) {
      await scrollThrough(page);
      // Only the full-page artifact disables skipped offscreen painting. All content
      // assertions and viewport screenshots above use the product's natural styles.
      await page.addStyleTag({ content: 'main.startup-page > section { content-visibility: visible !important; }' });
      await settle(page);
      await screenshot(page, engine, width, 'full-after-scroll', true);
    }
    result.measured = regions.length === 8 && regions.every((region) => region.measured)
      && result.plans.length === 2 && result.faq.length === 4
      && result.anchors.length === SECTION_IDS.length + LEGACY_ANCHORS.length && result.ctas.length >= 5;
  } catch (error) {
    failures.push(`${error.name}: ${error.message}`);
    await screenshot(page, engine, width, 'failure').catch(() => {});
  } finally {
    failures.push(...errors);
    result.ok = result.measured && !failures.length;
    await context.close();
  }
  return result;
}

async function spotNavigation(browser, engine) {
  const context = await prepareContext(browser, 390);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(20000);
  const result = { engine, measured: false, failures: [] };
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !isForeignConsoleError(message, base)) errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (new URL(response.url()).origin === baseUrl.origin && response.status() >= 400) errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
  });
  try {
    const entry = new URL(PAGE, base);
    entry.searchParams.set('entry', 'home-hero-startup');
    const response = await page.goto(entry.href, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error(`LP HTTP ${response?.status()}`);
    await settle(page);
    const spot = page.locator('#first-steps a.startup-primary[href*="from=shaho"]');
    if (await spot.count() !== 1) throw new Error('spot CTA must be one');
    await spot.click();
    await page.waitForURL((url) => url.pathname === '/uploads/contact.html', { waitUntil: 'domcontentloaded' });
    await settle(page);
    result.url = page.url();
    result.selection = await page.locator('#serviceCheckboxes input[type="checkbox"]').evaluateAll((boxes) => boxes.filter((box) => box.checked).map((box) => box.value));
    const url = new URL(result.url);
    if (url.searchParams.get('from') !== 'shaho') result.failures.push('from=shaho not preserved');
    if (url.searchParams.get('entry') !== 'home-hero-startup') result.failures.push('entry=home-hero-startup not inherited');
    if (result.selection.length !== 1 || result.selection[0] !== '社会保険・労働保険手続き') result.failures.push('insurance procedures not selected exclusively');
    result.measured = true;
  } catch (error) {
    result.failures.push(`${error.name}: ${error.message}`);
  } finally {
    result.errors = errors;
    result.failures.push(...errors);
    result.ok = result.measured && !result.failures.length;
    await context.close();
  }
  return result;
}

(async () => {
  const startedAt = Date.now();
  const results = [], navigation = [];
  for (const [engine, type] of ENGINES) {
    let browser;
    try {
      browser = await type.launch({ headless: true });
      for (const width of WIDTHS) results.push(await runCondition(browser, engine, width));
      navigation.push(await spotNavigation(browser, engine));
    } catch (error) {
      for (const width of WIDTHS.filter((w) => !results.some((r) => r.engine === engine && r.width === w))) {
        results.push({ engine, width, measured: false, ok: false, failures: [`${error.name}: ${error.message}`] });
      }
      if (!navigation.some((r) => r.engine === engine)) navigation.push({ engine, measured: false, ok: false, failures: [error.message] });
    } finally {
      if (browser) await browser.close();
    }
  }
  const report = {
    base, page: PAGE, widths: WIDTHS, engines: ENGINES.map(([engine]) => engine),
    expectedConditions: ENGINES.length * WIDTHS.length, recordedConditions: results.length,
    completedConditions: results.filter((r) => r.measured).length,
    unmeasuredConditions: ENGINES.length * WIDTHS.length - results.filter((r) => r.measured).length,
    failedConditions: results.filter((r) => !r.ok).length,
    expectedNavigationChecks: ENGINES.length, recordedNavigationChecks: navigation.length,
    completedNavigationChecks: navigation.filter((r) => r.measured).length,
    unmeasuredNavigationChecks: ENGINES.length - navigation.filter((r) => r.measured).length,
    failedNavigationChecks: navigation.filter((r) => !r.ok).length,
    measuredRegions: results.reduce((sum, r) => sum + (r.regions?.filter((region) => region.measured).length || 0), 0),
    expectedRegions: ENGINES.length * WIDTHS.length * 8,
    measuredFaqItems: results.reduce((sum, r) => sum + (r.faq?.length || 0), 0),
    expectedFaqItems: ENGINES.length * WIDTHS.length * 4,
    measuredAnchorChecks: results.reduce((sum, r) => sum + (r.anchors?.length || 0), 0),
    expectedAnchorChecks: ENGINES.length * WIDTHS.length * (SECTION_IDS.length + LEGACY_ANCHORS.length),
    artifacts, results, navigation,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    scope: 'Natural reveal and content-visibility measured in each viewport. One insurance CTA GET per engine; no input or submissions. Full-page artifacts alone enable offscreen section painting.',
  };
  report.passed = report.recordedConditions === report.expectedConditions && report.completedConditions === report.expectedConditions
    && report.failedConditions === 0 && report.recordedNavigationChecks === report.expectedNavigationChecks
    && report.completedNavigationChecks === report.expectedNavigationChecks && report.failedNavigationChecks === 0;
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else console.log(JSON.stringify({ passed: report.passed, completedConditions: report.completedConditions,
    expectedConditions: report.expectedConditions, failedConditions: report.failedConditions, navigation }, null, 2));
  if (!report.passed) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
