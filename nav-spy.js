(function () {
  'use strict';

  var state = window.__mnNavSpyState || {
    controller: null,
    readyHandler: null
  };
  window.__mnNavSpyState = state;

  var SECTION_BY_PAGE = {
    'services.html': 'services',
    'support.html': 'cases',
    'pricing.html': 'pricing',
    'about.html': 'about'
  };

  function clearReadyHandler() {
    if (!state.readyHandler) return;
    document.removeEventListener('DOMContentLoaded', state.readyHandler);
    state.readyHandler = null;
  }

  function isHomePage() {
    var path = location.pathname.replace(/\/+$/, '');
    return path === '' || path === '/' || /\/index\.html$/i.test(path);
  }

  function pageName(href) {
    try {
      var url = new URL(href, location.href);
      if (url.origin !== location.origin) return '';
      return url.pathname.split('/').pop().toLowerCase();
    } catch (error) {
      return '';
    }
  }

  // 現在地チップ。ヘッダーは下スクロールで隠れる（header-motion.js の .nav--hidden）ため、
  // 読んでいる最中はヘッダー内のハイライトが見えない。画面左上に小さな現在地を出して補う。
  // 表示・非表示の切替は CSS 側（.nav.nav--hidden ~ #navspy-chip.has-loc）が受け持つ。
  function ensureChip() {
    var chip = document.getElementById('navspy-chip');
    if (chip) return chip;
    var nav = document.getElementById('nav') || document.querySelector('.nav');
    if (!nav || !nav.parentNode) return null;
    chip = document.createElement('div');
    chip.id = 'navspy-chip';
    chip.setAttribute('aria-hidden', 'true');   // 現在地は各リンクの aria-current が正式に伝える
    nav.parentNode.insertBefore(chip, nav.nextSibling);
    return chip;
  }

  function createController() {
    if (!isHomePage()) return null;

    var links = Array.prototype.slice.call(document.querySelectorAll(
      '.nav-links a[href], .mob-nav a[href]'
    ));
    var itemById = Object.create(null);
    var items = [];

    links.forEach(function (link) {
      var id = SECTION_BY_PAGE[pageName(link.getAttribute('href'))];
      var section = id && document.getElementById(id);
      if (!section) return;

      if (!itemById[id]) {
        itemById[id] = { id: id, section: section, links: [] };
        items.push(itemById[id]);
      }
      itemById[id].links.push(link);
    });

    items = items.filter(function (item) { return item.links.length === 2; });
    if (!items.length) return null;
    items.sort(function (a, b) {
      if (a.section === b.section) return 0;
      return a.section.compareDocumentPosition(b.section) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    var observer = null;
    var frame = 0;
    var activeId = '';
    var destroyed = false;

    var chip = ensureChip();

    function setActive(nextId) {
      if (nextId === activeId) return;
      activeId = nextId;
      var label = '';
      items.forEach(function (item) {
        var on = item.id === nextId;
        if (on && item.links[0]) label = (item.links[0].textContent || '').trim();
        item.links.forEach(function (link) {
          link.classList.toggle('on', on);
          if (on) link.setAttribute('aria-current', 'location');
          else if (link.getAttribute('aria-current') === 'location') link.removeAttribute('aria-current');
        });
      });

      if (chip) {
        if (label) chip.textContent = label;
        chip.classList.toggle('has-loc', !!label);
      }
    }

    function update() {
      var markerY;
      var nextId = '';
      frame = 0;
      if (destroyed) return;

      markerY = Math.max(72, Math.round(window.innerHeight * 0.30));
      items.forEach(function (item) {
        if (item.section.getBoundingClientRect().top <= markerY + 1) nextId = item.id;
      });
      setActive(nextId);
    }

    function scheduleUpdate() {
      if (destroyed || frame) return;
      frame = window.requestAnimationFrame(update);
    }

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(scheduleUpdate, {
        root: null,
        rootMargin: '-29% 0px -70% 0px',
        threshold: 0
      });
      items.forEach(function (item) { observer.observe(item.section); });
    }
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    scheduleUpdate();

    return {
      itemCount: items.length,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (observer) observer.disconnect();
        window.removeEventListener('scroll', scheduleUpdate);
        window.removeEventListener('resize', scheduleUpdate);
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        setActive('');
        if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
        chip = null;
      }
    };
  }

  function reinit() {
    clearReadyHandler();
    if (state.controller) state.controller.destroy();
    state.controller = createController();
    window.__mnNavSpyController = state.controller;
    return state.controller;
  }

  window.__mnNavSpyReinit = reinit;

  clearReadyHandler();
  if (document.readyState === 'loading') {
    state.readyHandler = function () {
      state.readyHandler = null;
      reinit();
    };
    document.addEventListener('DOMContentLoaded', state.readyHandler, { once: true });
  } else {
    reinit();
  }
})();
