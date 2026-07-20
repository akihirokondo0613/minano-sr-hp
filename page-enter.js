/* ============================================================
   page-enter.js v2 — 自前SPA遷移エンジン ＋ 緑カーテン（2026-07 全面書き換え）

   【仕組み】サイト内リンクのクリックを横取りし、
     ① 緑カーテンで覆う(.22s) → ② fetchで次ページHTML取得（並行）
     → ③ <head>のスタイル・<body>を差し替え、history.pushState
     → ④ 準備（フォント＋トップのみヒーロー画像）を待つ
     → ⑤ マーカー線(.12+.46s) → 一拍(.12s) → めくり(.34s)   …= motion-lab「5a」の固定リズム
   ドキュメントが生き続けるので読み込みの凍結が画面に出ず、
   波・文字・足あとは途切れず動き続ける（旧：入場/退場の二重実装・
   sessionStorage引き継ぎ・prerender注入・壁時計位相同期は全廃）。

   【再初期化の約束事】
   - 共有スクリプト（image-slot.js / mascot.js / link-keep.js / header-motion.js 等の
     src付き）は初回のみ実行。差し替え後は再実行しない（URLレジストリで判定）。
   - 猫マスコットのDOM（.mn-mascot / .mn-recall）は body 差し替えをまたいで移植する。
   - ページ固有のインラインscriptは差し替えのたびに再実行（要素バインドなので安全）。
     ただし id が ONCE_INLINE のもの（pf-hover 等、document級リスナーを張るもの）は初回のみ。
   - header-motion.js は window.__hmReinit()、見出し改行は window.__mnJbreak() を差し替え後に呼ぶ。

   【安全弁】file:// と prefers-reduced-motion と非対応ブラウザでは一切介入しない
   （素のリンク遷移）。fetch失敗・8秒watchdog・例外時は location.href に即フォールバック。
   ============================================================ */
// View Transition API 由来の良性な未処理拒否を握りつぶす（実害なし）
window.addEventListener('unhandledrejection', function (e) {
  var m = e && e.reason && (e.reason.message || e.reason);
  if (typeof m === 'string' && /Transition was skipped/i.test(m)) { e.preventDefault(); }
});

// 時間帯に応じた、来訪者を労う前向きな声かけ（毎回ランダム）
function mnGreeting() {
  var h = new Date().getHours();
  var sets = {
    morning: [
      'おはようございます。今日も一日、応援しています。',
      'おはようございます。すてきな一日になりますように。',
      'おはようございます。今日もいいことがありますように。',
      'おはようございます。お立ち寄りいただきありがとうございます。',
      'おはようございます。今日もなさるべきことを一つずつ。',
      'おはようございます。朝の空気、気持ちいいですね。',
      'おはようございます。今日も一歩、前へ。',
      'おはようございます。あなたの今日を応援しています。'
    ],
    day: [
      'お仕事、おつかれさまです。',
      'いつもがんばっていらっしゃいますね。',
      'あなたの毎日を、応援しています。',
      'こんにちは。お立ち寄りいただきありがとうございます。',
      'お仕事の合間に、おつかれさまです。',
      '今日もひとがんばり、すてきです。',
      'こんにちは。今日もおたがいにがんばりましょう。',
      'いつも本当におつかれさまです。'
    ],
    evening: [
      '今日も一日、おつかれさまです。',
      '夕方もおつかれさまです。あと少し、応援しています。',
      '今日もよくがんばられましたね。',
      'こんばんは。お立ち寄りいただきありがとうございます。',
      '今日一日、がんばったあなたへ。',
      '夕暮れ時、おつかれさまです。',
      '今日も一日、おたがいにおつかれさまでした。',
      'こんばんは。今日もひとがんばりでしたね。'
    ],
    night: [
      '夜分までおつかれさまです。',
      'こんばんは。今日も一日おつかれさまです。',
      '遅くまでがんばるあなたを応援しています。',
      'いつもおつかれさまです。明日もいい日になりますように。',
      '今日一日、本当におつかれさまでした。',
      '静かな夜に、おつかれさまです。',
      '今日もよく頑張りましたね。あなたを応援しています。',
      'こんばんは。お立ち寄りいただきありがとうございます。'
    ]
  };
  var key = (h >= 5 && h < 10) ? 'morning' : (h >= 10 && h < 17) ? 'day' : (h >= 17 && h < 21) ? 'evening' : 'night';
  var list = sets[key];
  return list[Math.floor(Math.random() * list.length)];
}
function mnIsHomePath(p) { return /(^|\/)(index\.html)?$/.test(p || ''); }

/* ── 猫の足あと（採用案 1h）：登り方6パターン。[x, y(上へ), 回転deg]、intは歩間隔（秒） ── */
var MN_PAWS = [
  { steps: [[0, 0, 26], [24, 20, 26], [48, 40, 26], [72, 60, 26]], int: .34 },
  { steps: [[72, 0, -26], [48, 20, -26], [24, 40, -26], [0, 60, -26]], int: .34 },
  { steps: [[4, 0, 32], [30, 16, 8], [16, 36, -24], [42, 52, 28]], int: .34 },
  { steps: [[0, 0, 30], [34, 26, 30], [68, 52, 30]], int: .22 },
  { steps: [[0, 0, 20], [13, 12, 20], [26, 24, 20], [39, 36, 20], [52, 48, 20], [65, 60, 20]], int: .22 },
  { steps: [[0, 0, 48], [24, 12, 34], [42, 30, 16], [52, 52, 2]], int: .34 }
];
var MN_PAW_SVG = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="16" rx="5.4" ry="4.2"/><circle cx="5.2" cy="9.4" r="2.4"/><circle cx="9.8" cy="7" r="2.4"/><circle cx="14.2" cy="7" r="2.4"/><circle cx="18.8" cy="9.4" r="2.4"/></svg>';
function mnPawTrail(el) {
  el.innerHTML = '';
  var p = MN_PAWS[Math.floor(Math.random() * MN_PAWS.length)], mx = 0, my = 0;
  p.steps.forEach(function (s) { if (s[0] > mx) mx = s[0]; if (s[1] > my) my = s[1]; });
  el.style.width = (mx + 16) + 'px';
  el.style.height = (my + 16) + 'px';
  p.steps.forEach(function (s, i) {
    var sp = document.createElement('span');
    // 足あとの出現間隔：非トップ（顧問先ポータル等）はカバー時間が短く（めくりまで約1.25s）、
    // 旧・間隔 p.int（0.22〜0.34s）＋容器の .3s 遅延では 2〜3歩しか登り切らなかった。
    // 12ms 刻みに詰めて、覆っている間に全パターン（最長6歩）が出そろうようにする。
    sp.style.cssText = 'position:absolute;left:' + s[0] + 'px;bottom:' + s[1] + 'px;width:14px;height:14px;opacity:0;will-change:transform,opacity;' +
      'animation:pvPawUp 3.8s ease-out infinite;animation-delay:' + (i * 0.12) + 's';
    sp.innerHTML = MN_PAW_SVG;
    sp.firstChild.style.cssText = 'display:block;width:100%;height:100%;fill:rgba(255,255,255,.62);transform:rotate(' + s[2] + 'deg)';
    el.appendChild(sp);
  });
}
function mnSplitLabel(el, text) {
  // 文字は1字ずつ揺らすが、改行は文節のかたまり（.pv-w＝nowrap）単位でだけ起こす。
  // 旧実装は全文字が独立spanで、狭い画面では任意の位置（単語の途中）で折れていた。
  el.textContent = '';
  var chunks = null;
  try {
    if (window.Intl && Intl.Segmenter) {
      chunks = [];
      var iter = new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)[Symbol.iterator]();
      for (var v = iter.next(); !v.done; v = iter.next()) chunks.push(v.value.segment);
    }
  } catch (e) { chunks = null; }
  if (!chunks || !chunks.length) {   // Segmenter非対応：句読点・括弧の後で切る
    chunks = [];
    var buf = '';
    for (var i = 0; i < text.length; i++) {
      buf += text.charAt(i);
      if (/[、。・！？）」』〜…]/.test(text.charAt(i))) { chunks.push(buf); buf = ''; }
    }
    if (buf) chunks.push(buf);
  }
  // 行頭に置けない閉じ括弧・句読点は前のかたまりへ、行末に残せない開き括弧は次のかたまりへ
  var merged = [];
  chunks.forEach(function (c) {
    if (!c) return;
    var prev = merged.length ? merged[merged.length - 1] : '';
    if (merged.length && (/^[、。・！？）」』〜…ー]/.test(c) || /[（「『]$/.test(prev))) merged[merged.length - 1] = prev + c;
    else merged.push(c);
  });
  var idx = 0;
  merged.forEach(function (c) {
    var w = document.createElement('span');
    w.className = 'pv-w';
    for (var i = 0; i < c.length; i++) {
      var s = document.createElement('span');
      s.className = 'pv-c';
      s.textContent = c.charAt(i) === ' ' ? ' ' : c.charAt(i);
      s.style.animationDelay = (idx * 0.085).toFixed(3) + 's';
      idx++;
      w.appendChild(s);
    }
    el.appendChild(w);
  });
}

/* ════════════════ SPA遷移エンジン本体 ════════════════ */
(function () {
  'use strict';
  var de = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var supported = !!(window.fetch && window.DOMParser && window.history && history.pushState && document.adoptNode);
  // 介入しない環境：素のリンク遷移に任せる
  if (reduce || !supported || location.protocol === 'file:') return;

  try { history.scrollRestoration = 'manual'; } catch (e) {}

  /* ---- カーテン（単一・使い回し。<html>直下に置くので body 差し替えの影響を受けない） ---- */
  var WAVE_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 24' preserveAspectRatio='none'%3E%3Cpath d='M0 12Q30 0 60 12T120 12L120 0L0 0Z' fill='%23123F30'/%3E%3C/svg%3E";
  var veil = null, veilStyle = null;
  function ensureVeil() {
    if (veil) return veil;
    veilStyle = document.createElement('style');
    veilStyle.id = 'pg-veil-style';
    veilStyle.textContent =
      '#pg-veil{position:fixed;left:0;top:0;width:100%;height:calc(100% + 24px);z-index:2147483645;pointer-events:none;' +
      '  transform:translateY(-101%);will-change:transform;visibility:hidden;contain:strict}' +
      '#pg-veil.show{visibility:visible;pointer-events:auto}' +
      '#pg-veil .pv-body{position:absolute;inset:0 0 18px 0;background:var(--pg-curtain,#123F30)}' +
      '#pg-veil .pv-wave{position:absolute;left:0;bottom:0;width:calc(100% + 120px);height:24px;will-change:transform;' +
      '  background:url("' + WAVE_URL + '") left top/120px 24px repeat-x;animation:pvWave 2.4s linear infinite}' +
      '@keyframes pvWave{0%{transform:translate3d(0,0,0)}50%{transform:translate3d(-60px,1.6px,0)}100%{transform:translate3d(-120px,0,0)}}' +
      '#pg-veil .pv-lbl{position:absolute;left:0;right:0;top:calc(50% - 12px);transform:translateY(-50%) translateY(12px);opacity:0;' +
      '  text-align:center;padding:0 32px;color:#fff;letter-spacing:.05em;font-weight:700;font-size:22px;line-height:1.7;' +
      '  font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic Medium",YuGothic,"Noto Sans JP",sans-serif;' +
      '  will-change:transform,opacity;text-wrap:balance}' +
      '@media(max-width:560px){#pg-veil .pv-lbl{font-size:18px;padding:0 24px;line-height:1.9}}' +
      '#pg-veil .pv-in{position:relative;display:inline-block}' +
      '#pg-veil .pv-in::after{content:"";position:absolute;left:-5px;right:-5px;bottom:2px;height:9px;background:rgba(255,255,255,.2);' +
      '  border-radius:2px;transform:scaleX(0);transform-origin:left center;z-index:-1}' +
      '#pg-veil .pv-w{display:inline-block;white-space:nowrap}' +
      '#pg-veil .pv-in .pv-c{display:inline-block;animation:pvBob 2.9s ease-in-out infinite;will-change:transform}' +
      '@keyframes pvBob{0%,100%{transform:translate3d(0,2.2px,0)}50%{transform:translate3d(0,-2.2px,0)}}' +
      '#pg-veil .pv-paws{position:absolute;left:50%;top:calc(50% + 32px);transform:translateX(-50%);opacity:0;' +
      '  transition:opacity .28s ease;will-change:opacity}' +
      '@keyframes pvPawUp{0%{opacity:0;transform:translateY(6px) scale(.6)}9%{opacity:.62;transform:translateY(0) scale(1)}58%{opacity:.62}78%,100%{opacity:0;transform:translateY(0) scale(1)}}' +
      /* 覆う */
      'html.pv-on #pg-veil{transform:translateY(0);transition:transform .22s cubic-bezier(.6,0,.15,1)}' +
      'html.pv-on #pg-veil .pv-lbl{opacity:.97;transform:translateY(-50%);transition:opacity .18s ease .02s,transform .22s cubic-bezier(.6,0,.15,1) .02s}' +
      'html.pv-on #pg-veil .pv-paws{opacity:1}' +
      /* マーカー（準備完了後にだけ引かれる＝途中で切れない） */
      'html.pv-mark #pg-veil .pv-in::after{transform:scaleX(1);transition:transform .46s cubic-bezier(.45,.05,.35,.95) .12s}' +
      /* めくる */
      'html.pv-lift #pg-veil{transform:translateY(-101%);transition:transform .34s cubic-bezier(.6,0,.15,1)}' +
      'html.pv-lift #pg-veil .pv-lbl{opacity:0;transform:translateY(-50%) translateY(-12px);transition:opacity .22s ease,transform .32s cubic-bezier(.6,0,.15,1)}' +
      'html.pv-lift #pg-veil .pv-paws{opacity:0;transition:opacity .12s ease}' +
      /* めくり中はカーテン内の常時アニメ（波の流れ・文字の揺れ・足あとの点滅）を止め、静止した1枚の面にする。
         重い遷移先（社労士とは＝大きなDOM＋クイズ再構築／顧問先＝file-slot.js初回ロード＋一覧生成）では
         めくりの瞬間にレイアウト・描画でメインスレッドが飽和し、常時再描画の子を抱えたカーテンは
         コンポジット層を維持できず“めくりが一瞬で飛ぶ＝上がって見えない”。子アニメを止めれば面は静的な
         1枚となり、transform だけがGPUで滑るので、描画が詰まっていても最後まで上へめくれる。 */
      'html.pv-lift #pg-veil .pv-wave,html.pv-lift #pg-veil .pv-in span,html.pv-lift #pg-veil .pv-paws span{animation-play-state:paused}';
    document.head.appendChild(veilStyle);
    veil = document.createElement('div');
    veil.id = 'pg-veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.innerHTML = '<div class="pv-body"></div><div class="pv-wave"></div><div class="pv-lbl"><span class="pv-in"></span></div><div class="pv-paws"></div>';
    de.appendChild(veil);   // body ではなく <html> 直下（差し替えの影響を受けない）
    return veil;
  }
  function themeColor() {
    var m = document.querySelector('meta[name="theme-color"]');
    return (m && m.getAttribute('content')) || '#123F30';
  }
  var coverDone = Promise.resolve();     // 直近の「覆いきり」完了（navigate が swap 前に待つ）
  function showVeil(label) {
    ensureVeil();
    try { de.style.setProperty('--pg-curtain', themeColor()); } catch (e) {}
    mnSplitLabel(veil.querySelector('.pv-in'), label || '');
    mnPawTrail(veil.querySelector('.pv-paws'));
    veil.classList.add('show');
    void veil.offsetWidth;               // 表示化を確定させてから
    coverDone = new Promise(function (resolve) {
      requestAnimationFrame(function () {  // 1フレームのちに覆う＝初回でも確実に走らせる
        de.classList.add('pv-on');                 // 文字・足あとの立ち上げ（opacity）
        animVeil('-101%', '0', 220).then(resolve, resolve);   // 降りきった時点で解決
      });
    });
  }
  function setVeilLabel(label) {         // 遅れて判明した文字の差し込み（戻る/進む用）
    if (veil) mnSplitLabel(veil.querySelector('.pv-in'), label || '');
  }
  function hideVeil() {
    if (veilAnim) { try { veilAnim.cancel(); } catch (e) {} veilAnim = null; }
    de.classList.remove('pv-on', 'pv-mark', 'pv-lift');
    if (veil) veil.classList.remove('show');
  }
  // カーテンの開閉（覆う/めくる）は Web Animations API で駆動する。クラス切替のCSS
  // トランジションは、遷移の重い同期処理（DOMParser・adoptNode・スクリプト再実行）で
  // メインスレッドが詰まると開始フレームが取れず、開始が遅れる。その遅延が固定の
  // wait(420) を超えると hideVeil がめくり前に pv-lift を剥がし、カーテンがめくれずに消える
  // （＝トップ以外でめくりが出ない・不揃いになる原因）。WAAPIはタイムライン基準で確定的に
  // 終わり、finished を待ってから hideVeil するので、どのページでも必ず最後までめくれる。
  // CSSの transform ルール（.pv-on / .pv-lift）はWAAPI非対応時のフォールバックとして残す。
  var veilAnim = null;
  var VEIL_EASE = 'cubic-bezier(.6,0,.15,1)';
  function animVeil(fromY, toY, ms) {
    if (!veil) return Promise.resolve();
    if (!veil.animate) return wait(ms);                 // 非対応：CSSトランジションに時間だけ与える
    if (veilAnim) { try { veilAnim.cancel(); } catch (e) {} }
    var a = veil.animate(
      [{ transform: 'translateY(' + fromY + ')' }, { transform: 'translateY(' + toY + ')' }],
      { duration: ms, easing: VEIL_EASE, fill: 'both' }
    );
    veilAnim = a;
    return a.finished ? a.finished.catch(function () {}) : wait(ms);
  }

  /* ---- ユーティリティ ---- */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function raf2() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }
  function isHome() { return mnIsHomePath(location.pathname); }
  function pageTitleShort(t) {
    t = (t || '').split(/[｜|]/)[0].trim();
    if (t.length > 20) t = t.slice(0, 20) + '…';
    return t;
  }

  /* ── 遷移演出の要否・ラベルの共通判定（クリック・カード・戻る/進むで共用） ── */
  // 記事（/blog/配下）が「移動先」なら演出しない＝素のリンク遷移に任せる（記事を続けて読む導線を優先）。
  // ブログ一覧 blog.html は通常ページ扱い＝演出あり（ユーザー要望 2026-07-19）。判断基準は原則「移動先」。
  var GENERIC = 'ページを移動します';
  function isArticleDest(u) {
    var p = (u && u.pathname) || '';
    return /\/blog\//i.test(p);   // 記事のみ（blog.html は /blog/ を含まないので対象外＝演出あり）
  }
  function safeLabel(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }
  // 末尾 index.html を落として比較する（/ と /index.html を同一ページとみなす）。トップは / で配信され
  // ナビは index.html#… を指すため、素の pathname 比較では食い違い、同一ページ内アンカーで演出が出てしまう。
  function normPath(p) { return (p || '').replace(/index\.html$/i, ''); }
  function samePage(u) { return normPath(u.pathname) === normPath(location.pathname); }
  // 空・空白のラベルで遷移画面を始めない（＝文字なしのアンダーラインを禁止する最終保険）
  function resolveLabel(s) { s = safeLabel(s); return s || GENERIC; }
  function hasVeilText() {
    var el = veil && veil.querySelector('.pv-in');
    return !!(el && (el.textContent || '').trim().length);
  }
  // 汎用フォールバックのままなら、swap 後に確定した実タイトルへ格上げ（文字は絶対に空にしない）
  function maybeUpgradeLabel() {
    if (!veil) return;
    if (mnIsHomePath(location.pathname)) return;           // ホームは greeting のまま
    var el = veil.querySelector('.pv-in');
    var cur = el ? (el.textContent || '').trim() : '';
    if (cur && cur !== GENERIC) return;                    // 実ラベルがあるなら触らない
    var real = pageTitleShort(document.title);
    if (real) setVeilLabel(real);
  }

  /* ---- 実行済みレジストリ ---- */
  // 注意：初期登録は <head> 同期実行時点＝body未パースなので、初期ページ body 内の共有
  // スクリプト（image-slot/mascot/link-keep/header-motion/file-slot）が登録されない。
  // DCL後に再スキャンして補完する（辞書なので冪等）。→「src付きは初回のみ」の契約を守る。
  var loadedSrcs = {};
  function seedLoadedSrcs() {
    Array.prototype.forEach.call(document.querySelectorAll('script[src]'), function (s) { loadedSrcs[abs(s.getAttribute('src'))] = 1; });
  }
  seedLoadedSrcs();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seedLoadedSrcs);
  var ONCE_INLINE = { 'pf-hover': 1, 'stg-highlight': 1 };   // document級リスナーを張る共通インライン（初回のみ）
  var labelCache = {};                                        // path → ページ名（戻る/進むの文字用）
  labelCache[location.pathname] = isHome() ? '' : pageTitleShort(document.title);
  var lastPath = location.pathname;                           // 直近に表示していたページ（popstateの同一ページ判定用）

  /* ---- <head> の差し替え（style / link[rel=stylesheet] / meta / title） ---- */
  var KEEP_HEAD_IDS = { 'pg-veil-style': 1, 'hm-css': 1, 'mn-mascot-style': 1, '__om-edit-overrides': 1 };
  function headKey(n) {
    if (n.tagName === 'LINK') return 'L:' + abs(n.getAttribute('href') || '');
    var t = n.textContent || '';
    var h = 5381;
    for (var i = 0; i < t.length; i += Math.max(1, t.length >> 9)) h = ((h << 5) + h + t.charCodeAt(i)) | 0; // 荒いハッシュで十分
    return 'S:' + t.length + ':' + h + ':' + (n.id || '');
  }
  /* 未タグの現行ノードに data-pg を付与。page-enter.js は head 先頭で実行されるため
     ロード時点では link/style がまだパースされておらず、即時タグ付けは空振りする（※過去にこれが原因で
     ハードロード面のCSSがSPA差分から漏れ、遷移先に残留するバグがあった。swapHead 冒頭で毎回呼ぶこと） */
  function tagHead() {
    Array.prototype.forEach.call(document.head.querySelectorAll('style,link[rel="stylesheet"]'), function (n) {
      if (!KEEP_HEAD_IDS[n.id] && !n.hasAttribute('data-pg')) n.setAttribute('data-pg', headKey(n));
    });
  }
  tagHead();
  var pendingCss = [];   // swapHead で新規に挿入したCSS（readiness が load を待つ）
  function swapHead(doc) {
    tagHead();
    pendingCss = [];
    document.title = doc.title || document.title;
    ['theme-color', 'description'].forEach(function (name) {
      var nw = doc.head.querySelector('meta[name="' + name + '"]');
      var cur = document.head.querySelector('meta[name="' + name + '"]');
      if (nw && cur) cur.setAttribute('content', nw.getAttribute('content') || '');
      else if (nw && !cur) document.head.appendChild(document.adoptNode(nw));
      else if (!nw && cur && name === 'theme-color') cur.setAttribute('content', '#123F30');
    });
    var existing = {};
    Array.prototype.forEach.call(document.head.querySelectorAll('[data-pg]'), function (n) { existing[n.getAttribute('data-pg')] = n; });
    var used = {};
    Array.prototype.forEach.call(doc.head.querySelectorAll('style,link[rel="stylesheet"]'), function (n) {
      if (KEEP_HEAD_IDS[n.id]) return;
      var k = headKey(n);
      if (existing[k]) { used[k] = 1; return; }     // 同一資産（フォントlink・共通CSS等）は残す＝再取得しない
      var ad = document.adoptNode(n);
      ad.setAttribute('data-pg', k);
      if (ad.tagName === 'LINK') {
        pendingCss.push(new Promise(function (res) {
          ad.addEventListener('load', res);
          ad.addEventListener('error', res);
          if (ad.sheet) res();   // 既に適用済み（キャッシュ即時）
        }));
      }
      document.head.appendChild(ad);
      used[k] = 1;
    });
    Object.keys(existing).forEach(function (k) {
      if (!used[k]) existing[k].parentNode && existing[k].parentNode.removeChild(existing[k]);
    });
  }

  /* ---- <body> の差し替え＋スクリプト再実行 ---- */
  function execScriptsSeq(scope) {
    var list = Array.prototype.slice.call(scope.querySelectorAll('script'));
    var i = 0;
    function step() {
      for (; i < list.length; i++) {
        var s = list[i];
        var type = (s.getAttribute('type') || '').toLowerCase();
        if (type && type !== 'text/javascript' && type !== 'module') continue;   // JSON-LD等はスキップ
        var src = s.getAttribute('src');
        if (src) {
          var u = abs(src);
          if (loadedSrcs[u]) continue;      // 共有スクリプトは初回のみ
          loadedSrcs[u] = 1;
          var ns = document.createElement('script');
          if (type) ns.type = type;
          ns.src = src;
          i++;
          return new Promise(function (res) {
            ns.onload = ns.onerror = res;
            s.parentNode.replaceChild(ns, s);   // 読み込み完了を待って次へ（実行順を保証）
          }).then(step);
        }
        if (s.id && ONCE_INLINE[s.id]) continue;
        var inl = document.createElement('script');
        if (type) inl.type = type;
        if (s.id) inl.id = s.id;
        inl.textContent = s.textContent;
        s.parentNode.replaceChild(inl, s);      // 置換で同期実行（DOM上の位置も維持）
      }
      return Promise.resolve();
    }
    return step();
  }
  function swapBody(doc) {
    var keep = Array.prototype.slice.call(document.querySelectorAll('.mn-mascot, .mn-recall'));
    var newBody = document.adoptNode(doc.body);
    // ロゴローダー(#mn-load)はページを最初に開いた時だけの演出。SPA遷移で来た body にも
    // 静的に含まれているため、除去せずに残すと「トップに戻る」たびに再表示されてしまう。
    var loader = newBody.querySelector('#mn-load');
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
    document.documentElement.replaceChild(newBody, document.body);
    keep.forEach(function (el) { newBody.appendChild(el); });   // 猫はページをまたいで居続ける
    return execScriptsSeq(newBody).then(function () {
      if (window.__hmReinit) { try { window.__hmReinit(); } catch (e) {} }
      if (window.__mnJbreak) { try { window.__mnJbreak(); } catch (e) {} }
      // アクセス解析：SPA遷移は通常のページ読み込みが起きないため、手動でページビューを記録する
      try {
        if (window.goatcounter && window.goatcounter.count) {
          window.goatcounter.count({ path: location.pathname + location.search + location.hash });
        }
      } catch (e) {}
    });
  }

  /* ---- 準備待ち（この間もカーテン上の文字・足あとは漂い続ける） ---- */
  function waitHero(cap) {
    return new Promise(function (res) {
      var done = false;
      // 到着時、ヒーロー写真を即・全表示にする。緑カーテンのめくり自体が“出現”の演出なので、
      // index.html の hero-intro フェード（.hero-stage>image-slot の opacity:0→1・1.3s）は
      // SPA遷移では二重になり、めくれた瞬間に写真がまだ薄い（＝「読み込み後に表示されない」）。
      // 差し替え直後の要素では fill:both が backwards（opacity:0）のまま張り付くこともある。
      // カーテンがまだ覆っている段階で opacity:1 / animation:none を焼き込み、めくった時には
      // 写真が確定表示になっているようにする。初回の直接読み込みでは waitHero は走らない
      // （navigate 内でのみ呼ばれる）ので hero-intro のフェードはそのまま活きる。
      function revealHero() {
        var s = document.querySelector('.hero-stage>image-slot');
        if (s) { s.style.animation = 'none'; s.style.opacity = '1'; }
      }
      var end = function () { if (!done) { done = true; revealHero(); res(); } };
      (function poll() {
        if (done) return;
        var slot = document.querySelector('.hero-stage>image-slot');
        if (!slot) return end();
        var img = slot.shadowRoot && slot.shadowRoot.querySelector('img');
        // 注意：blur-upのぼかし下地は image-slot.js が _setLqip() で「ホスト要素の
        // style.backgroundImage」に敷く実装。shadowRoot 内の _img.src には確定画像しか
        // 入らない（差し込み写真は localStorage/state.json 保存の data:URL がそのまま本画像）。
        // よって data:URL を除外してはいけない（除外すると本画像を永遠に待ち、毎回CAPで強制めくり）。
        if (img && img.style.display !== 'none' && img.complete && img.naturalWidth > 0) return end();
        requestAnimationFrame(poll);
      })();
      setTimeout(end, cap);
    });
  }
  function readiness() {
    // 注意：raf2() は requestAnimationFrame 依存で、rAFが止まる環境（タブ/iframe非表示・
    // 省電力スロットリング）では永遠に解決しない → fetch/swapが全成功でも watchdog→hardGo に
    // なる。250msでタイムボックス化して rAF停止環境でも先へ進める。
    var ps = [Promise.race([raf2(), wait(250)])];
    if (document.fonts && document.fonts.status !== 'loaded') {
      ps.push(Promise.race([document.fonts.ready, wait(800)]));   // 全ページ同一フォント＝通常は即
    }
    if (pendingCss.length) {   // 新規CSSの適用待ち—待たないと素のHTML（縦一列の狭いレイアウト）がめくり後に一瞬見える
      ps.push(Promise.race([Promise.all(pendingCss), wait(2500)]));
      pendingCss = [];
    }
    if (isHome()) ps.push(waitHero(3500));
    return Promise.all(ps);
  }

  /* ---- 遷移本体（5a 固定リズム） ---- */
  var busy = false;
  function hardGo(url) { try { location.href = url; } catch (e) {} }
  function navigate(url, opts) {
    opts = opts || {};
    if (busy) return;
    busy = true;
    var swapped = false, lifted = false;
    function doLift() {
      if (lifted) return Promise.resolve(); lifted = true;
      de.classList.add('pv-lift');                    // 文字・足あとの退場（opacity）
      return animVeil('0', '-101%', 340).then(function () { hideVeil(); busy = false; });
    }
    var watchdog = setTimeout(function () {
      if (swapped) { doLift(); }   // 新DOMは差し替え済み → カーテンだけめくって続行（再読込しない）
      else { hardGo(url); }        // fetch/parse段階で停止 → 従来どおり素の遷移
    }, 8000);
    try { history.replaceState({ mn: 1, y: window.scrollY || 0 }, '', location.href); } catch (e) {}

    // 遷移文言は必ず非空にする（空だと「文字なしのアンダーライン」になる）。
    var label = resolveLabel(opts.label);
    showVeil(label);
    var hash = '';
    try { hash = new URL(url, location.href).hash; } catch (e) {}

    var fetchP = fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.text();
    });

    // ── 文字と線を「覆いきり」基準の同じフェーズに固定する（原因2/3の修正） ──
    // アンダーラインは移動先の読み込み完了(readiness)ではなく、カーテンが降りきって文字が出た直後に引く。
    // これで線の開始タイミングが遷移先の重さに左右されず毎回同じになり、
    // 「線が出ている間は必ず文字が出ている」ことを hasVeilText でゲートして保証する。
    var markP = coverDone.then(function () {
      if (hasVeilText()) de.classList.add('pv-mark');   // 文字がある時だけ線を引く
      return wait(580);                                 // .12s待ち + .46s描画ぶん
    });

    // 覆いきりは実測（coverDone）で待つ。降りきる前に swap すると新ページが一瞬見える（cap1.5sは非表示tab対策）
    var readyP = Promise.all([fetchP, wait(300), Promise.race([coverDone, wait(1500)])])
      .then(function (vals) {
        var doc = new DOMParser().parseFromString(vals[0], 'text/html');
        if (!doc || !doc.body) throw new Error('parse');
        if (opts.push !== false) { history.pushState({ mn: 1, y: 0 }, '', url); }
        swapHead(doc);
        return swapBody(doc).then(function () {
          labelCache[location.pathname] = mnIsHomePath(location.pathname) ? '' : pageTitleShort(document.title);
          lastPath = location.pathname;   // 表示中ページを更新（popstateの同一ページ判定に使う）
          swapped = true;   // 新DOM表示済み（watchdog発火時は再読込せずめくって続行）
          maybeUpgradeLabel();   // 汎用文言のままなら実タイトルへ格上げ（文字は空にしない）
          // スクロール位置：通常は先頭／戻る・進むは記憶位置／アンカーはその位置（カーテンの裏で済ませる）
          var y = opts.scrollY || 0;
          if (hash) {
            var tg = document.getElementById(decodeURIComponent(hash.slice(1)));
            if (tg) y = Math.max(0, tg.getBoundingClientRect().top + (window.scrollY || 0) - 76);
          }
          // scroll-behavior:smooth だと位置リセットがめくり後まで続く「見えるスクロール」になる。裏で即時に。
          de.style.scrollBehavior = 'auto';
          window.scrollTo(0, y);
          requestAnimationFrame(function () { de.style.scrollBehavior = ''; });
          return readiness();
        });
      });

    // 線の描画ぶん(markP)と移動先の準備(readyP)が両方そろってから一拍おいてめくる。
    // この順序で「文字→線→（保持）→めくり」が毎回同じになり、線が途中で切れない。
    Promise.all([markP, readyP])
      .then(function () { return wait(120); })          // 一拍
      .then(function () { clearTimeout(watchdog); return doLift(); })
      .catch(function () { clearTimeout(watchdog); hardGo(url); });   // 何かあれば素の遷移（カーテンごと破棄）
  }

  /* ---- リンク適格判定（旧実装と同条件）＋クエリ引き継ぎ（link-keep相当） ---- */
  function eligible(a) {
    if (!a) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return false;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
    var url; try { url = new URL(a.href, location.href); } catch (e) { return false; }
    if (url.origin !== location.origin) return false;
    if (samePage(url)) return false;   // 同一ページ（/ と /index.html、アンカー・hashのみ・再読込）は素通し
    if (isArticleDest(url)) return false;                  // ★記事(/blog/配下)行きは演出なし＝素のリンク遷移（一覧blog.htmlは演出あり）
    return true;
  }
  function withQuery(url) {   // プレビュー用トークン等の現在クエリを行き先に引き継ぐ
    try {
      var u = new URL(url, location.href);
      var cur = new URLSearchParams(location.search);
      cur.forEach(function (v, k) { if (!u.searchParams.has(k)) u.searchParams.set(k, v); });
      return u.href;
    } catch (e) { return url; }
  }
  // ラベル取得順：①リンク表示文字 ②aria-label ③画像alt/title ④保存済みタイトル ⑤安全な共通文言。
  // どの経路でも必ず非空を返す（空文字のまま遷移画面を開始しない）。
  function destLabel(a) {
    var url; try { url = new URL(a.href, location.href); } catch (e) { url = null; }
    if (url && mnIsHomePath(url.pathname)) return mnGreeting();
    var t = safeLabel(a.textContent);
    if (!t) t = safeLabel(a.getAttribute('aria-label'));
    if (!t) { var img = a.querySelector && a.querySelector('img[alt]'); if (img) t = safeLabel(img.getAttribute('alt')); }
    if (!t) t = safeLabel(a.getAttribute('title'));
    if (!t && url) t = safeLabel(labelCache[url.pathname]);
    if (!t) t = GENERIC;
    if (t.length > 20) t = t.slice(0, 20) + '…';
    return t;
  }
  // window捕捉で登録する（capture順: window→document→target）。プレビュー環境のホスト側
  // スクリプトが document 捕捉でクリックを先取りして素の遷移を起こし、カーテンが途中で
  // 破棄される（文字が一瞬しか見えない）ため、必ず先に走る window 側で横取りする。
  // 本番では従来と同一挙動（stopPropagation で link-keep 等に渡さない点も不変）。
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (eligible(a)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();                  // link-keep等の後続ハンドラに渡さない（クエリは自前で引き継ぐ）
      navigate(withQuery(a.href), { label: destLabel(a) });
      return;
    }
    // onclick="location.href='…'" 型のカード（howカード等）もSPA遷移に乗せる。
    // 素通すとカーテンなしの生リロードになる（capture段階の stopPropagation で
    // ターゲットのインライン onclick は発火しない）。
    var oc = e.target && e.target.closest ? e.target.closest('[onclick]') : null;
    if (oc) {
      var m = /location\.href\s*=\s*['"]([^'"]+)['"]/.exec(oc.getAttribute('onclick') || '');
      if (m) {
        var u; try { u = new URL(m[1], location.href); } catch (err) { u = null; }
        if (u && u.origin === location.origin && !samePage(u) && !isArticleDest(u)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
          var t = (oc.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length > 20) t = t.slice(0, 20) + '…';
          navigate(withQuery(u.href), { label: mnIsHomePath(u.pathname) ? mnGreeting() : t });
        }
      }
    }
  }, true);

  // bfcache 復元ガード：遷移中に hardGo 等で実ナビへ抜けたページが bfcache に入り「戻る」で
  // 復元されると、JS状態ごと復元されて busy=true とカーテン表示が残り、以後のクリックが
  // busy ガードで全無視され「リンクが効かない」状態になり得る。復元時にリセットする。
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { busy = false; hideVeil(); }
  });

  /* ---- 戻る / 進む ---- */
  window.addEventListener('popstate', function (ev) {
    if (busy) { hardGo(location.href); return; }        // 遷移中の戻るは素直に読み直す
    var url; try { url = new URL(location.href); } catch (e) { url = null; }
    if (url && isArticleDest(url)) { hardGo(location.href); return; }   // ★戻る/進むで記事(/blog/)へ来たら素で読み直す（演出なし）
    // ★同一ページ内（pathname不変・hashだけ変化）はカーテン不要＝アンカーへスクロールのみ。
    //   理念/サービス/料金 等トップ内リンクは、プレビューホストが hash 遷移を popstate 化して
    //   ここへ届く。lastPath（直近表示ページ）と比べる（popstate時 location は既に遷移先なので samePage は使えない）。
    if (url && normPath(url.pathname) === normPath(lastPath)) {
      var h = url.hash;
      if (h) {
        var el = document.getElementById(decodeURIComponent(h.slice(1)));
        if (el) { de.style.scrollBehavior = 'auto'; window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + (window.scrollY || 0) - 76)); requestAnimationFrame(function () { de.style.scrollBehavior = ''; }); }
      } else {
        window.scrollTo(0, (ev.state && ev.state.y) || 0);
      }
      return;
    }
    var p = location.pathname;
    lastPath = p;
    var known = labelCache[p];
    var label = mnIsHomePath(p) ? mnGreeting() : (known || GENERIC);   // 未知なら汎用→swap後に実タイトルへ格上げ
    navigate(location.href, {
      push: false,
      label: label,
      scrollY: (ev.state && ev.state.y) || 0
    });
  });
  try { history.replaceState({ mn: 1, y: window.scrollY || 0 }, '', location.href); } catch (e) {}

  // デバッグ・検証用フック（v5：記事のみ除外＝ブログ一覧は演出あり）
  window.__mnSpa = { navigate: navigate, v: 5, isArticleDest: isArticleDest };
})();

/* ============================================================
   見出しの日本語改行を全ブラウザで統一する
   ------------------------------------------------------------
   auto-phrase が効かないブラウザでだけ、句読点等の直後に <wbr> を差し込み
   word-break:keep-all に切り替える（Chromiumはネイティブに任せる）。
   SPA差し替え後にも window.__mnJbreak() で再実行される（jbDoneガードで冪等）。
   ============================================================ */
(function () {
  try {
    var hasAutoPhrase = window.CSS && CSS.supports && CSS.supports('word-break', 'auto-phrase');
    if (hasAutoPhrase) { window.__mnJbreak = function () {}; return; }
  } catch (e) { return; }

  var SEL = '.final-h,.final-cta h2,.page-hero h1,.page-h,.sec-h,.hero-h1,.why-h,.tools-h,.rep-h';
  var AFTER = /[、。，．・／！？：；〜～」』）】〕…]/;

  function process(el) {
    if (el.dataset.jbDone) return;
    el.dataset.jbDone = '1';
    var nodes = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(function (n) {
      var t = n.nodeValue;
      if (!t || !AFTER.test(t)) return;
      var frag = document.createDocumentFragment(), buf = '';
      for (var i = 0; i < t.length; i++) {
        buf += t[i];
        var isDash = t[i] === '—' || t[i] === '―' || t[i] === '─';
        var nextDash = t[i + 1] === '—' || t[i + 1] === '―' || t[i + 1] === '─';
        var breakHere = AFTER.test(t[i]) || (isDash && !nextDash);
        if (breakHere && i < t.length - 1) {
          frag.appendChild(document.createTextNode(buf)); buf = '';
          frag.appendChild(document.createElement('wbr'));
        }
      }
      if (buf) frag.appendChild(document.createTextNode(buf));
      if (frag.childNodes.length > 1) n.parentNode.replaceChild(frag, n);
    });
    el.style.wordBreak = 'keep-all';
    el.style.overflowWrap = 'anywhere';
  }

  function run() { try { document.querySelectorAll(SEL).forEach(process); } catch (e) {} }
  window.__mnJbreak = run;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
