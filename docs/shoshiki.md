# 社内書式ページ（shoshiki.html）の直し方

会社と従業員の間で使う社内書式50本のひな形を、ブラウザで記入・印刷できるHTML版で公開しているページ。先頭の `#common-forms` では、よく使う22点を4つの用途に分け、実際の未記入用紙のプレビューとHTMLへのリンクを並べる。`#onboarding-kit` では、会社用の準備ガイド・労働条件通知書Excelと、従業員用の入力できるPDF4点を入社書類セットとして配布する。`#procedure-pdfs` では、社労士への入社・退職・休職連絡票PDF3種と、初回・変更時の事業所基本情報シートを案内する。旧社内書式のWord・Excel配布と登録案内は終了したままとし、新しい入社セットとは分けて管理する。正本と生成器はすべてこのリポジトリにある。デスクトップ側の旧生成器（顧問先用書式ページ_作業/04_書式生成）は 2026-09-06 以降は使わない。

## 何がどこにあるか

| もの | 場所 |
|---|---|
| 書式の文面（正本） | `data/shoshiki/forms.json` |
| よく使う基本書式22点の掲載情報 | `data/shoshiki/common_previews.json`（番号・正本と一致するタイトル・分類・短い用途・プレビュー） |
| 基本書式22点の用紙プレビュー | `assets/previews/common/D-xx.webp`（公開HTMLの未記入用紙の1ページ目。840×1189） |
| 文面の元（記法版） | `scripts/shoshiki/hints.py`（`{(番号, ラベル): 記法}`）と `TEXT_FIX`（文の置換） |
| 書式の骨組み | `scripts/shoshiki/forms_base.py`（D-01〜D-32・E）、`forms_extra.py`（D-33〜D-52） |
| forms.json を作る | `scripts/shoshiki/make_json.py` |
| HTML（一覧・各書式・旧配布URLの案内） | `scripts/shoshiki/build_shoshiki.py` → `shoshiki.html`、`shoshiki/D-xx.html`、`shoshiki/dl/word-7kq3x9/index.html` |
| 書式の描画（HTML と Word） | `scripts/shoshiki/render_forms.py` |
| 保管用Office版のファイル名 | `scripts/shoshiki/shoshiki_names.py`（`build_zip.py` が使用） |
| 非公開のOffice版生成器 | `scripts/shoshiki/build_zip.py` → `scripts/shoshiki/_build/office-*/`（毎回新しい保管フォルダ。Git管理・公開対象外） |
| preflight の検査 | `scripts/build-shoshiki-page.mjs --check`（HTML が最新か） |
| 入社書類セットの掲載文・リンク | `scripts/shoshiki/build_shoshiki.py` の `ONBOARDING_KIT` と `onboarding_kit_block()` |
| 入社書類セットの6ファイル | `assets/download/onboarding-kit/` の `guide.pdf`、`labor-notice.xlsx`、`personal.pdf`、`bank.pdf`、`commute.pdf`、`emergency.pdf` |
| 入社書類セットの一括配布 | `assets/download/onboarding-kit.zip`（上の6点と入社連絡票・事業所基本情報シートの計8点。登録不要） |
| 労働条件通知書の公開見本 | `assets/previews/labor-notice-sample.webp`（一般労働者用の架空記入例。トップと書式一覧で共用） |
| 入社セットPDFのプレビュー | `assets/previews/onboarding-guide-preview.webp`（準備ガイド1ページ目）と `onboarding-{personal,bank,commute,emergency}-sample.webp`（各PDF2ページ目の架空記入例） |
| 税の扶養控除等申告書の年別公式案内 | `scripts/shoshiki/build_shoshiki.py` の `TAX_DECLARATION_URL`（国税庁の様式・入力用PDF・記載例一覧） |
| 手続き連絡票PDFの掲載文・リンク | `scripts/shoshiki/build_shoshiki.py` の `PROCEDURE_PDFS` と `procedure_pdf_block()` |
| 手続き連絡票・基本情報PDF（各2ページ） | `assets/download/procedure-establishment.pdf`、`procedure-onboarding.pdf`、`procedure-retirement.pdf`、`procedure-leave.pdf` |
| 手続き連絡票・基本情報PDFのプレビュー | `assets/previews/procedure-{establishment,onboarding,retirement,leave}-sample.webp`（各PDF2ページ目の架空記入例） |
| 扶養届の公式書式・記入例リンク | `scripts/shoshiki/build_shoshiki.py` の `DEPENDENT_OFFICIAL` と `dependent_official_block()` |
| 旧メール登録フォーム | Googleフォーム https://forms.gle/vFUpB3fqzetNHQQKA（所有者側の管理対象。サイトからの申込リンクは置かない） |

## 文面・改行位置を直す

1. 直したい書式の番号とラベルを `hints.py` で探す。記法は次のとおり。
   - `[A|B|C]` … 選択肢（□ A　□ B　□ C）。各選択肢は途中で折り返さない
   - `{d}` … 「　　年　　月　　日」
   - `{bNN}` … 幅 NN mm の下線空欄
   - `{hNN}` … 自由記述欄の高さ NN mm
   - `//` … 強制改行（ここで必ず折る）
   - 「ラベル：」＋直後の日付・短い空欄・最初の選択肢は 1 つの塊として折り返さない
2. 語の途中で折れるときは、その語の前に `//` を入れるか、選択肢を `[…]` にまとめる。空欄が長すぎて次行に落ちるときは `{bNN}` の数字を減らす。
3. 生成し直す。

```bash
python3 scripts/shoshiki/make_json.py        # hints/forms_base/forms_extra → data/shoshiki/forms.json
python3 scripts/shoshiki/build_shoshiki.py   # 公開HTML
node scripts/preflight.mjs
```

4. 直した書式を `shoshiki/D-xx.html` で開き、入力とブラウザの印刷・PDF保存を確かめる。ブラウザ検証は利用環境の制限に従い、既存Performance CIでも行う。
5. 公開は [release.md](release.md) の手順どおり（PR → CI → squash merge → デプロイ → 本番確認）。

`hints.py` に無い文面は `forms_base.py`／`forms_extra.py` の元テキストを直す。`TEXT_FIX` は「元の文 → 直した文」の辞書で、本文（p・note）の言い回しを変えるときに使う。

## 書式を増やす

`forms_extra.py` の `EXTRA` に 1 件足す（`no`・`cat`・`title`・`to`・`intro`・`blocks`・`guide`。宛名を変えるなら `addr`、署名欄を変えるなら `sig`）。`blocks` の種類は `fields`（表）・`checks`・`box`・`note`・`p` と、`("cut", 見出し)`（点線の切り取り線＋見出し。用紙の最下段に寄せる。D-52 の個人番号の欄で使用。署名欄を本文側に置くなら `sig=[]`）。`build_shoshiki.py` の `SCENES` に番号を足すと「場面から探す」に出る。上の python3 の 2 コマンドと preflight を回す。一覧、portal、`data/llms.json` と検証スクリプトの本数も同期する。

## 会社情報の差し込み

この設定はHTML社内書式だけに反映される。手続き連絡票PDFの会社情報や記入内容とは連携しない。

一覧ページの入力欄に入れた会社名・代表者・所在地・電話・担当は `localStorage`（キー `shoshiki.company`）にだけ保存し、各書式ページが開くときに `.co-name` などへ差し込む。どこにも送信しない。書式ページは印刷用の独自 CSS と自前の JS で組んであるため、`page-enter.js` の SPA 遷移から除外している（`isFormDest`）。除外を外すと、同名 `const` の二重宣言で JS が止まり会社名が入らない不具合が再発する。

設定JSONは `name/title/rep/addr/tel/dept` の文字列だけを受理し、不正なファイルは既存設定を変えない。保存が拒否された場合はページ内の値を保持して警告を表示する。別タブの変更は `storage` イベントで同期する。書式本文とチェック状態は再読み込み後に保持しないため、印刷・PDF保存を案内する。チェック欄はTabで移動し、Space・Enterで変更できる。

履歴復帰でブラウザが入力欄の旧値を復元する場合にも、`pageshow` 後の次taskで会社設定を読み直して入力欄と差し込み表示を揃える。BFCache復帰だけに限定しない。

## よく使う基本書式のプレビュー

一般的な入社・勤務・休暇・休職・退職・証明の22点を `common_previews.json` で選ぶ。入社セットのPDF・Excelと内容が重なる本人情報・通勤・給与口座等のHTML版はプレビューに重ねず、既存の50点一覧に保持する。解雇・懲戒・労使協定など状況に応じた判断が必要な書式も、50点一覧から利用できる。

分類は「入社」「勤務・休暇」「休職・退職」「証明・その他」の4群。画像は公開HTML書式の実際の1ページ目を、会社情報と本文が未記入の状態で表示して作る。見本をAIで再現せず、用紙外の操作バーや説明欄を含めない。複数ページの書式でも画像は1ページ目と明示し、HTMLを開いて全文を確認できるリンクを付ける。画像・本文リンクの両方で、ブラウザによる記入・印刷を案内する。

`#common-forms` はスクロール演出の `rv` に依存させない。長い一覧はIntersectionObserverの表示条件を満たしにくいため、HTMLの読み込み時点から表示し、画像だけをnative lazy loadingで読み込む。上部の移動リンクから、基本書式・入社セット・手続きPDF・扶養の公式書式・全50点一覧へ進める。`#procedure-pdfs` からも、社内で使う基本書式へのリンクを置く。

一覧ページの組み方：見出し・注意枠・本文の左端は `.content` の内側（本文列）にそろえる（`portal.html` も同じ）。600px以下の基本書式22点は、小さな用紙見本を左に置いた横長カードにして縦の長さを抑える。640px以下の「分類から探す」は、表を横スクロールさせず1書式1行のカード状（番号・書式名・用途・記入リンク）に組み替える。「記入する →」は高さ44pxを確保し、PC・タブレットの表は `table-layout:fixed` で列幅を表ごとにそろえる。

本文を修正した書式は、その公開HTMLから用紙画像を作り直して同期する。タイトルは `forms.json` と完全に一致させ、用途の短縮で法的な効果や必須提出を付け足さない。元の50HTML本文・一覧の用途・件数は、プレビュー追加だけでは変更しない。

## 手続き連絡票PDFの更新

入力欄付きの空欄ページを1枚目、赤字の架空の記入例を2枚目にまとめた4ファイルだけを `assets/download/` に置く。住所は郵便番号・都道府県・市区町村・町名番地・建物名等の入力欄に分け、保険の識別番号には確認資料の案内を添える。利用者の記入済みPDFをサイトへアップロード・保存する機能は設けない。掲載前に全ページの表示、フォームの入力・保存・再表示、住所など長文の収まり、架空例表示、公開用ファイルに実際の顧客情報が入っていないことを確認する。現行の代表者氏名非公開方針を維持する。

原稿の内容とWebの用途・主な記入内容が一致するかを確認し、必要なら `PROCEDURE_PDFS` を直してHTMLを再生成する。`portal.html` の入口、`uploads/service-shakai-hoken.html` の連絡票リンク、`data/llms.json` も同期する。基本情報シートは初回・変更時のみ提出する共通情報として、入社・退職・休職連絡票の直前に置く。PDF4種は既存のHTML50本に加算しない。公開は実PDFの確認後に [release.md](release.md) の手順で進め、4つの本番URLからPDFを取得できることを確認する。

扶養の公式書式は `#dependent-forms` に置き、日本年金機構の一般被保険者向け統合届・記入例・必要資料案内へ直接リンクする。協会けんぽの会社員の扶養と任意継続の扶養は区別し、公式案内の対象を確認する。公式リンクを変更するときは一次資料を実際に開いて、届書名・対象者・ファイル種別を照合する。本文・リンク・meta/OG・LLMSも同期する。

D-52は入力欄と個人番号の切り取り欄をA4一枚に収めるため、HTML生成器の `D52_CSS` でこの書式だけ余白・セルの行送りを調整する。本文・文字サイズは共通版を維持する。

## 入社書類セットの更新

入社セットは会社と従業員が使う書類で、社労士へ手続きを依頼する入社連絡票とは役割を分ける。掲載順は準備ガイド、会社が作成・交付する労働条件通知書、従業員が記入する本人情報・給与口座・通勤・緊急連絡先。Webの4段フローは会社が通知書を作成・交付、提出先・期限を案内、従業員が入力・保存して返送、会社が確認して加入手続きを進める順とする。

従業員用PDFは各2ページ（入力用と赤字の架空記入例）で、準備ガイドは案内2ページ。労働条件通知書Excelは現行の厚生労働省モデルを基準とする入力・一般労働者用・短時間労働者用の3シート。通知書を従業員自身が決める書式として案内しない。通勤届・緊急連絡先届は会社の運用に応じて使用し、一律の法定提出物として扱わない。番号・住所・資料の重複記入を減らす方針とし、書類本文と掲載文の担当・対象を一致させる。

個別6ファイルとZIPの内容を同期する。ZIPには既存の入社連絡票・事業所基本情報シートも同梱し、会社から当事務所への依頼資料を含む8点（PDF7点・Excel1点）で配布する。公開前にはPDFの全ページ・入力保存・再表示・長い住所、Excelの空欄・入力反映・A4印刷を確認し、記入例は架空と明示する。記入済みファイルをサイトへ送信する仕組みは設けない。PDFとExcelの作者情報を含め、代表者氏名の非公開方針を維持する。

書式一覧では入社セットの個別6点と、手続き連絡票・基本情報PDF4点の全10点にプレビューを表示する。準備ガイドは1ページ目、その他のPDFは2ページ目の赤字の架空記入例を実ファイルから画像にする。PDFの画像リンクはダウンロードとは分け、同じファイルの全2ページを別タブで開く。画像は840×1189のWebPとし、原稿変更時は該当プレビューも更新する。

労働条件通知書Excelを更新するときは、検証済みの架空記入例から `labor-notice-sample.webp` を作り、通知書の掲載項目とトップの見本にも反映する。トップの横送りには同じ全10点を掲載し、901px以上では先頭3枚を並べる。見える用紙から画像を読み込み、最初から10点を一括取得しない。通知書のリンクはExcelであること、会社が作成すること、ダウンロード先を明示し、PDFだけの見本として案内しない。

国税庁の扶養控除等申告書は年ごとの公式一覧へリンクし、支給年に合う様式を選ぶよう案内する。健康保険の扶養届とは区別する。公式の入力用PDFは国税庁がブラウザ内利用に対応しないと案内しているため、利用者へはダウンロード後の利用を案内する。給与・税の書類は会社の給与担当者への提出とし、事務所単独の税務サービスを示さない。

## 公開HTMLの検査とOffice版の保管

対象変更のPerformance CIでは `scripts/test-shoshiki.cjs` を実行し、全50書式の画面・印刷、設定・キーボード・戻る進む・横スクロールをChromium/WebKitで検査する。基本書式22点の分類・HTML表示先・画像の読み込みと実表示を、320・390・768・1280pxと実スマホ390pxで確認する。入社セットの7リンク、記入担当・対象、4段フロー、各ファイルの取得、全10点のプレビュー画像の実表示とPDF表示先も検査する。基本書式の節追加に合わせ、一覧はmain直下の8節を実表示する。Office配布リンクの例外は新しい `assets/download/onboarding-kit/labor-notice.xlsx` と `assets/download/onboarding-kit.zip` の2つだけとする（扶養届の日本年金機構公式Excelリンクは従来どおり別扱い）。旧4ファイルが提供されないこと、旧配布URLからHTML一覧へ到達できることを引き続き検査する。

元データのD-31/D-32、Word描画機能、Office用検査スクリプトは保持する。`data/shoshiki/forms.json` は従来どおり公開対象で、Office版の生成物だけを非公開で保管する。必要な場合だけ `python3 scripts/shoshiki/build_zip.py` を実行する。出力先はGit管理対象外の `scripts/shoshiki/_build/office-*/` で、既存成果物を削除・上書きしない。deployは `scripts/` を公開から除外する。公開ディレクトリ `shoshiki/` にxlsx/docx/zip等が置かれた場合、HTML生成・preflightは失敗する。

## 旧配布URL

`shoshiki/dl/word-7kq3x9/` は配布終了と登録不要のHTML版を案内するページとして残す。同ディレクトリの既存 `.htaccess` は404をこの案内へ向ける。過去のZIP・Excelは公開対象から削除し、Git履歴で復元できる。Googleフォーム自体の閉鎖や文言変更は所有者側で行い、サイトの変更だけで閉鎖したとは扱わない。`robots.txt` で `/shoshiki/dl/` は Disallow、書式ページは `noindex`、sitemap には一覧だけ載る。IndexNow は `scripts/lib/indexnow-changes.mjs` で `shoshiki/` 配下を通知対象外にしている。

## 法令の確認

各書式の `guide.law` は `meta.as_of` 時点の理解で書いてある。`guide.law/ops` は公開HTMLに出力していないため、公開本文の修正と生成元だけの修正を区別する。法改正で直すときは `forms_base.py`／`forms_extra.py` の `guide` と、必要なら本文を直し、`meta.as_of`（`forms_base.py` の `DATE`）を更新する。過去の登録者への更新案内を行う場合は、その希望とプライバシーポリシーに従う。
