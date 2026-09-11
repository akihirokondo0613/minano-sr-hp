# スポット注文ページ（spot.html）の直し方

顧問契約のない方が、入社・退社の手続き、会社設立時の新規適用、36協定の作成・届出を1回ごとの固定料金で注文するページ。品目カード→会社情報フォーム→確認画面（入力内容の見直し）→「この内容で注文する」→完了画面の一続き。送信先は受注システム（Google Apps Script のウェブアプリ。`SPOT_ENDPOINT`）で、送った時点で注文が確定し、完了画面に注文番号と案件ページのリンクが出る。

## 何がどこにあるか

| もの | 場所 |
|---|---|
| カート品目の正本 | `pricing.html` の `#spot-fees`（`.sf-row`） |
| カート品目データ（生成物） | `data/spot-items.json` |
| 品目データを作る | `scripts/sync-spot-items.mjs`（`data/spot-items.json` と spot.html の埋め込みを両方書く。`--check` で差分検出。preflightに組み込み済み） |
| 注文ページ本体 | `spot.html`（品目データは生成器がページ内の `<script id="spot-items">` に埋め込んだものを読む。埋め込みが無い・壊れているときだけ `fetch('data/spot-items.json')` する） |
| 事業者情報・取引条件のページ | `tokutei.html` |
| SPA遷移からの除外 | `page-enter.js` の `isSpotDest`（shoshiki と同じ理由：カートの状態をJSで持つため） |

品目の税抜価格を直すときは `pricing.html` の `#spot-fees` を直し、`node scripts/sync-spot-items.mjs` を実行する。`data/spot-items.json` と spot.html の `<!-- spot-items:start -->`〜`<!-- spot-items:end -->` の区間を手で編集しない（`--check` が落ちる）。

## カートに入れられる6品目（入社・退社・新規適用・36協定。2026-09-11 に絞った）

H01 入社手続き（資格取得届）・H05 会社設立時の新規適用手続き・H06 36協定の作成・届出・H02 退社手続き（資格喪失届）・H03 離職票の作成・H04 退社手続き＋離職票（同時）。コードと品目名・料金表の行の対応は `scripts/sync-spot-items.mjs` の `buildItems()`、入力欄は同じファイルの `FIELDS` が正本。受注システム（Apps Script の `Code.gs`）の `SPOT_WEB_CODES` も同じ6コードにそろえる（そこに無いコードの注文は赤フラグ「受付対象外の品目」で止まる）。

給付の申請・年次業務・給与計算・相談は `pricing.html` の料金表には残るが、Web注文には出さない。就業規則の作成・改定、労務システムの導入支援、助成金の申請代行（成功報酬）はカート対象外で、`spot.html` からは `uploads/contact.html`（お見積りフォーム）へ誘導する。

## SPOT_ENDPOINT（送信先）の差し替え手順

1. 受注システム（Apps Script の `web_order.gs` の `doPost`）は、注文 JSON を受けるとその場で確定し、`{ok:true, orderNo, items, subtotal, docDue, payDue, uploadUrl, statusUrl, underReview, next}` を返す。受け付けられないときは `{ok:false, error:"..."}` を返す（`error:"rejected"` のときは `message` に理由が入り、注文ページの送信失敗の欄に「理由：」として出る）。POST・`Content-Type: text/plain;charset=utf-8` で受ける。
2. デプロイして実行URL（`https://script.google.com/a/macros/minano-sr.com/s/.../exec`。下の「exec URL は `/a/macros/minano-sr.com/` 形式で書く」を参照）を取得する。
3. `spot.html` 内の `<script>` 冒頭にある定数を差し替える。

   ```js
   var SPOT_ENDPOINT = 'PLACEHOLDER_GAS_EXEC_URL';
   ```

   ↓

   ```js
   var SPOT_ENDPOINT = 'https://script.google.com/a/macros/minano-sr.com/s/xxxxx/exec';
   ```

4. `SPOT_ENDPOINT` が `PLACEHOLDER` のままだと、確認画面の「この内容で注文する」を押した時点で送信を試みず、常にメール・電話の代替導線を表示する（本番運用前の事故防止）。
5. 差し替え後、実際にテスト注文を送り、完了画面に注文番号・「書類を送る」・「進み具合を見る（案件ページ）」が出ること、そのリンクで案件ページ（`go/case.html`）が開くことを確かめてから公開する。赤フラグの無い注文では受任のご案内メール（請求書PDF付き）も同時に出るので、届くことも確かめる（完了画面はメールが届かなくても先へ進める作り）。

## 送信するJSON

キーは日本語のまま送る（会社名・法人個人区分・郵便番号・住所・代表者名・担当者名・担当者メール・電話・会員番号・流入経路・紹介元・補足・給与支払・顧問契約・確認_不正・確認_他社労士・確認_規約・案内同意・website・items）。`items` は `{業務コード, 業務名, 数量, 発生日, 対象者, 補足}` の配列（最大20件）。`website` はハニーポット（人には見えない欄）で、値が入っていたら送信せず完了画面だけ表示する。

## 計測

GoatCounterへ「カート追加」「注文送信」「送信失敗」の3イベントを送る（`spot/カート追加` 等のパスにイベントとして送信）。氏名・メール・注文内容そのものは送らない。

## 日付の欄（2026-09-11）

品目カードの日付（入社日・退職日）は1名のときだけ聞く。2名以上は各自の日付が違うので欄を出さず、`発生日` を空で送る。各自の日付は Excel の受領フォームで受ける。Apps Script 側は、Excel が届いて「送信を完了する」が押されたとき、法定期限が空の案件があれば担当者メールで知らせる（台帳の法定期限は人が入れる）。

## 取引条件と利用規約

`spot.html` の確認画面で同意を取るのは `tokutei.html`（取引条件・事業者情報）だけ（2026-09-11 の決定）。受任のご案内メールも `termsUrl_()` で同じページを案内する。利用規約は別ページとして未公開で、公開するときは スポット業務/_作業/build_forms_v2.py の規約案を今の仕組み（注文と同時に受任・確認メール廃止）に合わせて直し、`web_order.gs` の `termsUrl_` の分岐を外し、受任メールの見出しとこの同意チェックを「取引条件・事業者情報と利用規約」に変える。Script Properties の `TERMS_PDF_ID` があれば受任メールに PDF を添付する。

顧問契約の問いは「みなの社会保険労務士事務所と顧問契約はありますか」（value は ある／ない）。「ある」は Apps Script の `yesNorm_` で「はい」に寄り、赤フラグ（確認中）になる。他事務所の件は同意チェック「本件の手続きを、ほかの社会保険労務士事務所に依頼していません（顧問契約で任せている場合を含みます）」に任せる。

## メールのリンク入口 `go/index.html`
受注システムが顧客へ送るメールのリンクは `https://minano-sr.com/go/?a=…&id=…&t=…` を入口にする（`script.google.com` のURLを直書きしたメールが Gmail 宛で 5.7.1 拒否された 2026-09-10 の対策）。受注システム v23 からは Apps Script が画面を持たないので、`go/index.html` は `a=st/up/ack` を含むすべてのリンクを `case.html?id=&t=`（up は `#docs`、ack は `#ack`）へ振り分ける。id か t が無ければスポット注文ページへ案内する。検索対象外（robots.txt で `/go/` を除外、noindex）。

## 注文の確定は画面上で行う（2026-09-10 以降）
GAS の doPost は保留注文を積んだ直後に確定まで進め、JSON で `orderNo / items / subtotal / docDue / payDue / uploadUrl / statusUrl / underReview / next` を返す。spot.html の完了画面（`renderDone`）はこれをそのまま表示するので、受任のご案内メールが迷惑メール行きでも顧客は「書類を送る」「案件ページ」へ進める。確認メール方式（旧 `AUTO_CONFIRM=0`）は v23 で削除した。

## 品目カードの入力欄
`scripts/sync-spot-items.mjs` の `FIELDS`（qtyLabel／dateLabel／person／deadline）が正本。GAS 側 Code.gs の 数量ラベル・DATE_ASK と同じ文言にしておく。dateLabel が空の品目は日付欄を出さないが、今の6品目はすべて日付欄がある（入社日・適用事業所となった日・協定の起算日・退職日）。person=false の品目（H05 会社設立時の新規適用・H06 36協定）は氏名欄を出さず、H01〜H04 は出す。

## exec URL は `/a/macros/minano-sr.com/` 形式で書く
`https://script.google.com/a/macros/minano-sr.com/s/<ID>/exec`。素の `/macros/s/<ID>/exec` は、複数の Google アカウントにログインしているブラウザで `/macros/u/1/s/…` に書き換えられ「ページが見つかりません（現在、ファイルを開くことができません）」になる（2026-09-10 に本人の環境で発生）。Google の案内（Workspace は `a/<ドメイン>/` を挟む）に従う。spot.html の SPOT_ENDPOINT（go/index.html は v23 から exec を参照しない）。

## 2回目以降の注文（会社情報の事前入力）
受任メール・案件ページの「次回のご注文」リンクは `spot.html?member=<会員番号>&k=<署名>`。ページは `SPOT_ENDPOINT?a=me&id=&t=` から会員情報（会社名・区分・住所・担当者・電話・流入経路）を取り、会社情報フォームに先に入れる。署名が無いと受注システムは返さない（会員番号だけでは他社の情報は引けない）。

## 書類ページ `go/docs.html`（2026-09-10）
顧客の「送るもの・答えること」画面は HP 側の静的ページ。Apps Script の画面より速く開き、ボタンを押した瞬間に状態が変わる（記録が終わるまで「保存中」の印、失敗したら元に戻して行の下に理由）。データは `SPOT_ENDPOINT?a=updata&id=&t=`、操作は `POST {act: mark|answer|file|finish, …}`（本文は text/plain の JSON）。古いメールの `go/?a=up` リンクは go/index.html が docs.html へ振り分ける。原本が要る書類は「郵送します」で記録し、宛先を表示する。

## 案件ページ `go/case.html`（2026-09-10・第1段）
顧客が開くページは1つ。`?id=<注文番号>&t=<署名>` で受注システムの `?a=case` から全データを1回で取り、進み具合・次にすること・ご注文の内容・送るもの／答えること（#docs）・公文書・請求と支払・受領確認（#ack・POST act=ack）・次回の注文を描画する。go/docs.html は case.html#docs へ転送、go/index.html は a=st/up/ack を case.html へ振り分ける。担当者側は台帳のプルダウンのみ（受注システム v22）。
`a=case` の任意欄（無ければ従来表示）：`billing:null`＋`billingNote`＝未請求／取下げで金額・入金を出さない、`invoices`（2通以上）＝請求書ごとに行を分ける、`items[].state`（review／declined／cancelled）＝金額欄の表示、`nextUpload`＝「次にすること」の書類ボタン（無ければ canUpload）。「すべて揃いました」のトーストはページ上の操作で残り0になったときだけ出す。

## 案件ページの質問の折りたたみ（2026-09-10）
`go/case.html` の「お答えいただくこと」は、必須の質問・答えによって出る追加質問・すでに答えのある質問だけを開いて出し、任意の質問は「あれば助かること（任意・N問）」の折りたたみに入れる。答える数を少なく見せるためで、データ（`?a=updata` の `qgroups`）は変えていない。

## 2名以上は Excel 受領フォーム（2026-09-10）
受注システム v27 から、対象者が2名以上の注文（入社・退社・離職票・出産手当金・育休給付初回・傷病手当金・労災）は、案件ページの質問と確認用の書類行を出さず、`go/xlsx/` に置いた Excel 受領フォーム1本（全員分を記入）を送ってもらう。行政に出す提出書類の行だけ残る。1名の注文は従来どおり案件ページのフォーム（書類の写真＋選ぶだけの質問。本人の情報は書式 D-52「入社時 本人情報記入シート」を会社が本人に書かせて写真で送る）。

| 品目 | ファイル |
|---|---|
| H01 入社 | `go/xlsx/nyusha-juryo-form.xlsx` |
| H02・H03・H04 退社・離職票 | `go/xlsx/taishoku-juryo-form.xlsx` |
| K01・K02 出産手当金・育休給付初回 | `go/xlsx/sanikukyu-juryo-form.xlsx` |
| K08 傷病手当金 | `go/xlsx/shobyo-juryo-form.xlsx` |
| K09 労災 | `go/xlsx/rosai-juryo-form.xlsx` |

Web注文（2026-09-11 から6品目）で使うのは入社・退社の2本（H01〜H04）。給付用の3本（K01・K02／K08／K09）は受注システム（`Code.gs`）の対応表に残っているが、今の注文ページからは注文できない。

正本は `11_🧩 事務所サービス/01_スポット業務/書式/受領フォーム/`（元は業務本体の `02_情報回収・受領フォーム`。事務所名と連絡先を差し込んだ顧客配布版）。差し替えたら ASCII 名でここへコピーする（日本語名の URL は自動リンクで切れる）。`/go/` は robots.txt で Disallow、sitemap・IndexNow の対象外。案件ページは書類名に `Excel` を含む行を「記入したExcelを送る」ボタン（.xlsx のみ受け付け）で描く。送られた Excel は受注システム側で個人番号フォルダに保存する（マイナンバー列を含みうるため）。
