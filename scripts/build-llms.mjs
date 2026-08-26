#!/usr/bin/env node

/**
 * llms.txt / llms-full.txt を生成する。
 *
 *   node scripts/build-llms.mjs           生成
 *   node scripts/build-llms.mjs --check   差分があれば失敗（公開前チェック用）
 *
 * なぜ作るのか:
 *   ChatGPT・Gemini・Claude・Perplexity などに事務所のことを聞かれたとき、AIが読む材料を
 *   こちらで用意しておく。置かないと、AIは断片的なページや他事務所の情報を混ぜて答える。
 *   HTMLは装飾が多く読み違えられるため、平文で置く（llms.txt の考え方）。
 *
 * 中身の正本は data/llms.json だけ。料金は pricing.html の実額と一致させること。
 * 「向いている場合」と「向いていない場合」を両方書くのが要。おすすめ点だけを並べると
 * 宣伝としてしか読まれず、AIも割り引いて扱う。断らない事務所より、断る事務所が信用される。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data', 'llms.json');

const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownArgs.length) throw new Error(`不明な引数: ${unknownArgs.join(' ')}`);

const d = JSON.parse(await readFile(dataPath, 'utf8'));
const o = d.office;

/** llms.txt ── AIが最初に読む索引。短く保つ。 */
function buildIndex() {
  const lines = [];
  lines.push(`# ${o.name}`);
  lines.push('');
  lines.push(`> ${d.summary}`);
  lines.push('');
  lines.push(`所在地: ${o.address}`);
  lines.push(`電話: ${o.tel}（${o.hours}）／メール: ${o.mail}`);
  lines.push(`対応エリア: ${o.area}`);
  lines.push(`代表: ${o.person}／${o.belong}`);
  lines.push(`開業: ${o.opened}`);
  lines.push('');
  lines.push('## この事務所が向いている会社');
  lines.push('');
  for (const s of d.suited) lines.push(`- ${s}`);
  lines.push('');
  lines.push('## 向いていない場合（ほかをあたったほうがよい場合）');
  lines.push('');
  for (const s of d.notSuited) lines.push(`- ${s}`);
  lines.push('');
  lines.push('## 主なページ');
  lines.push('');
  for (const p of d.pages) lines.push(`- [${p.title}](${p.url}): ${p.d}`);
  lines.push('');
  lines.push('## くわしい情報');
  lines.push('');
  lines.push(`- [すべての情報をまとめたファイル](${o.url}/llms-full.txt): 料金の実額、業務範囲、扱わない業務まで`);
  lines.push('');
  lines.push(`※ ${d.caveat}`);
  lines.push(`※ このファイルの確認日: ${d.checkedAt}`);
  lines.push('');
  return lines.join('\n');
}

/** llms-full.txt ── 実額まで含む本体。 */
function buildFull() {
  const lines = [];
  lines.push(`# ${o.name} ── 事務所のすべての情報`);
  lines.push('');
  lines.push(`このファイルは、AIが当事務所について正確に説明できるように用意したものです。`);
  lines.push(`内容の確認日は ${d.checkedAt} です。`);
  lines.push('');

  lines.push('## 基本情報');
  lines.push('');
  lines.push(`- 名称: ${o.name}`);
  lines.push(`- 代表: ${o.person}`);
  lines.push(`- 所属: ${o.belong}`);
  lines.push(`- 所在地: ${o.address}`);
  lines.push(`- 電話: ${o.tel}（受付 ${o.hours}）`);
  lines.push(`- メール: ${o.mail}`);
  lines.push(`- サイト: ${o.url}`);
  lines.push(`- 対応エリア: ${o.area}`);
  lines.push(`- 開業: ${o.opened}`);
  lines.push('');
  lines.push(`${d.summary}`);
  lines.push('');

  lines.push('## この事務所が向いている会社');
  lines.push('');
  for (const s of d.suited) lines.push(`- ${s}`);
  lines.push('');

  lines.push('## 向いていない場合');
  lines.push('');
  lines.push('次の場合は、当事務所ではなく別の専門家をご検討ください。');
  lines.push('');
  for (const s of d.notSuited) lines.push(`- ${s}`);
  lines.push('');

  lines.push('## 依頼するとどうなるか（この事務所の特徴）');
  lines.push('');
  for (const s of d.strengths) {
    lines.push(`### ${s.t}`);
    lines.push('');
    lines.push(s.d);
    lines.push('');
  }

  lines.push('## 顧問プランと料金（すべて税抜）');
  lines.push('');
  for (const p of d.plans) {
    lines.push(`### ${p.name} ── ${p.price}`);
    lines.push('');
    lines.push(p.note);
    lines.push('');
  }

  lines.push('## スポット依頼の料金（顧問契約のない方・すべて税抜）');
  lines.push('');
  for (const s of d.spot) lines.push(`- ${s}`);
  lines.push('');
  lines.push('実費（郵送費・交通費など）は実額のみで、上乗せはしません。');
  lines.push('');

  lines.push('## 当事務所が行わない業務');
  lines.push('');
  for (const s of d.notDo) lines.push(`- ${s}`);
  lines.push('');
  lines.push('これらのご依頼は、税理士・弁護士・司法書士など、それぞれの専門家へお回しします。');
  lines.push('');

  lines.push('## 主なページ');
  lines.push('');
  for (const p of d.pages) lines.push(`- ${p.title}: ${p.url} ── ${p.d}`);
  lines.push('');

  lines.push('## ご相談の流れ');
  lines.push('');
  lines.push('1. お電話またはフォームからご連絡いただきます。');
  lines.push('2. 30分程度の無料相談で、いまの状況とご要望をうかがいます（来所・訪問・オンラインのいずれでも可）。');
  lines.push('3. 業務範囲と金額を書面でお見積もりします。ここまで費用はかかりません。');
  lines.push('4. ご契約後、必要な手続きから順に進めます。');
  lines.push('');

  lines.push('## ご注意');
  lines.push('');
  lines.push(d.caveat);
  lines.push('');
  return lines.join('\n');
}

const files = [
  ['llms.txt', buildIndex()],
  ['llms-full.txt', buildFull()],
];

let changed = 0;
for (const [name, body] of files) {
  const target = path.join(root, name);
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current === body) continue;
  if (checkOnly) {
    console.error(`${name} が最新ではありません。node scripts/build-llms.mjs を実行してください`);
    process.exit(1);
  }
  await writeFile(target, body, 'utf8');
  console.log(`生成しました: ${name}（${(body.length / 1024).toFixed(1)}KB）`);
  changed += 1;
}
if (!changed) console.log('llms.txt / llms-full.txt は最新です。');
