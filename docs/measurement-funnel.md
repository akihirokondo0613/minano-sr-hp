# 問い合わせ導線の計測

## 2026-09-19の変更

求人票LPは共通link-keep.jsと専用scriptの両方が成功を計測していたため、GoatCounterの成功・電話タップは共通へ統一した。LPの入力開始・送信操作も共通で記録する。既存の`contact-success:ads-kyujin`を維持し、誤って増えた`contact-success:direct`を止める。

記事内のリンクからサービスへ進む操作は`article-service-click:<記事slug>:<サービスslug>`で記録する。記事とサービスのURLパスだけを使用し、URLクエリやフォーム入力を解析へ送らない。SPAの捕捉段階でも1回記録する。

通常フォームとLPはHTTP200だけで成功とせず、JSONの`success`がboolean trueまたは文字列`true`のときに成功イベントを発火する。空JSON、不正JSON、false、HTTP失敗は成功にしない。受信済みなのに応答だけ届かない可能性があるため、エラー表示では再送前に電話・メールでの確認を案内する。

## 応答仕様の確認根拠と限界

[FormSubmit公式AJAX文書](https://formsubmit.co/ajax-documentation)を2026-09-19に確認。掲載された[公式Fetch例](https://gist.github.com/kesarawimal/53d4308a8234638b88275225c32a11b6)はJSON応答を読み取る実装だが、successの型と全応答パターンを定義したschemaは示していない。

既存の案件記録「給与計算アウトソーシング戦略/00_現在地.md」の2026-09-01実送信確認には`{"success":"true"}`という実応答が記録されている。今回の厳密判定はこの既知の成功形を受け入れる。仕様全体の保証と扱わず、未知の応答を未確認として扱う。新たな実メール送信は行っていない。APIの応答成功と事務所受信・有効相談・受任は別途確認する。

## 指標の読み方

- contact-clickは移動元ページ+from、フォームstart/attempt/successはfrom優先の既存分類。これらの末尾を同一のキーとして機械結合しない。
- LPはads-kyujinを固定分類に使う。名称は既存互換で、実際に広告流入だった証明ではない。受信メールのUTM/gclidと広告管理画面を別途確認する。
- 新イベントは記事→サービスのクリックであり、サービス読了・相談開始・受任を意味しない。個別訪問者を追跡するIDは導入しない。
- Google広告側は既存mn:contact-successの購読を維持。GoatCounterとの数値一致を前提にしない。

## 検証

`node scripts/test-measurement-funnel.cjs`はChromium/WebKitで正本ファイルを本番ホスト名へrouteして操作し、外部計測とFormSubmitを全てstubする。記事→サービス→フォーム、UTM、成功true/boolean、false/空/不正JSON、LP成功1回、アンカーの戻る/進むを検証する。

`page-enter.js`の同一ページ内hash移動は、記事/LP等のhard navigation判定より先に扱う。そうしないとLPのアンカーpopstateから同じhashへlocation.hrefを設定し直すループが起こる。
