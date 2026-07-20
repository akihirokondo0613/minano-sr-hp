/*
 * link-keep.js — preserve the current URL's query string across internal
 * navigations.
 *
 * Why: when this site is viewed through a preview / share link, the URL
 * carries an auth token (e.g. ?t=...). A plain <a href="blog.html"> click
 * navigates WITHOUT that token, so the destination is served as
 * "file not found" for anyone who isn't separately signed in. This script
 * re-attaches the current query string to same-site link clicks so the token
 * survives navigation.
 *
 * Safety: if the current URL has no query string (the normal case on a real,
 * deployed website), this script does nothing at all — it is completely inert.
 */
(function () {
  var q = location.search;
  if (!q || q.length < 2) return; // no token/query → inert on real deployments

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
        if (!dst.has(k)) dst.set(k, v);
      });
      url.search = dst.toString();

      e.preventDefault();
      location.href = url.href;
    },
    true
  );
})();
