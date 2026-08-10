# 日本語組版・レスポンシブの変更

## 基本原則

- `html,body{overflow-x:clip}` は保険であり、はみ出しを隠して合格にしない。中身が切れる場合は原因要素を直す。
- `white-space:nowrap` と `word-break:keep-all` は、その画面幅で文節が収まると実測できる範囲だけに使う。
- 文節を `.nw` で括る場合は、隣接する文節の境界へ `<wbr>` を一つ置く。WebKitは隣接nowrap要素の境界を改行機会にしない。
- 長い文節自体をnowrapにしない。文節の実幅を測ってから採用する。
- 句読点の孤立には `hanging-punctuation:allow-end`、末尾一文字の泣き別れには `text-wrap:pretty` を先に検討する。`balance` は孤立防止の代わりではない。
- `uploads/` 配下は `skin-v2.css` を読まない。共通の組版規則を追加するときは `wave-skin.css` にも反映する。

## レイアウト設計

- 帯、ナビ、チップ列、表、目次は中間幅で最も崩れやすい。モバイルとPCだけで判断しない。
- 画面を広げたときに行数が増える、または中途半端な二行になる状態はバグとして扱う。広幅では一行、狭い幅だけ折り返す設計を明示する。
- 横スクロールUIは、続きがあることを明確に示せない限り採用しない。
- 見出しの固定 `<br>`、nowrap、`clamp()`、グリッド列数はブレークポイント前後で確認する。
- ホバーやトランジションでは `padding`、`width`、`margin` を動かさず、`transform` と `opacity` を使う。既存の所要時間とイージングを優先する。

## 検証の順序

1. 変更前と同じ条件で不具合を再現する。
2. 対象要素の `getBoundingClientRect()` と親要素・ビューポートの境界を測る。
3. 対象幅とブレークポイント前後をChromium／WebKitで確認する。
4. `content-visibility:auto` の節は測定前にスクロールして描画させる。
5. 期待件数、記録件数、実測件数、未測定件数を確認する。対象要素ゼロ、描画行ゼロ、実測ゼロは失敗とする。
6. console error、page error、ページ横スクロール、要素単位のはみ出し、内部テキストのはみ出し、泣き別れを確認する。

`document.documentElement.scrollWidth` だけで合格にしない。`overflow:clip` や `hidden` の内側で切られた要素はページ幅を広げないため、各要素の右端と内部のRange矩形を測る。

局所的なスマホ修正は、少なくとも狭幅・標準的なスマホ幅・広めのスマホ幅と、変更したブレークポイントの前後を使う。中間幅の帯やグリッドを変えた場合は、タブレット帯も追加する。共通CSS、テンプレート、全記事構造を変えた場合だけ全体巡回へ広げる。

## 使用する検証器

- トップヒーロー: `scripts/test-home-hero.cjs`
- 最終CTA: `scripts/test-final-copy.cjs`
- ブログ全記事: `scripts/test-blog-articles.cjs`
- 泣き別れ: `scripts/audit-line-breaks.cjs`
- 全公開ページのアクセシビリティ・横幅: `scripts/audit-a11y.cjs`
- 統合実行: `scripts/run-layout-checks.cjs`

各スクリプトが持つ画面幅、エンジン、閾値、三重カウントを、実行時間短縮だけを理由に減らさない。短縮は重複巡回と待ち時間の削減に限る。

## 修正時の注意

- 既存の `.hero-veil`、CTA、写真、文字サイズ等を変更する場合は、依頼された対象だけを編集する。
- 共通CSS本体を変えた場合は、同じPRで資産版を更新し、全参照HTMLと `admin-post.html` へ同期する。
- ファーストビューのCSSは `skin-v2.css` を正本にし、`scripts/sync-critical-css.mjs` で `#critical-home` を生成する。
- 見た目を直した後、クリップ指定を根治と説明しない。要素矩形が境界内に収まることを実測値で示す。

過去の事故の経緯は [デザイン履歴](incidents/design-history.md)、[ページ遷移旧方式](incidents/page-enter-v1.md)、[スクロールハンドラ](incidents/scroll-handler.md) を参照する。
