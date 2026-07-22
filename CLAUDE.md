# 社労士事務所「みなの」HP — プロジェクト引き継ぎメモ

このサイトは **通常のHTML/CSS/JSの静的サイト**（Reactではない）。
プレビューに出る「empty #root」警告は**無害**。エラーではないので無視してよい。

## ⚠ .github/ フォルダは削除しないこと（デプロイ設定・2026-07-20 追加）
ルート直下の隠しフォルダ `.github/` は GitHub Actions による自動デプロイの設定で、**Webページのコンテンツではない**。
- `.github/workflows/deploy-public.yml`（自動デプロイ設定・YAML）／`.github/maintenance.html`（メンテナンス表示用の静的HTML）。
- **中身を書き換え・整形・ページ化しない**（パス・ファイル名・拡張子・内容をそのまま保持）。
- **保存・書き出し（ダウンロード提供）のたびに、この `.github/` と中の2ファイルを必ず含める**（削除・除外しない）。sitemap やページ監査の対象にもしない。

## 2026-07-11 デザイン全面刷新「稜線（りょうせん）」適用済み

**（2026-07-16）区切り線は全ページ「なみなみ線」に統一済み**：skin-v2.css の `.final-sec::before`／`.final-cta::before` のギザギザ多角形（clip-path）と、`.page-hero::after`・`.about-sec::before` の空装飾（background:none の残骸）を撤去し、wave-skin.css と同一の白波タイル（120px周期 repeat-x・26px高）に置換。加えて `.sec-alt::before`（infographic の4セクション）と `.footer::before`（明るい面に接するフッター上端）にも同じ波を追加。フッター直前が暗いCTA（`.final-sec`/`.final-cta`）のページは `+ .footer::before{content:none}` で波を出さず従来の border-top を維持。**引き伸ばし1枚SVGは Android で壊れるため、波は必ずこのタイル方式で書くこと。**

**（2026-07-16深夜 追記・区切り線の現状）**：上記なみなみ統一のCSS本体は、同日夜の別セッションの同期作業（稜線ギザギザ統一版 skin-v2.css / wave-skin.css のプッシュ）で意図せず上書きされ消失した。ユーザー確認のうえ、現在は**稜線ギザギザ（clip-path多角形）に統一**で確定（「不具合が出ない方」判断：clip-path方式は上記AndroidのSVG引き伸ばし不具合に該当せず、複数幅で実測検証済みのため）。なみなみに戻す場合は本メモのタイル仕様（120px周期 repeat-x・26px高・C1連続）で再実装すること。引き伸ばし1枚SVG禁止の教訓は引き続き有効。

- **ルート直下 `skin-v2.css` が新デザインの正本**（全トークン＋全コンポーネント。ローカルで設計・検証済みのものを機械的に反映）。旧トークン互換エイリアス（--g600等）内蔵のため、body内インラインstyleや header-motion.js の旧参照もそのまま新配色に載る。
- 適用対象（20ページ）: index / blog / portal / recruit / privacy-policy / infographic ＋ blog記事14本。  各ページの head スタイルは原則削除し skin-v2.css を読む（温存: 全ページ `#vt-transition`、portal `#fs-portal`、recruit `#recruit`、privacy `#legal`、infographic の `#infographic-extras/#ig-value/#ig-clarity/#ig-natural`）。index の `#home-xcase-css` と `#brushup-2026` はタグだけ残して中身は skin-v2.css に統合済み。
- フォントは BIZ UDPGothic ＋ IBM Plex Mono ＋ Zen Kaku Gothic New（Zen Maru Gothic は廃止。温存ブロック内は `var(--disp)` に置換済み）。theme-color/favicon は `#123F30`（遷移カーテン色も同色になる）。
- **`uploads/` 配下（service-*・case-*・contact）の配色は稜線パレットに追従済み（2026-07-12）**: wave-skin.css 末尾の「ryosen-palette-bridge」ブロックが旧トークン（--g900〜--g25・--ink系）の**値だけ**を新パレットへ再定義（service.cssの定義に後勝ち）。各ページのハードコード旧hex（#006E3C等）も新値へ置換済み（contactはJSの色配列含む12箇所）。service.css の直書き rgba(0,110,60,…)→rgba(18,63,48,…)、page-enter.js の theme-color フォールバック2箇所→#123F30、uploads全12ページに `<meta name="theme-color" content="#123F30">` 追加済み（遷移カーテン色の統一）。レイアウト・フォント（Zen Maru）・構成は旧デザインのまま＝色のみ統一。`wave-skin.css` は uploads 配下ページが参照し続けるため**削除しないこと**。ルート20ページからの参照は skin-v2.css に差し替え済み。
- 適用前の全ファイルは `_backup_before_ryosen/` に保管していたが、公開前クリーンアップ（2026-07-15）で削除済み。
- 旧記述のうち「brushup-2026 の大画面ブロック」「wave-skin.css 末尾の下層共通層」等、削除済みスタイルへの言及は旧方式の記録として読むこと（現行は skin-v2.css 側が正）。

## 公開前クリーンアップ（2026-07-15 実施）

公開に不要な開発・バックアップ・孤立ファイルを削除した：
- `_backup_before_ryosen/`（稜線適用前バックアップ22点）／`screenshots/`（検証用42点）／`_diag_boundary.png`
- 開発専用ページ: `motion-lab.html`（遷移比較デモ・noindex）／`_wcheck.html`（幅チェック）／`email-preview.html`（問い合わせ通知メールのプレビュー）
- 未参照コード: `file-slot.js` ＋ `.file-slots.state.json`（portal のファイル配布方式を廃止して未参照になっていた）
- `uploads/skin-v2.css`（孤立した複製。uploads 配下は `service.css` ＋ `../wave-skin.css` を読む）／`uploads/HPヒーロー画像.jpeg`（孤立。ヒーローは `assets/photos/hero-main.webp`）／`uploads/pasted-*.png`（貼り付け画像の残骸29点）
- 孤立イラスト（追加削除）: `assets/illustrations/` の4点 `09_stage_startup` ／ `10_stage_growth` ／ `11_stage_organization`（CASE段階ハイライト撤去の残骸）／ `22_subsidy_growth_profile_left`（未使用プロフィール）。全ページ grep でどこからも参照されていないことを確認して削除。※残る `assets/illustrations/` はすべて index / infographic の `<image-slot src>` が参照中。
- **残した非公開ファイル**: `admin-post.html`（記事作成ツール・URL直打ちで使用＝運用に必要）／`link-keep.js`（全ページが読むが本番は無害）／`.image-slots.state.json`（写真のリフレーム位置）。

## ファイル構成（最新版は必ず「ルート直下」）

最新のHP一式は **プロジェクトのルート直下** にある。これがデフォルトで開く正本。
（2026-07-17：別プロジェクトで更新した一式 `uploads/社労士事務所HP_ClaudeDesign移行_20260717/` をルートへ反映済み。
反映後の移行フォルダは削除した。クリーンアップ済みの孤立ファイル＝pasted-*.png・HPヒーロー画像.jpeg・uploads/skin-v2.css は反映から除外。）
**編集・確認はルート直下のファイルだけ**を対象にすること（混同しない）。

ルート直下の主なファイル：
- `index.html` … トップページ（正本）
- `blog.html` / `portal.html`（顧問先向け）/ `infographic.html`（社労士とは）/ `privacy-policy.html`
- `uploads/` … サービス各ページ（`service-*.html`）・事例（`case-*.html`）・`contact.html`・`service.css`
- `blog/` … ブログ記事9本 + `articles.json`
- `assets/` … 画像・ロゴ・猫マスコット画像
- `mascot.js` … 猫マスコット（後述）
- `image-slot.js` … 画像差し替え機能（後述）
- `link-keep.js` … プレビュー閲覧時のリンク維持（本番では無効・無害）
- `wave-skin.css`
  - （2026-07-16）白波（.page-hero::after／.sec-alt::before 等）を「1440px幅1枚SVGの全幅引き伸ばし」→「120px周期タイルの repeat-x」に変更。Android系ブラウザ（実機Brave）で引き伸ばしSVG背景の右半分が白い長方形に化けるラスタライズ不具合があったため。タイルは端点がC1連続で継ぎ目は出ない。引き伸ばし方式に戻さないこと。

内部リンクはすべて**相対パス**。ルート直下ページは `uploads/xxx.html`、
`uploads/`・`blog/` 配下のページは `../index.html` のように親参照。

## 日本語パスの注意

`uploads/みなの社労士_claudedesign_upload/` のような**日本語を含むパスは run_script の helper では扱えない**
（`disallowed characters` エラー）。日本語パスのファイルは個別ツール（str_replace_edit 等）で編集する。
※ルート直下に正本があるので、基本は日本語パスを触らずに済む。

## 画像差し替え（image-slot.js）

- **共通仕様（2026-07-13 ユーザー指定）：イラスト用スロットは、幅を狭めたときも縦積みにせず「タイトルの右側」に縮小表示する。** 例＝joseikin.html のヒーロー（.jk-hero-inner、≤760pxで右上に clamp 縮小）と「こんな会社に」カード（.jg-fit、≤860pxで h3 右横に grid 配置）。今後イラストスロットを追加するページも同じ挙動にすること。

- `<image-slot>` 要素にユーザーがドラッグ＆ドロップで画像を差し込める。
- 差し込んだ画像は **localStorage**（サイト全体で共有）と **ルート直下の `.image-slots.state.json`** の両方に保存。
  → 別ページに移動しても保持される。
- 写真の `<image-slot>` は原則 `fit="cover"` とし、**ダブルクリックで拡大・位置調整（リフレーム）**できる。人物・小物を切りたくないイラスト（サービス一覧・成長段階・記事一覧・事務所紹介・助成金解説など）は `fit="contain"` を指定し、手動の `crop-*` 値を付けない。4:3イラストを使う枠も `aspect-ratio: 4/3` に合わせ、枠内の等幅paddingで実効比率を崩さない。
- Claude Designで確定した位置調整は `.image-slots.state.json` の `s/x/y` を正本にし、公開HTMLの `crop-scale/crop-x/crop-y` にも焼き込む。公開側は状態ファイルを取得せず、この3属性だけで同じ構図を軽量再現する。手調整後は状態ファイルだけ更新して終わらないこと。
- **状態ファイルは「ルート直下の1つ」に統一済み。** どのページ（`uploads/` 配下含む）も読み込み時に
  `../` を付けてルートの `.image-slots.state.json` を参照し、書き込みも常にルートへ行う。
  → **差し替えるとその場で自動的にルートの状態ファイルへ保存される**ので、もう手動コピーは不要。
  （旧仕様：読み込みだけページ相対で、`uploads/.image-slots.state.json` への手動コピーが必要だった。）

### 差し替え画像の「本ファイル化」（本番・file:// 対策）— 実施済み

ドロップした写真は元々、隠しファイル `.image-slots.state.json`（データURL）＋ localStorage にだけ
保存され、`fetch` で読み込んでいた。これは **`file://`（DLして直接開く）では fetch がブロックされて
表示されない**／公開時も隠しファイルのアップロード忘れで消える、という弱点があった。

→ 対策として、差し替え済み18枚を **`assets/photos/<スロットid>.webp`** に書き出し、各ページの
`<image-slot>` に `src="(…/)assets/photos/<id>.webp"` を直接指定済み（uploads配下は `../assets/photos/`）。
これで **file://・どのサーバー・オフラインでも確実に表示**される。隠しファイルは編集環境にだけ残し、
公開サイトは `src` で指定した本ファイルを表示する。プレビューのドラッグ差し替え・位置調整は従来どおり編集環境で利用できる。
**新たに写真を差し替えて確定したい場合**は、同じ手順で `assets/photos/<id>.webp` を上書き再書き出しすること。

（2026-07-15 追記）当初の18枚に加え、未file化のままだったイラスト12枚も `assets/photos/<id>.webp` へ本ファイル化＋`src` 指定済み＝計30枚。追加分は index の `svc-ill-joseikin/kisoku/shaho/kyuyo/sodan/dx`（サービス一覧6行）と joseikin の `jk-hero-ill`＋こんな会社に5枚（`jk-ill-career/gyomu/ryoritsu/jinzai/trial`）。これで全 `<image-slot>` が本ファイルを持ち、DL・公開・オフラインで確実に表示される。

なお `image-slot.js` の `load()` は **`file://` のとき fetch を試みず即解決**する（`location.protocol==='file:'`）。
fetch はローカルファイルではブロックされ、待ち状態（pending）のまま画像が出ないため。これで file:// でも
すぐ `src`（本ファイル）にフォールバックして表示される。**ダウンロード時は `assets/`（特に `assets/photos/`）・
`image-slot.js`・各HTMLをフォルダ構造ごと一式**保存すること（フォルダが欠けると当然画像は出ない）。

### 公開表示と編集表示の分離（2026-07-21・性能改善）

- `window.omelette.writeFile` が使える環境だけを編集モードとする。編集モードでは従来どおり `.image-slots.state.json` と localStorage を利用する。
- 通常の公開サイトでは `.image-slots.state.json` を取得せず、HTMLの `src/srcset` をそのまま表示する。約1.6MBの編集用JSONが二重取得される問題を再発させない。
- 公開時の `<image-slot>` は編集UI・ghost画像・ドラッグ処理を作らない軽量クラスで表示する。編集用の重いShadow DOMを公開側へ戻さない。読込URLは `image-slot.js?v=20260722-crop1`。
- `<a>` や `onclick` 付きカード内の画像をClaude Designで調整できるよう、画像の直接ラッパーに編集環境だけ作動する `onclick="if(window.omelette&&window.omelette.writeFile){event.preventDefault();event.stopPropagation()}"` を置き、`page-enter.js` も編集環境の image-slot 操作をSPA遷移より優先する。公開時のリンク挙動は変えない。
- 軽量版が追加する `#mn-image-slot-public-style` は、`page-enter.js` の `KEEP_HEAD_IDS` でSPA遷移をまたいで保持する。これが無いとトップ→無料相談などの遷移後に画像の100%幅・高さ・cover指定が消え、画像と枠の大きさがずれる（2026-07-21に再現・修正）。
- `deploy-public.yml` は `.image-slots.state.json` と検証用 `scripts/` を public ブランチから除外する。隠しファイルを公開へ戻さない。
- 大きなイラストは `-480.webp` / `-960.webp` を `image-slot.js` が公開時に選択する。対象を増やすときは本体画像と同じ構図で両方を生成する。

## 画像の「ブラウザ内と本ファイルの食い違い」対策（2026-07-20 発覚・再発防止ルール）

**何が起きたか**：image-slot.js は画像を localStorage と `assets/photos/*.webp`（本ファイル）の両方に保存するが、本ファイル側の書き込みが環境要因で**エラーを出さず静かに失敗**することがある。その間もブラウザのプレビューは localStorage から表示するので正しく見え続け、誰も気づけない。結果、ダウンロード・公開時に本ファイル側だけ古い写真のまま、という食い違いが起きた（2026-07-20、5スロット分で発生）。

**再発防止ルール（ダウンロード提供・公開前は必ず実施）**：
- ユーザーへのダウンロード提供や公開作業の前に、localStorage の画像と `assets/photos/*.webp` を突合するチェックを走らせる。方法：`eval_js_user_view` で各スロットの localStorage 画像と、fetch で取得した本ファイルをそれぞれ 8×8 縮小→輝度シグネチャ化して比較（`diff` が大きいものだけ食い違い＝要再焼き込み）。全スロット一括だとタイムアウトするので10〜15件ずつバッチ分割する。
- 食い違いが見つかったスロットは、`snapshot_element` でブラウザ表示中の画像をPNGとして直接プロジェクトへ書き出し→run_script で webp 変換→`assets/photos/<id>.webp` を上書き（localStorage の中身を直接ファイル化する書き込み経路がこの環境には無いため、この経路を使う）。
- 差し替え作業のたびに実施するのが理想だが、最低限「ダウンロードを渡す直前」「公開直前」には必ず1回実施する。

## 猫マスコット（mascot.js）— 過去に何度も調整した。要注意ポイント

ヒーローのボタンではなく、**右下に固定で浮く `.floating` ボタン群**（`.fl-primary`＝「無料で相談する」）が基準。

### 位置の設計（重要・バグ多発箇所）
- 位置は必ず **右下隅からの距離（right/bottom オフセット）で統一**して保存・復元する。
  - 過去バグ：保存=右端基準／復元=左端基準で食い違い、**再読み込みで猫が飛んだ**。
- 位置を変えたら **`POS_KEY` を上げる**（`mn-mascot-pos-v9` → v10…）。
  これで古い保存位置がリセットされ、全員に新しい既定位置が反映される。
- 既定位置は「`.floating` 群の**左隣**」（テキストに被らない）。
  猫の右端＝ボタン群の左端のすぐ外、足元＝ボタン群の下辺にそろえる。
  **ボタンに重ねない**（ユーザーは重なりを嫌う）。

### カーソル追従（揺れ・暴走の元）
- 追従の傾きの基準は **`root`（傾かない外枠）**。`sprite`（傾く本体）を基準にすると
  傾く→基準ずれ→また傾く の**振動**になる。
- `transform` に **CSSトランジションをかけない**（JS追従と二重がけでふわふわ遅延する）。
- ドラッグ判定は pointermove で **`e.buttons & 1` を毎回チェック**し、押されていなければ即終了。
  → ポインター捕捉が取り残されても「ホバーだけで猫が付いてくる」暴走を防ぐ。
- **リサイズ中は追従の傾きを止める**（`resizing` フラグ）＋即座に右下基準でクランプ（遅延スナップ禁止）。
  → リサイズ時の高速移動を防止。

### トーン・動き
- セリフは**協力的でていねい**に（上から目線・語尾の「にゃ」はNG）。
- 既定の動きは**激しく走らせない**（ゆっくり歩く／揺れる程度）。スクロール中だけ歩く。
- サイズは小・中・大の3段階（吹き出しメニュー下部で変更、localStorageに記憶）。既定は中＝控えめ。
- 吹き出しは**キャラの真上**に出す（重ならない）。

## ページ遷移の演出（page-enter.js）— 緑カーテン（2026-07 自前SPA化済み）

**現行実装＝SPA方式（v2、全面書き換え済み）。以下が正。**
サイト内リンクのクリックを横取り→緑カーテン(.22s)で覆う→**location.href ではなく fetch→DOM差し替え＋pushState**→準備待ち→マーカー線(.12+.46s)→一拍(.12s)→めくり(.34s)。motion-lab「5a」の固定リズム。ドキュメントが生き続けるので凍結ゼロ・演出は完全連続。

### v6 の変更（2026-07-21・遷移文字の途中拡大を修正）
`window.__mnSpa.v===6`。ルートページは `html` の実効 `zoom=1`、uploads配下は `wave-skin.css` により通常 `zoom=.9`（2000px以上では1.15）。SPAのカーテンは `<html>` 直下に残したまま `swapHead()` でページCSSだけを交換するため、**無料相談→トップ系ページでは表示中のカーテンも .9→1 に切り替わり、文字が途中で約11%拡大していた**。`syncVeilZoom()` がカーテンへルートの逆倍率を与え、表示開始時・head交換直後・新規CSS適用時・表示中のリサイズ時に同期する。これにより本文側の既存倍率は変えず、カーテンの文字・波・足あとだけを常に同じ実寸で表示する。
- **本番キャッシュ対策**：サーバーがJavaScriptへ `max-age=604800`（7日）を付けるため、全HTMLと記事生成テンプレートの読込URLを `page-enter.js?v=20260722-1` に統一。修正版公開時に既存端末が旧版を保持し続けるのを防ぐ。次回 `page-enter.js` を変更して本番公開するときも、このクエリ版番号を全ページ＋`admin-post.html`の生成テンプレートで更新する。

### v4 の変更（2026-07-19・ブログ行きは演出なし＋文字/線の同フェーズ化）
`window.__mnSpa.v===4`。ユーザー要望「別ページへ行くときだけ遷移演出を出す（理念→サービス等は出す／ブログは続けて読めるよう出さない）」＋「文字とアンダーラインのズレ・文字なしアンダーラインの根絶」に対応。**判定は原則『移動先』**：
- **ブログ行き（一覧 `blog.html`／記事 `/blog/`配下）は演出なし＝素のリンク遷移**。共通判定 `isBlogDest(url)`（`/\/blog\.html$/i` ‖ `/\/blog\//i`）を `eligible()`・`[onclick]`カード分岐・`popstate` の3経路すべてに適用（片方だけ直さない）。ブログが移動先のときはクリック横取り／preventDefault／fetch／DOM差替／カーテンを一切開始しない。戻る・進むでブログへ来た場合は `hardGo()` で素の読み直し。→ ブログは毎回フルロード（＝記事間でSPA状態・scrollハンドラが蓄積しない副次効果あり）。**記事→トップ/社労士とは等の非ブログ行きは従来どおり演出あり**（ブログページでも page-enter.js は読まれ、非ブログ行きだけ横取りする）。誤爆防止確認済み：`uploads/blog-guide.html` のような名前は false。
- **文字とアンダーラインを『覆いきり(coverDone)』基準の同フェーズに固定**。旧実装は線(`pv-mark`)を `readiness()`（＝移動先の読み込み完了）後に引いていたため、遷移先の重さで線の開始が毎回ズレた。現行は `markP = coverDone.then(()=>{ if(hasVeilText()) pv-mark; wait(580) })` で**カーテンが降りて文字が出た直後に線を引く**（読み込み時間に非依存＝毎回同じ順序）。めくりは `Promise.all([markP, readyP]).then(wait120).then(doLift)` で**線の描画ぶんと移動先準備の両方がそろってから**行うので線が途中で切れない。
- **文字なしアンダーラインの禁止**：`pv-mark` は `hasVeilText()`（`.pv-in` に trim 済みテキストあり）が真のときだけ付与。ラベルは必ず非空化する——`resolveLabel()`＋`destLabel()` のフォールバック連鎖（①リンク文字 ②aria-label ③img alt/title ④キャッシュ済みタイトル ⑤共通文言 `GENERIC='ページを移動します'`）。旧・戻る/進むの `labelLate:' '`（空白ラベル→線だけ見える原因）は廃止し、汎用フォールバックのまま来た場合は swap 後に `maybeUpgradeLabel()` で実タイトルへ格上げ（＝文字を一度も空にしない）。
- 意匠（緑カーテン・波・猫足あと・速度/イージング）・SEO・本文・配色・フォントは不変。安全弁（file://・reduced-motion・fetch失敗8秒watchdog→hardGo）も不変。
- **（2026-07-19 追撃）同一ページ内アンカーでカーテンが出るバグを修正**。(1) トップは `/` で配信されるのにナビは `index.html#…` を指すため、素の `url.pathname===location.pathname` 判定を通り抜けていた → `normPath()`（末尾 `index.html` を落とす）＋ `samePage()` に統一し `eligible()`・`[onclick]`カード分岐の両方へ適用。(2) **真因**：プレビューホストが hash 遷移を `popstate` 化して発火させるため、`popstate` ハンドラが同一ページの hash 変化でも `navigate()`（カーテン）していた。`lastPath`（直近表示pathname）を保持し、`normPath(url.pathname)===normPath(lastPath)` の時は**カーテンを出さずアンカーへ即時スクロールのみ**で return（popstate 時 `location` は既に遷移先なので `samePage` は使えない＝`lastPath` 比較が要）。`lastPath` は navigate の swap 後に更新。検証：`#pricing/#why/#services/#cases` クリックで veil 非表示・該当セクションへスクロール、`infographic.html` は従来どおり veil 表示。

### v2 の要点（壊さないこと）
- **（2026-07-16）head差分のタグ付けは遅延式（tagHead）**：旧実装は page-enter.js 読み込み時に一度だけ data-pg を付与していたが、同スクリプトは head 先頭にあるため実行時点では link/style が未パースで空振りし、ハードロード面のCSS（skin-v2.css等）が差分管理外になって**遷移先に永久残留**するバグがあった（例：ルート→uploads 遷移で skin-v2 の .footer::before 波が uploads フッターに出現）。現在は swapHead 冒頭で毎回 tagHead() を呼び未タグノードを拾う。戻さないこと。なお skin-v2.css 側にも保険として `main:has(> :is(.final-cta,.final-sec):last-child) + .footer::before{content:none}` を入れてあり、万一混在しても暗いCTA直後のフッターに波は出ない。
- **（2026-07-17）readiness は新規CSSのloadも待つ**：swapHead で新たに挿入した link[rel=stylesheet]（例：ルート⇄uploads 間で入れ替わる service.css / skin-v2.css）を pendingCss に集め、readiness() で load/error を cap2.5s で待つ。これが無いとCSS未適用の素のHTML（縦一列の狭いレイアウト）がめくり後に一瞬見える。
- **（2026-07-17）swap はカーテン「覆いきり実測」も待つ**：旧実装は wait(300)（壁時計）だけで覆いきりを仮定していたが、覆い開始は showVeil 内の rAF 1フレーム後のため、タップ直後にメインスレッドが詰まる端末では降りきる前に swap が走り、差し替え直後のページ（旧スクロール位置・ヘッダー透過のまま）が一瞬見えた。showVeil が覆いアニメの finished を coverDone として公開し、navigate は fetch＋wait(300)＋coverDone（cap1.5s＝非表示タブ対策）の全部を待ってから差し替える。
- **（2026-07-17）位置リセットは「即時スクロール」で行う**：html の scroll-behavior:smooth（skin-v2／service.css／contact）だと、swap後の scrollTo(0,y) が滑りアニメになり、**めくり後まで続いて「旧スクロール位置のページが一瞬見える」**（ユーザー報告の崩れフラッシュの正体）。navigate 側で inline scrollBehavior='auto' を立てて即時スクロール→rAFで復帰し、さらに保険として skin-v2.css / wave-skin.css に `html.pv-on,html.pv-mark,html.pv-lift{scroll-behavior:auto !important}` を追加（端末に旧page-enter.jsがキャッシュされていても効く）。検証マーカー：`window.__mnSpa.v`（現行=3。undefined なら旧キャッシュが実行中）。
- **（2026-07-17）「遷移時に一瞬崩れたページが見える」＝プレビュー画面独自の挙動と確定（追いかけないこと）**：プレビューのホスト側が実クリック遷移をまれに素のiframeリロードに化けさせるのが原因。実測でサイト側は白＝合成・実クリックともSPA正常（クリック横取り→fetch 200→差し替え、未スタイルフレーム0）。ユーザーがDLしたHTML（file://）では発生しないことも確認済み＝本番では出ない。サイト側コードでは防げないため対処不要。診断用の一時ログ（mnDbg）は撤去済み。
- **クリック横取りは window の capture で登録**（2026-07-12変更）。プレビュー環境のホスト側スクリプトが document capture でクリックを先取りして素の遷移を起こし、カーテンが途中破棄される（文字が一瞬しか見えない）ため、必ず先に走る window 側で preventDefault＋stopImmediatePropagation する。本番挙動は従来と同一。document 登録に戻さないこと。
- **カーテンは単一の `#pg-veil`**（`<html>`直下＝body差し替えの影響外）。波・浮かぶ文字・猫足あと（6パターンランダム）の意匠は継続。入場/退場の二重実装・sessionStorage引き継ぎ・prerender注入・壁時計位相同期（mnPhase）は**全廃**（同一ドキュメントなので不要）。
- **差し替え手順**：swapHead（style/link[stylesheet]を data-pg キーで差分更新。フォントlink等同一資産は残す＝再取得なし。title・meta theme-color/descriptionも更新）→ swapBody（bodyを adoptNode で丸ごと交換。**猫マスコット .mn-mascot/.mn-recall は新bodyへ移植**）→ スクリプト再実行。
- **スクリプト再実行の規則**：src付きは絶対URLレジストリで**初回のみ**（image-slot/mascot/link-keep/header-motion等。順序保証のonload逐次実行）。インラインは毎回再実行（要素バインドなので安全）。例外：`ONCE_INLINE`（pf-hover, stg-highlight＝document級リスナーを張るもの）は初回のみ。JSON-LD等非JS typeはスキップ。
- **再初期化フック**：差し替え後に `window.__hmReinit()`（header-motion。古いscrollリスナーを外して貼り直す実装済み）と `window.__mnJbreak()`（見出し改行。jbDoneガードで冪等）を呼ぶ。新しい共通スクリプトを足すときは同じパターン（再実行可能 or フック公開）にすること。
- **クエリ引き継ぎ**：プレビューのトークン（?t=…）は navigate 内で自前マージ（link-keep 相当。クリックは stopPropagation で link-keep に渡さない）。
- **戻る/進む**：scrollRestoration='manual'。各entryの state.y にスクロール位置を記憶し、popstate→同じカーテン遷移で復元（スクロールはカーテンの裏で実施）。アンカー付きURLは差し替え後に位置計算（scrollIntoViewは使わない）。
- **準備待ち**：2フレーム＋フォント（通常即。cap0.8s）＋**トップのみヒーロー画像**（cap3.5s）。待ち中も文字・足あとは動き続ける（同一ドキュメントなので途切れない）。
- **安全弁**：file:// / reduced-motion / 非対応ブラウザは一切介入しない（素のリンク遷移）。fetch失敗・例外・8秒watchdog→ location.href に即フォールバック。遷移中のpopstateも素に読み直す。
- 検証用：`window.__mnSpa.navigate(url)`。（比較デモ motion-lab.html はクリーンアップ 2026-07-15 で削除済み。決定内容は本メモに記録。）
- 注意：ページ固有インラインscriptがdocument/window級リスナーを張ると訪問のたびに蓄積する。**scrollハンドラは2026-07-17に全ページ「登録置き換え式」へ統一済み（下記「ページ共通scrollハンドラの作法」参照）。新規ページも必ず同じ書き方にすること。** それ以外のdocument/window級リスナーは要素バインドに寄せるか ONCE_INLINE にid登録。

## ページ共通scrollハンドラの作法（2026-07-17 全33ページ改修済み・必ず守る）

**起きたバグ（Codex指摘で発覚）**：各ページのインラインscrollハンドラが (1) SPA遷移のたびに `window.addEventListener('scroll',…)` を張り直して**蓄積**し、(2) index / blog のハンドラは `#fl`（固定相談ボタン）を**無ガード参照**（indexは素の `fl` ＝id暗黙グローバル、blogは `getElementById('fl').classList` 直呼び）していたため、`#fl` を持たない**ブログ記事14本**へ遷移すると残留ハンドラが `ReferenceError: fl is not defined` / `TypeError: Cannot read properties of null` を毎スクロール発生させていた。単一ページのレスポンシブ検証では出ず、**SPAで複数ページを連続遷移して初めて発生**する。

**改修内容（全33公開ページに適用）**：
```js
if(window.__pgScroll)window.removeEventListener('scroll',window.__pgScroll);
window.__pgScroll=function(){
  var prog=document.getElementById('prog'),nav=document.getElementById('nav'),fl=document.getElementById('fl');
  var p=scrollY/(document.documentElement.scrollHeight-innerHeight||1);
  if(prog)prog.style.width=(p*100)+'%';
  if(nav)nav.classList.toggle('solid',scrollY>60);
  if(fl)fl.classList.toggle('hidden',scrollY<300);
};
window.addEventListener('scroll',window.__pgScroll,{passive:true});
```
（indexはこれに加え nav 'shrink' と updateFloat（fl存在ガード付き）、rAFスロットル付きページは ticking を維持）

**3原則（新規ページ・新規ハンドラで必ず守る）**：
1. **登録は置き換え式**：`window.__pgScroll` のような固定キーに保存し、addの前に必ず旧ハンドラをremove（header-motion.js の `__hmUpdate` と同じパターン）→ 蓄積ゼロ。
2. **要素はハンドラ内で毎回 getElementById して取得**（ページ読み込み時にキャッシュしない）→ body差し替え後に古い要素を触らない。素の `fl` のような**id暗黙グローバル参照は禁止**（要素が無いページで ReferenceError になる）。
3. **全要素にnullガード**（`if(el)`）→ その要素を持たないページに遷移した瞬間の残留1発でも落ちない。ページごとに存在する要素が違う前提で書く（例：#fl はブログ記事に無い）。

以下の旧記述（採用済みの意匠・狙い・速度・file://対策）は**デザイン意図の記録として残す**。実装構造に関する記述（html::before・#pg-live/#pgx-live・sessionStorage・prerender・MIN_HOLD等）は旧方式のもので、現行には存在しない。

### 採用済みの意匠（2026-07 に motion-lab.html で比較・決定。ユーザー承認済み）
- **波縁が流れる**：カーテン下端の波がゆっくり横に流れる（覆う/めくれる間だけ画面に見える）。
- **文字が水面に浮かぶ**：あいさつを1文字ずつ span 分割してゆっくり上下＋白のマーカー線が引かれる。
- **猫の足あとが上へ登る**：文字の下を足あとが登る。登り方は6パターン（MN_PAWS）から毎回ランダム。
  退場で選んだパターンを sessionStorage('pg-next-paw') で到着ページに引き継ぎ、行き帰りで同じ登り方にする。
  足あとは待ちが 0.45s を超えたときだけふわっと見える（旧・脈打つドットの後継。ドットは廃止）。
- **実装構造**：カーテン本体（無地）は従来どおり html::before（最初の描画前に敷ける）。
  波・文字・足あとは実DOMのライブ層 **#pg-live（入場）/ #pgx-live（退場）** に乗せ、
  ::before と**同じ箱（inset/height）・同じ transform/transition** で完全同期させている。
  この同期を壊さないこと（片方だけ duration や高さを変えると、めくれ中に波と本体が剖離する）。
- 比較用デモ **motion-lab.html** はクリーンアップ（2026-07-15）で削除済み（noindex の開発用ページだった。セクション見出しの登場案が採用見送りになった経緯もそこにあった）。

### 狙い（なぜこの仕組みか）
- **白い画面のチラつき（FOUC/読み込み中の空白）を隠す**のが第一目的。多ページ静的サイトは遷移ごとに全読み込みが走り、白画面が一瞬出る。緑カーテンで覆えば、その不格好な瞬間を見せずブランド色の中で切り替えられる。
- **文脈の橋渡し**：覆った瞬間に行き先の文字（トップ＝時間帯のあいさつ／他＝ページ名）を出し、到着側へ `sessionStorage('pg-next-label')` で**同じ文字を引き継ぐ**。タイトル待ちをせず即表示するので、タップ→到着まで文字が途切れない＝「どこへ向かっているか」が伝わり安心感が出る。
- **文字は大きめ（22px・Zen Maru Gothic 700・白）**：一瞬しか出ないので、小さいと読めない。視認性優先で大きく。

### 速度の考え方（重要・何度も調整した）
- **先読み（prerender）導入済み（2026-07）**：page-enter.js 冒頭で Speculation Rules（prerender＋prefetch、eagerness:moderate、href_matches:"/*"）を全ページに注入。ホバー/押下時点で行き先を裏タブに丸ごと描画し、タップ後の固まり（カクつきの発生源）を消す。Chromium系のみ効く（他は無視＝従来どおり）。
  連携の要点：入場IIFEは navType==='prerender' も対象に含めカーテンを敷くが、**doLift は document.prerendering 中は保留**し、prerenderingchange（表示切替）で syncHandoff（退場側が決めた文字・足あとを取り込み直し、波の位相も再同期）→めくり上げ。裏でめくり切らせないこと（到着時に演出が消える）。
- 体感の遅さの正体は**サイトの重さではなく、演出のために入れた待ち時間**。静的HTMLは本来速い。「もっと速く」と言われたら、まず演出の数値（下記）を削る。
- 現在値の目安：退場カバー `.22s`／移動開始＝**覆いきってから**（#pgx-live の transitionend。行き先は prerender/fetch で先読み済み）／入場の保持 `MIN_HOLD 620ms`（マーカー線 .12s待ち＋.46s描画を引き切って一拍）／めくれ `.34s`。イージング `cubic-bezier(.6,0,.15,1)`。
  マーカー線は**入場側でだけ**引く（退場は約250msで死ぬので間に合わない）。引き継ぎあり(.now)：.12s待ち＋.46s／なし(.on)：.2s待ち＋.42s。
  prerender経由の到着は prerenderingchange で MIN_HOLD を数え直す（これをしないと裏描画中に保持時間が消化され、マーカーが途中で切れる）。
  周期アニメ（波・文字・足あと）は mnPhase() で壁時計基準の負のdelayを入れ、ページをまたいでも位相が連続する（リセットで飛ばない）。
  カクつき対策：遷移中はメインスレッドが新ページの解析で飽和するため、カーテンの全アニメ要素（文字span・足あと・波・ラベル）に
  `will-change` を付けてコンポジッタレイヤーに昇格済み（メイン飽和中でも駒落ちしない）。外すとカクつきが再発するので消さないこと。
  入場はフォント（cap 1.2s）＋**トップのみヒーロー画像**（cap 4.5s。2026-07ユーザー要望で復活）を待つ。他ページの画像は待たない（blur-upが下地）。フェイルセーフ：トップ4.2s／他2.2s。
  なお各ページの mascot.js 等は元々 </body> 直前配置＝defer 化しても実行タイミングが変わらないため、defer 化は不要と判断済み。
- **入場側の静止時間（MIN_HOLD）が「アニメが終わって何もない時間」の正体**。長いとカーテンが止まって見える→短くするとキビキビ。これ以上短くすると演出が認識される前に消える＝実用下限。
- **遅い遷移の不安対策**：移動後 `900ms` 以上かかるときだけ、文字下に脈打つドット（`#pg-dots`）を出す。速い遷移では出さない（チラつき防止）。
- スマホ競合対策：標準の View Transition は全ページ `@view-transition{navigation:none}` で無効化済み（緑カーテンと二重に動くのを防ぐ）。

### file://（ダウンロードして直接開く）対策 — 実施済み
- 退場カーテンは `e.preventDefault()` でクリックを止め、**180ms 後に `location.href` で遷移**する。
  この遅延でユーザー操作の文脈が外れ、**ブラウザがスクリプト起点の `file://` 遷移をブロック**するため、
  ローカルで直接開くと「緑になるだけでページが変わらない＝リンクが効かない」状態になっていた。
- 対策：page-enter.js の両IIFEに `location.protocol === 'file:'` の早期 return を追加。
  ローカル閲覧では演出をやめ、**通常リンク（ユーザー操作の遷移）に任せる**ので確実に遷移する。
  本番（http/https）では従来どおり緑カーテンが動く。インラインの `onclick="location.href=…"`（howカード等）は
  クリック同期で遷移するため user-activation が保たれ、file:// でも問題ない（遅延遷移だけが対象）。

## アクセス解析（GoatCounter）— 2026-07-14 導入済み

- 全公開ページ（ルート・blog/・uploads/ の33ページ）の `</body>` 直前に GoatCounter タグを挿入済み（`data-goatcounter="https://minano-sr.goatcounter.com/count"`）。admin-post / motion-lab / email-preview / _wcheck は対象外。
- **SPA遷移対応**：page-enter.js の swapBody 後に `goatcounter.count({path:…})` を手動発火（差し替え遷移では通常のpage loadが起きないため）。
- **アカウントは未作成**。本番公開前に goatcounter.com で Code=「minano-sr」で登録が必要（admin-post.html の「アクセス解析」タブに手順を記載）。コードを変える場合は全ページのタグを一括置換。
- 新規ページを作るときも同じタグを `</body>` 直前に入れること。

## 問い合わせフォーム（uploads/contact.html）

- 送信先メール：**contact@minano-sr.com**（2026-07-21変更）。FormSubmitは宛先変更後の初回送信時に、このアドレスへ届く確認メールのリンクから再有効化が必要。
- 静的サイト単体ではメール送信できないため、外部フォーム送信サービス連携が将来必要。
  （現状の方式はユーザーと相談しながら変更してきた。直近の実装を必ず確認してから触る。）
- 業種・従業員数のチェックボックスあり。「空欄でも〜」のような圧迫感ある文言は使わない。

## 共通フッターの連絡先・改行（2026-07-21統一）

- 全33公開ページの「お問い合わせ」欄に `mailto:contact@minano-sr.com` を追加済み。`admin-post.html` の記事生成テンプレートも同じ内容に同期してある。
- 所在地と電話・営業時間は `address.footer-contact` の2行構造に統一。旧 `.footer-addr` の固定`<br>`や `.addr-sep` の「 / 」区切りへ戻さない。電話番号とメールアドレスは途中で分割しない。
- 共通スタイルはルート系=`skin-v2.css`、uploads系=`uploads/service.css`、問い合わせページ=`uploads/contact.html` 内のCSS。キャッシュ回避の読込版は `20260721-footer`。

## ホバー・アニメーションの作法（カクつき防止）

- ホバーやトランジションで **`padding` / `width` / `margin` などレイアウトを動かすプロパティを animate しない**
  （毎フレーム再レイアウトが走りカクつく）。代わりに **`transform`（translate / scale）と `opacity`** を使う（GPU合成で滑らか）。
  - 例：行の字下げは `padding-left` ではなく中身を `transform:translateX()`。左アクセント線は `width` ではなく `scaleX()`。
- **所要時間とイージングを全パーツで統一**する（バラバラだと不揃い・もたつく）。
  基準：`.34s cubic-bezier(.22,.61,.36,1)`（easeOut系）。1秒は遅すぎる。
- 奥行きを出すなら移動量に少し差をつける（例：文字10px・アイコン5px）。

## トップ画像の登場演出・画像の blur-up（実装済み）

- ヒーローは「黒下地→画像ポップ」を避け、深緑の下地＋画像のフェード＆引きズーム＋文字の遅延立ち上げ（`index.html` の `<style id="hero-intro">`）。
- **全 `<image-slot>` に blur-up を内蔵済み**（`image-slot.js` の `_setLqip`）。表示中の写真から極小ぼかし版を自動生成して下地に敷くので、読み込み中も黒や無地が出ない。写真差し替えにも自動追従。各ページ・各スロットに自動適用される。

## 採用ページ（recruit.html）

- ルート直下 `recruit.html`。営業スタッフをメイン募集（目的＝困っている人を助ける／社労士とアウトソーシングという選択肢を広める）。
- 本番公開用に整備済み（「仮（準備中）」バナー・各所の「（仮）」表記を撤去、`robots` を `index,follow` に変更、`sitemap.xml` に登録）。給与・勤務地などの数値は確定値として掲載中（公開前に最終確認推奨）。確定済み：完全週休2日制・有給初年度15日付与。ホームのフッター「コンテンツ」からリンク済み。
- 電話番号は実値（090-2838-8252）・代表名は近藤 昭宏に反映済み（2026-07-12）。**残プレースホルダ＝社労士登録番号（第16◯◯◯◯号・未定）**。ドメインは `minano-sr.com`、連絡先メールは `contact@minano-sr.com` に確定済み。OGP画像本体 `assets/og/minano-og.png` は、AI生成イラストではなく実際のトップページ上部を撮影した1200×630画像として、2026-07-16に公開ページへ設定済み。LINE導線はサイト全体から撤去済み（アカウント開設後に復活させる場合は footer の「お問い合わせ」欄・.fl-mini・最終CTAに追加し直す）。

## 2026-07 ブラッシュアップ（大画面対応・トップ強化）

ユーザーの体感：**14インチ（約1512px）ではちょうどよく、27インチ（2560px）ではスカスカ**。
対策として index.html 末尾の `<style id="brushup-2026">` に大画面プレゼンス層を追加済み：
- `@media(min-width:1560px)`：`--max:1320px`、セクション余白88px、FV見出し最大54px、写真各種拡大、final-inner 880px。
- `@media(min-width:1900px)`：`--max:1400px`、余白104px、FV最大58px、final-inner 940px。
- **1559px以下（＝14インチ含む）の見え方は一切変えていない**。大画面の見え方調整はこの2ブロック内で行うこと。
- **2000px以上は `html{zoom:1.15}` に切替済み**（旧 zoom:.9 比で約28%拡大。2026-07に 1→1.08→1.15 と段階的に引き上げ）。index.html は brushup-2026 内で hero-stage の svh 補正を /1.15 に同時上書き。下層は wave-skin.css 末尾で同じ切替（下層に svh 補正はない）。1999px以下は従来どおり zoom:.9。
- **下層ページの大画面対応は wave-skin.css 末尾に共通層**：1560px以上 `--max:1240px`、1900px以上 `--max:1320px`（各ページのインラインCSSより後に読まれるので勝つ）。**ブログ記事（article.post）は :has() で除外**して本文幅760pxを維持。

同ブラッシュアップでの主な変更（すべて index.html）：
- **サービス一覧は従来の横長・行型リスト（6行・01〜06）**（一度「主要3サービスの写真カード化 .svc-top3」を入れたがユーザー判断で撤回・削除済み）。各行の線画アイコンの代わりに **4:3イラスト用 `<image-slot>`（id: svc-ill-joseikin / kisoku / shaho / kyuyo / sodan / dx、`.svc-ill` ラッパー）** を設置。表示幅はPC 112px・モバイル72px。行は `<a>` なのでラッパー span に編集環境限定のクリックガードを付け、公開時のリンク操作とClaude Designの編集を両立している。正本画像は `assets/illustrations/service-*.webp`。画像内の実色 `#fefefe` との境界が見えないよう、サービス6行と記事一覧4行はいずれも、行・画像枠・`image-slot` の背景を同色に統一する。成長段階・記事一覧・事務所紹介・`joseikin.html` も4:3画像＋`fit="contain"`で統一し、画像内の人物・小物を切らない。事務所紹介の4枚は画像内に意味があるため、重複する説明ラベルを重ねない。
- **助成金タイムライン**（`.sub-timeline`）：STEP1〜5。「実施前の計画提出が必要」を強調、受給保証ではない注記付き。文言変更時もこの注記は残すこと。
- **CASE段階ハイライトは削除済み**（2026-07 ユーザー判断で機能ごと撤去。復活させないこと。`#stg-highlight` はコメントのみ残存）。
- FVサブコピーを「富山の中小企業に向けて…」に変更、FAQの「当日対応が可能」を断定しない表現に緩和。
- **TOOLSに図解**（`.tflow`）：勤怠→給与→手続き→年末調整の4ステップ。
- **ヒーローCTAの「光が走る」演出（ctaSheen）は削除済み**（ユーザー要望。復活させないこと）。

本番前要確認（2026-07-21更新）：電話・代表名・LINE撤去・OGP画像・ドメイン・連絡先メール（`contact@minano-sr.com`）は反映済み。残り＝登録番号（第16◯◯◯◯号）／FormSubmitの新アドレスでの再有効化・受信テスト／GoatCounterアカウント登録。

## レスポンシブの徹底（このプロジェクトで繰り返し発生した問題。編集後は必ず守る）

**過去に実際に起きたはみ出し・崩れの原因パターン：**
1. **横並びチップ・目次・帯**が中間幅（600〜1000px）で収まらず右へはみ出す
   （例：社労士とはページの目次「1.立ち位置〜7.診断」→ 最終的に削除で解決）。
2. **`white-space:nowrap` / `word-break:keep-all`** を装飾目的（マーカー線を切らない等）で
   広範囲に当てると、中間幅で行が収まらず飛び出す。nowrap は「その幅で必ず収まる」ことを
   確認できる範囲だけに限定する。確実に折らせたい位置には `<wbr>` を直接埋め込むのが最も堅い。
3. 保険として全ページ `html,body{overflow-x:clip}`（sticky を壊さない。hidden は使わない）。
   ただしこれは「隠す」だけで根治ではない。中身が切れて見える場合はレイアウト自体を直す。

**セクションや帯を追加・変更したら、必ず複数幅で検証すること：**
- eval_js で offender スキャンを回す（vw を超える要素を列挙）：
  `document.querySelectorAll('body *')` を回して `getBoundingClientRect().right > clientWidth` を検出。
- 目安の検証幅：360 / 390 / 640 / 768 / 900 / 1200px。特に**中間幅（640〜1000px）が盲点**
  （モバイル用CSSにもデスクトップ用CSSにも当たらない帯）。
- 横スクロールUI（`overflow-x:auto` のチップ列など）は「切れて見える＝バグに見える」と
  ユーザーに受け取られやすい。端がフェードする等の続きの手がかりがないなら採用しない。

## レイアウト・折り返しの作法（不自然な改行はNG）

- **横並びの帯・ナビ・チップ列が、画面を広げると行数が増える＝NG。** ヒーロー直下の要約帯（`.hs-inner`）のように、
  項目が一定幅で `flex-wrap:wrap` していると、広い画面で中途半端に2行・3行に折り返して見栄えが悪くなる。
  → **広幅では1行に固定（`flex-wrap:nowrap`＋余白を `clamp` で詰める）**、折り返しは**狭い画面（モバイル）だけ**に限定する。
- 「広げたら崩れる／行が増える」は仕様ではなくバグとして扱い、ブレークポイントごとに**1行で収まるか**を必ず確認する。
- 同様に、見出しや文の `<br>`・nowrap も、特定幅でのはみ出しや不揃いな改行を生むことがある。
  改行位置を変えたくない場合はフォントサイズ側（`clamp`）で詰め、収まらないなら改行ルール自体を見直す。

## 公式情報ページ（portal.html）— 2026-07-12 全面改修「公的機関リンク集」（旧・顧問先の方へ）

- **サイト全体でナビ・フッターの表記を「公式情報」に統一済み**（URL は portal.html のまま）。
- リンクは3分野×4枚の**色分けカードグリッド**（.lk-sec/.lk-grid/.lk-card、#fs-portal styleに定義）: 年金・健康保険=山影ブルー（--sora系）／雇用保険・労働基準=萌木グリーン／助成金・電子申請・様式=朝日アンバー。各セクションの `--ct`（文字/アクセント）と `--cl`（チップ地色）で色を制御。

- **旧「配布ファイル（file-slot）」方式は撤去済み**（メンテ困難のためユーザー判断）。現在は年金機構・協会けんぽ（富山/石川支部）・ハローワーク・富山/石川労働局・厚労省・雇用関係助成金・e-Gov（電子申請/法令検索）・主要様式DLコーナーへの**外部公式リンク集**（3カテゴリ×4行、`.cat`/`.file` 行スタイルを流用、target=_blank）。SEO目的のお役立きリンクページ。
- **file-slot.js / .file-slots.state.json / 旧版 portal_pre-linkhub_20260712.html はクリーンアップ（2026-07-15）で削除済み**（どのページからも未参照だったため。復活させる場合は再実装が必要）。`#fs-portal` styleタグはリンク行の小差分用に転用済み。検索/フィルタ/tools-barも撤去。
- リンク先URLを追加・変更するときは行の `.file-desc`（何に使うか）と `.lk-domain` も揃えて更新すること。

## 記事作成ツール（admin-post.html）— 2026-07-12 追加

※トップの pub-live バッジ（「開業準備中から発信中 ◯本・◯分野」）は 2026-07-12 ユーザー編集で削除済み（#pubLive 要素と pub-live-js を撤去）。articles.json はブログ側の「発信のあゆみ」集計と本ツールで引き続き使用する。

- ルート直下 `admin-post.html`。タブ3つ（記事を書く／公開中の記事一覧／使い方）。フォーム入力→簡易記法の本文→「生成する」で、**手順A「かんたん公開セット」＝①記事HTML ②新記事組み込み済みblog.html（件数+1済み） ③先頭追加済みarticles.json の3ファイルをダウンロード**（現行ファイルをfetchして差分を機械挿入。重複スラッグ検知あり。file://ではfetch不可のため手順B=コピペ方式にフォールバック）。手順Bとして従来の art-row／JSONエントリ／news-row スニペットも出力。
- noindex・どこからもリンクしていない（URL直打ちで使う管理ページ）。sitemap.xml には载せないこと。
- 下書きは localStorage（`mn-admin-post-draft-v1`）に自動保存。
- 記事テンプレを変えたら admin-post.html 内の `buildArticle()` も追従させること。カテゴリ別関連サービスカードは `REL` マップ。

## 記号・アイコンの方針（2026-07-17刷新→2026-07-18巻き戻し。現行ルール）

一度「装飾アイコン全廃・緑丸チェック廃止・漢字モノグラムチップ化」を全ページに適用したが、**ユーザー判断で巻き戻し済み**（「ずれた・のっぺりした」）。現行：
- **アイコン・丸チェックは従来どおり**（.chk 緑丸＋白チェック、plan-features の丸チェック、checklist の緑角チェック、各種線画アイコン）。
- **例外＝行政機関のみ漢字チップを使用**（ユーザー承認のシグネチャー）：infographicの行政機関カード（年金/雇用/労基/助成、`.kmono.kmono-sm`）と portal のカテゴリ（`.cat-icon.kmono`、セクション色継承）。`.kmono` は skin-v2.css に定義（40px角丸・淡緑地・Zen Maru Gothic 700 13px・#007B43）。Zen Maru Gothic の font link は infographic / portal のみにある（他ページに足さないこと）。
- **注意：削除された旧SVGの原本はどこにも残っていなかった**ため、巻き戻し時に同じ作法（viewBox 24・stroke currentColor 1.5・round）で再描画している。CSSは編集記録から完全復元。見た目は旧デザイン相当だがバイト一致ではない。今後大規模な見た目変更をする前は、必ずファイル一式のバックアップ（フォルダコピー）を取ってから行うこと。

## 表示速度の設計と性能ゲート（2026-07-21）

- Google Fontsは使用しない。和文はヒラギノ／游ゴシック／メイリオ等の端末内フォントを使い、分割フォントの大量通信を避ける。
- トップのLCP画像は native `<picture>`。AVIF/WebPの 720/800/1200/1600px を用意し、`preload`・`fetchpriority="high"`・width/heightを維持する。公開トップを `<image-slot>` に戻さない（preload scannerが画像を早期発見できなくなる）。
- トップの初回ロゴローダーは撤去済み。サイト内移動の緑カーテンはブランド演出として残す。
- トップは `#critical-home` にファーストビュー用CSSを置き、全量 `skin-v2.css` は `data-async-style` で後から適用する。両者を片方だけ変更しない。ファーストビューの規則を変更したらインライン側も同期する。
- 画面外の大きなsectionは `content-visibility:auto` で描画計算を遅延する。アンカー移動・SPA遷移で位置ずれがないことをモバイル実測する。
- CSS/JSを変更して公開するときはクエリ版を更新する。ヒーロー等の最適化画像は寸法入りの別名にして、7日キャッシュ中の旧資産と混同させない。サーバーはHTML/CSSをBrotli圧縮し、静的資産へ `max-age=604800` を付与している。
- 変更前後で `node scripts/check-performance-budget.mjs` を実行する。PRでは `.github/workflows/performance.yml` がモバイル／PCのLighthouseを計測してレポートを保存し、共有ランナーでも安定する転送量（モバイル600KiB・PC700KiB）とCLS 0.1を合否判定する。点数・LCP・TBTは共有ランナーのCPU混雑で大きく変動するため、ローカル同一条件の比較に使う。

## sitemap.xml は自動生成に切り替え済み（2026-07-19 `gen-sitemap.js` 追加）

**lastmod を手で書かないこと。** 手動だと「編集したのに lastmod を書き忘れる」で簡単にズレ、Google は lastmod が不正確だとサイト全体の lastmod を無視し始める（＝SEO実害）。過去に実際、福井表記削除・canonical/og追加を各ページに入れたのに sitemap の日付が 05-17/06-29 のまま取り残される不整合が起きた。

- **正本は `gen-sitemap.js`**（ルート直下・Node製）。ファイルの実 mtime から lastmod を機械生成する。公開直前や記事公開（admin-post 手順A）後に `node gen-sitemap.js` を一度実行するだけ。差分確認だけなら `node gen-sitemap.js --check`（CI向け・古ければ exit 1）。
- 対象は DIRS=（ルート/uploads/blog）直下の .html。除外は EXCLUDE（admin-post・icon-catalog・404・_backup 等）。priority/changefreq は RULES に定義（現行 sitemap と一致）。
- **ドメイン確定後はこのファイル先頭の `DOMAIN` 定数を1行差し替えるだけ**（HTML側の example.com 一括置換とは別。sitemap は DOMAIN が単一の真実）。
- この環境（ブラウザsandbox）は mtime を読めないため、初回の正確化だけは run_script で日付を機械割り当てして sitemap.xml を再生成済み（今日編集の9ページ=07-19、canonical/og追加ほか24ページ=07-18、古い日付の残存0）。以後はローカルで `node gen-sitemap.js` を回せば実 mtime で常に正確になる。

## 今後の引き継ぎ方針（2026-07-20・VSコード/Codexへの引き継ぎ検討）

ユーザーは今後、このHP一式をフォルダで書き出してVSコード＋Codexでの編集に移行することを検討中。引き継ぐ場合のアドバイス：

- **まず `present_fs_item_for_download` で一式取得 → フォルダ構造ごと保存**（`assets/`・各`.js`が欠けると画像/演出が壊れる）。
- **CLAUDE.md自体をCodexにも読ませる**（正本の場所、ファイル構成、過去バグの再発防止ルールが集約されている）。
- 引き継ぎ後の注意点（Codexにも伝えること）：
  1. 正本はルート直下のみ。`uploads/`配下は別デザイン系統（wave-skin.css）なので混同しない。
  2. 画像差し替えの二重保存（localStorage＋`assets/photos/*.webp`）に注意。VSコードではファイル側が正。Claude Design側の差し替えとVSコード側編集を並行させると食い違いの原因になる（2026-07-20に実際発生・対策済み＝上記「画像の食い違い」節）。
  3. page-enter.js（SPA遷移）は自己完結の1ファイル。ブログ判定・同一ページ判定など条件分岐が細かいので、触る前に「ページ遷移の演出」節を読む。
  4. sitemap.xmlは手で書かず `node gen-sitemap.js` で自動生成（mtimeベース）。ドメイン確定時は同ファイル先頭の `DOMAIN` 定数を変更。
  5. スクロールハンドラは置き換え式（`window.__pgScroll`パターン）。SPA遷移で蓄積するバグが過去に発生済み。
  6. skin-v2.css / wave-skin.css / service.css の対応関係を確認してから配色・レイアウトを触る。
- 役割分担の目安：機能追加・ロジック変更（フォーム送信・解析・ビルド周り）はCodex向き。文言・配色・レイアウトの微調整はどちらでも可だが、両方で同時編集すると上書き事故が起きるため、担当を切り替えるタイミングを明確にする。

## 進め方


- 小さな修正依頼は**その箇所だけ**直す（周辺のレイアウト・文言・色を勝手に変えない）。
- 修正後は `ready_for_verification({path})` でルートの該当 HTML を開いて確認。
- 変更は基本ルート直下に対して行う。
