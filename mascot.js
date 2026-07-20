/* ============================================================================
 *  みなの社労士 — サイトマスコット「ねこ」
 *  にっこり笑った協力的な猫が、カーソルを目で追い、スクロールで歩き（3コマ）、
 *  クリックで相談・電話へご案内するヘルパー。
 *
 *  使い方：各ページの </body> 直前に1行追加するだけ。
 *    （ルート直下のページ）    <script src="mascot.js"></script>
 *    （uploads/・blog/ のページ）<script src="../mascot.js"></script>
 *  画像とリンクのパスはページ階層を自動判定します。
 *
 *  ▼ デフォルトの大きさを変えたいとき → 下の DEFAULT_SIZE を書き換え。
 *    （訪問者は吹き出しメニューの「小・中・大」でも変更できます）
 * ========================================================================== */
(function () {
  if (window.__mnMascotLoaded) return;
  window.__mnMascotLoaded = true;

  var reduce  = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = window.matchMedia && window.matchMedia('(hover: none)').matches;

  // ---- ページ階層からルートまでの相対プレフィックスを判定 -------------------
  var p = location.pathname;
  var rootPrefix = /\/(uploads|blog)\/[^\/]*$/.test(p) ? '../' : '';
  var FRAMES = [
    rootPrefix + 'assets/cat-walk-1.webp', // 立ち（小走り）= 待機
    rootPrefix + 'assets/cat-walk-2.webp', // 沈み込み
    rootPrefix + 'assets/cat-walk-3.webp'  // 伸び
  ];
  var SPRITE_RATIO = 0.8; // 画像の高さ / 幅
  var URL_CONTACT = rootPrefix + 'uploads/contact.html';
  var URL_SERVICE = rootPrefix + 'index.html#services';
  var TEL = '090-2838-8252';

  // ---- 大きさ ---------------------------------------------------------------
  var DEFAULT_SIZE = 'auto';                 // 'auto'（画面幅で自動）| 'sm' | 'md' | 'lg'
  var SIZES = { sm: 82, md: 102, lg: 126 }; // px（幅）— ユーザーが明示選択した場合
  var SIZE_KEY = 'mn-mascot-size';
  // 画面幅・媒体に応じた既定の大きさ（スマホでは小さく、ワイド画面では少し大きく）
  function autoWidth() {
    var w = window.innerWidth || 1024;
    if (w <= 360) return 60;
    if (w <= 480) return 70;
    if (w <= 768) return 82;
    if (w <= 1100) return 94;
    if (w >= 1600) return 112;
    return 102;
  }
  function getSize() { try { var v = localStorage.getItem(SIZE_KEY); return SIZES[v] ? v : DEFAULT_SIZE; } catch (e) { return DEFAULT_SIZE; } }
  function setSize(v) { try { localStorage.setItem(SIZE_KEY, v); } catch (e) {} applySize(v); }

  // ---- 役割つきメッセージ（ページ別） --------------------------------------
  // 各ページで「何ができるか・どう役立つか」を具体的に案内する。
  var MESSAGES = {
    index: {
      greet: 'ようこそ。事務所の案内役のねこです。お探しのことへご案内しますね。',
      tips: [
        'どんなサービスがあるか、下の「サービス」でご覧いただけます。',
        '実際の事例も載せています。近いお悩みがきっと見つかります。',
        '助成金が使えるか、無料でお調べできます。'
      ]
    },
    'service-joseikin': {
      greet: '助成金のページですね。使えそうな制度を一緒に探しましょう。',
      tips: [
        '助成金は「もらえるか」の見極めが肝心です。無料でご相談いただけます。',
        '申請の手続きは私たちが代行します。手間はかかりません。',
        '採用・育休・教育訓練——目的に合う助成金をご提案します。'
      ],
      menu: '助成金のご相談、承りますか？'
    },
    'service-kyuyo-keisan': {
      greet: '給与計算のページです。毎月の手間とミスを減らすお手伝いをします。',
      tips: [
        '給与計算の丸ごと代行で、担当者の負担を大きく減らせます。',
        '社会保険料や税の改定にも、こちらで漏れなく対応します。',
        '今のやり方の課題、無料でお見積りします。'
      ]
    },
    'service-romu-sodan': {
      greet: '労務相談のページです。日々の「これ大丈夫？」にお答えします。',
      tips: [
        '残業・休職・ハラスメント——判断に迷う場面をご相談ください。',
        '顧問契約なら、いつでも気軽に聞ける相談先になります。',
        'トラブルは早めの相談が一番の予防になります。'
      ]
    },
    'service-shakai-hoken': {
      greet: '社会保険手続きのページです。入退社の煩雑な手続きを引き受けます。',
      tips: [
        '入社・退社・扶養の手続きを、期限内に正確に代行します。',
        '電子申請に対応。役所へ行く時間も省けます。',
        '手続き漏れの不安、まとめて解消できます。'
      ]
    },
    'service-shugyo-kisoku': {
      greet: '就業規則のページです。会社を守るルールづくりをお手伝いします。',
      tips: [
        '就業規則は「作って終わり」ではなく、実態に合わせて育てます。',
        '法改正に合わせた見直しも承ります。',
        'トラブルを防ぐ規程に整えます。気になる点をご相談ください。'
      ]
    },
    'service-dx': {
      greet: '労務DXのページです。紙とハンコの作業をらくにする方法をご提案します。',
      tips: [
        '勤怠・給与・手続きをデジタルでつなぎ、入力の二度手間をなくします。',
        '導入から運用の定着まで、伴走してサポートします。',
        '今のツールが合っているか、無料で見直します。'
      ]
    },
    case: {
      greet: '事例のページですね。実際にどう解決したかをご紹介します。',
      tips: [
        '同じ業種・近い規模の事例は、特に参考になります。',
        '「うちの場合は？」と思ったら、お気軽にご相談ください。',
        'ほかの業種の事例も、トップからご覧いただけます。'
      ]
    },
    blog: {
      greet: 'コラムのページです。労務の「知っておくと得」をまとめています。',
      tips: [
        '法改正や助成金の最新情報を、わかりやすくお届けしています。',
        '気になる記事から、お気軽にどうぞ。',
        '記事を読んで疑問がわいたら、そのままご相談ください。'
      ]
    },
    recruit: {
      greet: '採用のページですね。一緒に働く仲間を探しています。',
      tips: [
        '「困っている人を助ける」仕事です。やりがいを大切にしています。',
        '完全週休2日制・有給は初年度から15日付与です。',
        '気になることは、お問い合わせから気軽に聞いてください。'
      ],
      menu: '応募・お問い合わせはこちらへどうぞ。'
    },
    contact: {
      greet: 'お問い合わせのページです。入力でお困りなら、ここでお手伝いします。',
      tips: [
        '空欄があっても大丈夫です。わかる範囲でご記入ください。',
        'お電話でのご相談も承っています。下のボタンからどうぞ。',
        'いただいた内容は、担当者が責任を持って拝見します。'
      ]
    },
    portal: {
      greet: '顧問先ポータルですね。お手続きや資料の確認にご利用ください。',
      tips: [
        'よくお使いの機能は、上のメニューからすぐ開けます。',
        '操作でお困りのことがあれば、担当者へおつなぎします。'
      ]
    },
    infographic: {
      greet: '「社労士とは？」のページです。役割をやさしくご説明します。',
      tips: [
        '社労士は、人と会社の「働く」を支える専門家です。',
        '手続き・相談・トラブル予防——幅広くお任せいただけます。',
        'もっと知りたくなったら、無料相談でお話ししましょう。'
      ]
    },
    privacy: {
      greet: 'プライバシーポリシーのページです。情報の扱いをご確認ください。',
      tips: [
        'いただいた個人情報は、目的の範囲で大切に扱います。',
        'ご不明な点は、お問い合わせからお気軽にどうぞ。'
      ]
    },
    _default: {
      greet: 'こんにちは。事務所の案内役のねこです。お手伝いしますね。',
      tips: [
        'お探しのもの、一緒に見つけましょう。',
        'ご相談はいつでも無料です。'
      ]
    }
  };

  // ---- 役割つきメッセージ（トップの各セクション） --------------------------
  // index で見ているセクションに合わせて、その場で意味のある一言を出す。
  var SECTION_MSG = {
    services: 'こちらが提供しているサービス一覧です。お悩みに近いものをお選びください。',
    cases:    '実際の解決事例です。近いケースがあれば、同じように対応できます。',
    voice:    '私たちが大切にしているお約束です。安心してお任せください。',
    faq:      'よくいただくご質問をまとめました。答えが無ければ直接お尋ねください。',
    news:     '最新のお知らせとコラムです。役立つ情報を発信しています。',
    about:    '代表からのメッセージです。どんな想いで取り組んでいるかお伝えします。'
  };

  // ---- セリフ（役割＝サイトの案内役。協力的・ていねい・中身のある一言） ----
  // 猫は「事務所の案内役」。今いるページ・見ている場所に合わせて、
  // 何が分かるか・どう役立つかを具体的に伝える。ただの相づちにしない。
  var PAGE = detectPage();              // 現在ページの種別キー
  var MSG = MESSAGES[PAGE] || MESSAGES._default;
  var GREET = MSG.greet;
  var TIPS  = MSG.tips;
  var MENU_PROMPT = MSG.menu || 'どちらにご案内しましょう？';

  // 現在ページの種別を判定（ファイル名から）
  function detectPage() {
    var f = (p.split('/').pop() || 'index.html').toLowerCase();
    if (/^service-/.test(f)) return 'service-' + f.replace(/^service-|\.html$/g, '');
    if (/^case-/.test(f))    return 'case';
    if (f === 'blog.html' || /\/blog\//.test(p)) return 'blog';
    if (f === 'recruit.html')    return 'recruit';
    if (f === 'contact.html')    return 'contact';
    if (f === 'portal.html')     return 'portal';
    if (f === 'infographic.html')return 'infographic';
    if (f === 'privacy-policy.html') return 'privacy';
    return 'index';
  }

  // ---- 非表示の記憶（その訪問の間だけ畳む） --------------------------------
  // 既定は「隠れている」。表示は「このページを開いている間だけ」で、
  // 再読み込み・ページ遷移のたびに既定の非表示へ戻る（記憶しない）。
  var hiddenState = true;
  function isHidden() { return hiddenState; }
  function setHidden(v) { hiddenState = !!v; }

  // ---- スタイル -------------------------------------------------------------
  var css = '' +
  '.mn-mascot{--mn-w:92px;position:fixed;left:18px;bottom:16px;z-index:9000;width:var(--mn-w);' +
  '  pointer-events:none;user-select:none;-webkit-user-select:none;font-family:inherit}' +
  '.mn-mascot *{box-sizing:border-box}' +
  '.mn-bob{position:relative;width:var(--mn-w);height:calc(var(--mn-w) * 0.8);will-change:transform;' +
  '  transform-origin:50% 100%;animation:mn-breathe 4.6s ease-in-out infinite}' +
  '.mn-bob.mn-walk{animation:mn-walkbob .56s ease-in-out infinite}' +
  '.mn-bob.mn-hop{animation:mn-hop .62s cubic-bezier(.3,1.4,.5,1) 1}' +
  '.mn-sprite{position:relative;width:var(--mn-w);height:calc(var(--mn-w) * 0.8);cursor:grab;pointer-events:auto;touch-action:none;will-change:transform}' +
  '.mn-mascot.mn-dragging .mn-sprite{cursor:grabbing}' +
  '.mn-sprite img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;' +
  '  filter:drop-shadow(0 7px 8px rgba(0,40,20,.16));-webkit-user-drag:none}' +
  '.mn-sprite img.on{display:block}' +
  '.mn-shadow{position:absolute;left:50%;bottom:-3px;width:64%;height:11px;transform:translateX(-50%);' +
  '  background:radial-gradient(closest-side,rgba(0,40,20,.20),rgba(0,40,20,0));z-index:-1;animation:mn-shadow 4.6s ease-in-out infinite}' +
  // 吹き出し（キャラの「上」に出す＝重ならない）
  '.mn-bubble{position:absolute;left:0;bottom:calc(var(--mn-w) * 0.8 + 16px);min-width:0;width:max-content;max-width:240px;' +
  '  background:#fff;border:1.5px solid #e4ece7;border-radius:16px;padding:10px 13px;' +
  '  box-shadow:0 14px 30px rgba(0,50,28,.16);pointer-events:auto;opacity:0;transform:translateY(8px) scale(.97);' +
  '  transform-origin:18px 100%;transition:opacity .25s ease,transform .25s cubic-bezier(.2,1.3,.4,1);' +
  '  font-size:13.5px;line-height:1.72;color:#26483a;letter-spacing:.01em}' +
  '.mn-bubble.menu{width:228px;max-width:none}' +
  '.mn-bubble.show{opacity:1;transform:translateY(0) scale(1)}' +
  '.mn-bubble::after{content:"";position:absolute;left:20px;bottom:-8px;width:15px;height:15px;background:#fff;' +
  '  border-right:1.5px solid #e4ece7;border-bottom:1.5px solid #e4ece7;transform:rotate(45deg)}' +
  // 右半分にいるとき：吹き出しを「左へ」伸ばす（右下のボタン群・画面端に重ねない）
  '.mn-bubble.anchor-right{left:auto;right:0;transform-origin:calc(100% - 18px) 100%}' +
  '.mn-bubble.anchor-right::after{left:auto;right:20px}' +
  // 上に余白が足りないとき：キャラの「下」に出す（矢印は上向き）
  '.mn-bubble.below{bottom:auto;top:calc(var(--mn-w) * 0.8 + 16px);transform-origin:18px 0}' +
  '.mn-bubble.below.anchor-right{transform-origin:calc(100% - 18px) 0}' +
  '.mn-bubble.below::after{bottom:auto;top:-8px;border:none;border-left:1.5px solid #e4ece7;border-top:1.5px solid #e4ece7}' +
  '.mn-bubble-tx{margin:0;font-weight:500;word-break:normal;overflow-wrap:anywhere;line-break:strict;text-wrap:pretty}' +
  '.mn-acts{display:none;flex-direction:column;gap:7px;margin-top:11px}' +
  '.mn-bubble.menu .mn-acts{display:flex}' +
  '.mn-act{display:flex;align-items:center;gap:8px;width:100%;text-decoration:none;border:none;cursor:pointer;' +
  '  font-family:inherit;font-size:13px;font-weight:700;padding:9px 12px;border-radius:10px;text-align:left;' +
  '  transition:transform .12s ease,filter .12s ease}' +
  '.mn-act:hover{transform:translateY(-1px);filter:brightness(1.04)}' +
  '.mn-act.primary{background:#123F30;color:#fff}' +
  '.mn-act.ghost{background:#eef5f0;color:#123F30}' +
  '.mn-act svg{width:16px;height:16px;flex:0 0 auto}' +
  // サイズ切替
  '.mn-sizes{display:none;align-items:center;gap:6px;margin-top:11px;padding-top:10px;border-top:1px dashed #e4ece7}' +
  '.mn-bubble.menu .mn-sizes{display:flex}' +
  '.mn-sizes span{font-size:11.5px;color:#7a948a;font-weight:700;margin-right:2px}' +
  '.mn-sz{flex:1;border:1.5px solid #dbe7e0;background:#fff;color:#2a5a42;cursor:pointer;font-family:inherit;' +
  '  font-size:12px;font-weight:700;padding:6px 0;border-radius:8px;transition:all .12s ease}' +
  '.mn-sz:hover{border-color:#9cc7b3}' +
  '.mn-sz.active{background:#123F30;border-color:#123F30;color:#fff}' +
  // 閉じる／呼び戻し
  '.mn-close{position:absolute;top:-7px;right:-5px;width:25px;height:25px;border-radius:50%;border:1.5px solid #e4ece7;' +
  '  background:#fff;color:#789;cursor:pointer;pointer-events:auto;font-size:13px;line-height:1;display:flex;' +
  '  align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(0,40,20,.12);opacity:0;transition:opacity .2s}' +
  '.mn-mascot:hover .mn-close{opacity:1}' +
  '@media(hover:none){.mn-close{opacity:1}}' +
  // メニュー内の「猫を隠す」
  '.mn-hide-row{display:none;margin-top:9px;padding-top:9px;border-top:1px dashed #e4ece7;text-align:center}' +
  '.mn-bubble.menu .mn-hide-row{display:block}' +
  '.mn-hide-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;color:#7a948a;' +
  '  text-decoration:underline;text-underline-offset:2px;padding:4px 6px;border-radius:6px}' +
  '.mn-hide-btn:hover{color:#3a6b54}' +
  '.mn-recall{position:fixed;left:0;bottom:24px;z-index:9000;width:44px;height:48px;cursor:pointer;padding:0;' +
  '  background:#fff;border:1.5px solid #e4ece7;border-left:none;border-radius:0 14px 14px 0;' +
  '  box-shadow:0 8px 18px rgba(0,50,28,.14);display:none;align-items:center;justify-content:center}' +
  '.mn-recall img{width:34px;height:30px;object-fit:contain}' +
  '@media(max-width:640px){.mn-mascot{left:10px;bottom:12px}.mn-bubble{max-width:200px;font-size:13px}.mn-bubble.menu{width:210px}}' +
  // keyframes
  '@keyframes mn-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2px) scale(1.025)}}' +
  '@keyframes mn-walkbob{0%{transform:translateY(0)}25%{transform:translateY(-5px)}50%{transform:translateY(0)}75%{transform:translateY(-3px)}100%{transform:translateY(0)}}' +
  '@keyframes mn-hop{0%{transform:translateY(0) scale(1)}30%{transform:translateY(-22px) scale(1.05,.95)}' +
  '  55%{transform:translateY(0) scale(.97,1.03)}75%{transform:translateY(-6px) scale(1)}100%{transform:translateY(0) scale(1)}}' +
  '@keyframes mn-shadow{0%,100%{opacity:.5}50%{opacity:.32}}' +
  // 登場演出（マウント時に一度だけ：そっとポップ）
  '.mn-bob.mn-pop{animation:mn-pop .56s cubic-bezier(.22,1.2,.36,1) both}' +
  '@keyframes mn-pop{0%{opacity:0;transform:translateY(16px) scale(.6)}60%{opacity:1;transform:translateY(-3px) scale(1.04)}100%{opacity:1;transform:translateY(0) scale(1)}}' +
  '.mn-mascot.mn-appearing{opacity:0}' +
  '.mn-mascot.mn-appear-in{opacity:1;transition:opacity .4s ease}' +
  '@media(prefers-reduced-motion:reduce){.mn-bob{animation:none!important}.mn-shadow{animation:none}.mn-bob.mn-pop{animation:none}.mn-mascot.mn-appearing{opacity:1}}';

  var style = document.createElement('style');
  style.id = 'mn-mascot-style';
  style.textContent = css;
  document.head.appendChild(style);

  // ---- DOM ------------------------------------------------------------------
  var root = document.createElement('div');
  root.className = 'mn-mascot';
  root.innerHTML = '' +
    '<button class="mn-close" type="button" aria-label="マスコットを隠す">\u00d7</button>' +
    '<div class="mn-bubble" role="status" aria-live="polite">' +
      '<p class="mn-bubble-tx"></p>' +
      '<div class="mn-acts">' +
        '<a class="mn-act primary" href="' + URL_CONTACT + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>無料で相談する</a>' +
        '<a class="mn-act ghost" href="tel:' + TEL + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2z"/></svg>電話で聞く</a>' +
        '<a class="mn-act ghost" href="' + URL_SERVICE + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>サービスを見る</a>' +
      '</div>' +
      '<div class="mn-sizes">' +
        '<span>大きさ</span>' +
        '<button class="mn-sz" data-sz="sm" type="button">小</button>' +
        '<button class="mn-sz" data-sz="md" type="button">中</button>' +
        '<button class="mn-sz" data-sz="lg" type="button">大</button>' +
      '</div>' +
      '<div class="mn-hide-row"><button class="mn-hide-btn" type="button">猫を隠す</button></div>' +
    '</div>' +
    '<div class="mn-bob">' +
      '<div class="mn-sprite">' +
        '<img class="on" data-frame="' + FRAMES[0] + '" alt="案内役の猫" draggable="false">' +
        '<img data-frame="' + FRAMES[1] + '" alt="" draggable="false">' +
        '<img data-frame="' + FRAMES[2] + '" alt="" draggable="false">' +
      '</div>' +
      '<div class="mn-shadow"></div>' +
    '</div>';

  var recall = document.createElement('button');
  recall.className = 'mn-recall';
  recall.type = 'button';
  recall.setAttribute('aria-label', 'マスコットを表示');
  recall.innerHTML = '<img data-frame="' + FRAMES[0] + '" alt="">';

  // 猫フレーム画像は重要描画の後に遅延読み込み（初期表示・フォント取得と帯域を争わない）。
  function loadMascotFrames() {
    var list = root.querySelectorAll('img[data-frame]');
    for (var i = 0; i < list.length; i++) { if (!list[i].getAttribute('src')) list[i].src = list[i].getAttribute('data-frame'); }
    var rimg = recall.querySelector('img[data-frame]');
    if (rimg && !rimg.getAttribute('src')) rimg.src = rimg.getAttribute('data-frame');
  }
  function scheduleFrameLoad() {
    if ('requestIdleCallback' in window) requestIdleCallback(loadMascotFrames, { timeout: 1200 });
    else setTimeout(loadMascotFrames, 400);
  }

  // マスコットは SPA遷移で「作り直さず移動」されるため、初期ページ基準の相対href（uploads/contact.html 等）が
  // uploads/・blog/ 配下で uploads/uploads/… に化けて404になり、遷移カーテンが空振りする。現在地からプレフィックスを
  // 都度計算して mn-act の href を貼り直す。page-enter.js の swapBody 後に __mnMascotRelink() を呼ぶ。
  function mnRelink() {
    var pre = /\/(uploads|blog)\/[^\/]*$/.test(location.pathname) ? '../' : '';
    var primary = root.querySelector('.mn-act.primary');
    if (primary) primary.setAttribute('href', pre + 'uploads/contact.html');
    var ghosts = root.querySelectorAll('.mn-act.ghost');
    for (var i = 0; i < ghosts.length; i++) {
      if (!/^tel:/.test(ghosts[i].getAttribute('href') || '')) ghosts[i].setAttribute('href', pre + 'index.html#services');
    }
  }
  window.__mnMascotRelink = mnRelink;

  function mount() {
    document.body.appendChild(root);
    document.body.appendChild(recall);
    mnRelink();
    scheduleFrameLoad();         // フレーム画像はここからアイドル時に遅延読み込み
    applySize(getSize());
    if (!restorePos()) requestAnimationFrame(applyDefaultPos);
    // 既定は隠れた状態（左端の小さなタブ＝呼び戻しのみ表示）。クリックで登場する。
    if (isHidden()) { hide(true); return; }
    activate();
  }

  // 猫を「表示」状態にして、待機ポーズ・登場演出・あいさつ・案内を起動する。
  function activate(opts) {
    opts = opts || {};
    setFrame(0);                 // 既定は待機（ゆらゆら揺れるだけ）— 歩くのはスクロール中だけ
    startedAt = Date.now();
    // 登場演出：そっとフェード＋ポップして現れる
    if (!reduce) {
      bob.classList.remove('mn-pop');
      root.classList.add('mn-appearing');
      requestAnimationFrame(function () {
        root.classList.add('mn-appear-in');
        bob.classList.add('mn-pop');
        setTimeout(function () { bob.classList.remove('mn-pop'); root.classList.remove('mn-appearing', 'mn-appear-in'); }, 700);
      });
    }
    var delay = (opts.delay != null) ? opts.delay : 1400;
    setTimeout(function () {
      if (isHidden()) return;    // 起動待ちの間に隠されたら何もしない
      say(opts.greet || GREET, opts.hold || 5200); scheduleTip(); observeSections();
    }, delay);
  }

  var startedAt = 0;

  var bob    = root.querySelector('.mn-bob');
  var sprite = root.querySelector('.mn-sprite');
  var imgs   = root.querySelectorAll('.mn-sprite img');
  var bubble = root.querySelector('.mn-bubble');
  var bubbleTx = root.querySelector('.mn-bubble-tx');
  var closeBtn = root.querySelector('.mn-close');
  var szBtns = root.querySelectorAll('.mn-sz');

  // ---- 大きさ適用 -----------------------------------------------------------
  function applySize(v) {
    var px = (v === 'auto') ? autoWidth() : (SIZES[v] || SIZES.md);
    root.style.setProperty('--mn-w', px + 'px');
    szBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-sz') === v); });
  }
  szBtns.forEach(function (b) {
    b.addEventListener('click', function (e) { e.stopPropagation(); setSize(b.getAttribute('data-sz')); });
  });

  // ---- 吹き出し -------------------------------------------------------------
  var bubbleTimer = null, tipTimer = null, menuOpen = false;
  // 吹き出しの向きを、その時の猫の位置に合わせて決める。
  // ・右半分にいる → 左へ伸ばす（右下のボタン群・画面端に重ならない）
  // ・上に余白が足りない → 猫の下に出す
  function placeBubble() {
    var r = root.getBoundingClientRect();
    var anchorRight = (r.left + r.width / 2) > (window.innerWidth / 2);
    bubble.classList.toggle('anchor-right', anchorRight);
    var bh = bubble.offsetHeight || 0;
    bubble.classList.toggle('below', r.top < bh + 24);
  }
  function say(text, hold) {
    if (menuOpen) return;
    bubbleTx.textContent = text;
    bubble.classList.remove('menu');
    placeBubble();
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    // 表示時間は文章の長さに比例（読み切れる長さ）。短文は短く、長文はしっかり。
    if (!hold) {
      hold = Math.min(9000, Math.max(3200, 2200 + text.length * 130));
    }
    bubbleTimer = setTimeout(function () { if (!menuOpen) bubble.classList.remove('show'); }, hold);
  }
  function scheduleTip() {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function tick() {
      if (!menuOpen && !isHidden()) say(TIPS[Math.floor(Math.random() * TIPS.length)]);
      tipTimer = setTimeout(tick, 12000 + Math.random() * 6000);
    }, 9000 + Math.random() * 5000);
  }

  // ---- セクション案内（トップのみ）：見ている場所に合わせて一言 -------------
  var sectionsObserved = false;
  function observeSections() {
    if (sectionsObserved || PAGE !== 'index' || !('IntersectionObserver' in window)) return;
    sectionsObserved = true;
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      // 起動直後（最初の挨拶中）は割り込まない
      if (Date.now() - startedAt < 6500) return;
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id;
        if (!SECTION_MSG[id] || seen[id]) return;
        if (menuOpen || isHidden()) return;
        seen[id] = true;
        clearTimeout(tipTimer);          // 定期Tipと重ならないよう仕切り直す
        say(SECTION_MSG[id], 5200);
        scheduleTip();
      });
    }, { threshold: 0.5 });
    Object.keys(SECTION_MSG).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  // ---- メニュー（案内役） ---------------------------------------------------
  function openMenu() { menuOpen = true; clearTimeout(bubbleTimer); bubbleTx.textContent = MENU_PROMPT; bubble.classList.add('menu'); placeBubble(); bubble.classList.add('show'); }
  function closeMenu() { menuOpen = false; bubble.classList.remove('menu', 'show'); }
  function toggleMenu() { menuOpen ? closeMenu() : openMenu(); }

  // ---- 歩行アニメ（3コマ） --------------------------------------------------
  var WALK_SEQ = [0, 1, 2, 1];
  var seqIdx = 0, frameTimer = null;
  function setFrame(i) { imgs.forEach(function (im, k) { im.classList.toggle('on', k === i); }); }
  function stepFrame() { seqIdx = (seqIdx + 1) % WALK_SEQ.length; setFrame(WALK_SEQ[seqIdx]); }
  function startWalk() {
    if (reduce) return;
    bob.classList.add('mn-walk');
    if (frameTimer) return;
    frameTimer = setInterval(stepFrame, 200);  // ゆっくり歩き
  }
  function stopWalk() {
    bob.classList.remove('mn-walk');
    clearInterval(frameTimer); frameTimer = null;
    seqIdx = 0; setFrame(0);                    // 待機ポーズ（ゆらゆら）へ
  }

  // ---- クリック反応（ぴょん＋メニュー） ------------------------------------
  sprite.addEventListener('click', function (e) {
    e.preventDefault();
    if (justDragged) return;        // ドラッグ直後はメニューを開かない
    if (!reduce) { bob.classList.remove('mn-hop'); void bob.offsetWidth; bob.classList.add('mn-hop');
      setTimeout(function () { bob.classList.remove('mn-hop'); }, 640); }
    toggleMenu();
  });
  document.addEventListener('click', function (e) { if (menuOpen && !root.contains(e.target)) closeMenu(); });

  // ---- ホバーで説明（カーソルが合うと、今役立つ一言を動的に出す） ----------
  // デスクトップのみ。連発しないようスロットルし、メニュー中・非表示中は出さない。
  if (!isTouch) {
    var lastHover = 0;
    sprite.addEventListener('mouseenter', function () {
      if (menuOpen || isHidden() || dragging) return;
      var now = Date.now();
      if (now - lastHover < 2600) return;     // 連発防止
      if (bubble.classList.contains('show')) return; // すでに何か話しているならそのまま
      lastHover = now;
      say(TIPS[Math.floor(Math.random() * TIPS.length)]);
    });
  }

  // ---- 隠す / 呼び戻す ------------------------------------------------------
  function hide(silent) { closeMenu(); root.style.display = 'none'; recall.style.display = 'flex'; if (!silent) setHidden(true); clearTimeout(tipTimer); }
  function show() { setHidden(false); root.style.display = ''; recall.style.display = 'none'; activate({ greet: 'はい、ここにいます！', delay: 200 }); }
  closeBtn.addEventListener('click', function (e) { e.stopPropagation(); hide(false); });
  var hideBtn = root.querySelector('.mn-hide-btn');
  if (hideBtn) hideBtn.addEventListener('click', function (e) { e.stopPropagation(); hide(false); });
  recall.addEventListener('click', show);

  // ---- カーソル追従（視線で追う：本体を少し傾け・寄せる） ------------------
  var tiltX = 0, tiltY = 0, curX = 0, curY = 0, rafOn = false;
  function onMove(e) {
    if (isTouch || dragging || resizing) return;
    // 基準は「傾いていない器（root）」の中心。sprite を基準にすると
    // 傾く→基準がずれる→また傾く、の振動になるため root を使う。
    var r = root.getBoundingClientRect();
    var dx = e.clientX - (r.left + r.width / 2);
    var dy = e.clientY - (r.top + r.height / 2);
    tiltX = Math.max(-1, Math.min(1, dx / 420));
    tiltY = Math.max(-1, Math.min(1, dy / 420));
    if (!rafOn) { rafOn = true; requestAnimationFrame(loop); }
  }
  function loop() {
    curX += (tiltX - curX) * 0.14; curY += (tiltY - curY) * 0.14;
    // 控えめな視線追従（揺れすぎない）
    sprite.style.transform = 'translate(' + (curX * 4).toFixed(2) + 'px,' + (curY * 3).toFixed(2) + 'px) rotate(' + (curX * 3).toFixed(2) + 'deg)';
    if (Math.abs(tiltX - curX) > 0.002 || Math.abs(tiltY - curY) > 0.002) requestAnimationFrame(loop); else rafOn = false;
  }
  function onLeave() { tiltX = 0; tiltY = 0; if (!rafOn) { rafOn = true; requestAnimationFrame(loop); } }
  if (!reduce && !isTouch) { window.addEventListener('mousemove', onMove, { passive: true }); document.addEventListener('mouseleave', onLeave); }

  // ---- ドラッグで位置を移動 ---------------------------------------------
  var POS_KEY = 'mn-mascot-pos-v11';
  var dragging = false, justDragged = false, dStartX = 0, dStartY = 0, dBaseL = 0, dBaseT = 0, dPid = null;
  function clampPos(x, y) {
    var w = root.offsetWidth, h = root.offsetHeight;
    x = Math.max(4, Math.min(window.innerWidth - w - 4, x));
    y = Math.max(4, Math.min(window.innerHeight - h - 4, y));
    return [x, y];
  }
  // 位置は「右下隅からの距離(right/bottom)」で固定する。
  // こうすると右下のフローティングボタンと同じ基準になり、
  // ウィンドウをリサイズしても猫が自然に追従し、JS再計算による高速移動が起きない。
  function applyPos(x, y) {
    var w = root.offsetWidth, h = root.offsetHeight;
    // left/top → right/bottom オフセットに換算
    var rx = window.innerWidth - (x + w);
    var by = window.innerHeight - (y + h);
    rx = Math.max(4, Math.min(window.innerWidth - w - 4, rx));
    by = Math.max(4, Math.min(window.innerHeight - h - 4, by));
    root.style.left = 'auto'; root.style.top = 'auto';
    root.style.right = rx + 'px';
    root.style.bottom = by + 'px';
  }
  function restorePos() {
    try { var s = JSON.parse(localStorage.getItem(POS_KEY)); if (s && typeof s.rx === 'number') { applyByOffset(s.rx, s.by); return true; } } catch (e) {}
    return false;
  }
  function applyByOffset(rx, by) {
    var w = root.offsetWidth, h = root.offsetHeight;
    rx = Math.max(4, Math.min(window.innerWidth - w - 4, rx));
    by = Math.max(4, Math.min(window.innerHeight - h - 4, by));
    root.style.left = 'auto'; root.style.top = 'auto';
    root.style.right = rx + 'px';
    root.style.bottom = by + 'px';
  }
  function savePos() { try { var r = root.getBoundingClientRect(); localStorage.setItem(POS_KEY, JSON.stringify({ rx: window.innerWidth - r.right, by: window.innerHeight - r.bottom })); } catch (e) {} }
  // 既定位置：右下に浮くボタン群の「左隣」（テキストに重ならない）
  function applyDefaultPos() {
    var w = root.offsetWidth, h = root.offsetHeight;
    var cluster = document.querySelector('.floating') || document.querySelector('.fl-primary');
    if (cluster) {
      var b = cluster.getBoundingClientRect();
      if (b.width) {
        // 猫の右端をボタン群の左端の少し外側に置く（12pxの隙間）
        var rx = window.innerWidth - b.left + 12;
        // 猫の足元をボタン群の下辺にそろえる
        var by = window.innerHeight - b.bottom;
        applyByOffset(rx, by);
        return;
      }
    }
    applyByOffset(24, 96); // フォールバック：右下
  }
  sprite.addEventListener('pointerdown', function (e) {
    if (e.button != null && e.button > 0) return;
    var r = root.getBoundingClientRect();
    dBaseL = r.left; dBaseT = r.top; dStartX = e.clientX; dStartY = e.clientY;
    dragging = false; dPid = e.pointerId;
    try { sprite.setPointerCapture(dPid); } catch (_) {}
  });
  sprite.addEventListener('pointermove', function (e) {
    if (dPid == null || e.pointerId !== dPid) return;
    if (!(e.buttons & 1)) { endDrag(e); return; }
    var dx = e.clientX - dStartX, dy = e.clientY - dStartY;
    if (!dragging && Math.sqrt(dx * dx + dy * dy) < 6) return;
    dragging = true;
    root.classList.add('mn-dragging');
    closeMenu();
    sprite.style.transform = '';   // 追従の傾きを一旦リセット
    applyPos(dBaseL + dx, dBaseT + dy);
  });
  function endDrag(e) {
    if (dPid == null) return;
    try { sprite.releasePointerCapture(dPid); } catch (_) {}
    dPid = null;
    if (dragging) {
      dragging = false;
      root.classList.remove('mn-dragging');
      savePos();
      justDragged = true;
      setTimeout(function () { justDragged = false; }, 40);
    }
  }
  sprite.addEventListener('pointerup', endDrag);
  sprite.addEventListener('pointercancel', endDrag);
  var resizeT = null, resizing = false;
  window.addEventListener('resize', function () {
    // リサイズ中は視線追従の傾きを止め（カーソル相対が暴れて見えるのを防止）、
    // 右下基準のまま即座にクランプして、画面内に収め続ける。スナップ（遅延ジャンプ）はしない。
    resizing = true;
    tiltX = 0; tiltY = 0; curX = 0; curY = 0;
    sprite.style.transform = '';
    // 大きさが「自動」のときは、画面幅に合わせて猫のサイズも更新
    if (getSize() === 'auto') applySize('auto');
    var r = root.getBoundingClientRect();
    applyByOffset(window.innerWidth - r.right, window.innerHeight - r.bottom);
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { resizing = false; }, 220);
  });

  // ---- スクロール中だけ、ゆっくり歩く -----------------------------------------
  var walkStop = null;
  function onScroll() {
    if (reduce) return;
    startWalk();
    clearTimeout(walkStop);
    walkStop = setTimeout(stopWalk, 1800);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // ---- 起動 -----------------------------------------------------------------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
