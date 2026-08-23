/**
 * BudouX（日本語モデル）の同梱版。文の中の文節の切れ目を返す。
 *
 * なぜ同梱するのか:
 *   CI（deploy-public.yml）は npm install を挟まずに node scripts/preflight.mjs を走らせる。
 *   package.json も node_modules も無いリポジトリなので、外部依存では --check が動かない。
 *   モデルは21KB・パーサは60行程度で、scripts/ は公開時に削除されるため本番の重さには効かない。
 *
 * 取り込み元: budoux 0.9.0（Google LLC, Apache License 2.0）
 *   parser: budoux/module/parser.js を素のESMへ書き直したもの（式は変えていない）
 *   model : budoux/module/data/models/ja.js の model を budoux-ja-model.json へ書き出したもの
 *   ライセンス全文: https://www.apache.org/licenses/LICENSE-2.0
 *
 * Copyright 2021 Google LLC / Licensed under the Apache License, Version 2.0
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const rawModel = JSON.parse(readFileSync(path.join(here, 'budoux-ja-model.json'), 'utf8'));

const model = new Map(
  Object.entries(rawModel).map(([group, scores]) => [group, new Map(Object.entries(scores))]),
);
const baseScore =
  -0.5 *
  [...model.values()].flatMap((group) => [...group.values()]).reduce((a, b) => a + b, 0);

const GROUPS = [
  ['UW1', -3, -2], ['UW2', -2, -1], ['UW3', -1, 0], ['UW4', 0, 1], ['UW5', 1, 2], ['UW6', 2, 3],
  ['BW1', -2, 0], ['BW2', -1, 1], ['BW3', 0, 2],
  ['TW1', -3, 0], ['TW2', -2, 1], ['TW3', -1, 2], ['TW4', 0, 3],
];

/**
 * 各位置の「切れ目らしさ」。正なら文節の境目。
 * 位置0は使わないので -Infinity を入れておく。
 * @param {string} sentence
 * @returns {number[]}
 */
export function boundaryScores(sentence) {
  const scores = new Array(sentence.length).fill(-Infinity);
  for (let i = 1; i < sentence.length; i += 1) {
    let score = baseScore;
    for (const [name, from, to] of GROUPS) {
      const group = model.get(name);
      if (!group) continue;
      score += group.get(sentence.substring(i + from, i + to)) || 0;
    }
    scores[i] = score;
  }
  return scores;
}

/**
 * 文節の切れ目（文字インデックス）を返す。返るのは 1〜length-1 の範囲。
 * @param {string} sentence
 * @returns {number[]}
 */
export function phraseBoundaries(sentence) {
  if (!sentence) return [];
  const scores = boundaryScores(sentence);
  const result = [];
  for (let i = 1; i < sentence.length; i += 1) if (scores[i] > 0) result.push(i);
  return result;
}

/**
 * 文節へ分ける。確認用。
 * @param {string} sentence
 * @returns {string[]}
 */
export function phrases(sentence) {
  if (!sentence) return [];
  const bounds = phraseBoundaries(sentence);
  const out = [];
  let start = 0;
  for (const b of bounds) {
    out.push(sentence.slice(start, b));
    start = b;
  }
  out.push(sentence.slice(start));
  return out;
}
