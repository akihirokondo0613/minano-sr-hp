# SPA遷移でscrollハンドラが蓄積した事故

## 症状

各ページのインラインスクリプトが、SPA遷移のたびに `window.addEventListener('scroll', ...)` を追加していた。古いページのハンドラが残り続け、遷移回数に応じて同じ処理が重複した。

さらに、トップやブログ一覧のハンドラが固定相談ボタン `#fl` をnullガードなしで参照していた。`#fl` を持たない記事ページへ遷移したあとにスクロールすると、残留ハンドラが `ReferenceError` または `TypeError` を繰り返した。

単一ページを直接開くレスポンシブ検証では再現せず、SPAで異なる構造のページを連続して移動して初めて発生した。

## 採用した書き方

```js
if (window.__pgScroll) {
  window.removeEventListener('scroll', window.__pgScroll);
}
window.__pgScroll = function () {
  var prog = document.getElementById('prog');
  var nav = document.getElementById('nav');
  var fl = document.getElementById('fl');
  var p = scrollY / (document.documentElement.scrollHeight - innerHeight || 1);
  if (prog) prog.style.width = (p * 100) + '%';
  if (nav) nav.classList.toggle('solid', scrollY > 60);
  if (fl) fl.classList.toggle('hidden', scrollY < 300);
};
window.addEventListener('scroll', window.__pgScroll, { passive: true });
```

ページ固有の追加処理や `requestAnimationFrame` のスロットルがある場合も、次の3原則を維持した。

1. **固定キーで置き換える**：新しいハンドラを登録する前に、同じ固定キーに保存した旧ハンドラをremoveする。
2. **要素を毎回取り直す**：ハンドラ内で `getElementById` し、body差し替え前の要素を保持しない。id名の暗黙グローバルへ依存しない。
3. **全要素をnullガードする**：ページごとに存在する要素が違う前提で、要素がない場合は処理を飛ばす。

## 再発防止

- SPAの回帰は、一つのURLを直接開くだけでなく、構造の違うページ間を連続遷移してからスクロールする。
- `console` と `pageerror` を遷移前に初期化せず、残留処理のエラーを収集する。
- 新しいdocument/window級リスナーは、要素バインドへ寄せるか、再初期化可能な固定キー方式にする。
- body差し替えがある以上、ページ読込時に取得したDOM要素をdocument級ハンドラへ閉じ込めない。

## 移管元の原文

次は移管前の事故記録を改変せず引用したもの。ページ・記事件数は当時値であり、現況値として使わない。

> ## ページ共通scrollハンドラの作法（2026-07-17 全33ページ改修済み・必ず守る）
>
> **起きたバグ（Codex指摘で発覚）**：各ページのインラインscrollハンドラが (1) SPA遷移のたびに `window.addEventListener('scroll',…)` を張り直して**蓄積**し、(2) index / blog のハンドラは `#fl`（固定相談ボタン）を**無ガード参照**（indexは素の `fl` ＝id暗黙グローバル、blogは `getElementById('fl').classList` 直呼び）していたため、`#fl` を持たない**ブログ記事14本**へ遷移すると残留ハンドラが `ReferenceError: fl is not defined` / `TypeError: Cannot read properties of null` を毎スクロール発生させていた。単一ページのレスポンシブ検証では出ず、**SPAで複数ページを連続遷移して初めて発生**する。
>
> **改修内容（全33公開ページに適用）**：
> ```js
> if(window.__pgScroll)window.removeEventListener('scroll',window.__pgScroll);
> window.__pgScroll=function(){
>   var prog=document.getElementById('prog'),nav=document.getElementById('nav'),fl=document.getElementById('fl');
>   var p=scrollY/(document.documentElement.scrollHeight-innerHeight||1);
>   if(prog)prog.style.width=(p*100)+'%';
>   if(nav)nav.classList.toggle('solid',scrollY>60);
>   if(fl)fl.classList.toggle('hidden',scrollY<300);
> };
> window.addEventListener('scroll',window.__pgScroll,{passive:true});
> ```
> （indexはこれに加え nav 'shrink' と updateFloat（fl存在ガード付き）、rAFスロットル付きページは ticking を維持）
>
> **3原則（新規ページ・新規ハンドラで必ず守る）**：
> 1. **登録は置き換え式**：`window.__pgScroll` のような固定キーに保存し、addの前に必ず旧ハンドラをremove（header-motion.js の `__hmUpdate` と同じパターン）→ 蓄積ゼロ。
> 2. **要素はハンドラ内で毎回 getElementById して取得**（ページ読み込み時にキャッシュしない）→ body差し替え後に古い要素を触らない。素の `fl` のような**id暗黙グローバル参照は禁止**（要素が無いページで ReferenceError になる）。
> 3. **全要素にnullガード**（`if(el)`）→ その要素を持たないページに遷移した瞬間の残留1発でも落ちない。ページごとに存在する要素が違う前提で書く（例：#fl はブログ記事に無い）。
