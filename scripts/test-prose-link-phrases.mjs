import assert from 'node:assert/strict';
import { markPhrases } from './lib/phrase-breaks.mjs';

// 実際に語中で分断されたリンクと、再生成時に保護すべき範囲。
const examples = [
  ['料金表（顧問・スポット）', ['スポット']],
  ['ハローワーク求人票の無料点検・作成代行', ['ハローワーク', '無料点検', '作成代行']],
  ['社会保険・労働保険手続き', ['社会保険', '労働保険', '手続き']],
  ['厚生労働省｜トライアル雇用助成金（公式ページ）', ['厚生労働省', 'トライアル']],
  ['年次有給休暇の年5日取得義務と年休管理簿', ['年次有給休暇', '取得義務', '年休管理簿']],
  ['富山県賃上げ応援補助金（社労士報酬の一部を県が補助）', ['賃上げ']],
];
for (const [label, words] of examples) {
  for (const source of [`<p>詳しくは<a href="/page.html">${label}</a>をご覧ください。</p>`, `<div><a href="/page.html">${label}</a></div>`]) {
    const result = markPhrases(source).html;
    assert.equal(result.replaceAll('<wbr>', ''), source, '文字・リンク先を保持');
    assert.equal(markPhrases(result).html, result, '再生成しても変化しない');
    assert.match(result.match(/<a[^>]*>(.*?)<\/a>/s)[1], /<wbr>/, '長いリンクに改行機会を用意');
    for (const word of words) assert.ok(result.includes(word), `${word} の途中を分断しない`);
  }
}
for (const source of [
  '<p><a class="btn" href="/contact.html">社会保険の手続きについて相談する</a></p>',
  '<p><a href="mailto:contact@example.com">contact@example.com</a></p>',
  '<h2><strong><span class="phrase-unit">無料で</span><wbr><span class="phrase-unit">ご相談いただけます。</span></strong></h2>',
]) assert.equal(markPhrases(source).html, source, '操作部品・連絡先・手置き境界を保護');
console.log('本文リンクの文節: 12例と保護対象3例 合格');
