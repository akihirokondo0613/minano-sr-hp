/* Complete aligned poses. Entrance reference: docs/hero-gaaboo-motion.md. */
(function () {
  'use strict';
  window.mnInitHomeHero = function () {
    var stage = document.querySelector('#top .hero-stage');
    if (stage && window.__mnHeroMotionStage === stage) return;
    if (window.__mnHeroMotionCleanup) window.__mnHeroMotionCleanup();
    if (!stage) return;
    var motion = matchMedia('(prefers-reduced-motion: reduce)');
    var mobile = matchMedia('(max-width: 767px)');
    var timers = new Set(), stopped = false, visible = true;
    var frame = 0, entered = false;
    function later(callback, delay) {
      var timer = setTimeout(function () { timers.delete(timer); callback(); }, delay);
      timers.add(timer);
    }
    function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
    function activeCanvas() { return stage.querySelector(mobile.matches ? '.hero-canvas-sp' : '.hero-canvas-pc'); }
    function clearEntrance() {
      cancelAnimationFrame(frame);
    }
    function settle() {
      clearEntrance();
      entered = true;
      stage.classList.remove('hero-pending', 'hero-entering');
      stage.classList.add('hero-settled');
      stage.querySelectorAll('.hero-poses').forEach(function (pose) {
        pose.style.removeProperty('transform');
        pose.style.removeProperty('opacity');
      });
    }
    function loadNormalPoses() {
      activeCanvas().querySelectorAll('.hero-media:not(.actor-after) img').forEach(function (img) {
        img.loading = 'eager';
      });
    }
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
      if (stopped || !entered || motion.matches || !visible || document.hidden) return;
      // :has() 非対応のブラウザでも止まらないよう、表情差分の有無はJSで絞り込む。
      Array.from(activeCanvas().querySelectorAll('.hero-actor')).filter(function (actor) {
        return actor.querySelector('.actor-after img');
      }).forEach(function (actor, index) {
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
    function draw(pose, remaining, elapsed) {
      var distance = mobile.matches ? -600 : -1200;
      pose.style.transform = 'translate3d(0,' + distance * remaining + 'px,0) rotateY(' + -60 * remaining + 'deg)';
      pose.style.opacity = Math.min(1, Math.max(0, elapsed / 160));
    }
    function enter() {
      if (stopped || entered) return;
      if (motion.matches || !visible || document.hidden) { settle(); expressions(); return; }
      var poses = Array.from(activeCanvas().querySelectorAll('.hero-poses'));
      var duration = mobile.matches ? 2400 : 2000, start = performance.now();
      stage.classList.remove('hero-pending');
      stage.classList.add('hero-entering');
      function tick(now) {
        if (stopped) return;
        poses.forEach(function (pose, index) {
          var elapsed = Math.max(0, now - start - index * 30);
          var progress = Math.min(1, elapsed / duration);
          // GSAP elastic.out(0.8, 1.1): amplitude clamps to 1; period is 1.1 / 0.8.
          var remaining = progress === 1 ? 0 : Math.pow(2, -10 * progress) * Math.cos(2 * Math.PI * progress / 1.375);
          draw(pose, remaining, elapsed);
        });
        if (now - start >= duration + (poses.length - 1) * 30) { settle(); expressions(); }
        else frame = requestAnimationFrame(tick);
      }
      frame = requestAnimationFrame(tick);
    }
    function preference() { loadNormalPoses(); settle(); expressions(); }
    loadNormalPoses();
    if (motion.matches || document.hidden) { settle(); expressions(); }
    else {
      stage.classList.add('hero-pending');
      activeCanvas().querySelectorAll('.hero-poses').forEach(function (pose) { draw(pose, 1, 0); });
      enter();
    }
    var visibilityObserver = new IntersectionObserver(function (entries) {
      var next = entries[0].isIntersecting;
      if (visible !== next) {
        visible = next;
        if (!visible) settle();
        expressions();
      }
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
      clearEntrance();
      clearTimers();
      visibilityObserver.disconnect();
      removalObserver.disconnect();
      motion.removeEventListener('change', preference);
      mobile.removeEventListener('change', preference);
      document.removeEventListener('visibilitychange', preference);
      if (window.__mnHeroMotionStage === stage) {
        window.__mnHeroMotionStage = null;
        window.__mnHeroMotionCleanup = null;
      }
    }
    window.__mnHeroMotionStage = stage;
    window.__mnHeroMotionCleanup = cleanup;
  };
})();
