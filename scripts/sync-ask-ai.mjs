#!/usr/bin/env node

/**
 * 追従ボタンに「AIに聞く」を足す。
 *
 *   node scripts/sync-ask-ai.mjs           同期
 *   node scripts/sync-ask-ai.mjs --check    差分があれば失敗（公開前チェック用）
 *
 * なぜ作るのか:
 *   事務所が自分で「うちは良いです」と言うより、読み手が普段使っているAIに説明させたほうが
 *   納得される。そのためのボタン。押すと、質問が入った状態でAIが開く。
 *
 *   最初はページ下部のセクションとして置いたが、そこまで読む人が少なく気づかれなかった。
 *   電話アイコンの隣＝いちばん目に入る場所へ移した。
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
 * 開閉はHTMLのpopover属性で行う（JSを増やさない。外側クリックとEscでの閉じるが標準で効く）。
 * 差し込み位置は .floating の直前に固定する。何度実行しても同じ結果になるようにするため。
 * プロンプトは data/llms.json（llms.txt の正本）と揃える。
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markPhrases } from './lib/phrase-breaks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownArgs.length) throw new Error(`不明な引数: ${unknownArgs.join(' ')}`);

const d = JSON.parse(await readFile(path.join(root, 'data', 'llms.json'), 'utf8'));

// URLを並べると質問文が読みにくくなるので載せない。サイト名を出しておけば、
// Web検索できるAIは minano-sr.com と llms.txt にたどり着く。
const PROMPT = [
  `${d.office.name}（富山県富山市・minano-sr.com）について、次の3点を教えてください。`,
  '1. どんな会社に向いている事務所か',
  '2. 依頼するとどこまで対応してもらえて、料金はいくらか',
  '3. 逆に、どんな場合は別の専門家をあたったほうがよいか',
].join('\n');

const q = encodeURIComponent(PROMPT);

/** 各サービスの「質問を入れた状態で開く」URL。仕様が変わることがあるので、ここだけ直せばよい形にする。
 *  Geminiは 2026-08-27 に実機で確認したところ、?q= を付けても入力欄が空のまま開いたため外した。
 *  Googleが公式に用意しているパラメータではないので、今後も当てにしない。 */
const SERVICES = [
  { name: 'ChatGPT', url: `https://chatgpt.com/?q=${q}&hints=search` },
  { name: 'Claude', url: `https://claude.ai/new?q=${q}` },
];

const STYLE_ID = 'ask-ai-style';
const STYLE = `<style id="${STYLE_ID}">
.fl-ai{width:46px;height:46px;border-radius:50%;background:var(--sugi);border:1px solid var(--sugi);display:grid;place-items:center;box-shadow:0 8px 22px rgba(18,63,48,.2);cursor:pointer;padding:0;transition:transform .3s var(--ease),background .3s}
.fl-ai:hover{transform:translateY(-2px);background:var(--sugi-7,#0d2f24)}
.fl-ai svg{width:22px;height:22px;display:block}
.aa-pop{position:fixed;inset:auto clamp(14px,2vw,26px) calc(max(clamp(14px,2vw,26px), env(safe-area-inset-bottom) + 12px) + 118px) auto;width:min(320px,calc(100vw - 28px));margin:0;padding:20px 22px 18px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--shiro);box-shadow:0 18px 44px rgba(18,63,48,.18);z-index:230}
.aa-pop::backdrop{background:rgba(26,31,28,.28)}
.aa-pop-k{font-family:var(--mono);font-size:10.5px;font-weight:700;letter-spacing:.2em;color:var(--moegi-t)}
.aa-pop-h{font-family:var(--disp);font-size:15.5px;font-weight:800;line-height:1.6;color:var(--iwa);margin-top:7px}
.aa-pop-d{margin-top:8px;font-size:12.5px;line-height:1.8;color:var(--ink3)}
.aa-pop-btns{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.aa-pop-btns a{display:flex;align-items:center;gap:9px;padding:11px 15px;border-radius:999px;background:var(--yuki);border:1px solid var(--line);font-size:13px;font-weight:700;color:var(--iwa);text-decoration:none;transition:border-color .3s,background .3s}
.aa-pop-btns a:hover{border-color:var(--moegi);background:var(--moegi-l)}
.aa-pop-btns .dot{width:7px;height:7px;border-radius:50%;background:var(--moegi);flex-shrink:0}
.aa-pop-note{margin-top:12px;font-size:10.5px;line-height:1.75;color:var(--ink4)}
.aa-pop-close{position:absolute;top:10px;right:12px;width:28px;height:28px;border:0;background:transparent;color:var(--ink4);font-size:18px;line-height:1;cursor:pointer;border-radius:50%}
.aa-pop-close:hover{background:var(--yuki);color:var(--iwa)}
@media (max-width: 640px){
  .aa-pop{inset:auto 14px calc(max(14px, env(safe-area-inset-bottom) + 12px) + 112px) 14px;width:auto}
}
</style>`;

const AI_BUTTON = `    <button class="fl-ai" popovertarget="ask-ai-pop" type="button" aria-label="AIに聞く">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" fill="#fff"/><path d="M18.5 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z" fill="#8FC9A9"/></svg>
    </button>`;

function buildPopover() {
  const btns = SERVICES.map((s) =>
    `    <a href="${s.url}" target="_blank" rel="noopener nofollow"><span class="dot" aria-hidden="true"></span>${s.name}で開く</a>`
  ).join('\n');

  return `<!-- ask-ai:start -->
<div id="ask-ai-pop" popover class="aa-pop">
  <button class="aa-pop-close" popovertarget="ask-ai-pop" popovertargetaction="hide" type="button" aria-label="閉じる">×</button>
  <div class="aa-pop-k">ASK AI</div>
  <p class="aa-pop-h">この事務所が御社に合うか、AIに聞けます。</p>
  <p class="aa-pop-d">普段お使いのAIに、向いている会社・料金・逆に向いていない場合を聞けます。押すと質問が入った状態で開きます。</p>
  <div class="aa-pop-btns">
${btns}
  </div>
  <p class="aa-pop-note">※ 回答は各AIが生成するもので、当事務所が作成したものではありません。制度や金額が誤っている場合があります。</p>
</div>
<!-- ask-ai:end -->`;
}

// 文節印を打った状態で差し込む。打たないと sync-phrase-breaks と交互に書き換え合う
const popover = markPhrases(buildPopover()).html;

/** 旧版（ページ下部のセクション／前回のpopover）を取り除く */
function stripOld(source) {
  let next = source;
  const start = next.indexOf('<!-- ask-ai:start -->');
  if (start >= 0) {
    const end = next.indexOf('<!-- ask-ai:end -->');
    if (end >= 0) {
      next = next.slice(0, start) + next.slice(end + '<!-- ask-ai:end -->'.length);
    }
  }
  // 旧版のCSS（id="ask-ai"）が残っていれば消す
  const legacy = next.indexOf('<style id="ask-ai">');
  if (legacy >= 0) {
    const legacyEnd = next.indexOf('</style>', legacy) + '</style>'.length;
    next = next.slice(0, legacy) + next.slice(legacyEnd);
  }
  // ここでHTML全体の空行を詰めない。critical CSS など他の生成物の改行まで変えてしまう
  return next;
}

const entries = await readdir(root, { recursive: true });
const files = entries
  .filter((f) => f.endsWith('.html'))
  .filter((f) => !f.startsWith('.git') && !f.includes('node_modules') && !f.startsWith('.github'));

let changed = 0;
for (const rel of files.sort()) {
  const file = path.join(root, rel);
  const source = await readFile(file, 'utf8');
  if (!source.includes('class="floating"')) continue;

  let next = stripOld(source);

  // 電話アイコンの手前に「AIに聞く」を置く
  if (!next.includes('class="fl-ai"')) {
    const marker = '<div class="fl-mini">';
    const at = next.indexOf(marker);
    if (at < 0) throw new Error(`${rel}: .fl-mini が見つかりません`);
    next = `${next.slice(0, at + marker.length)}\n${AI_BUTTON}${next.slice(at + marker.length)}`;
  }

  // popover本体は .floating の直前へ（位置が一意に決まる＝何度実行しても同じ結果）
  const flStart = next.indexOf('<div class="floating"');
  if (flStart < 0) throw new Error(`${rel}: .floating が見つかりません`);
  // 直前の改行を1つに揃えてから挿入する（揃えないと、実行のたびに空行が1つずつ増える）
  const head = next.slice(0, flStart).replace(/\n+$/, '\n');
  next = `${head}${popover}\n${next.slice(flStart)}`;

  // ページ固有CSS
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
    console.error(`${rel} の「AIに聞く」が最新ではありません。node scripts/sync-ask-ai.mjs を実行してください`);
    process.exit(1);
  }
  await writeFile(file, next, 'utf8');
  changed += 1;
}
console.log(changed ? `「AIに聞く」を更新: ${changed}ファイル` : '「AIに聞く」は最新です。');
