(function () {
  'use strict';

  var state = {
    article: null,
    sourceToc: null,
    sourceHadHidden: false,
    sourceHiddenValue: null,
    originalParent: null,
    originalNextSibling: null,
    layout: null,
    side: null,
    mobileDetails: null,
    headings: [],
    links: [],
    linkHandlers: [],
    observer: null,
    rafId: 0,
    scrollHandler: null,
    resizeHandler: null,
    hashHandler: null,
    readyHandler: null,
    progressBars: [],
    progressLabels: [],
    progressTracks: []
  };

  function toArray(list) {
    return Array.prototype.slice.call(list || []);
  }

  function normalizedText(element) {
    return (element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function fragmentId(href) {
    var encoded;

    if (!href || href.charAt(0) !== '#') return '';
    encoded = href.slice(1);
    if (!encoded) return '';

    try {
      return decodeURIComponent(encoded);
    } catch (error) {
      return '';
    }
  }

  function readEntries(article, sourceToc) {
    var sourceLinks = toArray(sourceToc.querySelectorAll('a[href^="#"]'));
    var entries = [];
    var valid = sourceLinks.every(function (sourceLink) {
      var href = sourceLink.getAttribute('href');
      var id = fragmentId(href);
      var target = id ? document.getElementById(id) : null;
      var label = normalizedText(sourceLink);

      if (!target || !article.contains(target) || !label) return false;

      entries.push({
        href: href,
        heading: target,
        label: label
      });
      return true;
    });

    return valid ? entries : [];
  }

  function appendLinks(nav, entries) {
    var list = document.createElement('ol');
    list.className = 'post-toc-list';

    entries.forEach(function (entry, index) {
      var item = document.createElement('li');
      var link = document.createElement('a');

      link.className = 'post-toc-link';
      link.setAttribute('href', entry.href);
      link.setAttribute('data-post-toc-index', String(index));
      link.textContent = entry.label;
      item.appendChild(link);
      list.appendChild(item);
    });

    nav.appendChild(list);
  }

  function appendProgress(nav) {
    var track = document.createElement('div');
    var bar = document.createElement('span');
    var label = document.createElement('p');

    track.className = 'post-toc-progress';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', '記事の読了率');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '0');

    bar.className = 'post-toc-progress-bar';
    track.appendChild(bar);

    label.className = 'post-toc-progress-label';
    label.textContent = '0% 読了';

    nav.appendChild(track);
    nav.appendChild(label);
  }

  function createDesktopToc(entries) {
    var aside = document.createElement('aside');
    var nav = document.createElement('nav');
    var title = document.createElement('p');

    aside.className = 'post-toc-side';
    nav.className = 'post-toc-card';
    nav.setAttribute('aria-label', 'この記事の内容');

    title.className = 'post-toc-title';
    title.textContent = 'この記事の内容';
    nav.appendChild(title);
    appendLinks(nav, entries);
    appendProgress(nav);

    aside.appendChild(nav);
    return aside;
  }

  function createMobileToc(entries) {
    var details = document.createElement('details');
    var summary = document.createElement('summary');
    var nav = document.createElement('nav');

    details.className = 'post-toc-mobile';
    // 閉じたままだと存在に気づかれず、目次そのものが機能しない。既定で開く。
    details.open = true;
    summary.textContent = 'この記事の内容（全' + entries.length + '項目）';
    nav.className = 'post-toc-mobile-panel';
    nav.setAttribute('aria-label', 'この記事の内容');

    appendLinks(nav, entries);
    appendProgress(nav);
    details.appendChild(summary);
    details.appendChild(nav);
    return details;
  }

  function enhanceDom(article, sourceToc, entries) {
    var originalParent = article.parentNode;
    var sourceParent = sourceToc.parentNode;
    var layout;
    var side;
    var mobile;

    if (!originalParent || !sourceParent) return null;

    layout = document.createElement('div');
    layout.className = 'post-toc-layout';
    side = createDesktopToc(entries);
    mobile = createMobileToc(entries);

    state.article = article;
    state.sourceToc = sourceToc;
    state.sourceHadHidden = sourceToc.hasAttribute('hidden');
    state.sourceHiddenValue = sourceToc.getAttribute('hidden');
    state.originalParent = originalParent;
    state.originalNextSibling = article.nextSibling;
    state.layout = layout;
    state.side = side;
    state.mobileDetails = mobile;

    originalParent.insertBefore(layout, article);
    layout.appendChild(article);
    layout.appendChild(side);
    sourceParent.insertBefore(mobile, sourceToc);

    // 生成物がすべてDOMへ入った後だけ、静的なno-JS目次を隠す。
    sourceToc.hidden = true;

    return {
      side: side,
      mobile: mobile
    };
  }

  function setCurrent(index) {
    if (!state.links.length || !state.headings.length) return;
    index = Math.max(0, Math.min(index, state.headings.length - 1));

    state.links.forEach(function (link) {
      var isCurrent = Number(link.getAttribute('data-post-toc-index')) === index;
      link.classList.toggle('on', isCurrent);
      if (isCurrent) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function currentIndexFromViewport() {
    var line = Math.max(96, Math.min(window.innerHeight * 0.28, 220));
    var current = 0;

    state.headings.forEach(function (heading, index) {
      if (heading.getBoundingClientRect().top <= line) current = index;
    });

    return current;
  }

  function indexFromHash() {
    var id;

    if (!window.location.hash) return -1;
    id = fragmentId(window.location.hash);
    if (!id) return -1;

    return state.headings.findIndex(function (heading) {
      return heading.id === id;
    });
  }

  function articleProgress() {
    var article = state.article;
    var scrollTop;
    var articleTop;
    var distance;
    var percent;

    if (!article || !article.isConnected) return 0;

    scrollTop = window.scrollY || window.pageYOffset || 0;
    articleTop = article.getBoundingClientRect().top + scrollTop;
    distance = Math.max(1, article.getBoundingClientRect().height - window.innerHeight);
    percent = (scrollTop - articleTop) / distance * 100;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  function updateProgress() {
    var percent = articleProgress();

    state.progressBars.forEach(function (bar) {
      bar.style.width = percent + '%';
    });
    state.progressLabels.forEach(function (label) {
      label.textContent = percent + '% 読了';
    });
    state.progressTracks.forEach(function (track) {
      track.setAttribute('aria-valuenow', String(percent));
    });
  }

  function updateFromViewport() {
    state.rafId = 0;
    if (!state.article || !state.article.isConnected) return;
    setCurrent(currentIndexFromViewport());
    updateProgress();
  }

  function scheduleUpdate() {
    if (state.rafId) return;
    state.rafId = window.requestAnimationFrame(updateFromViewport);
  }

  function observeHeadings() {
    if (!('IntersectionObserver' in window)) return;

    state.observer = new IntersectionObserver(scheduleUpdate, {
      root: null,
      rootMargin: '-88px 0px -70% 0px',
      threshold: [0, 0.5, 1]
    });

    state.headings.forEach(function (heading) {
      state.observer.observe(heading);
    });
  }

  function prefersReducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (error) {
      return false;
    }
  }

  function updateHash(heading) {
    var url;

    try {
      url = new URL(window.location.href);
      url.hash = heading.id;
      window.history.replaceState(window.history.state, '', url.href);
    } catch (error) {
      window.location.hash = heading.id;
    }
  }

  function scrollToHeading(heading) {
    try {
      heading.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start'
      });
    } catch (error) {
      heading.scrollIntoView();
    }
  }

  function bindLinks() {
    state.links.forEach(function (link) {
      var handler = function (event) {
        var index = Number(link.getAttribute('data-post-toc-index'));
        var heading = state.headings[index];

        if (!heading || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        event.preventDefault();
        if (state.mobileDetails && state.mobileDetails.contains(link)) {
          state.mobileDetails.open = false;
        }
        scrollToHeading(heading);
        updateHash(heading);
        setCurrent(index);
        updateProgress();
      };

      link.addEventListener('click', handler);
      state.linkHandlers.push({ link: link, handler: handler });
    });
  }

  function bindWindowEvents() {
    state.scrollHandler = scheduleUpdate;
    state.resizeHandler = scheduleUpdate;
    state.hashHandler = function () {
      var hashIndex = indexFromHash();
      if (hashIndex >= 0) setCurrent(hashIndex);
      scheduleUpdate();
    };

    window.addEventListener('scroll', state.scrollHandler, { passive: true });
    window.addEventListener('resize', state.resizeHandler, { passive: true });
    window.addEventListener('hashchange', state.hashHandler);
  }

  function restoreSourceToc() {
    if (!state.sourceToc) return;

    if (state.sourceHadHidden) {
      state.sourceToc.setAttribute('hidden', state.sourceHiddenValue === null ? '' : state.sourceHiddenValue);
    } else {
      state.sourceToc.removeAttribute('hidden');
    }
  }

  function restoreArticle() {
    var restoreParent;
    var restoreBefore;

    if (!state.article || !state.layout || state.article.parentNode !== state.layout) return;

    restoreParent = state.layout.parentNode || state.originalParent;
    if (!restoreParent) return;

    if (state.layout.parentNode === restoreParent) {
      restoreBefore = state.layout;
    } else if (state.originalNextSibling && state.originalNextSibling.parentNode === restoreParent) {
      restoreBefore = state.originalNextSibling;
    } else {
      restoreBefore = null;
    }

    restoreParent.insertBefore(state.article, restoreBefore);
  }

  function clearState() {
    state.article = null;
    state.sourceToc = null;
    state.sourceHadHidden = false;
    state.sourceHiddenValue = null;
    state.originalParent = null;
    state.originalNextSibling = null;
    state.layout = null;
    state.side = null;
    state.mobileDetails = null;
    state.headings = [];
    state.links = [];
    state.linkHandlers = [];
    state.observer = null;
    state.rafId = 0;
    state.scrollHandler = null;
    state.resizeHandler = null;
    state.hashHandler = null;
    state.readyHandler = null;
    state.progressBars = [];
    state.progressLabels = [];
    state.progressTracks = [];
  }

  function destroy() {
    if (state.readyHandler) {
      document.removeEventListener('DOMContentLoaded', state.readyHandler);
    }

    if (state.observer) state.observer.disconnect();

    state.linkHandlers.forEach(function (binding) {
      binding.link.removeEventListener('click', binding.handler);
    });

    if (state.scrollHandler) window.removeEventListener('scroll', state.scrollHandler);
    if (state.resizeHandler) window.removeEventListener('resize', state.resizeHandler);
    if (state.hashHandler) window.removeEventListener('hashchange', state.hashHandler);
    if (state.rafId) window.cancelAnimationFrame(state.rafId);

    if (state.mobileDetails && state.mobileDetails.parentNode) {
      state.mobileDetails.parentNode.removeChild(state.mobileDetails);
    }
    restoreSourceToc();
    restoreArticle();
    if (state.layout && state.layout.parentNode) {
      state.layout.parentNode.removeChild(state.layout);
    }

    clearState();
  }

  function init() {
    var article = document.querySelector('article.post');
    var sourceToc;
    var entries;
    var dom;
    var initialIndex;

    if (!article) return;
    sourceToc = article.querySelector('nav.post-toc');
    if (!sourceToc) return;

    entries = readEntries(article, sourceToc);
    if (entries.length < 3) return;

    try {
      dom = enhanceDom(article, sourceToc, entries);
      if (!dom) return;

      state.headings = entries.map(function (entry) {
        return entry.heading;
      });
      state.links = toArray(dom.side.querySelectorAll('.post-toc-link')).concat(toArray(dom.mobile.querySelectorAll('.post-toc-link')));
      state.progressBars = toArray(dom.side.querySelectorAll('.post-toc-progress-bar')).concat(toArray(dom.mobile.querySelectorAll('.post-toc-progress-bar')));
      state.progressLabels = toArray(dom.side.querySelectorAll('.post-toc-progress-label')).concat(toArray(dom.mobile.querySelectorAll('.post-toc-progress-label')));
      state.progressTracks = toArray(dom.side.querySelectorAll('.post-toc-progress[role="progressbar"]')).concat(toArray(dom.mobile.querySelectorAll('.post-toc-progress[role="progressbar"]')));

      bindLinks();
      bindWindowEvents();
      observeHeadings();
      updateProgress();

      initialIndex = indexFromHash();
      setCurrent(initialIndex >= 0 ? initialIndex : currentIndexFromViewport());
    } catch (error) {
      destroy();
    }
  }

  function reinit() {
    destroy();
    init();
  }

  if (typeof window.__mnPostTocDestroy === 'function') {
    window.__mnPostTocDestroy();
  }
  window.__mnPostTocDestroy = destroy;
  window.__mnPostTocReinit = reinit;

  if (document.readyState === 'loading') {
    state.readyHandler = reinit;
    document.addEventListener('DOMContentLoaded', state.readyHandler, { once: true });
  } else {
    reinit();
  }
})();
