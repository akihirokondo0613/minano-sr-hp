# 社内書式ページ（shoshiki.html）の直し方

会社と従業員の間で使う社内書式50本のひな形を、ブラウザで記入・印刷できるHTML版のみで公開しているページ。Word・Excelファイルの配布と登録案内は終了した。正本と生成器はすべてこのリポジトリにある。デスクトップ側の旧生成器（顧問先用書式ページ_作業/04_書式生成）は 2026-09-06 以降は使わない。

## 何がどこにあるか

| もの | 場所 |
|---|---|
| 書式の文面（正本） | `data/shoshiki/forms.json` |
| 文面の元（記法版） | `scripts/shoshiki/hints.py`（`{(番号, ラベル): 記法}`）と `TEXT_FIX`（文の置換） |
| 書式の骨組み | `scripts/shoshiki/forms_base.py`（D-01〜D-32・E）、`forms_extra.py`（D-33〜D-52） |
| forms.json を作る | `scripts/shoshiki/make_json.py` |
| HTML（一覧・各書式・旧配布URLの案内） | `scripts/shoshiki/build_shoshiki.py` → `shoshiki.html`、`shoshiki/D-xx.html`、`shoshiki/dl/word-7kq3x9/index.html` |
| 書式の描画（HTML と Word） | `scripts/shoshiki/render_forms.py` |
| 保管用Office版のファイル名 | `scripts/shoshiki/shoshiki_names.py`（`build_zip.py` が使用） |
| 非公開のOffice版生成器 | `scripts/shoshiki/build_zip.py` → `scripts/shoshiki/_build/office-*/`（毎回新しい保管フォルダ。Git管理・公開対象外） |
| preflight の検査 | `scripts/build-shoshiki-page.mjs --check`（HTML が最新か） |
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

一覧ページの入力欄に入れた会社名・代表者・所在地・電話・担当は `localStorage`（キー `shoshiki.company`）にだけ保存し、各書式ページが開くときに `.co-name` などへ差し込む。どこにも送信しない。書式ページは印刷用の独自 CSS と自前の JS で組んであるため、`page-enter.js` の SPA 遷移から除外している（`isFormDest`）。除外を外すと、同名 `const` の二重宣言で JS が止まり会社名が入らない不具合が再発する。

設定JSONは `name/title/rep/addr/tel/dept` の文字列だけを受理し、不正なファイルは既存設定を変えない。保存が拒否された場合はページ内の値を保持して警告を表示する。別タブの変更は `storage` イベントで同期する。書式本文とチェック状態は再読み込み後に保持しないため、印刷・PDF保存を案内する。チェック欄はTabで移動し、Space・Enterで変更できる。

履歴復帰でブラウザが入力欄の旧値を復元する場合にも、`pageshow` 後の次taskで会社設定を読み直して入力欄と差し込み表示を揃える。BFCache復帰だけに限定しない。

D-52は入力欄と個人番号の切り取り欄をA4一枚に収めるため、HTML生成器の `D52_CSS` でこの書式だけ余白・セルの行送りを調整する。本文・文字サイズは共通版を維持する。

## 公開HTMLの検査とOffice版の保管

対象変更のPerformance CIでは `scripts/test-shoshiki.cjs` を実行し、全50書式の画面・印刷、設定・キーボード・戻る進む・横スクロールをChromium/WebKitで検査する。Office配布リンクがないこと、旧4ファイルが提供されないこと、旧配布URLからHTML一覧へ到達できることも検査する。

元データのD-31/D-32、Word描画機能、Office用検査スクリプトは保持する。`data/shoshiki/forms.json` は従来どおり公開対象で、Office版の生成物だけを非公開で保管する。必要な場合だけ `python3 scripts/shoshiki/build_zip.py` を実行する。出力先はGit管理対象外の `scripts/shoshiki/_build/office-*/` で、既存成果物を削除・上書きしない。deployは `scripts/` を公開から除外する。公開ディレクトリ `shoshiki/` にxlsx/docx/zip等が置かれた場合、HTML生成・preflightは失敗する。

## 旧配布URL

`shoshiki/dl/word-7kq3x9/` は配布終了と登録不要のHTML版を案内するページとして残す。同ディレクトリの既存 `.htaccess` は404をこの案内へ向ける。過去のZIP・Excelは公開対象から削除し、Git履歴で復元できる。Googleフォーム自体の閉鎖や文言変更は所有者側で行い、サイトの変更だけで閉鎖したとは扱わない。`robots.txt` で `/shoshiki/dl/` は Disallow、書式ページは `noindex`、sitemap には一覧だけ載る。IndexNow は `scripts/lib/indexnow-changes.mjs` で `shoshiki/` 配下を通知対象外にしている。

## 法令の確認

各書式の `guide.law` は `meta.as_of` 時点の理解で書いてある。`guide.law/ops` は公開HTMLに出力していないため、公開本文の修正と生成元だけの修正を区別する。法改正で直すときは `forms_base.py`／`forms_extra.py` の `guide` と、必要なら本文を直し、`meta.as_of`（`forms_base.py` の `DATE`）を更新する。過去の登録者への更新案内を行う場合は、その希望とプライバシーポリシーに従う。
