/*
 * header-motion.js — サイト共通のヘッダー演出（B＋C 合成 ＋ ホバー②）
 *
 *  ① 縮んで満ちる … スクロールで .nav に .solid（各ページ既存処理）が付くと、
 *                    高さが縮み影が満ちる（下の注入CSS）。
 *  ② 隠れて戻る   … 下スクロールでヘッダーを上へ隠し、上スクロールで戻す（このJS）。
 *  ③ 進捗下線     … ヘッダー下辺に読み進み具合を示す緑線を注入（このJS）。
 *  （旧「ホバー②」の下線注入は撤去。ナビのホバー下線と背景は skin-v2.css の
 *    .nav-links a::after / a:hover が全ページで担う。2026-08-09）
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
    + '.nav.solid .logo-mark{transform:scale(.9)}';

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

/*
 * カーソルに反応する演出（2026-10-15 本人指示「カーソルに合わせて動きを」）
 *  ・カード：カーソル位置に淡い緑の光が付いてきて、わずかに傾く（最大3度）
 *  ・主ボタン：カーソルが近づくと少し引き寄せられる（最大6px）
 *  ・トップの写真は動かさない（2026-10-15 本人指示で視差を外した）
 * マウス等の細かいポインター（hover:hover かつ pointer:fine）だけで動かし、
 * 指で操作する端末と「動きを減らす」設定では何もしない。
 * document に1回だけ委譲で登録するので、SPA の body 差し替え後もそのまま効く。
 */
(function () {
  if (window.__pfxBound) return;
  var mq = window.matchMedia;
  if (!mq || !mq('(hover: hover) and (pointer: fine)').matches) return;
  if (mq('(prefers-reduced-motion: reduce)').matches) return;
  window.__pfxBound = true;

  var CARD = '.pk-card, .help-card, .rq-card, .art-row, .home-plan-card, .plan-card, .hx-card, .rp-card, .ns-card, .home-once-grid > li, .svc-tab, .xcase-card, .tools-logo, .stage-card';
  var MAG = '.btn-primary, .nav-cta, .plan-btn-main, .startup-primary, .ac-primary';
  var css = ''
    + '.pfx-card.pfx-card{position:relative;isolation:isolate;transform:perspective(900px) rotateX(var(--prx,0deg)) rotateY(var(--pry,0deg)) translateY(var(--pty,0px));transition:transform .45s cubic-bezier(.22,1,.36,1),box-shadow .3s,border-color .3s}'
    + '.pfx-card.pfx-card.pfx-on{transition:transform .12s linear,box-shadow .3s,border-color .3s;--pty:-3px}'
    + '.pfx-glow{position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;opacity:0;transition:opacity .3s;'
    + 'background:radial-gradient(260px circle at var(--pmx,50%) var(--pmy,50%),rgba(46,158,99,.13),rgba(46,158,99,0) 62%)}'
    + '.pfx-card.pfx-on>.pfx-glow{opacity:1}'
    + '.pfx-mag{transition:transform .35s cubic-bezier(.22,1,.36,1)!important}';
  var st = document.createElement('style'); st.id = 'pfx-css'; st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var current = null, magEl = null, raf = 0, last = null;

  function leaveCard(el) {
    el.classList.remove('pfx-on');
    el.style.setProperty('--prx', '0deg'); el.style.setProperty('--pry', '0deg');
  }
  function onCard(el, e) {
    if (!el.classList.contains('pfx-card')) {
      el.classList.add('pfx-card');
      var g = document.createElement('span'); g.className = 'pfx-glow'; g.setAttribute('aria-hidden', 'true');
      el.insertBefore(g, el.firstChild);
    }
    var r = el.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    el.style.setProperty('--pmx', x + 'px'); el.style.setProperty('--pmy', y + 'px');
    var tilt = r.width > 520 ? 1.2 : 3; // 大きいカードほど控えめに
    el.style.setProperty('--pry', (((x / r.width) - .5) * 2 * tilt).toFixed(2) + 'deg');
    el.style.setProperty('--prx', (-((y / r.height) - .5) * 2 * tilt).toFixed(2) + 'deg');
    el.classList.add('pfx-on');
  }
  function onMag(el, e) {
    var r = el.getBoundingClientRect();
    var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    el.classList.add('pfx-mag');
    el.style.transform = 'translate(' + (dx / r.width * 10).toFixed(1) + 'px,' + (dy / r.height * 8).toFixed(1) + 'px)';
  }
  function frame() {
    raf = 0;
    var e = last; if (!e) return;
    var t = e.target && e.target.closest ? e.target : null;
    var card = t && t.closest(CARD);
    if (card !== current) { if (current) leaveCard(current); current = card; }
    if (card) onCard(card, e);
    var mag = t && t.closest(MAG);
    if (mag !== magEl) { if (magEl) magEl.style.transform = ''; magEl = mag; }
    if (mag) onMag(mag, e);
  }
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    last = e;
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });
  document.addEventListener('pointerleave', function () {
    if (current) { leaveCard(current); current = null; }
    if (magEl) { magEl.style.transform = ''; magEl = null; }
  });
})();
