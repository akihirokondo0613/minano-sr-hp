/*
 * header-motion.js — サイト共通のヘッダー演出（B＋C 合成 ＋ ホバー②）
 *
 *  ① 縮んで満ちる … スクロールで .nav に .solid（各ページ既存処理）が付くと、
 *                    高さが縮み影が満ちる（下の注入CSS）。
 *  ② 隠れて戻る   … 下スクロールでヘッダーを上へ隠し、上スクロールで戻す（このJS）。
 *  ③ 進捗下線     … ヘッダー下辺に読み進み具合を示す緑線を注入（このJS）。
 *  ＋ ホバー②     … メニューに中央から伸びる緑下線＋文字が緑（注入CSS）。
 *                    トップ（body[data-nav=...]）は独自ナビ演出を持つため対象外。
 *
 * CSSはこのファイルから注入し、全ページ一律に効かせる（service.css読込の有無を問わない）。
 * 既存の .solid トグル / floating 処理には手を付けない。reduced-motion では隠れを無効化。
 */
(function () {
  var CSS = ''
    + '#prog{display:none}'
    + '.nav{transition:height .42s cubic-bezier(.22,1,.36,1),border-color .3s,box-shadow .3s,transform .42s cubic-bezier(.5,0,.15,1)}'
    + '.nav.solid{height:56px;box-shadow:0 6px 20px rgba(0,0,0,.07)}'
    + '.nav.nav--hidden{transform:translateY(-100%)}'
    + '.logo-mark{transition:transform .42s cubic-bezier(.22,1,.36,1)}'
    + '.nav.solid .logo-mark{transform:scale(.9)}'
    + 'body:not([data-nav]) .nav-links a:not(.active):not([aria-current]){background:linear-gradient(var(--g600,#006E3C),var(--g600,#006E3C)) no-repeat center bottom;background-size:0 2px;transition:color .35s ease,background-size .32s cubic-bezier(.22,1,.36,1)}'
    + '@media(hover:hover){body:not([data-nav]) .nav-links a:not(.active):not([aria-current]):hover{color:var(--g600,#006E3C);background-size:100% 2px}}';

  function injectCSS() {
    if (document.getElementById('hm-css')) return;
    var st = document.createElement('style');
    st.id = 'hm-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function init() {
    injectCSS();

    var nav = document.querySelector('.nav');
    if (!nav || nav.querySelector('[data-hm-bar]')) return;

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ③ 進捗下線（ヘッダー下辺に固定。ヘッダーが隠れれば一緒に隠れる）
    if (getComputedStyle(nav).position === 'static') nav.style.position = 'relative';
    var bar = document.createElement('span');
    bar.setAttribute('data-hm-bar', '');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = 'position:absolute;left:0;bottom:0;height:2.5px;width:100%;'
      + 'background:var(--g500,#00A040);transform:scaleX(0);transform-origin:left center;'
      + 'transition:transform .12s linear;pointer-events:none;z-index:2;will-change:transform';
    nav.appendChild(bar);

    var mob = document.getElementById('mobNav');
    var burger = nav.querySelector('.nav-burger');
    var lastY = window.scrollY || 0, hidden = false;

    function setMenu(open, returnFocus) {
      if (!mob || !burger) return;
      mob.classList.toggle('open', open);
      mob.setAttribute('aria-hidden', open ? 'false' : 'true');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
      document.documentElement.classList.toggle('nav-menu-open', open);
      if (open) {
        nav.classList.remove('nav--hidden');
        window.setTimeout(function () {
          var first = mob.querySelector('a[href]');
          if (first) first.focus();
        }, 20);
      } else if (returnFocus) {
        burger.focus();
      }
    }

    if (mob && burger) {
      mob.setAttribute('role', 'navigation');
      mob.setAttribute('aria-label', 'サイトメニュー');
      mob.setAttribute('aria-hidden', mob.classList.contains('open') ? 'false' : 'true');
      document.documentElement.classList.toggle('nav-menu-open', mob.classList.contains('open'));
      burger.setAttribute('aria-controls', mob.id || 'mobNav');
      burger.setAttribute('aria-expanded', mob.classList.contains('open') ? 'true' : 'false');
      burger.setAttribute('aria-label', mob.classList.contains('open') ? 'メニューを閉じる' : 'メニューを開く');
      window.toggleNav = function () { setMenu(!mob.classList.contains('open'), false); };
      window.closeNav = function () { setMenu(false, false); };

      if (window.__hmKeydown) document.removeEventListener('keydown', window.__hmKeydown);
      window.__hmKeydown = function (e) {
        if (e.key === 'Escape' && mob.classList.contains('open')) setMenu(false, true);
        if (e.key === 'Tab' && mob.classList.contains('open')) {
          var items = [burger].concat(Array.prototype.slice.call(mob.querySelectorAll('a[href]')));
          var first = items[0], last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      document.addEventListener('keydown', window.__hmKeydown);

      if (window.__hmResize) window.removeEventListener('resize', window.__hmResize);
      window.__hmResize = function () {
        if (window.innerWidth > 1120 && mob.classList.contains('open')) setMenu(false, false);
      };
      window.addEventListener('resize', window.__hmResize, { passive: true });
    }

    var currentPath = location.pathname.replace(/\/index\.html$/, '/');
    if (/^\/blog\//.test(currentPath)) currentPath = '/blog.html';
    else if (/^\/uploads\/service-/.test(currentPath)) currentPath = '/services.html';
    else if (/^\/uploads\/case-/.test(currentPath)) currentPath = '/support.html';
    [nav, mob].forEach(function (root) {
      if (!root) return;
      root.querySelectorAll('a[href]').forEach(function (a) {
        if (a.classList.contains('logo') || a.classList.contains('nav-cta') || a.classList.contains('mob-cta')) return;
        var path = new URL(a.href, location.href).pathname.replace(/\/index\.html$/, '/');
        if (path === currentPath) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    });

    function update() {
      var y = window.scrollY || 0;
      var max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, y / max)) + ')';

      if (!reduce) {
        var menuOpen = mob && mob.classList.contains('open');
        if (y > lastY + 2 && y > 140 && !menuOpen && !hidden) { hidden = true; nav.classList.add('nav--hidden'); }
        else if ((y < lastY - 2 || y <= 8) && hidden) { hidden = false; nav.classList.remove('nav--hidden'); }
      }
      lastY = y;
    }

    // 直接更新（rAFゲートはバックグラウンド/iframe環境で発火しないことがあるため不採用）
    // SPA差し替えで再初期化されるため、古いリスナーは外してから貼り直す（多重加算防止）
    if (window.__hmUpdate) window.removeEventListener('scroll', window.__hmUpdate);
    window.__hmUpdate = update;
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  // SPA遷移（page-enter.js）が body 差し替え後に呼ぶ再初期化フック
  window.__hmReinit = init;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
