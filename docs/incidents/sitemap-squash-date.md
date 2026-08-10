# squash mergeでsitemap公開が止まった事故

## 何が起きたか

`gen-sitemap.js` は、Git管理中のHTMLについて最終コミット日から `lastmod` を生成する。ローカル作業中に生成した `sitemap.xml` は、その作業コミットの日付を持つ。

GitHubで `gh pr merge --squash` を行うと、`main` に新しい日時のコミットが作られる。すると、PR headで正しかった `lastmod` と、マージ後の履歴から生成される `lastmod` が必ずしも一致しない。

PRの性能検査はPR headを見るため合格する一方、マージ後のデプロイだけが `gen-sitemap.js --check` で失敗した。本番反映が止まり、`main` にあるsitemapのずれが後続PRにも連鎖した。2026年7月末のPRで実際に発生し、応急修正を経て公開フローを変更した。

## 根本対策

公開用の `sitemap.xml` は、`deploy-public.yml` がマージ後の履歴で `node gen-sitemap.js` を実行して作り直す。リポジトリにコミットされた `sitemap.xml` は開発時のスナップショットであり、公開用 `lastmod` の最終正本ではない。

PR側では、生成器が正常に動くことを確認するため `node gen-sitemap.js` を実行する。日付一致を求める `--check` を公開ゲートにしない。

## 再発防止

- `lastmod` を手作業で更新しない。
- 公開前チェックに `node gen-sitemap.js --check` を入れない。
- HTMLの最終コミット日が変わるsquash merge後に、デプロイ側で再生成する。
- GitHub Actionsのcheckoutは、日付生成に必要な履歴を取得する。
- `main` のsitemapとローカル生成結果の日付差だけを理由に、デプロイを止めない。
- URLの追加・削除、除外規則、優先度、ドメインは `gen-sitemap.js` のコードを確認し、件数を文書へ固定しない。

## 当時の経緯

PR #49でマージ日と作業日の差により公開が止まり、PR #50で応急復旧した。その後、PR #53で `--check` を公開ゲートから外し、デプロイ時再生成へ切り替えた。解決済みの事故であり、現在のsitemap日付差を同じ未解決バグとして扱わない。

## 移管元の原文

以下は事故当時の記録を情報欠落なく残すための原文です。日付、PR番号、件数、実行環境は歴史値であり、現行仕様の正本には使いません。

> ## sitemap.xml は自動生成に切り替え済み（2026-07-19 `gen-sitemap.js` 追加）
>
> **lastmod を手で書かないこと。** 手動だと「編集したのに lastmod を書き忘れる」で簡単にズレ、Google は lastmod が不正確だとサイト全体の lastmod を無視し始める（＝SEO実害）。過去に実際、福井表記削除・canonical/og追加を各ページに入れたのに sitemap の日付が 05-17/06-29 のまま取り残される不整合が起きた。
>
> - **正本は `gen-sitemap.js`**（ルート直下・Node製）。Git管理中の確定済みファイルは最終コミット日、未コミットの変更やGit管理外のフォルダでは実mtimeから lastmod を機械生成する。GitHub Actionsは履歴を省略せずcheckoutすること。公開直前や記事公開（admin-post 手順A）後に `node gen-sitemap.js` を一度実行するだけ。
>
> ### 公開用の sitemap は deploy 時に作り直す（2026-07-30 変更・`--check` で止めない）
>
> **`node gen-sitemap.js --check` を合否判定に使わないこと。** lastmod は各HTMLの**最終コミット日**由来だが、`gh pr merge --squash` は**新しい日付のコミットを作る**ため、ローカルで生成した lastmod は「作業日 ≠ マージ日」になった瞬間に必ずずれる。PRの Lighthouse は PR head コミット（作業日）を見るので合格し、**マージ後の `deploy-public.yml` だけが落ちて本番反映が止まる**。しかも main の sitemap がずれたままなので、以降の全PRが同じ理由で落ち続ける。2026-07-29→30 のPR #49 で実際に発生（#50 で応急処置、#52 のあと #53 で仕組みを修正）。
>
> - `deploy-public.yml` は「sitemapを公開用に再生成」ステップで `node gen-sitemap.js` を実行し、**マージ後の履歴から作り直した sitemap を public ブランチへ載せる**。＝本番の lastmod は常に正しい。
> - `performance.yml`（PR）は `node gen-sitemap.js` を実行するだけ（生成器が通ることの確認）。日付比較はしない。
> - したがって **main にコミットされている `sitemap.xml` は参考用のスナップショット**で、日付が1日ずれていても異常ではない。ローカル確認で `--check` が「古い」と言っても、それ自体は公開の障害ではない。
> - 対象は DIRS=（ルート/uploads/blog）直下の .html。除外は EXCLUDE（admin-post・icon-catalog・404・_backup 等）。priority/changefreq は RULES に定義（現行 sitemap と一致）。
> - **ドメイン確定後はこのファイル先頭の `DOMAIN` 定数を1行差し替えるだけ**（HTML側の example.com 一括置換とは別。sitemap は DOMAIN が単一の真実）。
> - この環境（ブラウザsandbox）は mtime を読めないため、初回の正確化だけは run_script で日付を機械割り当てして sitemap.xml を再生成済み（今日編集の9ページ=07-19、canonical/og追加ほか24ページ=07-18、古い日付の残存0）。以後はローカルで `node gen-sitemap.js` を回せば、Git履歴（コミット前の変更はmtime）から正確に更新できる。
