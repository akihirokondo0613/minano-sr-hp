/* Two complete, aligned poses are swapped; no cropped facial patches. */
(function () {
  'use strict';
  window.mnInitHomeHero = function () {
    if (window.__mnHeroMotionCleanup) window.__mnHeroMotionCleanup();
    var stage = document.querySelector('#top .hero-stage');
    if (!stage) return;
    var motion = matchMedia('(prefers-reduced-motion: reduce)');
    var mobile = matchMedia('(max-width: 768px)');
    var timers = new Set(), stopped = false, visible = true;
    function later(callback, delay) {
      var timer = setTimeout(function () { timers.delete(timer); callback(); }, delay);
      timers.add(timer);
    }
    function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
    function activeCanvas() { return stage.querySelector(mobile.matches ? '.hero-canvas-sp' : '.hero-canvas-pc'); }
    function settle() { stage.classList.remove('hero-entering'); stage.classList.add('hero-settled'); }
    function scheduleExpression(actor, index) {
      later(function () {
        if (stopped || motion.matches || !visible || document.hidden || !stage.isConnected) return;
        var after = actor.querySelector('.actor-after img');
        if (after && after.complete && after.naturalWidth) {
          actor.classList.add('is-wow');
          later(function () { actor.classList.remove('is-wow'); }, 420);
        }
        scheduleExpression(actor, index);
      }, 3600 + index * 720);
    }
    function expressions() {
      clearTimers();
      stage.querySelectorAll('.is-wow').forEach(function (actor) { actor.classList.remove('is-wow'); });
      if (stopped || motion.matches || !visible || document.hidden) return;
      activeCanvas().querySelectorAll('.hero-actor:has(.actor-after)').forEach(function (actor, index) {
        var after = actor.querySelector('.actor-after img');
        if (!after.getAttribute('src')) {
          actor.querySelectorAll('.actor-after source').forEach(function (source) {
            source.srcset = source.getAttribute('data-srcset');
          });
          after.src = after.getAttribute('data-src');
        }
        scheduleExpression(actor, index);
      });
    }
    function preference() { settle(); expressions(); }
    if (!motion.matches && !window.__mnHeroHasEntered) {
      stage.classList.add('hero-entering');
      later(function () { settle(); expressions(); }, 1600);
    } else { settle(); expressions(); }
    window.__mnHeroHasEntered = true;
    var visibilityObserver = new IntersectionObserver(function (entries) {
      var next = entries[0].isIntersecting;
      if (visible !== next) { visible = next; settle(); expressions(); }
    });
    visibilityObserver.observe(stage);
    var removalObserver = new MutationObserver(function () {
      if (!stage.isConnected) cleanup();
    });
    removalObserver.observe(document.documentElement, { childList: true });
    motion.addEventListener('change', preference);
    mobile.addEventListener('change', preference);
    document.addEventListener('visibilitychange', preference);
    function cleanup() {
      stopped = true;
      clearTimers();
      visibilityObserver.disconnect();
      removalObserver.disconnect();
      motion.removeEventListener('change', preference);
      mobile.removeEventListener('change', preference);
      document.removeEventListener('visibilitychange', preference);
    }
    window.__mnHeroMotionCleanup = cleanup;
  };
})();
