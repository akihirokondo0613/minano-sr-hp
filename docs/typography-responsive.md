# 日本語組版・レスポンシブの変更

## 作成時の段落・強調の設計

新規作成・本文改稿では、文節処理の前に次を決める。既存ページの改行修正だけで文章の意味、SEO情報、料金・制度条件を変えない。

- **揃え方は役割で決める。** 中央の見出しに続く短い導入・説明は中央揃えを維持する。ブログ等の長文本文は既存の左揃えを維持する。折り返しの不具合を直すためだけに揃え方を変更しない。
- **意味のまとまりを段落にする。** 説明、既存の更新日・確認日、注意書きを長い一段落へ詰め込まない。別の意味になる境界は `p` で分け、PCだけに合わせた `br` の追加で整えない。文ごとの機械的な分割や全ページ3段落の固定化はしない。日付の新設・更新可否は各ページの既存運用を守る。
- **日付・数値と単位・短い用語を途中で割らない。** 狭幅で収まる範囲を `.nw` と境界の `wbr` で保護する。制度名や長文全体を折返し禁止にしない。カードの番号・見出し・説明は別要素にし、文節処理が一続きの文章として扱わない構造にする。
- **太字と下線は判断に必要な部分だけ。** 結論、事前手続き、期限、対象外条件を `strong` で選択的に強調する。特に見つけやすくしたい短い条件には既存配色の控えめな下線を併用できる。段落全部や金額だけを強調せず、適用条件・例外を読める状態にする。リンクの装飾と混同させず、文字自体のコントラストを保つ。
- **生成元を直す。** 生成HTMLだけで調整せず、対応するテンプレート・生成器へ反映する。助成金ガイドの実装例は `scripts/build-joseikin-guides.mjs` の `jgd-rule`、`jgd-source-note`、`jgd-key`。他ページへクラスや幅を一律移植せず、そのページの部品を優先する。

完成確認では、変更した節の導入、カード・手順、注記・出典までを狭幅・中間幅・PCで実際に読む。横はみ出しがなくても、日付の分断、語の途中、括弧だけの行、短い行末の取り残し、中央揃えの不自然な段落を見落とさない。文字数による自動検査は補助であり、意味として自然に読めるかを画面で確認する。具体的な幅・エンジン・測定方法は以下の既存手順に従う。

## 基本原則

- `html,body{overflow-x:clip}` は保険であり、はみ出しを隠して合格にしない。中身が切れる場合は原因要素を直す。
- `white-space:nowrap` と `word-break:keep-all` は、その画面幅で文節が収まると実測できる範囲だけに使う。
- 文節を `.nw` で括る場合は、隣接する文節の境界へ `<wbr>` を一つ置く。WebKitは隣接nowrap要素の境界を改行機会にしない。
- 長い文節自体をnowrapにしない。文節の実幅を測ってから採用する。
- 句読点の孤立には `hanging-punctuation:allow-end`、末尾一文字の泣き別れには `text-wrap:pretty` を先に検討する。`balance` は孤立防止の代わりではない。
- 本文（`p, li, dd, dt, figcaption, blockquote, summary`）と見出し（`h1`〜`h5`）には `word-break: auto-phrase` を当てる。これが無いと文節の途中で切れ、末尾に1〜2文字だけ残る行が出る。3系統（`skin-v2.css` / `wave-skin.css` / `uploads/service.css`）すべてに同じ規則を置く。
- **`auto-phrase` には必ず逃げ道を用意する。** 文節が器より長いと折り返せずに溢れる。`overflow-wrap: break-word` を併記し、本文中のリンク（`p a, li a, dd a`）は `word-break: normal` に戻す。出典名・制度名は一つの長い文節になりやすく、320pxのブログ本文で20pxはみ出した実測がある。文節印を持つ本文リンクは例外として `keep-all; overflow-wrap: break-word` を両エンジンへ適用する。生成器で用語内部とカタカナ語を保護し、リンク名の意味の切れ目で折る。クラス付きボタン・電話・メールはこの処理から除外する。
- **表のセル（`td, th`）は `auto-phrase` の対象外にする。** 列が狭いと文節が入りきらず、折り返せずにセルからはみ出す（`uploads/case-*.html` の360px幅で23〜62pxのはみ出しを実測）。
- 連絡先の英数字（メール・電話・URL）は `word-break: keep-all; overflow-wrap: anywhere` で行中の分断を防ぐ。
- **`word-break: auto-phrase` も `text-wrap: pretty` も WebKit では効かない**（Playwright WebKitで `word-break` は `normal`、`text-wrap` は `wrap` に解決される）。CSSだけで直ったと説明しない。
- **iPhoneの文節改行は `<wbr>` をビルド時に埋めて解く**（2026-08-23導入）。`scripts/sync-phrase-breaks.mjs` が同梱BudouX（`scripts/lib/budoux-ja.mjs`、Apache-2.0）で切れ目を出し、CSS側の `@supports not (word-break: auto-phrase)` の中で `:has(wbr)` に `word-break: keep-all; overflow-wrap: break-word` を当てる。守るべき決めごと:
  - **`<wbr>` を入れるだけでは何も変わらない。** 日本語はもともとどこでも折れるので、`keep-all` と対で使う。
  - **`@supports not (word-break: auto-phrase)` で囲う。** Chromium系には当てない。`keep-all` は min-content 幅を最長の文節まで押し上げるので、列組みが数px〜15px広がる（`support.html` の320pxで実測）。auto-phrase が効くならそちらのほうが副作用が無い。
  - **逃げ道は `overflow-wrap: break-word`。** `anywhere` は min-content 幅を1文字まで下げるので、flex/grid の列がその幅まで潰れる（ブログの `li` で、右の説明が32pxまで縮んで2文字ずつ折れた）。
  - **印は文字の直後にだけ置く。** 開始タグの手前までは戻してよい（`…、<wbr><strong>…` にしないと `<strong>` が1行に居座って器から出る）が、**閉じタグの直後には置かない**。`<wbr>` は要素なので、flex/grid の箱の直下だと1個のアイテムとして数えられ、列がずれる。
  - **人が置いた `<wbr>` は剥がさない。** 生成器が剥がすのは「文字と文字のあいだ」にある印だけ。`<span class="nw">…</span><wbr><span class="nw">…</span>` のような手置きの印を消すと `test-home-hero.cjs` が落ちる。
  - **用語（`terms.js`）は前後の境目も外す。** 実行時に `<span class="term">` で包まれるので、語の直前・直後の `<wbr>` が独立したアイテムになる。ただし、`terms.js` が除外している本文リンク内は用語の前後で折ってよい。
  - **漢字と漢字のあいだでは折らない。** BudouXは統計モデルで、「中／小企業」「人／材開発支援助成金」「随時／改定」のように熟語や制度名を割る。全78ページで356か所あり、ほぼ全部が誤りだった。
  - **禁則を自前で外す。** `<wbr>` は `line-break: strict` より強い明示の切れ目なので、「合わせる｜：」のように行頭に置けない字の前へ入れないよう生成器で弾く。
  - **10文字を超える塊は割る。** 器に収まらないと逃げ道が禁則を無視して折る（句点だけが次の行へ落ちる）か、折れずに溢れる。割る場所が無ければ熟語の中でも折る（「雇用関係助成金申請サポート」は、そうしないと `services.html` の320pxで62pxはみ出した）。
  - **英数字の途中では折らない。** BudouXは日本語のモデルなので「S｜TEP 03」のように割ることがある。
  - **用語辞書（`terms.js`）の語の中では折らない。** `<wbr>` でテキストノードが割れると、その語だけツールチップが静かに消える。
  - **WebKitの `scrollWidth` は数px増えることがある。** `keep-all` を当てた要素の「折れない幅」がレイアウトオーバーフローとして記録されるためで、`<wbr>` も `overflow-wrap` も min-content には数えられない。`window.scrollX` は0のまま（`overflow-x: clip` が効く）で、要素・テキストとも器から出ないので実害は無い。`audit-a11y.cjs` の「ページ自体の横スクロール」に出たら、要素単位のはみ出しと `window.scrollX` で確かめてから判断する。
  - **置き場所は実測で守る。** 静的検査ではCSSの子孫セレクタ（`.sec-h strong` など）が読めないので、`scripts/test-phrase-breaks.cjs` が全ページをブラウザで開き、nowrapの中／flex・gridの独立アイテムになった `<wbr>` を落とす。`run-layout-checks.cjs` に入っている。
  - 生成物（トップTOPICS・関連記事・助成金の解説ページ・助成金の対象チェック）は、各生成器が `scripts/lib/phrase-breaks.mjs` の `markPhrases()` を通す。あとから差し込むと生成器の `--check` が毎回落ちる。
- `uploads/` 配下は `skin-v2.css` を読まない。共通の組版規則を追加するときは `wave-skin.css` にも反映する。

## レイアウト設計

- 帯、ナビ、チップ列、表、目次は中間幅で最も崩れやすい。モバイルとPCだけで判断しない。
- 画面を広げたときに行数が増える、または中途半端な二行になる状態はバグとして扱う。広幅では一行、狭い幅だけ折り返す設計を明示する。
- 横スクロールUIは、続きがあることを明確に示せない限り採用しない。
- 見出しの固定 `<br>`、nowrap、`clamp()`、グリッド列数はブレークポイント前後で確認する。
- ホバーやトランジションでは `padding`、`width`、`margin` を動かさず、`transform` と `opacity` を使う。既存の所要時間とイージングを優先する。

短いリンクを含む導入文は、必要に応じてリンクを `inline-block; max-width:100%` にする。長いリンク全体の `nowrap` は使わない。強調見出しの `.phrase-unit` は短い意味のまとまりに限定し、境界の `wbr` とともに使う。

生成器を変更したときは `node scripts/test-prose-link-phrases.mjs` で実例・文字保持・冪等性・除外対象を確認する。

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
- 文節印の置き場所: `scripts/test-phrase-breaks.cjs`
- 統合実行: `scripts/run-layout-checks.cjs`

各スクリプトが持つ画面幅、エンジン、閾値、三重カウントを、実行時間短縮だけを理由に減らさない。短縮は重複巡回と待ち時間の削減に限る。

アクセシビリティ監査は、まず補正後の生データをJSONで残す。

```sh
node scripts/audit-a11y.cjs http://127.0.0.1:8811/ --json --output=/tmp/minano-a11y.json
node scripts/audit-a11y.cjs http://127.0.0.1:8811/ --check
```

`--check` は、期待条件と実測条件の不一致、解析不能、写真測定の依存不足、コントラスト不足、操作領域の実違反をすべて失敗にする。操作領域は24×24px未満という理由だけで違反にせず、[WCAG 2.2のSpacing例外](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)（中心に置く24px円が、別の操作領域または別の小さい操作領域の24px円と交差しないこと）を実測する。報告では、エンジン・幅ごとの生件数と、共通CSS／テンプレート単位の修正パターン数を分ける。

CIでは `--check-measurement` を使い、現行ページの違反数に左右されず、期待件の欠落、実測0件、解析不能、写真測定の不成立を失敗にする。公開前の最終判定では引き続き `--check` を使う。

## 修正時の注意

- 既存の `.hero-veil`、CTA、写真、文字サイズ等を変更する場合は、依頼された対象だけを編集する。
- 共通CSS本体を変えた場合は、同じPRで資産版を更新し、全参照HTMLと `admin-post.html` へ同期する。
- ファーストビューのCSSは `skin-v2.css` を正本にし、`scripts/sync-critical-css.mjs` で `#critical-home` を生成する。
- 見た目を直した後、クリップ指定を根治と説明しない。要素矩形が境界内に収まることを実測値で示す。

過去の事故の経緯は [デザイン履歴](incidents/design-history.md)、[ページ遷移旧方式](incidents/page-enter-v1.md)、[スクロールハンドラ](incidents/scroll-handler.md) を参照する。
