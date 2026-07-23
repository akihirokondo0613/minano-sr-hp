/*
 * link-keep.js — preserve the current URL's query string across internal
 * navigations.
 *
 * Why: when this site is viewed through a preview / share link, the URL
 * carries an auth token (e.g. ?t=...). A plain <a href="blog.html"> click
 * navigates WITHOUT that token, so the destination is served as
 * "file not found" for anyone who isn't separately signed in. This script
 * re-attaches only the preview/attribution parameters needed by this site to
 * same-site link clicks, so a token survives without copying arbitrary input.
 *
 * Safety: if the current URL has no query string (the normal case on a real,
 * deployed website), this script does nothing at all — it is completely inert.
 */
(function () {
  var q = location.search;
  if (!q || q.length < 2) return; // no token/query → inert on real deployments
  var keepQuery = /^(?:t|from|utm_source|utm_medium|utm_campaign|utm_content|utm_term|gclid|fbclid)$/i;

  document.addEventListener(
    'click',
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href) return;

      // Leave in-page anchors and non-navigational schemes alone.
      if (href.charAt(0) === '#') return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) return; // tel:, mailto:, data:, etc.
      if (a.hasAttribute('download')) return;
      if (a.target && a.target !== '' && a.target !== '_self') return; // opens in a new tab

      var url;
      try {
        url = new URL(href, location.href);
      } catch (_) {
        return;
      }
      if (url.origin !== location.origin) return; // external link → leave as-is

      // Merge the current query params into the destination, without
      // clobbering any params the link already specifies (e.g. ?from=...).
      var cur = new URLSearchParams(location.search);
      var dst = url.searchParams;
      cur.forEach(function (v, k) {
        if (keepQuery.test(k) && !dst.has(k)) dst.set(k, v);
      });
      url.search = dst.toString();

      e.preventDefault();
      location.href = url.href;
    },
    true
  );
})();

/*
 * 相談導線の成果計測。
 *
 * GoatCounterへ送るのは「どのページから、どの導線が使われたか」だけ。
 * 氏名・メール・相談内容など、フォームへ入力された値は送信しない。
 * SPA差し替えで再実行されてもリスナーを重複させない。
 */
(function () {
  var old = window.__mnAnalytics;
  if (old && typeof old.dispose === 'function') {
    old.dispose();
  } else if (old) {
    document.removeEventListener('click', old.onClick, true);
    document.removeEventListener('input', old.onFormStart, true);
    document.removeEventListener('submit', old.onFormSubmit, true);
    document.removeEventListener('mn:contact-success', old.onContactSuccess);
    document.removeEventListener('mn:contact-navigate', old.onSpaContactNavigation);
    if (old.timer) clearInterval(old.timer);
  }

  var queue = [];
  var timer = 0;
  var state = {};

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = 0;
    state.timer = 0;
  }

  function safePart(value) {
    return String(value || 'general')
      .toLowerCase()
      .replace(/\.html$/i, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'general';
  }

  function currentPage() {
    var path = location.pathname.replace(/\/+$/, '');
    var last = path.split('/').pop() || 'home';
    if (last === 'index.html') return 'home';
    return safePart(last);
  }

  function flush() {
    if (!window.goatcounter || typeof window.goatcounter.count !== 'function') return false;
    while (queue.length) window.goatcounter.count(queue.shift());
    stopTimer();
    return true;
  }

  function countEvent(path, title) {
    queue.push({
      path: path,
      title: title,
      event: true
    });
    if (flush() || timer) return;

    var attempts = 0;
    timer = setInterval(function () {
      attempts += 1;
      if (flush() || attempts >= 50) {
        stopTimer();
        if (attempts >= 50) queue.length = 0;
      }
    }, 100);
    state.timer = timer;
  }

  function contactSource(url) {
    return safePart(url.searchParams.get('from') || 'general');
  }

  function rememberContactSource(url) {
    var source = safePart(currentPage() + '-' + contactSource(url));
    try {
      sessionStorage.setItem('mn-contact-source', source);
      sessionStorage.setItem('mn-contact-source-at', String(Date.now()));
    } catch (_) {
      // 保存できないブラウザでも、計測と遷移は継続する。
    }
    return source;
  }

  function currentContactSource() {
    var urlSource = new URL(location.href).searchParams.get('from');
    if (urlSource) return safePart(urlSource);
    try {
      var savedAt = Number(sessionStorage.getItem('mn-contact-source-at') || 0);
      if (!savedAt || Date.now() - savedAt > 30 * 60 * 1000) {
        sessionStorage.removeItem('mn-contact-source');
        sessionStorage.removeItem('mn-contact-source-at');
        return 'direct';
      }
      return safePart(sessionStorage.getItem('mn-contact-source') || 'direct');
    } catch (_) {
      return 'direct';
    }
  }

  function onClick(event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;

    var href = link.getAttribute('href') || '';
    if (/^tel:/i.test(href)) {
      countEvent('phone-click:' + currentPage(), '電話リンク');
      return;
    }
    if (/^mailto:/i.test(href)) {
      countEvent('email-click:' + currentPage(), 'メールリンク');
      return;
    }

    var url;
    try {
      url = new URL(href, location.href);
    } catch (_) {
      return;
    }
    trackContactNavigation(url);
  }

  function trackContactNavigation(url) {
    if (!url || url.origin !== location.origin || !/\/uploads\/contact\.html$/i.test(url.pathname)) return;
    var source = rememberContactSource(url);
    countEvent('contact-click:' + source, '無料相談への移動');
  }

  function onSpaContactNavigation(event) {
    var href = event && event.detail && event.detail.href;
    if (!href) return;
    try {
      trackContactNavigation(new URL(href, location.href));
    } catch (_) {
      // 不正なURLは計測せず、ページ遷移本体には影響させない。
    }
  }

  function contactForm(target) {
    return target && target.closest ? target.closest('#contactForm') : null;
  }

  function onFormStart(event) {
    var form = contactForm(event.target);
    if (!form || form.dataset.analyticsStarted === '1') return;
    form.dataset.analyticsStarted = '1';
    countEvent(
      'contact-form-start:' + currentContactSource(),
      '無料相談フォーム入力開始'
    );
  }

  function onFormSubmit(event) {
    if (!event.target || event.target.id !== 'contactForm') return;
    countEvent(
      'contact-submit-attempt:' + currentContactSource(),
      '無料相談フォーム送信操作'
    );
  }

  function onContactSuccess() {
    var source = currentContactSource();
    countEvent(
      'contact-success:' + source,
      '無料相談フォーム送信成功'
    );
    try {
      sessionStorage.removeItem('mn-contact-source');
      sessionStorage.removeItem('mn-contact-source-at');
    } catch (_) {
      // 保存不可のブラウザでは処理不要。
    }
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onFormStart, true);
  document.addEventListener('submit', onFormSubmit, true);
  document.addEventListener('mn:contact-success', onContactSuccess);
  document.addEventListener('mn:contact-navigate', onSpaContactNavigation);

  state = {
    onClick: onClick,
    onFormStart: onFormStart,
    onFormSubmit: onFormSubmit,
    onContactSuccess: onContactSuccess,
    onSpaContactNavigation: onSpaContactNavigation,
    timer: timer,
    dispose: function () {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('input', onFormStart, true);
      document.removeEventListener('submit', onFormSubmit, true);
      document.removeEventListener('mn:contact-success', onContactSuccess);
      document.removeEventListener('mn:contact-navigate', onSpaContactNavigation);
      stopTimer();
      queue.length = 0;
    }
  };
  window.__mnAnalytics = state;
})();
