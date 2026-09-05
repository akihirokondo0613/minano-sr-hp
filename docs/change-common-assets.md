# 共通資産・構造・性能・SPAの変更

複数ページへ伝播するCSS／JS、記事テンプレート、画像表示基盤、サイト構造、性能最適化、SPA遷移を変更するときの手順。局所修正より影響範囲が広いため、資産版、生成物、両CSS系統、Chromium／WebKit、公開キャッシュまで確認する。

## 正本

| 対象 | 正本 |
|---|---|
| 共通資産のキャッシュ版 | `assets-version.json` |
| ルート系のデザイン | `skin-v2.css` |
| `uploads/`系 | `uploads/service.css`と`wave-skin.css` |
| ブログ記事固有 | `blog-article.css` |
| トップのCritical CSS | `skin-v2.css`から`scripts/sync-critical-css.mjs`が生成する`index.html`内`#critical-home` |
| SPA遷移と現在の実装版 | `page-enter.js`と`window.__mnSpa.v` |
| 性能閾値 | `scripts/assert-lighthouse-budget.mjs` |
| 静的性能条件 | `scripts/check-performance-budget.mjs` |
| PRのブラウザー・性能CI | `.github/workflows/performance.yml` |
| 公開物の選別とデプロイ | `.github/workflows/deploy-public.yml` |
| NAP・構造化データ | `scripts/check-structured-data.mjs`と生成元データ |

文書へ資産版、性能閾値、SPA版、公開ページ数を書き写さず、実行時に正本から取得する。

## ファイルとリンクの境界

- ルート直下のHTMLが公開ページの正本。`uploads/` はサービス・問い合わせ等、`blog/` は記事と `articles.json`、`assets/` は画像・ロゴ等、`scripts/` は生成・監査、`.github/` はCI・公開基盤、`docs/` は非公開運用文書である。
- 内部リンクは配置階層に合う相対パスを使う。ルートと `uploads/`／`blog/` の親参照を混同しない。
- 日本語名の移行フォルダ、バックアップ、書き出し物を正本にしない。日本語パスを扱えない補助ツールへ無理に渡さず、正本のルート側を編集する。
- 公開用workflowは運用文書、スクリプト、管理ページ、状態ファイルを除外する。新しい非公開ディレクトリを作る場合は、同じPRで公開除外と機械検査を追加する。

## 共通CSS／JSを変える順序

1. 変更対象と全参照元を`rg`で特定する。JSがCSSを注入していないか、ルート系と`uploads/`系に同じ役割の旧実装が残っていないか確認する。
2. 正本の資産を最小差分で変更する。
3. `assets-version.json`の該当資産へ新しい一意な版を設定する。
4. `node scripts/sync-asset-version.mjs`を実行し、全参照HTMLと`admin-post.html`内の記事生成テンプレートへ同じ`?v=`を同期する。
5. ファーストビュー規則を変えた場合は`node scripts/sync-critical-css.mjs`を実行する。`#critical-home`を手作業で写さない。
6. `node scripts/preflight.mjs`と`node scripts/run-layout-checks.cjs --full`を実行する。
7. PRのブラウザーレイアウトとLighthouseが合格してからマージする。本番では実際に読み込まれた`href`／`src`の`?v=`まで確認する。

`scripts/check-asset-version.mjs`は、変更した資産の版据え置きとページ間の版ばらつきを検出する。baseを解決できない場合は安全側で同期状態を検査する。共通資産の中身だけ変えて版を据え置くと、既存端末へ修正が届かない。過去の原因は[二重下線の事故](incidents/nav-double-underline.md)を参照する。

## CSSと共通構造

- ルート系は`skin-v2.css`、`uploads/`配下は`uploads/service.css`と`wave-skin.css`を使う。片方の見た目をもう片方へ無条件に移植しない。
- 組版規則を`uploads/`にも適用する場合は`wave-skin.css`へ明示的に入れる。詳細は[日本語組版とレスポンシブ](typography-responsive.md)を参照する。
- ナビの下線とホバー背景は各CSS系統で一系統だけにする。ルート系では`skin-v2.css`が担い、`header-motion.js`へ旧下線を再導入しない。
- 共通フッターの連絡先を変える場合は、表示HTML、記事生成テンプレート、構造化データを同時に確認する。住所、電話、営業時間は`index.html`のLocalBusiness JSON-LDと`scripts/check-structured-data.mjs`を正本として照合する。
- トップの既存アンカーは外部ブックマーク互換に使われる。削除・改名はサイト構造変更としてリンク監査を伴う。
- `.github/`、`scripts/`、`docs/`、管理ページ、運用用manifestはWeb本文ではない。公開対象は`.github/workflows/deploy-public.yml`で明示的に選別する。

## 画像表示基盤

- 公開側はHTMLの`src`／`srcset`と画像本体を正本にし、編集用状態ファイルやlocalStorageへ依存しない。
- 編集環境の `<image-slot>` は差し替えと位置調整を提供するが、確定後は画像を `assets/photos/` 等の本ファイルへ書き出し、HTMLの `src` に設定する。状態ファイルだけ更新して終わらない。
- 写真は既存の `cover` とcrop属性を、人物・小物を切りたくないイラストは `contain` と枠の縦横比を使い分ける。イラストを狭幅で無条件に縦積みにせず、既存ページのタイトル横縮小パターンを優先する。
- 編集時の拡大・位置は状態ファイルの値と、公開HTMLのcrop属性を同期する。状態ファイルはルートの一つへ集約し、公開サイトは取得しない。
- `window.omelette.writeFile`が使える環境だけを編集モードとし、公開側へ重い編集UI、ghost画像、ドラッグ処理を戻さない。
- SPAをまたいでも公開用画像スタイルを保持する。`page-enter.js`のhead保持対象と`image-slot.js`の公開クラスを片方だけ変更しない。
- レスポンシブ画像を増やす場合は同じ構図の派生画像を作り、HTMLと選択ロジックを同期する。
- Claude Designで画像を確定した場合、ブラウザー表示だけで判断せず、本ファイルとクロップ属性を確認する。過去の食い違いは[画像スロットの同期事故](incidents/image-slot-desync.md)を参照する。
- `file://` では編集用状態のfetchに頼らず、HTMLが参照する本ファイルへフォールバックする。フォルダで渡す場合はHTML、JavaScript、`assets/`を構造ごと保つ。

## SPAの現行ルール

現行の`page-enter.js`は、`/blog/`記事行きと社内書式（`shoshiki.html`・`shoshiki/`配下、`isFormDest`。詳細は[shoshiki.md](shoshiki.md)）を除く内部通常遷移をfetch、head/body差し替え、`pushState`で処理する。旧方式のprerender、sessionStorage引き継ぎ、複数カーテン層を戻さない。旧方式の設計記録は[ページ遷移旧方式](incidents/page-enter-v1.md)に分離する。

- `blog/`配下の記事へ向かうリンクは素の遷移とし、クリック横取り、DOM差し替え、カーテンを開始しない。`blog.html`の一覧は通常のSPA対象であり、記事から非ブログへ向かう遷移も現行SPAの対象。
- 同一ページのアンカーはカーテンを出さず即時スクロールする。`index.html`の有無を正規化し、`popstate`では直前pathnameとの比較も行う。
- `swapHead()`の冒頭で `tagHead()` を呼び、既存headを毎回タグ付けする。head先頭の初回実行時だけタグ付けする旧方式へ戻さない。新規stylesheetは `pendingCss` に集め、load/errorを待つ。
- body差し替えは壁時計の固定待ちではなく、カーテンの `coverDone` と必要資産の準備がそろうまで待つ。差し替え時のスクロールは一時的にsmoothを止め、裏側で即時復元する。
- ルート系と `uploads/` 系で実効倍率が変わってもカーテン内の文字が途中で拡大しないよう、`syncVeilZoom()` を表示開始、head交換、CSS適用、表示中のリサイズで同期する。
- マーカー線は `coverDone` を基準に開始し、`hasVeilText()` が真のときだけ描く。`resolveLabel()`／`destLabel()` のフォールバックでラベルを空にせず、汎用ラベルは `maybeUpgradeLabel()` で実タイトルへ更新する。文字のない線を再発させない。
- クリック横取りはプレビュー側のdocument captureより先に動くwindow captureで行う。document側へ戻してカーテンを途中破棄させない。
- カーテンは `<html>` 直下の単一 `#pg-veil`。入場・退場の二重DOM、ラベルのsessionStorage引き継ぎ、壁時計位相同期を再導入しない。
- src付き共通スクリプトはURL単位で初回だけ、ページ固有のインラインスクリプトは必要に応じて再実行する。document/window級リスナーは再初期化フックまたは一度だけの登録にする。
- 共通スクリプトの再初期化フックは冪等にする。body差し替え後に古い要素を参照しない。
- プレビュー用クエリは遷移先へ引き継ぎ、戻る／進むは履歴ごとのスクロール位置を復元する。
- `file://`、reduced motion、非対応環境では介入せず通常リンクに任せる。fetch失敗、例外、watchdog発火時は通常遷移へフォールバックする。
- GoatCounterのSPAページビューはbody差し替え後に明示送信する。送信パスはページURLと一致させ、通常ロードとの二重計測を避ける。
- `#mn-image-slot-public-style` などSPAをまたいで維持するstyleは `KEEP_HEAD_IDS` と実際のheadを同期する。ページ固有の温存style IDはHTMLを正本にし、現存する `#vt-transition`、`#home-xcase-css`、`#brushup-2026`、`#fs-portal`、`#recruit`、`#legal`、`#infographic-extras`、`#ig-value`、`#ig-clarity`、`#ig-natural` を一括整理で削除しない。
- body差し替え後の `window.__hmReinit()`、`window.__mnJbreak()` 等の再初期化フックを維持し、新しい共通スクリプトも冪等な再実行または明示フックを用意する。

ページ共通のscrollハンドラは、固定キーに保存して旧ハンドラをremoveしてから登録し、要素をハンドラ内で毎回取り直し、すべてnullガードする。id暗黙グローバルとロード時にキャッシュした要素を使わない。背景は[scrollハンドラ蓄積事故](incidents/scroll-handler.md)を参照する。

## 性能を維持する

- Google Fontsを再導入せず、端末内の日本語フォントを使う。CIは日本語フォントを用意して実測する。
- トップのLCP画像はnative`<picture>`、レスポンシブ形式、`preload`、`fetchpriority`、寸法指定を維持する。公開トップを編集用画像要素へ戻さない。
- `skin-v2.css`を正本とするCritical CSSと、後から適用する全量CSSの構造を維持する。
- 画面外の`content-visibility:auto`は、アンカー・SPA遷移・測定前スクロールとセットで扱う。未描画の要素を測れなかった場合は合格にしない。
- CSS／JS変更時はキャッシュ版を同期する。画像を差し替える場合は寸法を含む別名または参照更新で旧キャッシュとの混同を防ぐ。
- `node scripts/check-performance-budget.mjs`で静的条件を確認し、CIのLighthouseは`.github/workflows/performance.yml`と`scripts/assert-lighthouse-budget.mjs`の現行条件で判定する。文書の古い数値を使わない。
- レイアウトアニメーションでは`padding`、`width`、`margin`を動かさず、`transform`と`opacity`を使う。

公開手順は[GitHub経由の編集・本番公開](release.md)に従う。sitemapの生成とマージ日の関係は[sitemapとsquash mergeの事故](incidents/sitemap-squash-date.md)を参照する。
