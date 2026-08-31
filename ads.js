/**
 * ads.js — Google広告のコンバージョン計測
 *
 * ■ いまは無効です
 *   下の CONFIG.id が空のあいだは外部スクリプトを一切読み込みません。
 *   値を埋めた瞬間から計測が始まります。
 *
 * ■ 値の取り方（Google広告の管理画面 / アカウント 223-961-7825）
 *   1. ツールと設定 → 測定 → コンバージョン
 *   2. 「+ 新しいコンバージョンアクション」→ ウェブサイト
 *   3. ドメインに minano-sr.com を入力 →「手動でコンバージョンアクションを追加」
 *   4. 目標を選んで作成したあと、「タグを設定する」→「タグを自分で追加する」を開くと
 *          送信先: AW-1234567890/AbCdEfGhIj
 *      と表示される。スラッシュの前が id、後ろが label。
 *   5. 同じ手順をもう一度行い、電話タップ用のアクションも作る（label だけ違う値になる）。
 *
 * ■ 作成時に決める設定（ここの実装が前提にしているもの）
 *   ・カウント方法は「1回」。このスクリプトは重複排除用の transaction_id を送らないため、
 *     「全件」にすると再送信や再申込がそのまま二重計上される。
 *   ・自動タグ設定（gclid の自動付与）が ON であること。OFF だと URL に gclid が付かず、
 *     広告クリックとコンバージョンが結び付かない。
 *
 * ■ どのページに載せるか
 *   広告の着地ページ（startup-payroll.html / uploads/service-shugyo-kisoku.html）と、
 *   コンバージョンが起きるページ（uploads/contact.html）の3枚だけ。
 *   着地ページで gtag が動くと gclid から _gcl_aw クッキーが書かれるので、
 *   その場で申し込まず後日ブックマークや自然検索で戻ってきた人も広告に紐づく。
 *   着地ページにタグが無いと、この経路の申込は取りこぼす。
 *
 * ■ 本番でしか動かさない（重要）
 *   scripts/verify-ui.cjs は問い合わせフォームを実際に入力して送信ボタンを押し、
 *   formsubmit.co だけを差し替えて success を返す。つまり mn:contact-success が発火する。
 *   googletagmanager.com は差し替えていないため、無防備だと CI が回るたびに
 *   本物のコンバージョンが広告アカウントへ飛ぶ。Google広告のコンバージョンは削除できない。
 *   そのため、ホスト名が本番と一致するときだけ動かす。
 */
(function () {
  'use strict';

  var CONFIG = {
    id: '',          // 例 'AW-1234567890'
    formLabel: '',   // 無料相談の申し込み（フォーム送信）
    telLabel: ''     // 電話番号のタップ
  };

  /** 本番のホスト名。ここに一致しないと何も読み込まない（CI・ローカル・プレビューは対象外） */
  var HOSTS = ['minano-sr.com', 'www.minano-sr.com'];

  if (HOSTS.indexOf(location.hostname) === -1) return;
  if (!CONFIG.id) return;

  // page-enter.js のSPA遷移で body ごと差し替わるため、読み込みと購読は1回だけにする
  if (!window.__mnAdsLoaded) {
    window.__mnAdsLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // 着地ページでこれが動くと、URLの gclid から _gcl_aw クッキーが書かれる
    window.gtag('config', CONFIG.id);
  }

  if (window.__mnAdsBound) return;
  window.__mnAdsBound = true;

  function send(label) {
    if (!label || typeof window.gtag !== 'function') return;
    window.gtag('event', 'conversion', { send_to: CONFIG.id + '/' + label });
  }

  // 申込フォームの送信が成功した瞬間だけ発火する。フォーム側のコードには手を入れていない。
  document.addEventListener('mn:contact-success', function () {
    send(CONFIG.formLabel);
  });

  // 電話タップ。タップ直後に電話アプリへ移るので、送信の完了は待たない。
  // gtag は内部で sendBeacon 相当を使うため、遷移しても送信自体は残る。
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!a) return;
    send(CONFIG.telLabel);
  }, true);
})();
