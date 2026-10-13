/* home.js — トップページの横送り（おすすめ情報）とタブ（サービス・インフォメーション）。
   SPAでbodyが差し替わるたびに window.mnInitHome() が呼ばれるので、毎回張り直す（冪等）。
   JavaScriptが無い環境では全パネルを表示したままにする（HTMLに hidden を書かない）。 */
(function () {
  'use strict';

  function initTabs(root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    var panels = tabs.map(function (tab) { return document.getElementById(tab.getAttribute('aria-controls')); });
    function select(index, focus) {
      tabs.forEach(function (tab, i) {
        var on = i === index;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        if (panels[i]) panels[i].hidden = !on;
      });
      if (focus) tabs[index].focus();
    }
    tabs.forEach(function (tab, i) {
      tab.onclick = function () { root.classList.add('is-switched'); select(i, false); };
      tab.onkeydown = function (e) {
        var key = e.key, next = null;
        if (key === 'ArrowRight' || key === 'ArrowDown') next = (i + 1) % tabs.length;
        else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
        else if (key === 'Home') next = 0;
        else if (key === 'End') next = tabs.length - 1;
        if (next === null) return;
        e.preventDefault();
        root.classList.add('is-switched');
        select(next, true);
      };
    });
    var current = tabs.findIndex(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
    select(current < 0 ? 0 : current, false);
    root.classList.add('js-tabs');
  }

  function initRail() {
    var rail = document.getElementById('pk-rail');
    var nav = document.getElementById('pk-nav');
    var bar = document.querySelector('.pk-progress span');
    if (!rail || !nav) return;
    var arrows = Array.prototype.slice.call(nav.querySelectorAll('.pk-arrow'));
    if (window.__mnPkRail) {
      window.removeEventListener('resize', window.__mnPkRail.sync);
    }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var queued = false;
    function step() {
      var first = rail.querySelector('.pk-item');
      if (!first) return rail.clientWidth;
      var gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
      var one = first.getBoundingClientRect().width + gap;
      return one * Math.max(1, Math.floor((rail.clientWidth + gap) / one));
    }
    function measure() {
      queued = false;
      var max = rail.scrollWidth - rail.clientWidth;
      nav.hidden = max <= 1;
      if (arrows[0]) arrows[0].disabled = rail.scrollLeft <= 1;
      if (arrows[1]) arrows[1].disabled = rail.scrollLeft >= max - 1;
      if (bar) {
        var ratio = rail.scrollWidth ? rail.clientWidth / rail.scrollWidth : 1;
        var pos = max > 0 ? rail.scrollLeft / max : 0;
        bar.style.width = (Math.min(1, ratio) * 100) + '%';
        bar.style.left = (pos * (1 - Math.min(1, ratio)) * 100) + '%';
      }
    }
    function sync() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    }
    arrows.forEach(function (button) {
      button.onclick = function () {
        var dir = Number(button.getAttribute('data-pk-dir')) || 1;
        rail.scrollBy({ left: dir * step(), behavior: reduce ? 'auto' : 'smooth' });
      };
    });
    rail.onscroll = sync;
    // マウスでつかんで横に送る。少しでも動かしたらクリック扱いにしない（誤遷移を防ぐ）。
    var drag = null;
    rail.onpointerdown = function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: rail.scrollLeft, moved: false };
    };
    rail.onpointermove = function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; rail.classList.add('is-dragging'); }
      if (drag.moved) rail.scrollLeft = drag.left - dx;
    };
    rail.onpointerup = rail.onpointerleave = function () {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      if (!moved) return;
      // クリックは pointerup の直後に届く。カードを押せない状態のまま1拍待ち、つかんだ先へ遷移させない。
      setTimeout(function () { rail.classList.remove('is-dragging'); }, 0);
      // 指を離した位置から近いカードへ吸着させる
      var first = rail.querySelector('.pk-item');
      if (first) {
        var gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
        var one = first.getBoundingClientRect().width + gap;
        rail.scrollTo({ left: Math.round(rail.scrollLeft / one) * one, behavior: reduce ? 'auto' : 'smooth' });
      }
    };
    rail.ondragstart = function (e) { e.preventDefault(); };
    window.__mnPkRail = { sync: sync };
    window.addEventListener('resize', sync, { passive: true });
    measure();
    requestAnimationFrame(measure);
  }

  window.mnInitHome = function () {
    document.querySelectorAll('[data-tabs]').forEach(initTabs);
    initRail();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.mnInitHome, { once: true });
  } else {
    window.mnInitHome();
  }
})();
