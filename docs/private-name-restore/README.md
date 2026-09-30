# 氏名掲載の復元

2026-09-30の氏名非公開変更。復元元SHAは37a6f195fcf43ef7a877ed89631fdf7e2aae0333。
復元元の原文はGitへ含めず、Drive正本の projects/minano-sr-hp/_非公開復元データ/代表者氏名_掲載復元.json に保存する。この手順書とscriptsは本番配信から除外される。復元元をpublicへコピーしない。

復元確認：node scripts/restore-representative-name.mjs --snapshot 非公開の復元データのパス
復元適用：node scripts/restore-representative-name.mjs --snapshot 非公開の復元データのパス --apply
競合があれば全体を変更せず停止する。その後、各生成同期・preflight・表示検証・PR・公開が必要。
構造化データと同時に、verify-ui.cjsの代表者署名の期待値も戻す。
既存記事のSEO観察日をリセットしない。外部プロフィール、過去の検索結果、Git履歴からの特定は防がない。
