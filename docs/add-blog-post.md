# ブログ記事の追加・更新手順

## 正本と作業開始

- 公開記事のメタデータ正本は `blog/articles.json`。記事HTML、`blog.html` の一覧・表示件数、`articles.json`、`sitemap.xml` の同期を崩さない。
- トップの 06 TOPICS（流れるカード列と公開本数）は `blog/articles.json` から `scripts/sync-home-topics.mjs` が生成する。`index.html` のカードと数値を手で書き換えない。
- 助成金の制度別解説ページ `uploads/joseikin-*.html` は `data/joseikin-guides.json` から `scripts/build-joseikin-guides.mjs` が生成する。HTMLを手で直さない。骨組みは `uploads/service-romu-sodan.html` を型として写す。
- 管理画面 `admin-post.html` が出力するのは下書きセットであり、公開完成物ではない。図解、根拠、相談導線、監査、sitemap同期を終えるまで公開しない。
- 新規記事は `minano-blog-post` スキルと同梱の `assets/new_post.py` を使う。テンプレートを変えた場合は `admin-post.html` の `buildArticle()` と Codex／Claude両環境の生成器を同時に見直す。
- 本文を書く前に `reader`（誰が読むか）、`problem`（何に困っているか）、`outcome`（読後に何ができるか）、`service`（相談先）を決め、`articles.json` と本文冒頭の読者マップを一致させる。

## 記事の構成

1. 読者の困りごとと、この記事で分かることを先に示す。
2. 「この記事のポイント」と目次を置く。
3. 制度説明だけで終わらせず、対象・対象外、判断条件、実務手順、間違えやすい箇所を示す。
4. 判断を助ける箇所へHTML/CSS図解を置く。図解は本文を理解しやすくするために使い、記事を長くするために増やさない。本文をSVG画像の中だけに閉じ込めない。
5. 「自社だけで判断しないほうがよいところ」を具体的な不利益とともに示す。
6. 読者が次に行う三つの行動を示す。
7. FAQは実在する疑問だけにする。FAQがないこと自体は異常ではない。
8. 公式情報、関連記事、著者情報、記事テーマに対応するサービスCTAを置く。記事自身への関連記事リンクを作らない。

## 法令・数値・出典

- 年度、施行日、料率、金額、期限、対象要件は、公開時点の官公庁等の一次資料で照合する。
- 重要な主張と出典の対応が分かるようにし、単に記事末へリンクを並べて検証済みとしない。
- 強い言い切りであることだけを理由に、一次資料で裏付けられた表現を弱めない。未確定事項、例外、計算前提は明示する。
- 助成金、税務、事務所実績等の表現は [法令・料金・公開情報の変更](change-legal-content.md) に従う。

## 同期と公開前監査

本文量を変えた場合は次の順で同期する。

```bash
node scripts/sync-blog-read-times.mjs
node scripts/sync-blog-dates.mjs
node scripts/sync-home-topics.mjs
node gen-sitemap.js
```

差分確認では、読了時間と日付の同期スクリプトに `--check` を使える。`gen-sitemap.js --check` は公開ゲートに使わない。

公開前に最低限、次を実行する。

```bash
node scripts/audit-blog.mjs --check
node scripts/sync-blog-read-times.mjs --check
node scripts/sync-blog-dates.mjs --check
node scripts/sync-home-topics.mjs --check
node scripts/check-structured-data.mjs
node scripts/preflight.mjs
```

共通ブログCSS、記事テンプレート、生成器、複数記事の構造を変えた場合は `node scripts/run-layout-checks.cjs --full` まで行う。局所的な本文修正は対象記事、必要な幅、Chromium／WebKitに絞り、横はみ出し、泣き別れ、console／page errorを確認する。

`audit-blog.mjs` の数値を報告するときは、その実行結果を根拠にする。`.post-refs` と `.post-related` は `</article>` の外側にあり得るため、`article.post` 内だけを検索して「ない」と判定しない。

## 管理画面の注意

- `admin-post.html` はnoindexかつsitemap対象外。公開ページへリンクしない。
- 下書きはブラウザのlocalStorageへ保存される。生成直後のファイルをサーバーへ直置きしない。
- 生成器の関連サービスは `service` から一意に決める。
- 公開後の件数やURL数は固定値を書かず、`audit-blog.mjs` と `gen-sitemap.js` の結果を使う。
