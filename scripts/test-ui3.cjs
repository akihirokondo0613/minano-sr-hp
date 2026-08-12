#!/usr/bin/env node

/**
 * UI改善3点のブラウザー回帰テスト。
 *
 *   node scripts/test-ui3.cjs [base] [--json]
 *
 * 代表記事を一度だけ読み込み、用語ツールチップと追従目次を検査する。
 * 続いてトップを通常読込し、トップ→ブログ→トップを同じwindowでSPA遷移して、
 * 現在地ナビと各機能の冪等な再初期化を検査する。ブログ記事への遷移は
 * page-enter.js v6の契約上、通常遷移なのでSPA往復には含めない。
 *
 * 対象0件を「問題0件」として合格させない。条件、機能、SPA遷移、ナビ状態の
 * 期待件数／記録件数／実測件数／未測定件数をそれぞれ照合する。
 */

const { chromium, webkit } = require('playwright');

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8811/')
  .replace(/\/?$/, '/');
const asJson = args.includes('--json');

const ARTICLE_PATH = 'blog/nyusha-tetsuzuki-checklist.html';
const WIDTHS = [320, 1023, 1120, 1440];
const TOC_DESKTOP_MIN = 1120;
const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];
const NAV_TARGETS = [
  { href: 'services.html', id: 'services' },
  { href: 'support.html', id: 'cases' },
  { href: 'pricing.html', id: 'pricing' },
  { href: 'about.html', id: 'about' },
];
const EXPECTED_NAV_STATES_PER_VISIT = 1 + NAV_TARGETS.length;
const UPGRADE_INSECURE_META =
  /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*content=["'][^"']*upgrade-insecure-requests[^"']*["'][^>]*>/gi;
const RETRYABLE_NAVIGATION =
  /ERR_CONNECTION_RESET|ECONNRESET|ERR_EMPTY_RESPONSE|ERR_SOCKET_NOT_CONNECTED/i;

function conditionKey(engine, width) {
  return `${engine}|${width}`;
}

function isIgnoredConsoleError(message) {
  const location = message.location().url || '';
  const value = message.text();
  return /minano-sr\.goatcounter\.com\/count/.test(location)
    || /Failed to load resource: A TLS error/.test(value);
}

async function prepareLocalHttpPage(page) {
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'http:') return;

  await page.route(`${baseUrl.origin}/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    // SPAのfetchで取得するHTMLも対象にする。documentだけ処理すると、WebKitで
    // body差し替え後の相対資産だけHTTPSへupgradeされ、実際の本番と条件がずれる。
    const isHtml = request.resourceType() === 'document'
      || pathname === '/'
      || pathname.endsWith('.html');
    if (!isHtml) {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      const html = await response.text();
      await route.fulfill({ response, body: html.replace(UPGRADE_INSECURE_META, '') });
    } catch {
      await route.abort('failed');
    }
  });
}

async function gotoWithRetry(page, url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      if (!response?.ok()) {
        throw new Error(`${url} を取得できません（HTTP ${response?.status() ?? '不明'}）`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && RETRYABLE_NAVIGATION.test(String(error))) {
        await page.waitForTimeout(250);
        continue;
      }
      break;
    }
  }
  throw lastError;
}

async function settlePage(page) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('link[data-async-style]')]
        .every((link) => link.media === 'all'),
      null,
      { timeout: 2500 },
    );
  } catch {
    // WebKitのローカルHTTPではlink.onloadが発火しない場合がある。
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('link[data-async-style]')) link.media = 'all';
    });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function waitForScrollToSettle(page, timeout = 5000) {
  await page.evaluate((timeoutMs) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let previousX = scrollX;
    let previousY = scrollY;
    let stableFrames = 0;

    function sample() {
      const delta = Math.max(Math.abs(scrollX - previousX), Math.abs(scrollY - previousY));
      previousX = scrollX;
      previousY = scrollY;
      stableFrames = delta <= 0.5 ? stableFrames + 1 : 0;
      if (stableFrames >= 5) {
        resolve();
        return;
      }
      if (performance.now() - startedAt > timeoutMs) {
        reject(new Error('smooth scrollが安定しません'));
        return;
      }
      requestAnimationFrame(sample);
    }

    requestAnimationFrame(sample);
  }), timeout);
}

function durationsAreZero(value) {
  const durations = String(value || '').split(',').map((part) => Number.parseFloat(part) || 0);
  return durations.length > 0 && durations.every((duration) => duration === 0);
}

function appendFailures(target, prefix, failures) {
  for (const failure of failures) target.push(`${prefix}: ${failure}`);
}

async function inspectTooltip(page, width) {
  const failures = [];
  await page.waitForFunction(
    () => typeof window.__mnTermsReinit === 'function'
      && document.body?.dataset.mnTermsReady === 'true',
    null,
    { timeout: 8000 },
  );

  let snapshot = await page.evaluate(() => {
    const excluded = [
      'h1', 'h2', 'h3', 'nav', '.nav', '.footer', '.breadcrumb', 'script', 'style',
      'noscript', 'template', 'a', 'button', '.term', 'input', 'textarea', 'select',
      'option', 'label', 'summary', 'svg', 'canvas', 'iframe', 'object', 'embed',
      'audio', 'video', 'code', 'pre', 'kbd', 'samp', 'var', 'ruby', 'rt', 'rp',
      '[contenteditable]', '[aria-hidden="true"]',
    ].join(',');
    const markers = [...document.querySelectorAll('main .term')];
    const keys = markers.map((marker) => marker.dataset.termKey || marker.textContent.trim());
    const described = markers.map((marker) => {
      const id = marker.getAttribute('aria-describedby') || '';
      const popover = id ? document.getElementById(id) : null;
      return {
        id,
        markerTag: marker.tagName,
        role: marker.getAttribute('role'),
        tabIndex: marker.tabIndex,
        expanded: marker.getAttribute('aria-expanded'),
        popoverExists: Boolean(popover),
        popoverRole: popover?.getAttribute('role') || '',
      };
    });
    return {
      ready: document.body.dataset.mnTermsReady === 'true',
      markerCount: markers.length,
      popoverCount: document.querySelectorAll('body > .term-pop').length,
      keys,
      uniqueKeyCount: new Set(keys).size,
      excludedAncestorCount: markers.filter((marker) => marker.parentElement?.closest(excluded)).length,
      described,
    };
  });

  if (!snapshot.ready) failures.push('初期化完了フラグがありません');
  if (snapshot.markerCount <= 0) failures.push('用語マーカーが0件です');
  if (snapshot.popoverCount !== snapshot.markerCount) {
    failures.push(`マーカー${snapshot.markerCount}件に対しpopoverが${snapshot.popoverCount}件です`);
  }
  if (snapshot.uniqueKeyCount !== snapshot.markerCount) {
    failures.push(`同じ用語が複数回マークされています（${snapshot.markerCount - snapshot.uniqueKeyCount}件）`);
  }
  if (snapshot.excludedAncestorCount !== 0) {
    failures.push(`除外要素内に用語マーカーが${snapshot.excludedAncestorCount}件あります`);
  }
  for (const item of snapshot.described) {
    if (item.markerTag !== 'SPAN' || item.role !== 'button' || item.tabIndex !== 0) {
      failures.push(`用語マーカーの要素・role・tabindexが不正です（${item.markerTag}/${item.role}/${item.tabIndex}）`);
    }
    if (!item.id || !item.popoverExists || item.popoverRole !== 'tooltip') {
      failures.push(`aria-describedbyの参照先が不正です（${item.id || '空'}）`);
    }
  }

  if (snapshot.markerCount > 0) {
    const marker = page.locator('main .term').first();
    await marker.scrollIntoViewIfNeeded();
    await marker.focus();
    await page.waitForFunction(
      () => document.activeElement?.classList.contains('term')
        && document.activeElement.getAttribute('aria-expanded') === 'true',
      null,
      { timeout: 3000 },
    );
    await marker.press('Escape');
    await page.waitForFunction(
      () => document.activeElement?.classList.contains('term')
        && document.activeElement.getAttribute('aria-expanded') === 'false',
      null,
      { timeout: 3000 },
    );
    await marker.press('Enter');
    await page.waitForFunction(
      () => document.activeElement?.classList.contains('term')
        && document.activeElement.getAttribute('aria-expanded') === 'true',
      null,
      { timeout: 3000 },
    );
    await page.waitForFunction(
      () => {
        const marker = document.activeElement;
        const id = marker?.getAttribute('aria-describedby');
        const popover = id ? document.getElementById(id) : null;
        const rect = popover?.getBoundingClientRect();
        const style = popover ? getComputedStyle(popover) : null;
        return marker?.classList.contains('term')
          && marker.getAttribute('aria-expanded') === 'true'
          && Boolean(popover && rect && rect.width > 0 && rect.height > 0
            && style.visibility !== 'hidden' && Number.parseFloat(style.opacity) > 0);
      },
      null,
      { timeout: 5000 },
    );

    const openState = await marker.evaluate((element) => {
      const id = element.getAttribute('aria-describedby');
      const popover = id ? document.getElementById(id) : null;
      const rect = popover?.getBoundingClientRect();
      const style = popover ? getComputedStyle(popover) : null;
      return {
        describedBy: id,
        expanded: element.getAttribute('aria-expanded'),
        visible: Boolean(popover && rect && rect.width > 0 && rect.height > 0
          && style.visibility !== 'hidden' && Number.parseFloat(style.opacity) > 0),
        rect: rect ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        } : null,
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    if (openState.expanded !== 'true' || !openState.visible || !openState.rect) {
      failures.push('Enterでtooltipを表示できません');
    } else {
      const { rect, viewport } = openState;
      if (rect.left < -1 || rect.top < -1
        || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1) {
        failures.push(
          `tooltipがviewport外です（${rect.left.toFixed(1)},${rect.top.toFixed(1)}–`
          + `${rect.right.toFixed(1)},${rect.bottom.toFixed(1)} / ${viewport.width}×${viewport.height}）`,
        );
      }
    }
    await marker.press('Escape');
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-expanded') === 'false',
      null,
      { timeout: 3000 },
    );
  }

  const beforeReinit = await page.evaluate(() => ({
    markers: document.querySelectorAll('main .term').length,
    popovers: document.querySelectorAll('body > .term-pop').length,
    keys: [...document.querySelectorAll('main .term')]
      .map((marker) => marker.dataset.termKey || marker.textContent.trim()),
  }));
  await page.evaluate(() => {
    window.__mnTermsReinit();
    window.__mnTermsReinit();
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const afterReinit = await page.evaluate(() => ({
    markers: document.querySelectorAll('main .term').length,
    popovers: document.querySelectorAll('body > .term-pop').length,
    keys: [...document.querySelectorAll('main .term')]
      .map((marker) => marker.dataset.termKey || marker.textContent.trim()),
  }));
  if (JSON.stringify(beforeReinit) !== JSON.stringify(afterReinit)) {
    failures.push('用語UIを2回再初期化するとDOM件数または対象語が変わります');
  }

  let reducedMotion = null;
  if (width === WIDTHS[0] && snapshot.markerCount > 0) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    reducedMotion = await page.evaluate(() => {
      const popover = document.querySelector('.term-pop');
      const progress = document.querySelector('.post-toc-progress-bar');
      return {
        mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        tooltipTransitionDuration: popover ? getComputedStyle(popover).transitionDuration : '',
        progressTransitionDuration: progress ? getComputedStyle(progress).transitionDuration : '',
      };
    });
    if (!reducedMotion.mediaMatches
      || !durationsAreZero(reducedMotion.tooltipTransitionDuration)
      || !durationsAreZero(reducedMotion.progressTransitionDuration)) {
      failures.push(
        `reduced-motionでtransitionが停止しません `
        + `(tooltip=${reducedMotion.tooltipTransitionDuration}, progress=${reducedMotion.progressTransitionDuration})`,
      );
    }
    // page-enter.jsは初期化時のmediaを見てSPA介入を決めるため、SPA検査前に戻す。
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }

  snapshot = { ...snapshot, beforeReinit, afterReinit, reducedMotion };
  return {
    measured: snapshot.markerCount > 0 && snapshot.popoverCount > 0,
    failures,
    ...snapshot,
  };
}

async function inspectToc(page, width) {
  const failures = [];
  await page.waitForFunction(
    () => typeof window.__mnPostTocReinit === 'function'
      && document.querySelector('.post-toc-layout'),
    null,
    { timeout: 8000 },
  );
  await settlePage(page);

  async function snapshot() {
    return page.evaluate(({ desktopMin }) => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const article = document.querySelector('article.post');
      const headings = article
        ? [...article.children].filter((child) => child.tagName === 'H2' && !child.hasAttribute('style'))
        : [];
      const sourceToc = article?.querySelector('nav.post-toc') || null;
      const sourceHrefs = sourceToc
        ? [...sourceToc.querySelectorAll('a[href^="#"]')].map((link) => link.getAttribute('href'))
        : [];
      const sourceResolvedCount = sourceHrefs.filter((href) => {
        let id = '';
        try { id = decodeURIComponent(href.slice(1)); } catch { return false; }
        const target = id ? document.getElementById(id) : null;
        return Boolean(target && article?.contains(target));
      }).length;
      const side = document.querySelector('.post-toc-side');
      const mobile = document.querySelector('.post-toc-mobile');
      const containers = [side, mobile].filter(Boolean);
      const visibleContainers = containers.filter(visible);
      const strayStatic = [...document.querySelectorAll('article.post > .post-toc')]
        .filter((toc) => !toc.closest('.post-toc-side,.post-toc-mobile'));
      const visibleStrayStatic = strayStatic.filter(visible);
      const activeVisible = visibleContainers.flatMap((container) => (
        [...container.querySelectorAll('a[aria-current]')]
          .filter((link) => ['true', 'location'].includes(link.getAttribute('aria-current')))
      ));
      const duplicateIds = [...document.querySelectorAll('[id]')]
        .map((element) => element.id)
        .filter((id, index, ids) => id && ids.indexOf(id) !== index);
      const articleRect = article?.getBoundingClientRect();
      const expectedDesktop = innerWidth >= desktopMin;
      return {
        articleExists: Boolean(article),
        headingCount: headings.length,
        headingIds: headings.map((heading) => heading.id),
        sourceEntryCount: sourceHrefs.length,
        sourceResolvedCount,
        sourceHrefs,
        layoutCount: document.querySelectorAll('.post-toc-layout').length,
        sideCount: document.querySelectorAll('.post-toc-side').length,
        mobileCount: document.querySelectorAll('.post-toc-mobile').length,
        staticTocCount: document.querySelectorAll('article.post .post-toc').length,
        strayStaticCount: strayStatic.length,
        strayStaticVisibleCount: visibleStrayStatic.length,
        sideVisible: visible(side),
        mobileVisible: visible(mobile),
        visibleContainerCount: visibleContainers.length,
        visibleTocCount: visibleContainers.length + visibleStrayStatic.length,
        expectedDesktop,
        linkCounts: {
          side: side?.querySelectorAll('a[href^="#"]').length || 0,
          mobile: mobile?.querySelectorAll('a[href^="#"]').length || 0,
          visible: visibleContainers[0]?.querySelectorAll('a[href^="#"]').length || 0,
        },
        visibleHrefs: visibleContainers[0]
          ? [...visibleContainers[0].querySelectorAll('a[href^="#"]')]
            .map((link) => link.getAttribute('href'))
          : [],
        activeVisibleCount: activeVisible.length,
        activeVisibleHrefs: activeVisible.map((link) => link.getAttribute('href')),
        progressCount: visibleContainers[0]
          ?.querySelectorAll('.post-toc-progress[role="progressbar"]').length || 0,
        progressNow: visibleContainers[0]
          ?.querySelector('.post-toc-progress[role="progressbar"]')
          ?.getAttribute('aria-valuenow') || '',
        progressBarWidth: (() => {
          const bar = visibleContainers[0]?.querySelector('.post-toc-progress-bar');
          if (!bar) return 0;
          return Number.parseFloat(bar.style.width || getComputedStyle(bar).width || '0');
        })(),
        mobileIsDetails: mobile?.tagName === 'DETAILS',
        mobileOpen: mobile?.hasAttribute('open') || false,
        articleWidth: articleRect?.width || 0,
        duplicateIds: [...new Set(duplicateIds)],
      };
    }, { desktopMin: TOC_DESKTOP_MIN });
  }

  const initial = await snapshot();
  if (!initial.articleExists) failures.push('article.postがありません');
  if (initial.sourceEntryCount < 3) failures.push(`静的目次の有効候補が${initial.sourceEntryCount}件です`);
  if (initial.sourceResolvedCount !== initial.sourceEntryCount) {
    failures.push(
      `静的目次${initial.sourceEntryCount}件のうち参照先を解決できたのは${initial.sourceResolvedCount}件です`,
    );
  }
  if (initial.layoutCount !== 1 || initial.sideCount !== 1 || initial.mobileCount !== 1) {
    failures.push(
      `目次DOM数が不正です（layout=${initial.layoutCount}, side=${initial.sideCount}, mobile=${initial.mobileCount}）`,
    );
  }
  if (initial.visibleTocCount !== 1) {
    failures.push(
      `表示中の目次が${initial.visibleTocCount}件です `
      + `(enhanced=${initial.visibleContainerCount}, stray=${initial.strayStaticVisibleCount})`,
    );
  }
  if (initial.expectedDesktop) {
    if (!initial.sideVisible || initial.mobileVisible) failures.push('1120px以上でside目次だけが表示されていません');
  } else if (!initial.mobileVisible || initial.sideVisible) {
    failures.push('1120px未満でmobile目次だけが表示されていません');
  }
  // モバイル目次は既定で開く（閉じていると存在に気づかれず目次が機能しないため）。
  if (!initial.expectedDesktop && (!initial.mobileIsDetails || !initial.mobileOpen)) {
    failures.push('mobile目次が開いたdetailsではありません');
  }
  if (initial.linkCounts.visible !== initial.sourceEntryCount) {
    failures.push(
      `表示目次リンク${initial.linkCounts.visible}件と静的目次${initial.sourceEntryCount}件が一致しません`,
    );
  }
  const expectedHrefs = initial.sourceHrefs;
  if (JSON.stringify(initial.visibleHrefs) !== JSON.stringify(expectedHrefs)) {
    failures.push('目次リンクの順序または参照先が対象h2と一致しません');
  }
  if (initial.progressCount !== 1) failures.push(`表示目次のprogressbarが${initial.progressCount}件です`);
  if (initial.articleWidth <= 0 || initial.articleWidth > 821) {
    failures.push(`記事本文幅が820px以下ではありません（${initial.articleWidth.toFixed(1)}px）`);
  }
  if (initial.duplicateIds.length) {
    failures.push(`重複idがあります: ${initial.duplicateIds.slice(0, 8).join(', ')}`);
  }

  if (initial.sourceEntryCount >= 2 && initial.visibleContainerCount === 1) {
    if (!initial.expectedDesktop) {
      const summary = page.locator('.post-toc-mobile > summary');
      if (await summary.count() !== 1) failures.push('mobile目次のsummaryが1件ではありません');
      else {
        // 既定で開いているので、Enterでいったん閉じ、もう一度Enterで開く。
        // トグルの両方向を確認する。
        await summary.focus();
        await summary.press('Enter');
        await page.waitForFunction(
          () => !document.querySelector('.post-toc-mobile')?.hasAttribute('open'),
          null,
          { timeout: 3000 },
        );
        await summary.press('Enter');
        await page.waitForFunction(
          () => document.querySelector('.post-toc-mobile')?.hasAttribute('open'),
          null,
          { timeout: 3000 },
        );
      }
    }

    const selector = initial.expectedDesktop ? '.post-toc-side' : '.post-toc-mobile';
    const secondLink = page.locator(`${selector} a[href="${expectedHrefs[1]}"]`);
    if (await secondLink.count() !== 1) {
      failures.push('2番目の目次リンクが1件ではありません');
    } else {
      await secondLink.focus();
      await secondLink.press('Enter');
      await page.waitForFunction(
        (href) => location.hash === href,
        expectedHrefs[1],
        { timeout: 5000 },
      );
      await page.waitForFunction(
        (href) => {
          let id = '';
          try { id = decodeURIComponent(href.slice(1)); } catch { return false; }
          const target = id ? document.getElementById(id) : null;
          const line = Math.max(96, Math.min(innerHeight * 0.28, 220));
          return Boolean(target && target.getBoundingClientRect().top <= line + 1);
        },
        expectedHrefs[1],
        { timeout: 5000 },
      );
      await waitForScrollToSettle(page);
      await page.waitForFunction(
        ({ container, href }) => {
          const visible = (element) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none'
              && style.visibility !== 'hidden';
          };
          const root = [...document.querySelectorAll(container)].find(visible);
          const current = root ? [...root.querySelectorAll('a[aria-current]')]
            .filter((link) => ['true', 'location'].includes(link.getAttribute('aria-current'))) : [];
          return current.length === 1 && current[0].getAttribute('href') === href;
        },
        { container: selector, href: expectedHrefs[1] },
        { timeout: 5000 },
      );
      await page.waitForFunction(
        (container) => {
          const visible = (element) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none'
              && style.visibility !== 'hidden';
          };
          const root = [...document.querySelectorAll(container)].find(visible);
          return Number(root?.querySelector('.post-toc-progress')?.getAttribute('aria-valuenow')) > 0;
        },
        selector,
        { timeout: 5000 },
      );
    }
  }

  const afterScroll = await snapshot();
  if (afterScroll.activeVisibleCount !== 1
    || afterScroll.activeVisibleHrefs[0] !== expectedHrefs[1]) {
    failures.push(
      `表示目次の現在地が1件ではありません（${afterScroll.activeVisibleHrefs.join(',') || '0件'}）`,
    );
  }
  if (!(Number(afterScroll.progressNow) > 0) || !(afterScroll.progressBarWidth > 0)) {
    failures.push(
      `読了率が更新されません（aria=${afterScroll.progressNow || '空'}, width=${afterScroll.progressBarWidth}）`,
    );
  }

  const beforeReinit = await snapshot();
  await page.evaluate(() => {
    window.__mnPostTocReinit();
    window.__mnPostTocReinit();
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterReinit = await snapshot();
  const invariant = (value) => ({
    headingCount: value.headingCount,
    sourceEntryCount: value.sourceEntryCount,
    sourceResolvedCount: value.sourceResolvedCount,
    layoutCount: value.layoutCount,
    sideCount: value.sideCount,
    mobileCount: value.mobileCount,
    visibleContainerCount: value.visibleContainerCount,
    visibleTocCount: value.visibleTocCount,
    strayStaticCount: value.strayStaticCount,
    strayStaticVisibleCount: value.strayStaticVisibleCount,
    sideLinks: value.linkCounts.side,
    mobileLinks: value.linkCounts.mobile,
    duplicateIds: value.duplicateIds,
  });
  if (JSON.stringify(invariant(beforeReinit)) !== JSON.stringify(invariant(afterReinit))) {
    failures.push('目次を2回再初期化するとDOM件数が変わります');
  }

  return {
    measured: initial.sourceEntryCount >= 3
      && initial.sourceResolvedCount === initial.sourceEntryCount
      && initial.visibleContainerCount > 0
      && initial.linkCounts.visible > 0,
    failures,
    initial,
    afterScroll,
    beforeReinit: invariant(beforeReinit),
    afterReinit: invariant(afterReinit),
  };
}

async function inspectPageTerms(page, { requireMarker = true } = {}) {
  const failures = [];
  await page.waitForFunction(
    () => typeof window.__mnTermsReinit === 'function'
      && document.body?.dataset.mnTermsReady === 'true',
    null,
    { timeout: 8000 },
  );
  const state = await page.evaluate(() => {
    const markers = [...document.querySelectorAll('main .term')];
    const keys = markers.map((marker) => marker.dataset.termKey || marker.textContent.trim());
    return {
      markerCount: markers.length,
      popoverCount: document.querySelectorAll('body > .term-pop').length,
      uniqueKeyCount: new Set(keys).size,
      ready: document.body.dataset.mnTermsReady === 'true',
    };
  });
  if (!state.ready) failures.push('用語初期化完了フラグがありません');
  if (requireMarker && state.markerCount <= 0) failures.push('ページ内の用語マーカーが0件です');
  if (state.markerCount !== state.popoverCount) failures.push('用語マーカーとpopoverの件数が一致しません');
  if (state.markerCount !== state.uniqueKeyCount) failures.push('同じ用語が複数回マークされています');
  return {
    measured: state.ready
      && state.markerCount === state.popoverCount
      && state.markerCount === state.uniqueKeyCount
      && (!requireMarker || state.markerCount > 0),
    failures,
    ...state,
  };
}

async function inspectIndexNav(page, visit) {
  const failures = [];
  await page.waitForFunction(
    () => typeof window.__mnNavSpyReinit === 'function'
      && document.querySelector('#services')
      && document.querySelector('#pricing')
      && document.querySelector('#about'),
    null,
    { timeout: 8000 },
  );

  const targetSelector = NAV_TARGETS
    .flatMap(({ href }) => [`.nav-links a[href="${href}"]`, `.mob-nav a[href="${href}"]`])
    .join(',');

  async function readState(label) {
    return page.evaluate(({ targets, selector, stateLabel }) => {
      const links = [...document.querySelectorAll(selector)];
      const desktopCounts = targets.map(({ href }) => (
        document.querySelectorAll(`.nav-links a[href="${href}"]`).length
      ));
      const mobileCounts = targets.map(({ href }) => (
        document.querySelectorAll(`.mob-nav a[href="${href}"]`).length
      ));
      const active = links.filter((link) => link.classList.contains('on'));
      const current = links.filter((link) => link.getAttribute('aria-current') === 'location');
      const allNavLinks = [...document.querySelectorAll('.nav-links a, .mob-nav a')];
      const allActive = allNavLinks.filter((link) => link.classList.contains('on'));
      const allLocation = allNavLinks
        .filter((link) => link.getAttribute('aria-current') === 'location');
      return {
        label: stateLabel,
        linkCount: links.length,
        desktopCounts,
        mobileCounts,
        activeCount: active.length,
        currentCount: current.length,
        activeHrefs: active.map((link) => link.getAttribute('href')),
        currentHrefs: current.map((link) => link.getAttribute('href')),
        allActiveCount: allActive.length,
        allLocationCount: allLocation.length,
        allActiveHrefs: allActive.map((link) => link.getAttribute('href')),
        allLocationHrefs: allLocation.map((link) => link.getAttribute('href')),
      };
    }, { targets: NAV_TARGETS, selector: targetSelector, stateLabel: label });
  }

  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(
    (selector) => [...document.querySelectorAll(selector)]
      .every((link) => !link.classList.contains('on')
        && link.getAttribute('aria-current') !== 'location'),
    targetSelector,
    { timeout: 5000 },
  );
  const states = [await readState('hero')];

  for (const target of NAV_TARGETS) {
    // 遅延画像やcontent-visibilityの展開で初回スクロール後に位置が変わり得る。
    // 判定線の手前へ戻った場合は、対象をもう一度判定線まで運んでから状態を読む。
    await page.waitForFunction(
      ({ href, id, selector }) => {
        const section = document.getElementById(id);
        const markerY = Math.max(72, Math.round(innerHeight * 0.30));
        if (section && section.getBoundingClientRect().top > markerY) {
          section.scrollIntoView({ behavior: 'auto', block: 'start' });
          return false;
        }
        const matching = [...document.querySelectorAll(selector)]
          .filter((link) => link.getAttribute('href') === href);
        const all = [...document.querySelectorAll(selector)];
        return matching.length === 2
          && matching.every((link) => link.classList.contains('on')
            && link.getAttribute('aria-current') === 'location')
          && all.filter((link) => link.classList.contains('on')).length === 2
          && all.filter((link) => link.getAttribute('aria-current') === 'location').length === 2;
      },
      { href: target.href, id: target.id, selector: targetSelector },
      { timeout: 5000 },
    );
    states.push(await readState(target.id));
  }

  if (states.length !== EXPECTED_NAV_STATES_PER_VISIT) {
    failures.push(`ナビ状態が${EXPECTED_NAV_STATES_PER_VISIT}件ではありません（${states.length}件）`);
  }
  for (const state of states) {
    if (state.linkCount !== NAV_TARGETS.length * 2
      || state.desktopCounts.some((count) => count !== 1)
      || state.mobileCounts.some((count) => count !== 1)) {
      failures.push(`${state.label}: desktop/mobileの対象リンクが各1件ではありません`);
    }
    const expectedActive = state.label === 'hero' ? 0 : 2;
    if (state.activeCount !== expectedActive || state.currentCount !== expectedActive
      || state.allActiveCount !== expectedActive || state.allLocationCount !== expectedActive) {
      failures.push(
        `${state.label}: active/currentが${expectedActive}件ではありません `
        + `(対象${state.activeCount}/${state.currentCount}, 全体${state.allActiveCount}/${state.allLocationCount})`,
      );
    }
    if (state.label !== 'hero') {
      const expectedHref = state.label === 'cases' ? 'support.html' : `${state.label}.html`;
      if (state.activeHrefs.some((href) => href !== expectedHref)
        || state.currentHrefs.some((href) => href !== expectedHref)) {
        failures.push(`${state.label}: 別のリンクが現在地になっています`);
      }
    }
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    window.__mnNavSpyReinit();
    window.__mnNavSpyReinit();
  });
  await page.waitForFunction(
    (selector) => [...document.querySelectorAll(selector)]
      .every((link) => !link.classList.contains('on')
        && link.getAttribute('aria-current') !== 'location'),
    targetSelector,
    { timeout: 5000 },
  );
  const afterReinit = await readState('hero-after-reinit');
  if (afterReinit.linkCount !== NAV_TARGETS.length * 2
    || afterReinit.activeCount !== 0 || afterReinit.currentCount !== 0
    || afterReinit.allActiveCount !== 0 || afterReinit.allLocationCount !== 0) {
    failures.push('nav-spyを2回再初期化すると対象または状態が重複します');
  }

  return {
    visit,
    measured: states.length === EXPECTED_NAV_STATES_PER_VISIT
      && states.every((state) => state.linkCount > 0),
    failures,
    states,
    afterReinit,
  };
}

async function spaNavigate(page, path, label) {
  await page.evaluate(({ nextPath, nextLabel }) => {
    if (!window.__mnSpa || typeof window.__mnSpa.navigate !== 'function') {
      throw new Error('page-enter.jsのSPA APIがありません');
    }
    window.__mnSpa.navigate(new URL(nextPath, location.href), { label: nextLabel });
  }, { nextPath: path, nextLabel: label });
  await page.waitForFunction(
    (expectedPath) => location.pathname.endsWith(expectedPath),
    path,
    { timeout: 15000 },
  );
  // URLとbodyはカーテンが上がり切る前に切り替わる。busy中に次のnavigateを呼ぶと
  // page-enter.jsが意図的に無視するため、遷移クラスが外れるところまでを1遷移とする。
  await page.waitForFunction(
    () => !document.documentElement.matches('.pv-on,.pv-mark,.pv-lift'),
    null,
    { timeout: 15000 },
  );
}

async function inspectBlogAfterSpa(page) {
  const failures = [];
  await settlePage(page);
  // 一覧ページは現行本文に辞書語がないため、0件そのものは正常。hookの再初期化と
  // marker/popoverの整合性を測り、用語がある記事・トップでは別途1件以上を必須にする。
  const terms = await inspectPageTerms(page, { requireMarker: false });
  appendFailures(failures, 'ブログ用語', terms.failures);
  const state = await page.evaluate(() => ({
    path: location.pathname,
    navTargetActive: document.querySelectorAll(
      '.nav-links a.on[href="services.html"],.nav-links a.on[href="pricing.html"],'
      + '.nav-links a.on[href="support.html"],.nav-links a.on[href="about.html"],'
      + '.mob-nav a.on[href="services.html"],.mob-nav a.on[href="pricing.html"],'
      + '.mob-nav a.on[href="support.html"],.mob-nav a.on[href="about.html"]',
    ).length,
    tocLayoutCount: document.querySelectorAll('.post-toc-layout').length,
    tocSideCount: document.querySelectorAll('.post-toc-side').length,
    tocMobileCount: document.querySelectorAll('.post-toc-mobile').length,
    termsHook: typeof window.__mnTermsReinit === 'function',
    navHook: typeof window.__mnNavSpyReinit === 'function',
    navController: Boolean(window.__mnNavSpyController),
  }));
  if (!/\/blog\.html$/.test(state.path)) failures.push(`blog.htmlではありません: ${state.path}`);
  if (state.navTargetActive !== 0) failures.push(`ブログでトップ現在地が${state.navTargetActive}件残っています`);
  if (state.tocLayoutCount || state.tocSideCount || state.tocMobileCount) {
    failures.push('ブログ一覧に記事目次DOMが残っています');
  }
  if (!state.termsHook || !state.navHook) failures.push('SPA後に共通再初期化hookがありません');
  if (state.navController) failures.push('ブログ一覧でnav-spy controllerが有効です');
  return {
    measured: terms.measured && state.termsHook && state.navHook,
    failures,
    terms,
    ...state,
  };
}

async function runCondition(page, engine, width, browserErrors) {
  const failures = [];
  const key = conditionKey(engine, width);
  const result = {
    key,
    engine,
    width,
    measured: false,
    failures,
    tooltip: null,
    toc: null,
    navVisits: [],
    spaTransitions: [],
    pageStates: [],
    browserErrors,
  };

  try {
    await gotoWithRetry(page, `${base}${ARTICLE_PATH}`);
    await settlePage(page);
    result.tooltip = await inspectTooltip(page, width);
    appendFailures(failures, 'tooltip', result.tooltip.failures);
    result.toc = await inspectToc(page, width);
    appendFailures(failures, 'toc', result.toc.failures);
    result.pageStates.push({
      stage: 'article',
      path: new URL(page.url()).pathname,
      measured: result.tooltip.measured && result.toc.measured,
    });

    // SPA往復の起点はトップの通常ロード。記事行きは現行仕様どおり通常遷移とする。
    await gotoWithRetry(page, `${base}index.html`);
    await settlePage(page);
    const sentinel = `${key}|${Date.now()}|${Math.random()}`;
    await page.evaluate((value) => { window.__mnUi3SpaSentinel = value; }, sentinel);
    const indexTerms = await inspectPageTerms(page);
    appendFailures(failures, 'トップ用語', indexTerms.failures);
    const initialNav = await inspectIndexNav(page, 'initial');
    result.navVisits.push(initialNav);
    appendFailures(failures, '初回トップナビ', initialNav.failures);
    result.pageStates.push({
      stage: 'index-initial',
      path: new URL(page.url()).pathname,
      measured: indexTerms.measured && initialNav.measured,
      terms: indexTerms,
    });

    await spaNavigate(page, 'blog.html', 'ブログ');
    const blogSentinel = await page.evaluate(() => window.__mnUi3SpaSentinel || '');
    const toBlog = {
      from: 'index.html',
      to: 'blog.html',
      recorded: true,
      completed: blogSentinel === sentinel,
      sentinelPreserved: blogSentinel === sentinel,
    };
    result.spaTransitions.push(toBlog);
    if (!toBlog.completed) failures.push('SPA index→blogでwindow sentinelが失われました');
    const blogState = await inspectBlogAfterSpa(page);
    appendFailures(failures, 'ブログSPA後', blogState.failures);
    result.pageStates.push({ stage: 'blog-spa', path: new URL(page.url()).pathname, measured: blogState.measured });

    await spaNavigate(page, 'index.html', 'トップ');
    await settlePage(page);
    const returnSentinel = await page.evaluate(() => window.__mnUi3SpaSentinel || '');
    const toIndex = {
      from: 'blog.html',
      to: 'index.html',
      recorded: true,
      completed: returnSentinel === sentinel,
      sentinelPreserved: returnSentinel === sentinel,
    };
    result.spaTransitions.push(toIndex);
    if (!toIndex.completed) failures.push('SPA blog→indexでwindow sentinelが失われました');
    const returnTerms = await inspectPageTerms(page);
    appendFailures(failures, '復帰トップ用語', returnTerms.failures);
    const returnNav = await inspectIndexNav(page, 'return');
    result.navVisits.push(returnNav);
    appendFailures(failures, '復帰トップナビ', returnNav.failures);
    const indexDom = await page.evaluate(() => ({
      tocLayoutCount: document.querySelectorAll('.post-toc-layout').length,
      tocSideCount: document.querySelectorAll('.post-toc-side').length,
      tocMobileCount: document.querySelectorAll('.post-toc-mobile').length,
      termsHook: typeof window.__mnTermsReinit === 'function',
      navHook: typeof window.__mnNavSpyReinit === 'function',
      pageEnterVersion: window.__mnSpa?.v ?? null,
      articleHardNavigationContract: typeof window.__mnSpa?.isArticleDest === 'function'
        && window.__mnSpa.isArticleDest(new URL('blog/example.html', location.href))
        && !window.__mnSpa.isArticleDest(new URL('blog.html', location.href)),
    }));
    if (indexDom.tocLayoutCount || indexDom.tocSideCount || indexDom.tocMobileCount) {
      failures.push('トップ復帰後に記事目次DOMが残っています');
    }
    if (!indexDom.termsHook || !indexDom.navHook) failures.push('トップ復帰後に共通再初期化hookがありません');
    if (!Number.isInteger(indexDom.pageEnterVersion) || indexDom.pageEnterVersion < 6) {
      failures.push(`page-enter.jsのSPA版を確認できません（${indexDom.pageEnterVersion ?? 'なし'}）`);
    }
    if (!indexDom.articleHardNavigationContract) {
      failures.push('ブログ記事だけを通常遷移にする現行契約が成立しません');
    }
    result.pageStates.push({
      stage: 'index-return',
      path: new URL(page.url()).pathname,
      measured: returnTerms.measured && returnNav.measured,
      terms: returnTerms,
      dom: indexDom,
    });

    if (browserErrors.length) failures.push(`console/page/request errorが${browserErrors.length}件あります`);
    result.measured = Boolean(
      result.tooltip?.measured
      && result.toc?.measured
      && result.navVisits.length === 2
      && result.navVisits.every((visit) => visit.measured)
      && result.spaTransitions.length === 2
      && result.spaTransitions.every((transition) => transition.recorded),
    );
  } catch (error) {
    failures.push(`検査を完了できません: ${error.message}`);
  }
  result.ok = result.measured && failures.length === 0;
  return result;
}

(async () => {
  const results = [];
  const expectedConditionKeys = ENGINES.flatMap(([engine]) => (
    WIDTHS.map((width) => conditionKey(engine, width))
  ));

  for (const [engine, browserType] of ENGINES) {
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
    } catch (error) {
      for (const width of WIDTHS) {
        results.push({
          key: conditionKey(engine, width),
          engine,
          width,
          measured: false,
          ok: false,
          failures: [`${engine}を起動できません: ${error.message}`],
          tooltip: null,
          toc: null,
          navVisits: [],
          spaTransitions: [],
          pageStates: [],
          browserErrors: [],
        });
      }
      continue;
    }
    try {
      for (const width of WIDTHS) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: 'no-preference',
        });
        const page = await context.newPage();
        const browserErrors = [];
        page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
        page.on('console', (message) => {
          if (message.type() === 'error' && !isIgnoredConsoleError(message)) {
            browserErrors.push(`console ${message.location().url || 'unknown'}: ${message.text()}`);
          }
        });
        page.on('requestfailed', (request) => {
          let requestUrl;
          try { requestUrl = new URL(request.url()); } catch { return; }
          if (requestUrl.origin !== new URL(base).origin) return;
          const errorText = request.failure()?.errorText || 'failed';
          // SPAのbody/head交換で不要になった取得をブラウザーが止める通常動作。
          if (/ERR_ABORTED|cancelled/i.test(errorText)) return;
          browserErrors.push(
            `request ${requestUrl.pathname}: ${errorText}`,
          );
        });
        page.on('response', (response) => {
          let responseUrl;
          try { responseUrl = new URL(response.url()); } catch { return; }
          if (responseUrl.origin === new URL(base).origin && response.status() >= 400) {
            browserErrors.push(`response ${responseUrl.pathname}: HTTP ${response.status()}`);
          }
        });
        await prepareLocalHttpPage(page);
        results.push(await runCondition(page, engine, width, browserErrors));
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }

  const recordedConditionKeys = results.map((result) => result.key);
  const expectedSet = new Set(expectedConditionKeys);
  const recordedSet = new Set(recordedConditionKeys);
  const missingConditionKeys = expectedConditionKeys.filter((key) => !recordedSet.has(key));
  const unexpectedConditionKeys = recordedConditionKeys.filter((key) => !expectedSet.has(key));
  const duplicateConditionKeys = recordedConditionKeys
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  const expectedConditions = expectedConditionKeys.length;
  const recordedConditions = results.length;
  const measuredConditions = results.filter((result) => result.measured).length;
  const unmeasuredConditions = Math.max(0, expectedConditions - measuredConditions);

  const tooltipRecorded = results.filter((result) => result.tooltip).length;
  const tooltipMeasured = results.filter((result) => result.tooltip?.measured).length;
  const tocRecorded = results.filter((result) => result.toc).length;
  const tocMeasured = results.filter((result) => result.toc?.measured).length;
  const navVisits = results.flatMap((result) => result.navVisits || []);
  const navStates = navVisits.flatMap((visit) => visit.states || []);
  const spaTransitions = results.flatMap((result) => result.spaTransitions || []);
  const pageStates = results.flatMap((result) => result.pageStates || []);

  const coverage = {
    expectedConditions,
    recordedConditions,
    measuredConditions,
    unmeasuredConditions,
    missingConditionKeys,
    unexpectedConditionKeys,
    duplicateConditionKeys: [...new Set(duplicateConditionKeys)],
    consistent: recordedConditions === expectedConditions
      && measuredConditions === expectedConditions
      && missingConditionKeys.length === 0
      && unexpectedConditionKeys.length === 0
      && duplicateConditionKeys.length === 0,
  };
  const featureCoverage = {
    tooltip: {
      expected: expectedConditions,
      recorded: tooltipRecorded,
      measured: tooltipMeasured,
      unmeasured: expectedConditions - tooltipMeasured,
    },
    toc: {
      expected: expectedConditions,
      recorded: tocRecorded,
      measured: tocMeasured,
      unmeasured: expectedConditions - tocMeasured,
    },
    navVisits: {
      expected: expectedConditions * 2,
      recorded: navVisits.length,
      measured: navVisits.filter((visit) => visit.measured).length,
      unmeasured: expectedConditions * 2 - navVisits.filter((visit) => visit.measured).length,
    },
    navStates: {
      expected: expectedConditions * 2 * EXPECTED_NAV_STATES_PER_VISIT,
      recorded: navStates.length,
      measured: navStates.filter((state) => state.linkCount > 0).length,
      unmeasured: expectedConditions * 2 * EXPECTED_NAV_STATES_PER_VISIT
        - navStates.filter((state) => state.linkCount > 0).length,
    },
    spaTransitions: {
      expected: expectedConditions * 2,
      recorded: spaTransitions.length,
      measured: spaTransitions.filter((transition) => transition.completed).length,
      unmeasured: expectedConditions * 2
        - spaTransitions.filter((transition) => transition.completed).length,
    },
    pageStates: {
      expected: expectedConditions * 4,
      recorded: pageStates.length,
      measured: pageStates.filter((state) => state.measured).length,
      unmeasured: expectedConditions * 4
        - pageStates.filter((state) => state.measured).length,
    },
  };

  const featureCoverageConsistent = Object.values(featureCoverage).every((item) => (
    item.recorded === item.expected
    && item.measured === item.expected
    && item.unmeasured === 0
  ));
  const failures = results.flatMap((result) => (
    result.failures.map((failure) => `${result.engine}@${result.width}px: ${failure}`)
  ));
  const output = {
    config: {
      article: ARTICLE_PATH,
      engines: ENGINES.map(([engine]) => engine),
      widths: WIDTHS,
      tocDesktopMin: TOC_DESKTOP_MIN,
      navTargets: NAV_TARGETS,
    },
    coverage,
    featureCoverage,
    failures,
    results,
    success: coverage.consistent && featureCoverageConsistent && failures.length === 0,
  };

  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(
      `UI3条件: 期待${coverage.expectedConditions} / 記録${coverage.recordedConditions} / `
      + `実測${coverage.measuredConditions} / 未測定${coverage.unmeasuredConditions}`,
    );
    for (const [name, item] of Object.entries(featureCoverage)) {
      console.log(
        `${name}: 期待${item.expected} / 記録${item.recorded} / `
        + `実測${item.measured} / 未測定${item.unmeasured}`,
      );
    }
    for (const failure of failures.slice(0, 100)) console.error(`失敗: ${failure}`);
    if (failures.length > 100) console.error(`ほか${failures.length - 100}件`);
    console.log(output.success ? '合格: UI改善3点' : `失敗: ${failures.length}件`);
  }
  if (!output.success) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
