#!/usr/bin/env node

/**
 * 「AIに聞いてみる」ブロックを、指定ページのマーカー間へ差し込む。
 *
 *   node scripts/sync-ask-ai.mjs           同期
 *   node scripts/sync-ask-ai.mjs --check    差分があれば失敗（公開前チェック用）
 *
 * なぜ作るのか:
 *   事務所が自分で「うちは良いです」と言うより、読み手が普段使っているAIに説明させたほうが
 *   納得される。そのためのボタン。押すと、質問が入った状態でAIが開く。
 *
 * 設計で外してはいけない点が3つある。
 *   1. 他事務所と比較させない。聞くのは「この事務所がどんな会社に向くか」だけ。
 *      比較を頼むと、開業直後で実績の少ない当事務所は不利になるうえ、根拠のない優劣を
 *      語らせることになる。
 *   2. 「向いていない場合」も必ず聞かせる。おすすめ点だけを言わせると宣伝としてしか
 *      読まれない。断る材料を持っている事務所のほうが信用される。
 *   3. AIの回答は当事務所が書いたものではない、と明記する。制度や金額を誤って答える
 *      可能性があり、それを事務所の説明と混同されると事故になる。
 *
 * プロンプトと参照先は data/llms.json（llms.txt の正本）と揃える。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['about.html', 'pricing.html'];

const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownArgs.length) throw new Error(`不明な引数: ${unknownArgs.join(' ')}`);

const d = JSON.parse(await readFile(path.join(root, 'data', 'llms.json'), 'utf8'));
const base = d.office.url;

const PROMPT = [
  `${d.office.name}（富山県富山市）について、次の3点を教えてください。`,
  '1. どんな会社に向いている事務所か',
  '2. 依頼するとどこまで対応してもらえて、料金はいくらか',
  '3. 逆に、どんな場合は別の専門家をあたったほうがよいか',
  '',
  '次の資料を参照してください。',
  `${base}/llms.txt`,
  `${base}/llms-full.txt`,
].join('\n');

const q = encodeURIComponent(PROMPT);

/** 各サービスの「質問を入れた状態で開く」URL。仕様が変わることがあるので、ここだけ直せばよい形にする。 */
const SERVICES = [
  { name: 'ChatGPT', url: `https://chatgpt.com/?q=${q}&hints=search` },
  { name: 'Gemini', url: `https://gemini.google.com/app?q=${q}` },
  { name: 'Claude', url: `https://claude.ai/new?q=${q}` },
  { name: 'Perplexity', url: `https://www.perplexity.ai/search?q=${q}` },
];

const STYLE_ID = 'ask-ai';
const STYLE = `<style id="${STYLE_ID}">
.aa{background:var(--yuki);border:1px solid var(--line);border-radius:var(--r-lg);padding:clamp(24px,3.4vw,44px) clamp(20px,3vw,40px);text-align:center}
.aa-kick{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.2em;color:var(--moegi-t)}
.aa-h{font-family:var(--disp);font-size:clamp(19px,2.6vw,27px);font-weight:800;line-height:1.55;color:var(--iwa);margin-top:10px}
.aa-d{margin-top:12px;font-size:14px;line-height:1.95;color:var(--ink2);max-width:34em;margin-inline:auto}
.aa-btns{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:22px}
.aa-btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:999px;background:var(--shiro);border:1px solid var(--line);font-size:13.5px;font-weight:700;color:var(--iwa);text-decoration:none;transition:border-color .3s,transform .3s var(--ease),box-shadow .3s}
.aa-btn:hover{border-color:var(--moegi);transform:translateY(-2px);box-shadow:0 8px 20px rgba(18,63,48,.08)}
.aa-btn .dot{width:8px;height:8px;border-radius:50%;background:var(--moegi);flex-shrink:0}
.aa-after{margin-top:18px;font-size:13.5px;font-weight:700;color:var(--sugi)}
.aa-note{margin-top:14px;font-size:11.5px;line-height:1.85;color:var(--ink3);max-width:40em;margin-inline:auto}
@media (max-width: 640px){
  .aa-btns{flex-direction:column;gap:8px}
  .aa-btn{width:100%;justify-content:center}
  .aa-d{font-size:13.5px}
}
</style>`;

function buildBlock() {
  const btns = SERVICES.map((s) =>
    `        <a class="aa-btn" href="${s.url}" target="_blank" rel="noopener nofollow"><span class="dot" aria-hidden="true"></span>${s.name}で開く</a>`
  ).join('\n');

  return `<!-- ask-ai:start -->
<section class="sec" id="ask-ai">
  <div class="w">
    <div class="aa rv">
      <div class="aa-kick">ASK AI</div>
      <h2 class="aa-h">この事務所が御社に合うか、<strong>AIに聞いてみてください。</strong></h2>
      <p class="aa-d">当事務所の情報をまとめたページを用意しています。普段お使いのAIに、どんな会社に向いているか、料金はいくらか、逆にどんな場合は別の専門家をあたったほうがよいかを聞けます。ボタンを押すと、質問が入った状態で開きます。</p>
      <div class="aa-btns">
${btns}
      </div>
      <p class="aa-after">AIの答えを見たうえで、気になる点は下のフォームやお電話でお尋ねください。</p>
      <p class="aa-note">※ 回答はそれぞれのAIが生成するもので、当事務所が作成したものではありません。制度や金額を誤って説明する場合がありますので、正確な内容は当サイトの各ページ、または直接のご相談でお確かめください。AIサービスの仕様によっては、質問が自動で入力されないことがあります。</p>
    </div>
  </div>
</section>
<!-- ask-ai:end -->`;
}

const block = markPhrases(buildBlock()).html;

let changed = 0;
for (const name of targets) {
  const file = path.join(root, name);
  let source = await readFile(file, 'utf8');
  const start = source.indexOf('<!-- ask-ai:start -->');
  const end = source.indexOf('<!-- ask-ai:end -->');
  if (start < 0 || end < 0) {
    throw new Error(`${name} に ask-ai のマーカーがありません（<!-- ask-ai:start --> と <!-- ask-ai:end -->）`);
  }
  let next = source.slice(0, start) + block + source.slice(end + '<!-- ask-ai:end -->'.length);

  // ページ固有CSSは head の末尾に置く（無ければ足す・あれば差し替える）
  const styleOpen = `<style id="${STYLE_ID}">`;
  const sIdx = next.indexOf(styleOpen);
  if (sIdx >= 0) {
    const sEnd = next.indexOf('</style>', sIdx) + '</style>'.length;
    next = next.slice(0, sIdx) + STYLE + next.slice(sEnd);
  } else {
    next = next.replace('</head>', `${STYLE}\n</head>`);
  }

  if (next === source) continue;
  if (checkOnly) {
    console.error(`${name} の「AIに聞いてみる」が最新ではありません。node scripts/sync-ask-ai.mjs を実行してください`);
    process.exit(1);
  }
  await writeFile(file, next, 'utf8');
  console.log(`更新: ${name}`);
  changed += 1;
}
if (!changed) console.log('「AIに聞いてみる」は最新です。');
