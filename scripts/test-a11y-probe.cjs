#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { probeA11y } = require('./lib/a11y-probe.cjs');

const FIXTURE = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #fff; color: #111; font: 16px/1.5 Arial, sans-serif; }
    .sample { display: block; }
    #srgb { color: color(srgb .65 .65 .65); }
    #display-p3 { color: color(display-p3 .65 .65 .65); }
    #uppercase { color: RGB(170, 170, 170); }
    #rgba-color { color: rgba(0, 0, 0, .5); }
    #actual-failure, #one, .bulk, .same { color: #aaa; }
    #large-pass { color: #777; font-size: 24px; font-weight: 400; }
    #bold-large-pass { color: #777; font-size: 18.67px; font-weight: 700; }
    #normal-size-fail { color: #777; font-size: 23.99px; font-weight: 400; }
    #transparent { color: rgba(0, 0, 0, 0); }
    #zero-owner { opacity: 0; }
    #partial-owner { opacity: .5; }
    #gradient { color: #777; background-image: linear-gradient(#fff, #000); }
    #solid-gradient {
      color: #123f30;
      background-color: #fff;
      background-image: linear-gradient(rgba(46, 158, 99, .42), rgba(46, 158, 99, .42));
      background-position: 0 88%;
      background-size: 100% 30%;
      background-repeat: no-repeat;
    }
    #oklch-gradient {
      color: #123f30;
      background-color: #fff;
      background-image: linear-gradient(oklch(98% .01 145) 0%, oklch(45% .12 145) 100%);
    }
    #underline-gradient {
      display: block;
      width: 180px;
      height: 40px;
      color: #123f30;
      line-height: 16px;
      background-color: #fff;
      background-image: linear-gradient(#2e9e63, #2e9e63);
      background-position: 0 100%;
      background-size: 100% 3px;
      background-repeat: no-repeat;
    }
    #generated::before, #generated::after { color: #aaa; }
    #generated::before { content: "前"; }
    #generated::after { content: "後"; }
    #generated-bg-pass::before {
      content: "可";
      color: #fff;
      background: #000;
    }
    #generated-bg-fail::before {
      content: "不";
      color: #fff;
      background: #fff;
    }
    #generated-bg-partial::before {
      content: "片";
      color: #fff;
      background-color: #fff;
      background-image: linear-gradient(#000, #000);
      background-position: 0 100%;
      background-size: 100% 2px;
      background-repeat: repeat-x;
    }
    #stroke-text {
      color: transparent;
      -webkit-text-stroke: 1px #aaa;
    }
    #photo-area { color: #aaa; background-image: url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="); }
    #ancestor-gradient { background-image: linear-gradient(#123, #456); }
    #opaque-child { color: #000; background: #fff; }
    #filtered { filter: brightness(1); }
    #blended { mix-blend-mode: multiply; }
    #alpha-outer { background: rgba(0, 0, 0, .5); }
    #alpha-inner { color: #000; background: rgba(255, 255, 255, .5); }
    #nav-inline { display: inline; font-size: 10px; line-height: 10px; }
    #target-zone { position: relative; width: 540px; height: 130px; margin-top: 20px; }
    #target-zone a, #target-zone button {
      position: absolute;
      display: block;
      margin: 0;
      padding: 0;
      border: 0;
      color: #000;
      background: #fff;
      font: 10px/1 Arial, sans-serif;
      text-decoration: none;
    }
    #size-pass { left: 0; top: 40px; width: 24px; height: 24px; }
    #spacing-pass { left: 60px; top: 40px; width: 10px; height: 10px; }
    #spacing-fail-a { left: 120px; top: 40px; width: 10px; height: 10px; }
    #spacing-fail-b { left: 138px; top: 40px; width: 10px; height: 10px; }
    #small-near-normal { left: 208px; top: 47px; width: 8px; height: 8px; }
    #normal-near { left: 220px; top: 40px; width: 24px; height: 24px; }
    #disabled-small { left: 285px; top: 40px; width: 10px; height: 10px; }
    #aria-disabled-small { left: 320px; top: 40px; width: 10px; height: 10px; }
    #spacing-rect-a { left: 360px; top: 40px; width: 8px; height: 8px; }
    #spacing-rect-b { left: 371px; top: 40px; width: 40px; height: 8px; }
    #aria-hidden-visible { left: 460px; top: 40px; width: 10px; height: 10px; }
    #gap-four-a { left: 0; top: 90px; width: 20px; height: 20px; }
    #gap-four-b { left: 24px; top: 90px; width: 20px; height: 20px; }
    #gap-three-a { left: 100px; top: 90px; width: 20px; height: 20px; }
    #gap-three-b { left: 123px; top: 90px; width: 20px; height: 20px; }
    #inline-collision-zone { font-size: 10px; line-height: 10px; }
    #inline-obstacle { display: inline; }
    #small-near-inline {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin: 0;
      padding: 0;
      border: 0;
    }
    #extra-targets { display: flex; align-items: flex-start; gap: 30px; margin: 30px 0; }
    #extra-targets > *, #extra-targets summary {
      display: block;
      flex: 0 0 24px;
      width: 24px;
      min-width: 24px;
      height: 24px;
      margin: 0;
      padding: 0;
    }
    #zero-target { display: block; width: 0; height: 0; overflow: hidden; }
    #input-target { color: #aaa; background: #fff; border: 0; }
    #placeholder-fail { background: #fff; }
    #placeholder-fail::placeholder { color: #aaa; opacity: 1; }
    #placeholder-opacity, #placeholder-hidden { background: #fff; }
    #placeholder-opacity::placeholder { color: #000; opacity: .5; }
    #placeholder-hidden::placeholder { color: #aaa; opacity: 1; }
    #target-edge-cases {
      position: relative;
      width: 620px;
      height: 100px;
      margin: 50px 0;
    }
    #target-edge-cases > * {
      position: absolute;
      display: block;
      width: 10px;
      height: 10px;
      margin: 0;
      padding: 0;
      border: 0;
      color: #000;
      background: #fff;
      font: 10px/1 Arial, sans-serif;
      text-decoration: none;
    }
    #circle-24 {
      left: 0;
      top: 35px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
    }
    #overlap-24-a { left: 80px; top: 35px; width: 24px; height: 24px; }
    #overlap-24-b { left: 88px; top: 35px; width: 24px; height: 24px; }
    #pseudo-expanded { left: 180px; top: 42px; position: absolute; }
    #pseudo-expanded::before {
      content: "";
      position: absolute;
      left: -7px;
      top: -7px;
      width: 24px;
      height: 24px;
      pointer-events: auto;
    }
    #pointer-none { left: 260px; top: 42px; pointer-events: none; }
    #opacity-target { left: 340px; top: 42px; opacity: 0; }
    #role-checkbox-target { left: 420px; top: 35px; width: 24px; height: 24px; }
    #implicit-label { left: 520px; top: 35px; width: 24px; height: 24px; }
    #implicit-control { pointer-events: none; }
    #near-implicit-label { left: 540px; top: 42px; width: 10px; height: 10px; }
    #nonprose-inline { display: inline; font-size: 10px; line-height: 10px; }
    #prose-inline-block { display: inline-block; font-size: 10px; line-height: 10px; }
    #disabled-fieldset { margin: 50px 0; }
  </style>
</head>
<body>
  <main id="fixture" data-component="fixture">
    <span id="srgb" class="sample">sRGB</span>
    <span id="display-p3" class="sample">P3</span>
    <span id="uppercase" class="sample">UPPER</span>
    <span id="rgba-color" class="sample">RGBA</span>
    <span id="actual-failure" class="sample">実違反</span>
    <span id="one" class="sample">一</span>
    <span id="large-pass" class="sample">大きな文字</span>
    <span id="bold-large-pass" class="sample">太字の大きな文字</span>
    <span id="normal-size-fail" class="sample">通常サイズの文字</span>
    <span id="transparent" class="sample">透明</span>
    <div aria-hidden="true"><span id="aria-hidden-text">装飾</span></div>
    <div id="zero-owner"><span id="opacity-zero-text">不可視</span></div>
    <div id="partial-owner"><span id="partial-opacity-text">半透明</span></div>
    <span id="gradient" class="sample">グラデーション</span>
    <span id="solid-gradient" class="sample">単色マーカー</span>
    <span id="oklch-gradient" class="sample">色空間つきグラデーション</span>
    <span id="underline-gradient" class="sample">文字に触れない下線</span>
    <span id="generated" class="sample">本体</span>
    <span id="generated-bg-pass" class="sample"></span>
    <span id="generated-bg-fail" class="sample"></span>
    <span id="generated-bg-partial" class="sample"></span>
    <span id="stroke-text" class="sample">縁取り文字</span>
    <div id="photo-area"><span id="photo-child">写真測定へ委譲</span></div>
    <div id="ancestor-gradient"><span id="opaque-child" class="sample">不透明な子</span></div>
    <span id="filtered" class="sample">フィルター</span>
    <span id="blended" class="sample">ブレンド</span>
    <div id="alpha-outer"><span id="alpha-inner" class="sample">二層</span></div>
    <div id="no-direct-parent"><span id="direct-child">子だけ</span></div>
    <div id="bulk"></div>
    <span class="same sample">同級一</span><span class="same sample">同級二</span>
    <p>文章中の<a id="inline-link" href="#inline">インライン</a>リンク</p>
    <nav><p>ナビ内の<a id="nav-inline" href="#nav-inline">短いリンク</a>文章</p></nav>
    <div id="target-zone">
      <button id="size-pass">A</button>
      <a id="spacing-pass" href="#spacing-pass">B</a>
      <button id="spacing-fail-a">C</button>
      <a id="spacing-fail-b" href="#spacing-fail-b">D</a>
      <button id="small-near-normal">E</button>
      <a id="normal-near" href="#normal-near">F</a>
      <button id="disabled-small" disabled>G</button>
      <a id="aria-disabled-small" href="#disabled" aria-disabled="true">H</a>
      <button id="spacing-rect-a">I</button>
      <a id="spacing-rect-b" href="#spacing-rect-b">J</a>
      <button id="aria-hidden-visible" aria-hidden="true">K</button>
      <button id="gap-four-a">L</button>
      <button id="gap-four-b">M</button>
      <button id="gap-three-a">N</button>
      <button id="gap-three-b">O</button>
    </div>
    <p id="inline-collision-zone">文章<a id="inline-obstacle" href="#inline-obstacle">本文リンク</a><button id="small-near-inline">P</button>続き</p>
    <div id="extra-targets">
      <input id="input-target" type="button" value="I">
      <select id="select-target" aria-label="選択"><option>1</option></select>
      <textarea id="textarea-target" aria-label="入力"></textarea>
      <details><summary id="summary-target">S</summary></details>
      <label id="label-target" for="input-target">L</label>
      <div id="role-button-target" role="button" tabindex="0">B</div>
      <span id="role-link-target" role="link" tabindex="0">R</span>
      <input id="placeholder-fail" type="text" placeholder="入力例">
      <input id="placeholder-opacity" type="text" placeholder="半透明の入力例">
      <input id="placeholder-hidden" type="text" value="入力済み" placeholder="表示されない入力例">
    </div>
    <div id="target-edge-cases">
      <button id="circle-24">円</button>
      <button id="overlap-24-a">重</button>
      <a id="overlap-24-b" href="#overlap-24-b">複</a>
      <button id="pseudo-expanded">擬</button>
      <button id="pointer-none">無</button>
      <button id="opacity-target">透</button>
      <span id="role-checkbox-target" role="checkbox" tabindex="0" aria-checked="false">選</span>
      <label id="implicit-label"><input id="implicit-control" type="checkbox">暗</label>
      <button id="near-implicit-label">別</button>
    </div>
    <div id="nonprose-inline-wrap"><a id="nonprose-inline" href="#nonprose">非文章リンク</a></div>
    <p>文章中の<a id="prose-inline-block" href="#prose-inline-block">inline-blockリンク</a>です。</p>
    <fieldset id="disabled-fieldset" disabled>
      <input id="fieldset-disabled-control" type="checkbox">
      <label id="fieldset-disabled-label" for="fieldset-disabled-control">無効な選択</label>
    </fieldset>
    <svg id="svg-targets" width="40" height="40" viewBox="0 0 40 40" aria-label="SVG操作対象">
      <a id="svg-link" href="#svg-link"><rect x="4" y="4" width="32" height="32"></rect></a>
    </svg>
    <span id="zero-target" role="button" tabindex="0">Z</span>
  </main>
  <script>
    document.querySelector('#bulk').innerHTML = Array.from(
      { length: 25 },
      (_, index) => '<span class="bulk sample">違反' + (index + 1) + '</span>',
    ).join('');
  </script>
</body>
</html>`;

const ENGINES = [
  ['chromium', chromium],
  ['webkit', webkit],
];

function bySelector(items, selector) {
  return items.find((item) => item.selector === selector);
}

function assertIdentityFields(item, engine) {
  for (const field of ['nodeIndex', 'path', 'component', 'selector', 'key']) {
    assert.notEqual(item[field], undefined, `${engine}: findingに${field}がありません`);
  }
}

async function runEngine(engine, browserType) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    await page.setContent(FIXTURE, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(probeA11y, {
      aaNormal: 4.5,
      aaLarge: 3,
      targetSize: 24,
      overflowTolerance: 1,
      photoSelectors: ['#photo-area'],
    });

    assert.equal(result.pageScrollsHorizontally, 0, `${engine}: 横スクロールが発生しました`);
    assert.equal(result.overflowCount, 0, `${engine}: 要素が横にはみ出しました`);

    const srgbFailure = bySelector(result.contrast, 'span#srgb.sample');
    assert.ok(srgbFailure, `${engine}: color(srgb)を測定できません`);
    assert.match(
      srgbFailure.foreground,
      /^rgba\(16[56], 16[56], 16[56], 1\)$/,
      `${engine}: color(srgb .65 .65 .65)を0〜255のsRGBへ変換できません`,
    );
    assert.ok(
      srgbFailure.ratio > 2 && srgbFailure.ratio < 3,
      `${engine}: color(srgb)の比率が不正です（${srgbFailure.ratio}）`,
    );
    assert.ok(bySelector(result.contrast, 'span#display-p3.sample'), `${engine}: color(display-p3)を測定できません`);
    assert.ok(bySelector(result.contrast, 'span#uppercase.sample'), `${engine}: 大文字RGBの違反を検出できません`);
    assert.ok(bySelector(result.contrast, 'span#rgba-color.sample'), `${engine}: rgbaを測定できません`);
    assert.ok(bySelector(result.contrast, 'span#actual-failure.sample'), `${engine}: 実違反を検出できません`);
    assert.ok(bySelector(result.contrast, 'span#one.sample'), `${engine}: 直接テキスト1文字を検出できません`);
    assert.equal(
      bySelector(result.contrastResults, 'span#large-pass.sample')?.need,
      3,
      `${engine}: 24px文字へ3:1基準を適用できません`,
    );
    assert.equal(
      bySelector(result.contrastResults, 'span#large-pass.sample')?.outcome,
      'pass',
      `${engine}: 大きな文字の3:1適合を判定できません`,
    );
    assert.equal(
      bySelector(result.contrastResults, 'span#bold-large-pass.sample')?.need,
      3,
      `${engine}: 18.67px太字へ3:1基準を適用できません`,
    );
    assert.equal(
      bySelector(result.contrast, 'span#normal-size-fail.sample')?.need,
      4.5,
      `${engine}: 24px未満の通常文字へ4.5:1基準を適用できません`,
    );

    const bulkFailures = result.contrast.filter((item) => item.selector === 'span.bulk.sample');
    assert.equal(bulkFailures.length, 25, `${engine}: 25件の違反が切り捨てられました`);

    const sameClass = result.contrast.filter((item) => item.selector === 'span.same.sample');
    assert.equal(sameClass.length, 2, `${engine}: 同class兄弟を2件測定できません`);
    assert.notEqual(sameClass[0].nodeIndex, sameClass[1].nodeIndex, `${engine}: nodeIndexが衝突しました`);
    assert.notEqual(sameClass[0].path, sameClass[1].path, `${engine}: pathが衝突しました`);
    assert.notEqual(sameClass[0].key, sameClass[1].key, `${engine}: keyが衝突しました`);

    const excludedSelectors = new Set([
      ...result.contrast,
      ...result.contrastResults,
      ...result.contrastUnresolved,
    ].map((item) => item.selector));
    assert.ok(!excludedSelectors.has('span#aria-hidden-text'), `${engine}: aria-hiddenを除外できません`);
    assert.ok(!excludedSelectors.has('span#opacity-zero-text'), `${engine}: 祖先opacity:0を除外できません`);
    assert.ok(!excludedSelectors.has('span#transparent.sample'), `${engine}: 透明文字を除外できません`);
    assert.ok(!excludedSelectors.has('button#disabled-small'), `${engine}: disabled操作要素の文字を除外できません`);
    assert.ok(!excludedSelectors.has('a#aria-disabled-small'), `${engine}: aria-disabled操作要素の文字を除外できません`);
    assert.ok(!excludedSelectors.has('div#no-direct-parent'), `${engine}: 直接テキストのない親を測定しました`);
    assert.ok(bySelector(result.contrastResults, 'span#direct-child'), `${engine}: 直接テキストの子を測定できません`);

    assert.equal(
      bySelector(result.contrastUnresolved, 'span#gradient.sample')?.reason,
      'complex-background',
      `${engine}: gradientを算出不能にできません`,
    );
    assert.ok(
      bySelector(result.contrastResults, 'span#solid-gradient.sample'),
      `${engine}: 同色2stopのマーカーを測定できません`,
    );
    assert.equal(
      bySelector(result.contrastUnresolved, 'span#oklch-gradient.sample')?.reason,
      'complex-background',
      `${engine}: stop位置つきoklch gradientを単色背景として誤合格にしました`,
    );
    const underlineGradient = bySelector(result.contrastResults, 'span#underline-gradient.sample');
    assert.ok(underlineGradient, `${engine}: 文字に触れない3px下線gradientを測定できません`);
    assert.match(
      underlineGradient.bg,
      /^rgba\(255, 255, 255, 1\)$/,
      `${engine}: 文字に触れない3px下線gradientを文字背景として扱いました`,
    );
    assert.ok(
      bySelector(result.contrast, 'span#generated.sample::before'),
      `${engine}: ::beforeの生成文字を監査できません`,
    );
    assert.ok(
      bySelector(result.contrast, 'span#generated.sample::after'),
      `${engine}: ::afterの生成文字を監査できません`,
    );
    const generatedBackgroundPass = bySelector(
      result.contrastResults,
      'span#generated-bg-pass.sample::before',
    );
    assert.equal(
      generatedBackgroundPass?.outcome,
      'pass',
      `${engine}: ::before自身の黒背景を無視しました`,
    );
    assert.match(
      generatedBackgroundPass?.bg || '',
      /^rgba\(0, 0, 0, 1\)$/,
      `${engine}: ::before自身の背景色を取得できません`,
    );
    assert.ok(
      bySelector(result.contrast, 'span#generated-bg-fail.sample::before'),
      `${engine}: ::beforeの白文字・白背景を検出できません`,
    );
    assert.equal(
      bySelector(result.contrastUnresolved, 'span#generated-bg-partial.sample::before')?.reason,
      'complex-pseudo-background-geometry',
      `${engine}: ::beforeの下端だけに置いたrepeat-x画像を全面背景と誤判定しました`,
    );
    assert.ok(
      bySelector(result.contrast, 'span#stroke-text.sample'),
      `${engine}: 透明fillとtext-strokeの文字を監査できません`,
    );
    assert.ok(
      bySelector(result.contrast, 'input#input-target::value'),
      `${engine}: input buttonのvalue文字を監査できません`,
    );
    assert.ok(
      !bySelector(result.contrastResults, 'span#photo-child')
        && !bySelector(result.contrastUnresolved, 'span#photo-child'),
      `${engine}: 写真測定対象を通常背景の監査へ重複計上しました`,
    );
    assert.ok(
      bySelector(result.contrast, 'input#placeholder-fail::placeholder'),
      `${engine}: placeholder文字のコントラスト不足を検出できません`,
    );
    const translucentPlaceholder = bySelector(result.contrast, 'input#placeholder-opacity::placeholder');
    assert.ok(translucentPlaceholder, `${engine}: 表示中placeholderを監査できません`);
    assert.ok(
      translucentPlaceholder.ratio > 3.8 && translucentPlaceholder.ratio < 4.1,
      `${engine}: placeholderのopacityを前景色へ反映できません（${translucentPlaceholder.ratio}）`,
    );
    const allContrastSelectors = new Set([
      ...result.contrast,
      ...result.contrastResults,
      ...result.contrastUnresolved,
    ].map((item) => item.selector));
    assert.ok(
      !allContrastSelectors.has('input#placeholder-hidden::placeholder'),
      `${engine}: 値入力済みで非表示のplaceholderを監査へ含めました`,
    );
    assert.equal(
      bySelector(result.contrastUnresolved, 'span#partial-opacity-text')?.reason,
      'partial-opacity',
      `${engine}: 0<opacity<1を算出不能にできません`,
    );
    assert.equal(
      bySelector(result.contrastUnresolved, 'span#filtered.sample')?.reason,
      'filter',
      `${engine}: filterを算出不能にできません`,
    );
    assert.equal(
      bySelector(result.contrastUnresolved, 'span#blended.sample')?.reason,
      'mix-blend-mode',
      `${engine}: mix-blend-modeを算出不能にできません`,
    );

    const alphaLayers = bySelector(result.contrastResults, 'span#alpha-inner.sample');
    assert.ok(alphaLayers, `${engine}: 半透明2層を測定できません`);
    const channels = alphaLayers.bg.match(/[\d.]+/g).map(Number);
    assert.ok(
      channels.slice(0, 3).every((channel) => Math.abs(channel - 191) <= 2),
      `${engine}: source-overの背景値が不正です（${alphaLayers.bg}）`,
    );
    assert.ok(
      bySelector(result.contrastResults, 'span#opaque-child.sample'),
      `${engine}: 不透明な子の背後にある祖先gradientで誤って算出不能になりました`,
    );

    assert.equal(result.contrastCounts.consistent, true, `${engine}: contrast件数の恒等式が崩れました`);
    assert.equal(result.contrast.length, result.contrastCounts.failed, `${engine}: contrast失敗件数が不一致です`);
    assert.equal(result.contrastResults.length, result.contrastCounts.measured, `${engine}: contrast実測件数が不一致です`);
    assert.equal(result.contrastUnresolved.length, result.contrastCounts.unresolved, `${engine}: contrast未解決件数が不一致です`);
    assert.equal(
      result.contrastCounts.scanned,
      result.contrastCounts.excluded
        + result.contrastCounts.unresolved
        + result.contrastCounts.passed
        + result.contrastCounts.failed,
      `${engine}: contrast scannedの分類合計が一致しません`,
    );

    const sizePass = bySelector(result.targetResults, 'button#size-pass');
    const spacingPass = bySelector(result.targetResults, 'a#spacing-pass');
    const spacingFailA = bySelector(result.targets, 'button#spacing-fail-a');
    const spacingFailB = bySelector(result.targets, 'a#spacing-fail-b');
    const nearNormal = bySelector(result.targets, 'button#small-near-normal');
    const rectCollision = bySelector(result.targets, 'button#spacing-rect-a');
    const gapFourA = bySelector(result.targetResults, 'button#gap-four-a');
    const gapFourB = bySelector(result.targetResults, 'button#gap-four-b');
    const gapThreeA = bySelector(result.targets, 'button#gap-three-a');
    const gapThreeB = bySelector(result.targets, 'button#gap-three-b');
    const circle24 = bySelector(result.targetResults, 'button#circle-24');
    const overlap24A = bySelector(result.targets, 'button#overlap-24-a');
    const overlap24B = bySelector(result.targets, 'a#overlap-24-b');
    const pseudoExpanded = bySelector(result.targetResults, 'button#pseudo-expanded');
    const implicitLabel = bySelector(result.targets, 'label#implicit-label');
    const nearImplicitLabel = bySelector(result.targets, 'button#near-implicit-label');
    assert.equal(sizePass?.outcome, 'size-pass', `${engine}: 24px targetを合格にできません`);
    assert.equal(spacingPass?.outcome, 'spacing-pass', `${engine}: spacing例外を合格にできません`);
    assert.equal(spacingFailA?.outcome, 'fail', `${engine}: small-target同士の交差を検出できません`);
    assert.equal(spacingFailB?.outcome, 'fail', `${engine}: small-target同士の相互交差を検出できません`);
    assert.equal(nearNormal?.outcome, 'fail', `${engine}: 通常target矩形との交差を検出できません`);
    assert.ok(
      rectCollision?.collisions.some((collision) => collision.kinds.includes('target-rectangle')),
      `${engine}: 小targetの実rectとの交差を検出できません`,
    );
    assert.equal(gapFourA?.outcome, 'spacing-pass', `${engine}: 20px targetの4px間隔を合格にできません`);
    assert.equal(gapFourB?.outcome, 'spacing-pass', `${engine}: 20px targetの4px間隔を相互に合格にできません`);
    assert.equal(gapThreeA?.outcome, 'fail', `${engine}: 20px targetの3px間隔を検出できません`);
    assert.equal(gapThreeB?.outcome, 'fail', `${engine}: 20px targetの3px間隔を相互に検出できません`);
    assert.equal(circle24?.outcome, 'spacing-pass', `${engine}: 24px円をsize-passにしてはいけません`);
    assert.equal(overlap24A?.outcome, 'fail', `${engine}: 異なるactionの24px target重なりを検出できません`);
    assert.equal(overlap24B?.outcome, 'fail', `${engine}: 異なるactionの24px target重なりを相互検出できません`);
    assert.equal(pseudoExpanded?.outcome, 'size-pass', `${engine}: 疑似要素で24pxへ拡張したhit領域を合格にできません`);
    assert.equal(implicitLabel?.outcome, 'fail', `${engine}: 暗黙labelと別actionの重なりを検出できません`);
    assert.equal(nearImplicitLabel?.outcome, 'fail', `${engine}: 暗黙labelに近接する小targetを検出できません`);

    const targetSelectors = new Set(result.targetResults.map((item) => item.selector));
    const classifiedTargetSelectors = new Set([
      ...result.targetResults,
      ...result.targetUnresolved,
    ].map((item) => item.selector));
    assert.ok(!targetSelectors.has('a#inline-link'), `${engine}: インラインリンクを除外できません`);
    assert.ok(!targetSelectors.has('a#inline-obstacle'), `${engine}: 衝突相手のInlineリンクを寸法監査へ含めました`);
    assert.ok(!targetSelectors.has('button#small-near-inline'), `${engine}: 文章中のinline-block buttonをInline例外にできません`);
    assert.ok(!targetSelectors.has('button#disabled-small'), `${engine}: disabled buttonを除外できません`);
    assert.ok(targetSelectors.has('a#aria-disabled-small'), `${engine}: aria-disabled単独で操作targetを除外しました`);
    assert.ok(targetSelectors.has('a#nav-inline'), `${engine}: nav内inline targetを誤って除外しました`);
    assert.ok(targetSelectors.has('button#aria-hidden-visible'), `${engine}: 可視aria-hidden targetを誤って除外しました`);
    assert.ok(targetSelectors.has('button#opacity-target'), `${engine}: opacity:0だけで操作targetを除外しました`);
    assert.ok(!classifiedTargetSelectors.has('button#pointer-none'), `${engine}: pointer-events:none targetを除外できません`);
    assert.ok(targetSelectors.has('a#nonprose-inline'), `${engine}: 文章外のinline linkを誤ってInline例外にしました`);
    assert.ok(!classifiedTargetSelectors.has('a#prose-inline-block'), `${engine}: 文章内inline-block linkをInline例外にできません`);
    assert.ok(targetSelectors.has('span#role-checkbox-target'), `${engine}: role=checkboxをtarget監査できません`);
    assert.ok(targetSelectors.has('label#implicit-label'), `${engine}: 暗黙labelをtarget監査できません`);
    assert.ok(!classifiedTargetSelectors.has('input#implicit-control'), `${engine}: labelで操作するpointer-events:noneのcontrolを重複監査しました`);
    assert.ok(!classifiedTargetSelectors.has('input#fieldset-disabled-control'), `${engine}: disabled fieldset配下のcontrolを除外できません`);
    assert.ok(!classifiedTargetSelectors.has('label#fieldset-disabled-label'), `${engine}: disabled controlに関連するlabelを除外できません`);
    for (const selector of [
      'input#input-target',
      'select#select-target',
      'textarea#textarea-target',
      'summary#summary-target',
      'label#label-target',
      'div#role-button-target',
      'span#role-link-target',
    ]) assert.ok(targetSelectors.has(selector), `${engine}: ${selector}をtarget監査できません`);
    assert.equal(
      bySelector(result.targetUnresolved, 'span#zero-target')?.reason,
      'zero-geometry',
      `${engine}: 0矩形targetを未解決として記録できません`,
    );
    assert.equal(
      bySelector(result.targetUnresolved, 'a#svg-link')?.reason,
      'complex-target-shape',
      `${engine}: SVG linkをscannedかつ未解決として記録できません`,
    );
    assert.ok(
      spacingFailA.rects.length > 0 && spacingFailB.rects.length > 0,
      `${engine}: getClientRectsを保持できません`,
    );
    assert.equal(result.targetCounts.consistent, true, `${engine}: target件数の恒等式が崩れました`);
    assert.equal(result.targets.length, result.targetCounts.failed, `${engine}: target失敗件数が不一致です`);
    assert.equal(result.targetResults.length, result.targetCounts.eligible, `${engine}: target実測件数が不一致です`);
    assert.equal(result.targetUnresolved.length, result.targetCounts.unresolved, `${engine}: target未解決件数が不一致です`);
    assert.equal(
      result.targetCounts.scanned,
      result.targetCounts.excluded + result.targetCounts.unresolved + result.targetCounts.eligible,
      `${engine}: target scannedの分類合計が一致しません`,
    );

    for (const item of [
      ...result.contrast,
      ...result.contrastUnresolved,
      ...result.targets,
      ...result.targetUnresolved,
      ...result.overflow,
    ]) assertIdentityFields(item, engine);

    console.log(
      `${engine}: pass `
      + `(contrast scanned=${result.contrastCounts.scanned}, failed=${result.contrastCounts.failed}, `
      + `unresolved=${result.contrastCounts.unresolved}; targets scanned=${result.targetCounts.scanned}, `
      + `failed=${result.targetCounts.failed})`,
    );
  } finally {
    await browser.close();
  }
}

(async () => {
  for (const [engine, browserType] of ENGINES) await runEngine(engine, browserType);
  console.log('a11y probe: Chromium / WebKit 2エンジン合格');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
