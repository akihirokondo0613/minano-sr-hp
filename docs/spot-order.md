# スポット注文ページ（spot.html）の直し方

顧問契約のない方が、入社・退社の手続きや給付の申請、給与計算、労務相談などを1回ごとの固定料金で注文するページ。品目カード→会社情報フォーム→確認画面→送信→完了画面の一続きで、送信先はGoogle Apps Script（未接続）を想定している。

## 何がどこにあるか

| もの | 場所 |
|---|---|
| カート品目の正本 | `pricing.html` の `#spot-fees`（`.sf-row`） |
| カート品目データ（生成物） | `data/spot-items.json` |
| 品目データを作る | `scripts/sync-spot-items.mjs`（`--check` で差分検出。preflightに組み込み済み） |
| 注文ページ本体 | `spot.html`（品目データはページ読み込み時に `fetch('data/spot-items.json')` する） |
| 事業者情報・取引条件のページ | `tokutei.html` |
| SPA遷移からの除外 | `page-enter.js` の `isSpotDest`（shoshiki と同じ理由：カートの状態をJSで持つため） |

品目の税抜価格を直すときは `pricing.html` の `#spot-fees` を直し、`node scripts/sync-spot-items.mjs` を実行する。`data/spot-items.json` を手で編集しない（`--check` が落ちる）。

## カートに入れられる23品目

就業規則の作成・改定、労務システムの導入支援、助成金の申請代行（成功報酬）はカート対象外で、`spot.html` からは `uploads/contact.html`（お見積りフォーム）へ誘導する。対象23品目のコード対応は `scripts/sync-spot-items.mjs` の `buildItems()` を参照。

## SPOT_ENDPOINT（送信先）の差し替え手順

1. Google Apps Script 側でスプレッドシート受信・確認メール送信・確認リンク発行を行うウェブアプリを用意し、`{ok:true}` または `{ok:false, error:"..."}` を返すようにする（POST・`Content-Type: text/plain;charset=utf-8` で受ける）。
2. デプロイして実行URL（`https://script.google.com/macros/s/.../exec`）を取得する。
3. `spot.html` 内の `<script>` 冒頭にある定数を差し替える。

   ```js
   var SPOT_ENDPOINT = 'PLACEHOLDER_GAS_EXEC_URL';
   ```

   ↓

   ```js
   var SPOT_ENDPOINT = 'https://script.google.com/macros/s/xxxxx/exec';
   ```

4. `SPOT_ENDPOINT` が `PLACEHOLDER` のままだと、確認画面の「この内容で注文する」を押した時点で送信を試みず、常にメール・電話の代替導線を表示する（本番運用前の事故防止）。
5. 差し替え後、実際にテスト注文を送って `{ok:true}` が返ることと、確認メールが届くことを確認してから公開する。

## 送信するJSON

キーは日本語のまま送る（会社名・法人個人区分・郵便番号・住所・代表者名・担当者名・担当者メール・電話・会員番号・流入経路・紹介元・補足・給与支払・顧問契約・確認_不正・確認_他社労士・確認_規約・案内同意・website・items）。`items` は `{業務コード, 業務名, 数量, 発生日, 対象者, 補足}` の配列（最大20件）。`website` はハニーポット（人には見えない欄）で、値が入っていたら送信せず完了画面だけ表示する。

## 計測

GoatCounterへ「カート追加」「注文送信」「送信失敗」の3イベントを送る（`spot/カート追加` 等のパスにイベントとして送信）。氏名・メール・注文内容そのものは送らない。

## 利用規約

`spot.html` の確認画面では、利用規約を「準備中・注文確認メールに添付」として案内している。利用規約のページを公開したら、リンク先を差し替える。

## メールのリンク入口 `go/index.html`
受注システムが顧客へ送るメールのリンクは `https://minano-sr.com/go/?a=…&id=…&t=…` を入口にし、`go/index.html` がクエリごと `SPOT_ENDPOINT` へ転送する（GAS 側 `LINK_BASE_DEFAULT`／Script Property `LINK_BASE`）。`script.google.com` のURLを直書きしたメールが Gmail 宛で 5.7.1 拒否された（2026-09-10）ための対策。`SPOT_ENDPOINT` を差し替えたら `go/index.html` の `ENDPOINT` も同じ値にする。検索対象外（robots.txt で `/go/` を除外、noindex）。

## 注文の確定は画面上で行う（2026-09-10 以降）
GAS 側は既定で `AUTO_CONFIRM=1`。doPost が保留注文を積んだ直後に確定まで進め、JSON で `orderNo / items / subtotal / docDue / payDue / uploadUrl / statusUrl / underReview` を返す。spot.html の完了画面（`renderDone`）はこれをそのまま表示するので、確認メールが迷惑メール行きでも顧客は「書類を送る」「案件ページ」へ進める。Script Property `AUTO_CONFIRM=0` にすると旧方式（確認メールのリンクを押してから確定）に戻り、完了画面は「確認メールを送りました」の文面になる。

## 品目カードの入力欄
`scripts/sync-spot-items.mjs` の `FIELDS`（qtyLabel／dateLabel／person）が正本。GAS 側 Code.gs の 数量ラベル・DATE_ASK と同じ文言にしておく。dateLabel が空の品目（G03/G04/G05/S02/S03）は日付欄を出さない。person=false の品目（会社設立・労使協定・給与計算・年次・研修・相談）は氏名欄を出さない。

## exec URL は `/a/macros/minano-sr.com/` 形式で書く
`https://script.google.com/a/macros/minano-sr.com/s/<ID>/exec`。素の `/macros/s/<ID>/exec` は、複数の Google アカウントにログインしているブラウザで `/macros/u/1/s/…` に書き換えられ「ページが見つかりません（現在、ファイルを開くことができません）」になる（2026-09-10 に本人の環境で発生）。Google の案内（Workspace は `a/<ドメイン>/` を挟む）に従う。spot.html の SPOT_ENDPOINT と go/index.html の ENDPOINT の両方。

## 2回目以降の注文（会社情報の事前入力）
受任メール・案件ページの「次回のご注文」リンクは `spot.html?member=<会員番号>&k=<署名>`。ページは `SPOT_ENDPOINT?a=me&id=&t=` から会員情報（会社名・区分・住所・担当者・電話・流入経路）を取り、会社情報フォームに先に入れる。署名が無いと受注システムは返さない（会員番号だけでは他社の情報は引けない）。
