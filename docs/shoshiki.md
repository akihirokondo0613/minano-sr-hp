# 社内書式ページ（shoshiki.html）の直し方

会社と従業員の間で使う社内書式のひな形を、ブラウザで記入・印刷できる形で公開しているページ。正本と生成器はすべてこのリポジトリにある。デスクトップ側の旧生成器（顧問先用書式ページ_作業/04_書式生成）は 2026-09-06 以降は使わない。

## 何がどこにあるか

| もの | 場所 |
|---|---|
| 書式の文面（正本） | `data/shoshiki/forms.json` |
| 文面の元（記法版） | `scripts/shoshiki/hints.py`（`{(番号, ラベル): 記法}`）と `TEXT_FIX`（文の置換） |
| 書式の骨組み | `scripts/shoshiki/forms_base.py`（D-01〜D-32・E）、`forms_extra.py`（D-33〜D-51） |
| forms.json を作る | `scripts/shoshiki/make_json.py` |
| HTML（一覧・各書式・DLページ） | `scripts/shoshiki/build_shoshiki.py` → `shoshiki.html`、`shoshiki/D-xx.html`、`shoshiki/dl/word-7kq3x9/index.html` |
| 書式の描画（HTML と Word） | `scripts/shoshiki/render_forms.py` |
| 配布物のファイル名（ASCII） | `scripts/shoshiki/shoshiki_names.py`（`build_shoshiki.py` と `build_zip.py` が共有。標準ライブラリだけ。CI の runner に openpyxl が無いので `build_shoshiki.py` から `build_zip.py` を import しない） |
| Excel帳簿・Word一式 zip | `scripts/shoshiki/build_zip.py` → `shoshiki/D-31_shukkinbo.xlsx`、`shoshiki/D-32_nenkyu-kanribo.xlsx`、`shoshiki/dl/word-7kq3x9/shanai-shoshiki-word-YYYYMM.zip` |
| preflight の検査 | `scripts/build-shoshiki-page.mjs --check`（HTML が最新か） |
| メール登録（Word一式） | Googleフォーム https://forms.gle/vFUpB3fqzetNHQQKA（contact@ のアカウント。作り直さない） |

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
python3 scripts/shoshiki/build_shoshiki.py   # HTML
python3 scripts/shoshiki/build_zip.py        # Excel帳簿と Word一式 zip
node scripts/preflight.mjs
```

4. 直した書式を `shoshiki/D-xx.html` で開いて確かめる（ローカルは `python3 -m http.server 8811` で `http://127.0.0.1:8811/shoshiki/D-xx.html`）。Word 版は zip を展開して開く。
5. 公開は [release.md](release.md) の手順どおり（PR → CI → squash merge → デプロイ → 本番確認）。

`hints.py` に無い文面は `forms_base.py`／`forms_extra.py` の元テキストを直す。`TEXT_FIX` は「元の文 → 直した文」の辞書で、本文（p・note）の言い回しを変えるときに使う。

## 書式を増やす

`forms_extra.py` の `EXTRA` に 1 件足す（`no`・`cat`・`title`・`to`・`intro`・`blocks`・`guide`。宛名を変えるなら `addr`、署名欄を変えるなら `sig`）。`build_shoshiki.py` の `SCENES` に番号を足すと「場面から探す」に出る。上の python3 の 3 コマンドと preflight を回す。

## 会社情報の差し込み

一覧ページの入力欄に入れた会社名・代表者・所在地・電話・担当は `localStorage`（キー `shoshiki.company`）にだけ保存し、各書式ページが開くときに `.co-name` などへ差し込む。どこにも送信しない。書式ページは印刷用の独自 CSS と自前の JS で組んであるため、`page-enter.js` の SPA 遷移から除外している（`isFormDest`）。除外を外すと、同名 `const` の二重宣言で JS が止まり会社名が入らない、Excel リンクが「PK…」の文字化け画面になる、の 2 つが再発する。

## 配布物のファイル名

サイトに置くバイナリ（xlsx・zip）は ASCII 名にする。日本語名の URL は、Googleフォームの確認メッセージなど自動リンクの環境で日本語の手前で切れて 404 になる。表示名は `<a download="…">` で日本語にしている。zip のダウンロードページ `shoshiki/dl/word-7kq3x9/` は、リンクがディレクトリで切れても届くように置いてある。Googleフォームの確認メッセージにはこのディレクトリ URL（`https://minano-sr.com/shoshiki/dl/word-7kq3x9/`）だけを書く。zip 名は `as_of` の年月で変わるが、ディレクトリ URL なのでフォーム側は直さなくてよい。同ディレクトリの `.htaccess` で 404 をこのページに向けている（古い zip 名のリンクでも届く）。`robots.txt` で `/shoshiki/dl/` は Disallow、書式ページは `noindex`、sitemap には一覧だけ載る。IndexNow は `scripts/lib/indexnow-changes.mjs` で `shoshiki/` 配下を通知対象外にしている。

## 法令の確認

各書式の `guide.law` は作成時点（2026-09）の理解で書いてある。法改正で直すときは `forms_base.py`／`forms_extra.py` の `guide` と、必要なら本文を直し、`meta.as_of`（`forms_base.py` の `DATE`）を更新して zip 名の年月も上がるようにする。更新案内はフォームで「希望する」に☑した人にだけ送る。
