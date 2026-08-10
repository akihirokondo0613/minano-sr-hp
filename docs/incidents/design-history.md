# デザイン変更の履歴

この文書は、採用・撤回・上書き事故の経緯を残すための履歴であり、現行仕様の正本ではない。現在の配色、フォント、対象ページ、資産版はコードと `assets-version.json` を確認する。

## 「稜線」への全面刷新

2026年7月11日に「稜線（りょうせん）」デザインを適用した。ルート系ページでは `skin-v2.css` をデザイントークンとコンポーネントの正本にし、旧トークン参照を互換エイリアスで吸収した。`uploads/` 配下は独立したレイアウトを維持し、`service.css` と `wave-skin.css` のパレット橋渡しで色だけをそろえた。

当時はテーマカラー、favicon、ページ遷移カーテンも同じ深緑へ統一した。`uploads/` 配下のハードコード色、JavaScript内の色、半透明色、theme-colorも追従させたが、レイアウトと構成は別系統のまま残した。したがって、ルート系の規則を `uploads/` へ機械的にコピーしてはいけない。

刷新前のバックアップは公開前クリーンアップで削除済みである。旧スタイルへの言及は復元元ではなく、判断経緯として読む。

## 区切り線の採用と巻き戻し

2026年7月16日に、セクション境界を白波タイルへ統一する変更を一度行った。Android系ブラウザで、横長のSVG一枚を全幅へ引き伸ばした背景の右半分が白い長方形になるラスタライズ不具合が出たため、波を使うなら端点が連続する小さなタイルを `repeat-x` する設計とした。

その日の別セッションで `skin-v2.css` と `wave-skin.css` を同期した際、白波統一のCSSが意図せず上書きされて消えた。ユーザー確認の結果、複数幅で実測済みだった `clip-path` の稜線ギザギザへ統一する判断で確定した。

ここから残す教訓は次の2点である。

- デザイン正本を同期するときは、別セッションの変更をファイル単位で上書きしない。
- 波へ戻す場合も、横長SVG一枚の引き伸ばし方式は使わず、継ぎ目のないタイル方式で実装して実機確認する。

## 公開前クリーンアップ

2026年7月15日に、公開に不要なバックアップ、検証画像、診断用ページ、プレビュー用ページ、未参照コード、貼り付け画像の残骸、孤立したCSS複製とイラストを削除した。`admin-post.html`、全ページから参照される運用用JavaScript、画像リフレーム状態など、運用に必要な非公開資産は残した。

このクリーンアップでは、参照有無を全ページ検索してから削除した。見た目上使われていないだけで削除せず、HTML、CSS、JavaScript、記事生成テンプレートからの参照を確認する。

## アイコン全廃の撤回

2026年7月17日から18日にかけて、装飾アイコンと緑丸チェックを全廃し、漢字モノグラムへ置き換える変更を一度全ページへ適用した。しかし、ユーザー評価は「ずれた・のっぺりした」であり、従来の線画アイコンとチェック表現へ巻き戻した。

行政機関を表す漢字チップだけは、承認済みの意匠として残した。適用箇所やフォント読込の現状は固定記述を信じず、HTML、CSSと性能検査コードを確認する。

削除したSVGの原本は残っていなかったため、巻き戻し時は同じ作法で再描画した。見た目は旧デザイン相当だが、元ファイルとのバイト一致ではない。この事故以降、大規模な見た目変更は、復元可能な差分またはブランチを確保してから行う。

## 共通の判断基準

- 現行デザインは履歴文書ではなく、実際に読み込まれるCSSとHTMLを正本とする。
- ルート系と `uploads/` 系のCSS境界を維持する。
- 一括置換や正本同期の前後で、削除・上書きされる差分を確認する。
- 採用済みの意匠と、試して撤回した案を混同しない。

## 移管元に残っていた具体記録

以下は、要約で失われやすい実装名・寸法・削除対象を事故記録として移したもの。現行仕様ではなく、復元や再導入の判断材料である。

**（2026-07-16）区切り線は全ページ「なみなみ線」に統一済み**：skin-v2.css の `.final-sec::before`／`.final-cta::before` のギザギザ多角形（clip-path）と、`.page-hero::after`・`.about-sec::before` の空装飾（background:none の残骸）を撤去し、wave-skin.css と同一の白波タイル（120px周期 repeat-x・26px高）に置換。加えて `.sec-alt::before` と `.footer::before` にも同じ波を追加。フッター直前が暗いCTA（`.final-sec`/`.final-cta`）のページは `+ .footer::before{content:none}` で波を出さず従来の border-top を維持した。引き伸ばし一枚SVGは Android で壊れるため、波はタイル方式で書く判断だった。

同日夜の別セッションの同期作業で、この白波CSSは意図せず上書きされ消失した。ユーザー確認のうえ、稜線ギザギザ（clip-path多角形）で確定した。なみなみに戻す場合の比較済み仕様は、120px周期の repeat-x、26px高、端点がC1連続するタイルであり、引き伸ばし一枚SVGは禁止する。

公開前クリーンアップでは、次を参照検索後に削除した。

- `_backup_before_ryosen/`、`screenshots/`、`_diag_boundary.png`
- `motion-lab.html`、`_wcheck.html`、`email-preview.html`
- `file-slot.js` と `.file-slots.state.json`
- `uploads/skin-v2.css`、旧ヒーロー画像、`uploads/pasted-*.png`
- CASE段階ハイライト撤去後に孤立したイラストと、未使用プロフィール用イラスト

残した非公開資産は `admin-post.html`、公開ページが参照する運用用JavaScript、画像リフレーム状態だった。現在の公開除外対象は当時の一覧を転載せず、deploy workflowと検査コードを正本とする。

アイコン刷新の巻き戻しでは、削除済みSVGの原本が残っていなかったため、viewBox、`stroke:currentColor`、round指定等の同じ作法で再描画した。見た目は旧デザイン相当だがバイト一致ではない。大規模な見た目変更の前は、Gitで復元できる差分またはブランチを確保する。

## 移管元の原文

次は移管前の記録を改変せず引用したもの。件数、フォント、色、ファイルの存否は当時値であり、現況の指示には使わない。現況はコードと検査スクリプトを正本とする。

> ## 2026-07-11 デザイン全面刷新「稜線（りょうせん）」適用済み
>
> **（2026-07-16）区切り線は全ページ「なみなみ線」に統一済み**：skin-v2.css の `.final-sec::before`／`.final-cta::before` のギザギザ多角形（clip-path）と、`.page-hero::after`・`.about-sec::before` の空装飾（background:none の残骸）を撤去し、wave-skin.css と同一の白波タイル（120px周期 repeat-x・26px高）に置換。加えて `.sec-alt::before`（infographic の4セクション）と `.footer::before`（明るい面に接するフッター上端）にも同じ波を追加。フッター直前が暗いCTA（`.final-sec`/`.final-cta`）のページは `+ .footer::before{content:none}` で波を出さず従来の border-top を維持。**引き伸ばし1枚SVGは Android で壊れるため、波は必ずこのタイル方式で書くこと。**
>
> **（2026-07-16深夜 追記・区切り線の現状）**：上記なみなみ統一のCSS本体は、同日夜の別セッションの同期作業（稜線ギザギザ統一版 skin-v2.css / wave-skin.css のプッシュ）で意図せず上書きされ消失した。ユーザー確認のうえ、現在は**稜線ギザギザ（clip-path多角形）に統一**で確定（「不具合が出ない方」判断：clip-path方式は上記AndroidのSVG引き伸ばし不具合に該当せず、複数幅で実測検証済みのため）。なみなみに戻す場合は本メモのタイル仕様（120px周期 repeat-x・26px高・C1連続）で再実装すること。引き伸ばし1枚SVG禁止の教訓は引き続き有効。
>
> - **ルート直下 `skin-v2.css` が新デザインの正本**（全トークン＋全コンポーネント。ローカルで設計・検証済みのものを機械的に反映）。旧トークン互換エイリアス（--g600等）内蔵のため、body内インラインstyleや header-motion.js の旧参照もそのまま新配色に載る。
> - 適用対象（20ページ）: index / blog / portal / recruit / privacy-policy / infographic ＋ blog記事14本。  各ページの head スタイルは原則削除し skin-v2.css を読む（温存: 全ページ `#vt-transition`、portal `#fs-portal`、recruit `#recruit`、privacy `#legal`、infographic の `#infographic-extras/#ig-value/#ig-clarity/#ig-natural`）。index の `#home-xcase-css` と `#brushup-2026` はタグだけ残して中身は skin-v2.css に統合済み。
> - フォントは BIZ UDPGothic ＋ IBM Plex Mono ＋ Zen Kaku Gothic New（Zen Maru Gothic は廃止。温存ブロック内は `var(--disp)` に置換済み）。theme-color/favicon は `#123F30`（遷移カーテン色も同色になる）。
> - **`uploads/` 配下（service-*・case-*・contact）の配色は稜線パレットに追従済み（2026-07-12）**: wave-skin.css 末尾の「ryosen-palette-bridge」ブロックが旧トークン（--g900〜--g25・--ink系）の**値だけ**を新パレットへ再定義（service.cssの定義に後勝ち）。各ページのハードコード旧hex（#006E3C等）も新値へ置換済み（contactはJSの色配列含む12箇所）。service.css の直書き rgba(0,110,60,…)→rgba(18,63,48,…)、page-enter.js の theme-color フォールバック2箇所→#123F30、uploads全12ページに `<meta name="theme-color" content="#123F30">` 追加済み（遷移カーテン色の統一）。レイアウト・フォント（Zen Maru）・構成は旧デザインのまま＝色のみ統一。`wave-skin.css` は uploads 配下ページが参照し続けるため**削除しないこと**。ルート20ページからの参照は skin-v2.css に差し替え済み。
> - 適用前の全ファイルは `_backup_before_ryosen/` に保管していたが、公開前クリーンアップ（2026-07-15）で削除済み。
> - 旧記述のうち「brushup-2026 の大画面ブロック」「wave-skin.css 末尾の下層共通層」等、削除済みスタイルへの言及は旧方式の記録として読むこと（現行は skin-v2.css 側が正）。
>
> ## 公開前クリーンアップ（2026-07-15 実施）
>
> 公開に不要な開発・バックアップ・孤立ファイルを削除した：
> - `_backup_before_ryosen/`（稜線適用前バックアップ22点）／`screenshots/`（検証用42点）／`_diag_boundary.png`
> - 開発専用ページ: `motion-lab.html`（遷移比較デモ・noindex）／`_wcheck.html`（幅チェック）／`email-preview.html`（問い合わせ通知メールのプレビュー）
> - 未参照コード: `file-slot.js` ＋ `.file-slots.state.json`（portal のファイル配布方式を廃止して未参照になっていた）
> - `uploads/skin-v2.css`（孤立した複製。uploads 配下は `service.css` ＋ `../wave-skin.css` を読む）／`uploads/HPヒーロー画像.jpeg`（孤立。ヒーローは `assets/photos/hero-main.webp`）／`uploads/pasted-*.png`（貼り付け画像の残骸29点）
> - 孤立イラスト（追加削除）: `assets/illustrations/` の4点 `09_stage_startup` ／ `10_stage_growth` ／ `11_stage_organization`（CASE段階ハイライト撤去の残骸）／ `22_subsidy_growth_profile_left`（未使用プロフィール）。全ページ grep でどこからも参照されていないことを確認して削除。※残る `assets/illustrations/` はすべて index / infographic の `<image-slot src>` が参照中。
> - **残した非公開ファイル**: `admin-post.html`（記事作成ツール・URL直打ちで使用＝運用に必要）／`link-keep.js`（全ページが読むが本番は無害）／`.image-slots.state.json`（写真のリフレーム位置）。
>
> ## 記号・アイコンの方針（2026-07-17刷新→2026-07-18巻き戻し。現行ルール）
>
> 一度「装飾アイコン全廃・緑丸チェック廃止・漢字モノグラムチップ化」を全ページに適用したが、**ユーザー判断で巻き戻し済み**（「ずれた・のっぺりした」）。現行：
> - **アイコン・丸チェックは従来どおり**（.chk 緑丸＋白チェック、plan-features の丸チェック、checklist の緑角チェック、各種線画アイコン）。
> - **例外＝行政機関のみ漢字チップを使用**（ユーザー承認のシグネチャー）：infographicの行政機関カード（年金/雇用/労基/助成、`.kmono.kmono-sm`）と portal のカテゴリ（`.cat-icon.kmono`、セクション色継承）。`.kmono` は skin-v2.css に定義（40px角丸・淡緑地・Zen Maru Gothic 700 13px・#007B43）。Zen Maru Gothic の font link は infographic / portal のみにある（他ページに足さないこと）。
> - **注意：削除された旧SVGの原本はどこにも残っていなかった**ため、巻き戻し時に同じ作法（viewBox 24・stroke currentColor 1.5・round）で再描画している。CSSは編集記録から完全復元。見た目は旧デザイン相当だがバイト一致ではない。今後大規模な見た目変更をする前は、必ずファイル一式のバックアップ（フォルダコピー）を取ってから行うこと。
