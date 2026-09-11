#!/usr/bin/env node
'use strict';

/**
 * scripts/lib/console-origin.cjs の isForeignConsoleError を、ブラウザーを使わずに確かめる。
 *
 *   node scripts/test-console-origin.cjs
 *
 * 6つの台本（audit-a11y・test-blog-articles・test-final-copy・test-mobile-heading-overflow・
 * test-ui3・verify-ui）は、console のエラーを数えるか捨てるかをこの1関数で決めている。
 * true＝別の配信元なので数えない、false＝数える。判定が逆になると、自分のページのエラーを
 * 見落とす（false→true）か、外部の埋め込みのエラーで CI が赤くなる（true→false）。
 */

const assert = require('node:assert/strict');
const { isForeignConsoleError } = require('./lib/console-origin.cjs');

// Playwright の ConsoleMessage のうち、判定に使う location() だけを持つ見本
function consoleAt(url) {
  return { location: () => ({ url }) };
}

const LOCAL = 'http://127.0.0.1:8811/';
const PROD = 'https://minano-sr.com/';
const MAPS = 'https://www.google.com/maps/embed?pb=!1m18';
// file:// は Node の URL で origin が文字列 'null' になるので、file:// どうしは同じ配信元として数える。
// 手元のファイルを直接開いて測るとき、そのファイル群は自分のサイトなので数えるのが正しい
// （外部の https は捨てる）。5本は base を 'http' で始まる引数からしか取らず、file:// を
// 渡せるのは process.argv[2] をそのまま使う verify-ui.cjs だけ。今の実装の結果をここで固定する。
const FILE_BASE = 'file:///tmp/minano-sr-hp/index.html';

const cases = [
  // [説明, message, base, 期待値]
  ['自分の配信元のファイル（base と同じ origin）は数える', consoleAt('http://127.0.0.1:8811/assets/app.js'), LOCAL, false],
  ['自分の配信元のページ自身（インラインスクリプト）も数える', consoleAt('http://127.0.0.1:8811/about.html'), LOCAL, false],
  ['本番の base で、本番のファイルは数える', consoleAt('https://minano-sr.com/skin-v2.css'), PROD, false],
  ['別の配信元（Google マップの埋め込み）は数えない', consoleAt(MAPS), LOCAL, true],
  ['本番の base でも、別の配信元は数えない', consoleAt(MAPS), PROD, true],
  ['同じホストでもポートが違えば別の配信元なので数えない', consoleAt('http://127.0.0.1:9999/x.js'), LOCAL, true],
  ['同じホスト・同じポートでも http と https は別の配信元', consoleAt('https://127.0.0.1:8811/x.js'), LOCAL, true],
  ['location の url が空なら出所が分からないので数える', consoleAt(''), LOCAL, false],
  ['location() が url を持たないときも数える', { location: () => ({}) }, LOCAL, false],
  ['location 関数が無いメッセージも数える', { text: () => 'error' }, LOCAL, false],
  ['message 自体が無くても落ちずに数える', undefined, LOCAL, false],
  ['location が URL として壊れているときは数える', consoleAt('not a url'), LOCAL, false],
  ['base が URL として壊れているときは数える', consoleAt(MAPS), 'not a url', false],
  ['base が file:// なら、手元のファイルのエラーは数える', consoleAt('file:///tmp/minano-sr-hp/skin-v2.css'), FILE_BASE, false],
  ['base が file:// でも、https の外部は数えない', consoleAt(MAPS), FILE_BASE, true],
];

// 片方の結果しか無い表では、判定が常に同じ値を返す壊れ方を見逃す
assert.ok(cases.some((c) => c[3] === true) && cases.some((c) => c[3] === false), '期待値が片寄っています');

let failed = 0;
for (const [label, message, base, expected] of cases) {
  let actual;
  try {
    actual = isForeignConsoleError(message, base);
    assert.equal(actual, expected);
    console.log(`ok  ${label}`);
  } catch (error) {
    failed += 1;
    console.error(`NG  ${label}: 期待 ${expected}／実際 ${actual}${error.code === 'ERR_ASSERTION' ? '' : `（${error.message}）`}`);
  }
}

if (failed) {
  console.error(`console-origin: ${cases.length}件中${failed}件不合格`);
  process.exit(1);
}
console.log(`console-origin: ${cases.length}件合格`);
