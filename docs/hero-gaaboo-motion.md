# gaaboo ヒーロー登場演出の参照根拠

取得時点：2026-10-03。公式公開 HTML・JavaScript・CSS の静的解析による記録。以下の時間はソースの公称値であり、実画面の時刻・FPS は測定していない。

## 今回再現する範囲

通常人物の登場移動・Y 軸回転・透明度・DOM 順の時間差を再現する。鳥・飛行機の例外移動、ブランドの WOW → gaaboo ロゴ導入全体は対象外。人数と人物素材は minano 側で別に設計し、gaaboo の人物画像・ロゴ・アセットはコピーしない。

## ソースで確認した仕様

`top.js` の `O()` は `DOMContentLoaded` から開始する。`helpers.js` の待機関数は秒数を `setTimeout` のミリ秒へ変換する。人物登場までの待機は `0.20 + 0.72 + 0.90 + 0.88 + 0.50 = 3.20 秒`。画像やフォントの読み込み完了を待つ処理、初回限定の storage 判定は当該処理にない。

| 項目 | SP（幅 ≤ 767px） | PC（幅 ≥ 768px） |
| --- | --- | --- |
| 初期位置 | x = 0、y = −600px | x = 0、y = −1200px |
| 終点 | x = 0、y = 0 | x = 0、y = 0 |
| Y 軸回転 | rotateY = −60° → 0° | rotateY = −60° → 0° |
| 移動・回転の時間 | 2.4 秒 | 2.0 秒 |
| 移動・回転の ease | `elastic.out(0.8,1.1)` | 同左 |
| 透明度 | opacity = 0 → 1、160ms、linear（`ease:"none"`） | 同左 |
| 時間差 | DOM 順に 30ms ずつ | 同左 |

通常人物には scale や Z 軸 rotation の指定はない。上方から降りて配置へ収束する弾みは elastic ease による。opacity と移動・回転は同時開始する独立 tween。

## 同梱 GSAP 3.14.1 から導いた等価 ease

`gsap.js` の elastic 設定関数 `Ms()` は amplitude を最低 1 に補正し、入力 amplitude が 1 未満なら period をその値で割る。今回の有効 amplitude は 1、period は `1.1 / 0.8 = 1.375`、位相は period の 1/4 となる。したがって正規化進捗 `t ∈ [0,1]` に対する等価式は次のとおり。

```js
function heroElastic(t) {
  return t === 1
    ? 1
    : 1 - Math.pow(2, -10 * t) * Math.cos((2 * Math.PI * t) / 1.375);
}
```

時間を 2.4 秒／2.0 秒に正規化してこの式へ渡す。終点を 1 に固定する分岐も同梱 GSAP の挙動に対応する。これは静的に導いた数学的な等価式であり、実ブラウザでフレーム単位の一致は未測定。

## 一次資料

- [公開トップ HTML](https://gaaboo.jp/)：module script の参照と、SP／PC の個別イラスト DOM。取得 HTML の 295〜477 行がイラスト、478〜480 行からロゴ stage。
- [現行トップ JavaScript](https://gaaboo.jp/wp/wp-content/themes/gaaboo/assets/js/top.js?ver=1766493868)：圧縮ソース 1 行目の `O()`、末尾の `DOMContentLoaded`。初期値、待機、時間、ease、stagger の根拠。
- [helpers.js](https://gaaboo.jp/wp/wp-content/themes/gaaboo/assets/js/helpers.js)：`w` として export される秒単位の待機関数。
- [view.js](https://gaaboo.jp/wp/wp-content/themes/gaaboo/assets/js/view.js)：`sm` の上限 767px、`md` の下限 768px、`isMobile` と `device` の判定。
- [同梱 gsap.js](https://gaaboo.jp/wp/wp-content/themes/gaaboo/assets/js/gsap.js)：GSAP 3.14.1 のバージョン記載と、elastic の設定関数 `Ms()`。等価 ease の導出根拠。
- [現行 top.css](https://gaaboo.jp/wp/wp-content/themes/gaaboo/assets/css/top.css?ver=1766629964)：`.mv-illust .c-illust` の初期 opacity、PC／SP の表示切替とキャンバス。
- [現行 common.css](https://gaaboo.jp/wp/wp-content/themes/gaaboo/assets/css/common.css?ver=1766573311)：共通イラスト要素と、before／after 画像を重ねる規則。

通常の新しいページ読み込みでは当該 DCL 処理が実行される。再訪の実操作、BFCache 復帰、実機、実画面時刻・FPS は未検証。
