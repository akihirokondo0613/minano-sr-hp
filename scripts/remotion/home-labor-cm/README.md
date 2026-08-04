# みなの社労士 15秒CM

HPトップ用の固定16:9広告を、Remotionでローカル再生成するプロジェクトです。
人物イラストを揺らさず、書類・時計・チェック・一本線だけを意味のある箇所で動かします。

## 仕様

- Composition: `MinanoLaborCm15`
- 1280×720 / 30fps / 450フレーム（15秒）
- H.264映像 + AACステレオ音声
- 5区間のナレーション、120 BPMの自作BGM、12個の自作効果音
- 音声と同期した焼き込み字幕
- カメラ揺れなし、外周48px以上の安全域
- CTAは最終2.5秒以上保持し、退出アニメーションなし

## 再生成

```bash
npm install
python3 scripts/generate_audio.py
python3 scripts/generate_voicevox_voiceover.py
npm run typecheck
npm run render
```

ナレーションの再生成前に、ローカルのVOICEVOX Engineを
`http://127.0.0.1:50021`で起動してください。既定話者は冥鳴ひまり（style id 14）です。

生成後、HP配信用MP4はfaststart付きで次へ配置します。

```bash
ffmpeg -i out/home-labor-cm-15s-v2.mp4 \
  -vf "scale=in_range=full:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a copy -movflags +faststart \
  ../../../assets/video/home-labor-cm-15s-v2.mp4
```

## 音声・素材の権利

- ナレーション: `VOICEVOX:冥鳴ひまり`。公開時はこの表記を動画内または周辺に残す。
- BGM・効果音: `scripts/generate_audio.py`による決定的な波形合成。外部音源なし。
- イラスト: ユーザー提供の既存HP素材。
- Remotion: 現在の利用主体・人数が無料商用枠の条件内か、公開時に公式条件を再確認する。

参照した利用条件（2026-08-04確認）:

- https://voicevox.hiroshiba.jp/term/
- https://www.meimeihimari.com/terms-of-use
- https://www.remotion.dev/license

詳細は `asset-manifest.json`、`audio-cue-sheet.json`、`storyboard.md` を参照してください。

## 最終QA（2026-08-04）

- MP4: 15.061秒 / 1,042,295 bytes / SHA-256 `490edfa4...872879a`
- 映像: H.264 1280×720 / 30fps / yuv420p limited-range BT.709
- 音声: AAC-LC 48kHz stereo / -18.6 LUFS-I / -5.7 dBTP
- 全450フレームと音声をffmpegで全デコード済み
- Chromium・WebKit、320〜1440pxで16:9枠・はみ出し・遅延読込みを回帰検査する
