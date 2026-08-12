# GitHub経由の編集・本番公開

ターミナルとGitHub CLIを使えるCodex／Claude Code向けの標準手順。正本は`main`で、公開物はマージ後に`.github/workflows/deploy-public.yml`が`public`へ作る。Claude.ai／Claude DesignなどローカルGitと`gh`を操作できない環境では、公開したと装わず、ローカル変更または差分作成までで止めて引き継ぐ。

## 基本方針

- ユーザーが「分析だけ」「下書き」「公開しない」と指定しない限り、修正、検証、PR、squash merge、デプロイ、本番確認までを一続きで行う。
- `public`は直接編集・push・force pushしない。`main`へのマージを公開の起点にする。
- 小さな変更で全ページを調査しない。対象要素、適用元と上書き元、対象端末、直接の同期先、公開経路に絞る。
- 依頼箇所以外の文言、レイアウト、配色、ブランド表現を変えず、無関係なリファクタリングを混ぜない。
- 画面上のHotfixと、生成器・スキル・監査・CIの改訂は原則として別PRにする。修正を既存端末へ届けるため不可欠な資産版同期など、分けると一時的に壊れる変更だけを同じPRに含め、理由をPR本文へ残す。
- 小規模Hotfixでサブエージェントを増やしすぎない。使う場合は独立した論点だけにし、担当ファイル、成果物、終了条件を固定する。同じ原因調査や同じファイルの編集を重ねず、最終判断、commit、merge、本番確認は主担当が行う。
- PRの必須チェックが通る前にマージしない。デプロイと本番URLを確認する前に「公開完了」と報告しない。

## 作業開始

最初に現在地、リモート、HEAD、未コミット変更、認証、競合し得るPRを確認する。

```bash
pwd
git remote -v
git fetch origin --prune
git status -sb
git branch --show-current
git rev-parse HEAD
gh auth status
gh pr list --state open --json number,title,headRefName,updatedAt,url
```

同じ共通資産、生成テンプレート、資産版を触るPRがある場合だけ対象ファイルと順序を確認する。無関係なPRの調査や完了待ちはしない。既存の作業ツリーに他者の変更があれば、破棄、上書き、stash、一括stage、ブランチ切替をせず、`origin/main`から隔離worktreeを作る。

クリーンな作業ツリーを使える場合は、`main`をfast-forwardして作業ブランチを作る。

```bash
git switch main
git pull --ff-only origin main
git switch -c agent/<短い変更名>
```

## 調査・編集・検証

着手時に「分析のみ／局所修正／新規作成／共通基盤変更／公開運用」を分類する。局所UIは[局所UIの変更](change-local-ui.md)、共通CSS・JS・構造・性能・SPAは[共通資産の変更](change-common-assets.md)、記事は[ブログ記事の追加](add-blog-post.md)、制度・料金は[法令・料金コンテンツの変更](change-legal-content.md)、折り返しは[日本語組版とレスポンシブ](typography-responsive.md)に従う。

検証は次の順に進める。

1. 修正前の対象条件で症状または現状を記録する。
2. 最小差分で変更し、同じ条件と境界幅で対象回帰を行う。
3. 資産版、生成テンプレート、構造化データ、記事一覧、sitemapなど直接の同期先を確認する。
4. 共通CSS・JS、共通テンプレート、生成器、サイト構造を変えた場合だけ全体回帰を行う。

最終差分が変わっていなければ、合格済みの重い検証を繰り返さない。公開前の静的・同期ゲートは必ず実行する。

```bash
node scripts/preflight.mjs
git diff --check
```

`preflight.mjs`が同期不足を示したら、対応する生成・同期コマンドを実行して差分を確認し、再実行する。失敗を無視して公開しない。HTMLの追加・更新・削除時にsitemapを手動確認する場合も、`node gen-sitemap.js`と生成で実行し、`--check`を公開ゲートにしない。本番用sitemapはデプロイ時にマージ後の履歴から作られる。経緯は[sitemapとsquash mergeの事故](incidents/sitemap-squash-date.md)を参照する。

## Commit・push・PR

差分と対象ファイルを確認し、関係するファイルだけを明示的にstageする。

```bash
git status -sb
git diff --stat
git diff
git add -- <対象ファイル>
git diff --cached
git commit -m "<変更内容を表す短い日本語>"
git push -u origin "$(git branch --show-current)"
```

PR本文には「目的または原因」「変更内容」「検証結果」を書く。公開まで依頼されている場合はdraftにしない。

```bash
gh pr create \
  --base main \
  --head "$(git branch --show-current)" \
  --title "<変更内容を表す日本語>" \
  --body-file <PR本文のMarkdownファイル>
PR_NUMBER="$(gh pr view --json number --jq .number)"
gh pr checks "$PR_NUMBER" --watch --interval 30
```

CIの定義と合否条件は`.github/workflows/performance.yml`と各検査スクリプトを正本とする。待機は`gh pr checks --watch`を一つだけ使い、短周期ポーリングを重ねない。失敗時は該当runを特定し、次で失敗ログを読み、同じブランチで原因を直して再検証する。

```bash
gh run view <run-id> --log-failed
```

マージ直前に`origin/main`と未マージPRをもう一度確認する。検証後に`main`が進み、同じファイルまたは共通資産が変わった場合だけ最新`main`へ載せ直し、対象検証とCIを再実行する。

```bash
git fetch origin --prune
gh pr list --state open --json number,title,headRefName,updatedAt,url
gh pr merge "$PR_NUMBER" --squash --delete-branch
```

## デプロイと本番確認

マージ後、今回のPRタイトルとマージSHAに対応する`Deploy public branch`を探し、そのrunだけを待つ。

```bash
gh run list \
  --workflow deploy-public.yml \
  --branch main \
  --limit 3 \
  --json databaseId,headSha,status,conclusion,url,displayTitle
gh run watch <databaseId> --interval 30 --exit-status
```

`.github/workflows/deploy-public.yml`は公開前チェック、sitemap生成、非公開資産の除外、`public`反映を担う。ワークフローが成功する前に完了扱いにせず、失敗時に`public`へ手動force pushして回避しない。

本番はキャッシュを避けるクエリ付きURLで確認する。

```text
https://minano-sr.com/<対象パス>?verify=<日時または変更名>
```

- 対象のスマホ／PC幅で、文言、画像、計算済みCSS、リンク先、横はみ出し、console errorを確認する。
- 共通CSS／JSを変えた場合は、画面だけでなく実際に読み込まれた`href`／`src`の`?v=`が`assets-version.json`と一致することを確認する。
- HTMLを追加・更新・削除した場合は、deploy workflowが本番反映を確認した後、変更した公開URLだけをIndexNowへ一度通知する。通常デプロイ後に手動で重ねて送信しない。

```bash
node scripts/submit-indexnow.mjs --submit <自動送信に失敗した変更URL...>
```

この手動コマンドは自動送信に失敗した場合の復旧用である。初回のサイト全体通知だけはURL省略を許す。HTTP応答の成功は受付完了であり、インデックス登録や検索順位を保証しない。変更のないURLを毎回再送信しない。

完了報告には、本番URL、PR URL、変更点、実行した検証と結果、確認した画面幅を記載する。

## Codex／Claude Codeへ渡す標準プロンプト

角括弧内だけ依頼ごとに差し替える。

```text
このリポジトリの CLAUDE.md を最初に最後まで読み、記載された正本・デザイン・GitHub公開ルールに従ってHPを修正してください。

【変更内容】
[直したい内容を具体的に記載]

【対象ページ・箇所】
[例：トップページのスマホ版ヒーロー／不明なら「画面から特定」]

【対象画面】
[例：スマホのみ。対象幅とブレークポイント前後／PCのみ／全画面]

【維持するもの】
[文言、写真、リンク、PC表示、既存デザインなど]

【完了条件】
[見た目・挙動として満たす条件]

重要:
- 小さな変更は対象箇所だけを調べ、周辺の文言・配色・レイアウトを勝手に変更しないでください。
- 着手時に「局所修正／新規作成／共通基盤変更」を分類し、調査・検証・変更ファイルを伝播範囲に限定してください。
- 画面上のHotfixと生成器・監査・CI・指示書の改訂は、分離できる限り別PRにしてください。
- 既存の実装方法とブランドトークンを優先し、同じ目的の新しい表現を増やしすぎないでください。
- デザイン判断を含む場合は /frontend-design の原則を適用してください。
- 編集前に現状を確認し、変更後は対象幅のスクリーンショット、要素矩形による横はみ出し、console errorを確認してください。
- 変更完了前に /review を実行してください。
- 私が「分析だけ」「下書き」「公開しない」と指定していない限り、作業ブランチ作成、commit、push、PR作成、必須チェック合格確認、mainへのsquash merge、本番デプロイ、本番URL確認まで行ってください。
- PRまたはデプロイが失敗した場合は原因を直して再実行してください。権限・認証・未確定情報で進められない場合だけ、推測せず止めて報告してください。
- 完了報告には、本番URL、PR URL、変更点、検証結果を記載してください。
```

短い依頼では次の一文に変更内容を続けてもよい。

```text
CLAUDE.md と docs/release.md のGitHub公開フローを厳守し、[変更内容]を対象箇所だけ修正してください。検証後、PR作成、必須チェック合格、mainへのsquash merge、本番デプロイ、実サイト確認まで行い、本番URL、PR URL、検証結果を報告してください。
```
