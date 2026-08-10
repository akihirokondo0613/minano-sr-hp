# ナビゲーションの二重下線事故

## 症状

ブログなど一部ページで、ナビゲーション項目の下に幅の広い濃緑線と、共通デザインの短い線が重なった。両端が耳のようにはみ出し、ホバー時の淡い背景も表示されなかった。

## 原因

`header-motion.js` が、旧デザインのホバー下線を背景画像として注入し続けていた。

```css
body:not([data-nav]) .nav-links a:not(.active):not([aria-current]) {
  background: linear-gradient(var(--g600), var(--g600)) no-repeat center bottom;
  background-size: 0 2px;
}
```

稜線適用後は `skin-v2.css` の `.nav-links a::after` も下線を描いていた。一部ページだけに `data-nav` 属性を置いて旧下線を無効化したため、その属性がないページでは2系統が同時に有効になった。

また、JavaScriptが注入した高い詳細度の `background` が、`skin-v2.css` のホバー背景まで打ち消した。問題は下線の太さではなく、同じ役割を持つ実装がJS注入CSSと共通CSSへ分散したことだった。

## 対処

`header-motion.js` から旧下線の注入規則を撤去し、ルート系ページのナビ装飾を `skin-v2.css` の疑似要素とホバー規則へ一本化した。

`uploads/` 配下は `skin-v2.css` を読まず、`uploads/service.css` の独立した下線だけを持つため、同じ変更の対象外とした。CSS系統が違うページへ、ルート系の修正を一括適用しなかった。

## 修正を既存端末へ届けられなかった二次事故

最初の修正では `header-motion.js` 本体だけを変更し、読込URLの `?v=` を更新しなかった。長期キャッシュを持つ端末には旧JavaScriptが残り、後続PRで全参照の資産版を上げる必要が生じた。

版の正本は `assets-version.json` である。共通JS/CSSを変更したら、同じPRで値を更新し、`node scripts/sync-asset-version.mjs` により全参照HTMLと `admin-post.html` の記事生成テンプレートへ同期する。`preflight.mjs` の版同期検査を通す。

## 再発防止

- 共通CSSへ装飾を足す前に、同じ装飾が別CSS、JavaScript注入CSS、インラインstyleに残っていないか `rg` で探す。
- 一部ページだけの除外属性で旧実装を延命しない。役割を一つの正本へ統合する。
- ルート系と `uploads/` 系のCSSを別物として確認する。
- 共通資産の本体変更とキャッシュ版同期を同じPRで完了する。

## 移管元の原文

次は移管前の事故記録を改変せず引用したもの。対象件数、資産版、キャッシュ期間は当時値であり、現況はコードから取得する。

> ## ナビの下線は skin-v2.css の1系統だけ（2026-08-09 二重下線を解消）
>
> **起きたバグ**: `header-motion.js` が旧デザイン時代のホバー下線を注入し続けていた。
>
> ```css
> body:not([data-nav]) .nav-links a:not(.active):not([aria-current]){
>   background:linear-gradient(var(--g600),var(--g600)) no-repeat center bottom;background-size:0 2px}
> ```
>
> 稜線適用時に `skin-v2.css` へ `.nav-links a::after`（--moegi 3px・左右8px内側）を入れたが、旧下線を無効化したのは `<body data-nav="B">` を付けた5ページ（index / services / pricing / support / about）だけだった。**`skin-v2.css` を読む残りのページ（blog.html・blog記事28本・portal・recruit・infographic・joseikin・privacy・404）では2本が重なり**、幅の広い濃緑2pxの両端が「耳」のようにはみ出して見えていた。加えてこの `background` 指定（特異度 0-4-2）が `skin-v2.css` の `.nav-links a:hover`（0-2-1）の淡い緑のピル背景を打ち消していた＝**ブログ側だけホバーの見た目が違う**原因。
>
> - **対処**: `header-motion.js` から当該2行を撤去。ナビのホバー下線と背景は `skin-v2.css` の `.nav-links a::after` / `a:hover` が全ページで担う。`data-nav` 属性はどこからも参照されなくなったが、各ページの `<body data-nav="B">` はそのまま残してある（他の用途で使う可能性があるため。使わないなら別途削除してよい）。
> - **`uploads/` 配下は対象外。** これらは `skin-v2.css` を読まず `uploads/service.css` が独自に `.nav-links a{background:linear-gradient(...)}` を持つ。`::after` は無いので下線は1本のまま＝二重になっていない。旧系統として意図的に残す（配色は稜線パレットに追従済み）。
> - **キャッシュ版の取りこぼしは機械で止める（2026-08-09 追加）**: この修正（PR #76）では `header-motion.js` の中身だけ変えて `?v=` を据え置いたため、7日キャッシュを持つ端末に修正が届かず、後追いのPR #78で65ファイルの版番号を上げることになった。版の正本は `assets-version.json`。共通JS/CSSを変更したら該当値を更新し、`node scripts/sync-asset-version.mjs` で参照HTMLと `admin-post.html` の記事生成テンプレートへ同期する。`preflight.mjs` が同期漏れとキャッシュ版の据え置きをCIで止める。
> - **再発防止**: 共通CSSへ新しい装飾を足すときは、**旧実装が別ファイル（JSの注入CSS含む）に残っていないか**を必ず `rg` で確認する。今回は「一部ページにだけ除外フラグを付けて済ませた」ことで、フラグの無いページに旧実装が生き残った。除外フラグ方式は取りこぼす。
