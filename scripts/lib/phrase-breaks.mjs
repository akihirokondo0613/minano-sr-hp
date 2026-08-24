/**
 * 文節の切れ目へ <wbr> を置く（iPhone/Safari 対策の実体）
 *
 * word-break:auto-phrase は Chromium にしか無く、Safari では normal に解決される。
 * iPhone では「正社員 / 化で」「機 / 械やシステム」のように語の途中で折れるので、
 * 切れ目を先に <wbr> で決めておき、CSS側の `:has(wbr){word-break:keep-all}` で効かせる。
 *
 * ここに置く理由:
 *   トップTOPICS・関連記事・助成金の解説ページは生成物で、
 *   後から <wbr> を差し込むと生成器の --check が毎回落ちる。
 *   生成器自身がこの関数を通せば、生成物と実ファイルが最初から一致する。
 *
 * 対象は CSSで auto-phrase を当てている範囲と同じ。
 *   見出し（h1〜h4）＋ 本文（p, li, dd, dt, figcaption, blockquote, summary）
 *   ＋ 見出しに準じるclass（DISPLAY_CLASSES）。
 *   表のセル（td, th）の中と、12文字未満・日本語を含まない要素は触らない。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundaryScores } from './budoux-ja.mjs';

/**
 * 用語ツールチップ（terms.js）が拾う語。この中では折らない。
 *
 * terms.js は テキスト ノードの中を indexOf で探して <span class="term"> に包む。
 * 語の途中に <wbr> が入るとテキストノードが割れ、印を打った語だけ
 * ツールチップが静かに消える。key の取り方は check-performance-budget.mjs と同じ。
 */
const termsSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'terms.js'),
  'utf8',
);
const TERM_KEYS = [...termsSource.matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1]);
if (!TERM_KEYS.length) throw new Error('terms.js から用語キーを取り出せませんでした');

/**
 * 見出しに準じる扱いをする class。span で組んだカード見出しを拾うためにある。
 * p や h2 で組んであるもの（.jg-catch など）は TARGET_TAGS 側で拾えるので載せない。
 * ここへ足したら、CSS側の :has(wbr) の並びにも同じ class を足すこと。
 */
const DISPLAY_CLASSES = new Set([
  'tp-title',      // トップ 06 TOPICS のカード見出し
  'rp-title',      // 記事末「あわせて読みたい」のタイトル
  'jk-guide-n',    // 助成金ページ・制度別ガイドのカード名
  'svc-info-desc', // サービス一覧カードの説明。題（svc-info-name）は漢字連続で強制分割が
                   // 「サ/ポート」に落ちるため対象外＝手置きの<wbr>で折る（sync対象だと手置きも剥がれる）
]);

const TARGET_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4',
  'p', 'li', 'dd', 'dt', 'figcaption', 'blockquote', 'summary',
]);
/** この中に入っている対象要素は触らない（表は折り返して当然なので対象外） */
const CELL_TAGS = new Set(['td', 'th']);
/** この中の文字は触らない */
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title', 'pre', 'code', 'template', 'svg']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** 短すぎる見出しは折り返さないので印を打たない */
const MIN_CHARS = 12;
/**
 * ひとつながりで残す最大の長さ。
 * 320pxのブログ本文が1行14文字ほど、カードの見出しは1行11文字ほど。
 * これを超える塊が出ると器に収まらず、逃げ道が禁則を無視して折るか
 * （句点だけが次の行に落ちる）、折れずに溢れる。実測で10なら収まる。
 */
const MAX_PHRASE = 10;

/** class属性の値を取り出す */
function classesOf(attrs) {
  const m = attrs.match(/\bclass\s*=\s*"([^"]*)"/i) || attrs.match(/\bclass\s*=\s*'([^']*)'/i);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

function isTarget(name, attrs) {
  // svc-info-name（サービス一覧カードの題）は h3 でも処理しない。
  // 漢字連続の題は文節境界が全部禁止され、10文字上限の強制分割が
  // 「サ/ポート」のような語中に落ちるため、印は手置きで管理する
  // （syncの対象にすると手置きの印も剥がされる）。
  if (classesOf(attrs).includes('svc-info-name')) return false;
  if (TARGET_TAGS.has(name)) return true;
  return classesOf(attrs).some((c) => DISPLAY_CLASSES.has(c));
}

/**
 * 対象要素の内側の範囲を、入れ子の内側優先で拾う。
 * @returns {{start:number,end:number}[]} 文書内での位置（内側のHTMLの範囲）
 */
function findTargets(html) {
  const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  const found = [];
  let rawUntil = null;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[0].startsWith('<!--')) continue;
    const [raw, slash, rawName, attrs, selfClose] = m;
    const name = rawName.toLowerCase();
    if (rawUntil) {
      if (slash && name === rawUntil) rawUntil = null;
      continue;
    }
    if (!slash && RAW_TAGS.has(name)) {
      if (!selfClose) rawUntil = name;
      continue;
    }
    if (VOID_TAGS.has(name) || selfClose) continue;
    if (!slash) {
      const inCell = CELL_TAGS.has(name) || stack.some((el) => el.inCell);
      stack.push({
        name,
        inCell,
        target: !inCell && isTarget(name, attrs),
        innerStart: m.index + raw.length,
        hasTargetChild: false,
      });
      continue;
    }
    // 閉じタグ。対応が崩れているHTMLでも巻き戻せるよう、同名を探して戻す。
    let at = stack.length - 1;
    while (at >= 0 && stack[at].name !== name) at -= 1;
    if (at < 0) continue;
    const closed = stack[at];
    stack.length = at;
    if (closed.target && !closed.hasTargetChild) {
      found.push({ start: closed.innerStart, end: m.index, tag: closed.name });
    }
    if (closed.target || closed.hasTargetChild) {
      for (const parent of stack) parent.hasTargetChild = true;
    }
  }
  return found;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 内側のHTMLを「タグ / 実体参照 / 1文字」へ割る */
function atomize(inner) {
  const atoms = [];
  const re = /<[^>]*>|&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g;
  let last = 0;
  let m;
  const pushChars = (text) => {
    for (const ch of text) atoms.push({ kind: 'char', raw: ch, ch });
  };
  while ((m = re.exec(inner)) !== null) {
    if (m.index > last) pushChars(inner.slice(last, m.index));
    if (m[0][0] === '<') {
      atoms.push({ kind: 'tag', raw: m[0], name: (m[0].match(/^<\/?([a-zA-Z0-9-]+)/) || [])[1]?.toLowerCase() || '' });
    } else {
      const body = m[1];
      let ch = '?';
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        ch = Number.isFinite(code) ? String.fromCodePoint(code) : '?';
      } else if (ENTITIES[body]) {
        ch = ENTITIES[body];
      }
      atoms.push({ kind: 'entity', raw: m[0], ch });
    }
    last = m.index + m[0].length;
  }
  if (last < inner.length) pushChars(inner.slice(last));
  return atoms;
}

/**
 * 禁則。<wbr> は line-break:strict より強い「明示された切れ目」なので、
 * ここで置かないよう自分で外す。BudouXは「合わせる｜：」のように
 * 行頭に置けない記号の前へ切れ目を返すことがある。
 */
/** 行頭に置けない字（この前では折らない） */
const NO_LINE_START = /[)\]｝〕〉》」』】〙〗〟'"｠»、。，．：；？！‼⁇⁈⁉・ー゠–—々〻ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ℃%‰°′″…‥〜゛゜ゝゞヽヾ]/;
/** 行末に置けない字（この後では折らない） */
const NO_LINE_END = /[([｛〔〈《「『【〘〖〝'"｟«¥$￥＄£€#＃]/;

/** 英数字。語の途中で折らないための判定に使う。 */
const LATIN = /[0-9A-Za-z＿'’.-]/;

/** 漢字（々・〆を含む）。熟語の途中で折らないための判定に使う。 */
const KANJI = /[\u3005\u3006\u3007\u4E00-\u9FFF\u3400-\u4DBF]/;

/**
 * white-space:nowrap の箱の中には印を打たない。
 *
 * WebKitでは、nowrapの中の <wbr> は折り返しに使われないのに
 * 「ここで折れる」と数えられるらしく、収まらない塊が前の行へ残って溢れる
 * （uploads/service-joseikin.html の320pxで h2.sec-h > strong が31pxはみ出した）。
 * 打っても効かないので、最初から置かない。
 */
const NOWRAP_CLASSES = new Set([
  'nw', 'nobr',
  'jk-hit-tag', 'jk-hit-amt-l', 'jg-amount-l',
  'optional-details-state', 'optional-details-state-open', 'optional-details-state-closed',
]);
/**
 * class ではなくCSSの子孫セレクタで nowrap になる箱。
 *   .sec-h strong / .page-hero h1 strong …… 見出しの中の強調はひと塊で扱う
 *   .nav-links a / .footer-ul a[href^=…] …… ナビ・フッターのリンク
 * 「この字の中では折らない」を静的に判定するために、タグで丸ごと外す。
 */
const NOWRAP_TAGS = new Set(['a']);
/** 見出しの中では、この字も丸ごと外す */
const NOWRAP_TAGS_IN_HEADING = new Set(['strong', 'b']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5']);

/**
 * 手で置いた <wbr> か、この生成器が置いた <wbr> かを見分ける。
 *
 * 生成器は必ず「文字と文字のあいだ」にしか置かない。タグに隣り合う <wbr>
 * （<span class="nw">…</span><wbr><span class="nw">…</span> のような、
 * どこで折るかを人が決めた印）は、剥がさずそのまま残す。
 */
function isGenerated(atoms, at) {
  const prev = atoms[at - 1];
  const next = atoms[at + 1];
  return !!prev && !!next && prev.kind !== 'tag' && next.kind !== 'tag';
}

function rebuild(inner, ownerTag) {
  const all = atomize(inner);
  // 前回この生成器が置いた印だけを剥がす
  const atoms = all.filter((a, i) => !(a.kind === 'tag' && a.name === 'wbr' && isGenerated(all, i)));
  const stripped = atoms.map((a) => a.raw).join('');

  // 表示される文字だけを並べ、位置を対応づける
  const text = [];
  const indexOfAtom = [];
  // nowrapは「どの箱の中か」まで持つ。深さだけだと、隣り合う二つの
  // <span class="nw"> のあいだ（＝折ってよい場所）まで止めてしまう。
  const nowrapStack = [];
  const openNowrap = [];
  const nowrapAt = [];
  // <br> で区切って、行をまたいだ文脈でBudouXを走らせない
  const segmentAt = [];
  let nowrapSeq = 0;
  let segment = 0;
  for (let i = 0; i < atoms.length; i += 1) {
    const a = atoms[i];
    if (a.kind === 'tag') {
      const closing = a.raw[1] === '/';
      if (a.name === 'br') segment += 1;
      if (!closing && !VOID_TAGS.has(a.name) && !a.raw.endsWith('/>')) {
        const nowrap = classesOf(a.raw).some((c) => NOWRAP_CLASSES.has(c))
          || NOWRAP_TAGS.has(a.name)
          || (HEADING_TAGS.has(ownerTag) && NOWRAP_TAGS_IN_HEADING.has(a.name));
        nowrapStack.push(nowrap);
        if (nowrap) { nowrapSeq += 1; openNowrap.push(nowrapSeq); }
      } else if (closing) {
        if (nowrapStack.pop()) openNowrap.pop();
      }
      continue;
    }
    text.push(a.ch);
    indexOfAtom.push(i);
    nowrapAt.push(openNowrap.length ? openNowrap[openNowrap.length - 1] : 0);
    segmentAt.push(segment);
  }

  const sentence = text.join('');
  const trimmed = sentence.trim();
  if (trimmed.length < MIN_CHARS) return { html: stripped, added: 0 };
  if (!/[぀-ヿ一-鿿]/.test(trimmed)) return { html: stripped, added: 0 };

  // 用語の内側は折らない（terms.js のツールチップが効かなくなるため）。
  // 前後の境目も外す。terms.js は実行時に <span class="term"> で包むので、
  // 語の直前・直後の <wbr> は flex/grid の箱の中で独立したアイテムになる。
  const protectedAt = new Array(sentence.length + 1).fill(false);
  for (const key of TERM_KEYS) {
    let at = sentence.indexOf(key);
    while (at >= 0) {
      for (let i = at; i <= at + key.length; i += 1) protectedAt[i] = true;
      at = sentence.indexOf(key, at + 1);
    }
  }

  /**
   * ここで折ってよいか。
   * @param {number} b
   * @param {boolean} [allowKanji] 熟語の途中でも折るか（長すぎる塊を割る最後の手段）
   */
  function canBreakAt(b, allowKanji = false) {
    if (b <= 0 || b >= sentence.length) return false;
    if (protectedAt[b]) return false;
    if (NO_LINE_START.test(sentence[b])) return false;
    if (NO_LINE_END.test(sentence[b - 1])) return false;
    // 英数字の語は空白で折れるので、途中では切らない。
    // BudouXは日本語の統計モデルなので「S｜TEP 03」のように割ることがある。
    if (LATIN.test(sentence[b - 1]) && LATIN.test(sentence[b])) return false;
    // 漢字と漢字のあいだでは折らない。BudouXは統計モデルなので、
    // 「中／小企業」「人／材開発支援助成金」「随時／改定」のように
    // 熟語や制度名を割ることがある。全78ページで356か所あり、
    // 目で追えたものはほぼ全部が誤りだった。失う正しい切れ目より害が大きい。
    if (!allowKanji && KANJI.test(sentence[b - 1]) && KANJI.test(sentence[b])) return false;
    // nowrapの箱は「中で折らない」だけ。箱の境目で折るのは差し支えない。
    if (nowrapAt[b] !== 0 && nowrapAt[b] === nowrapAt[b - 1]) return false;
    if (/\s/.test(sentence[b]) || /\s/.test(sentence[b - 1])) return false;
    return placeAt(b) > 0;
  }

  /**
   * 印を実際に差し込む位置（atomの番号）を返す。置けないなら0。
   *
   * 開始タグの手前まで戻してから置く。<strong> の直前で折れないと、
   * 「ヒントを、|わかりやすく。」が1行に居座って器から出る（blog.html の360pxで実測）。
   * タグの内側へ入れると nowrap の箱に閉じ込められて効かないので、外へ出す。
   *
   * ただし戻った先が閉じタグなら置かない。<wbr> は要素なので、
   * grid/flex の箱の直下だと1個のアイテムとして数えられ、列がずれる
   * （ブログの li が display:grid で、右の説明が32pxまで潰れた実測がある）。
   * 前が文字なら、そこは必ずテキストの流れの中なので安全。
   */
  function placeAt(b) {
    let at = indexOfAtom[b];
    while (at > 0) {
      const prev = atoms[at - 1];
      if (prev.kind !== 'tag') break;
      if (prev.name === 'wbr') break;
      const closing = prev.raw[1] === '/';
      if (closing || VOID_TAGS.has(prev.name) || prev.raw.endsWith('/>')) break;
      at -= 1;
    }
    if (at <= 0) return 0;
    // 既に印があるなら、その一つ前を見て判断する。ここを見落とすと
    // 「2回目の実行で置けない位置」になり、長すぎる文節の割り足しが毎回ふえる。
    const prev = atoms[at - 1];
    const anchor = prev.kind === 'tag' && prev.name === 'wbr' ? atoms[at - 2] : prev;
    if (!anchor || anchor.kind === 'tag') return 0;
    return at;
  }

  /** そこに既に印があるか（人が置いた印と二重にしない） */
  function alreadyMarked(at) {
    return at > 0 && atoms[at - 1].kind === 'tag' && atoms[at - 1].name === 'wbr';
  }

  // <br> で区切った一行ずつ採点する。行をまたいだ文脈で判定しない。
  const scores = new Array(sentence.length).fill(-Infinity);
  const segStarts = [0];
  for (let i = 1; i < sentence.length; i += 1) if (segmentAt[i] !== segmentAt[i - 1]) segStarts.push(i);
  segStarts.push(sentence.length);
  for (let k = 0; k < segStarts.length - 1; k += 1) {
    const from = segStarts[k];
    const part = boundaryScores(sentence.slice(from, segStarts[k + 1]));
    for (let i = 1; i < part.length; i += 1) scores[from + i] = part[i];
  }

  const chosen = [];
  for (let b = 1; b < sentence.length; b += 1) if (scores[b] > 0 && canBreakAt(b)) chosen.push(b);

  // 文節が長すぎると、器に収まらず overflow-wrap:anywhere が禁則を無視して折る。
  // 「…なっています／。」のように句点だけが次の行へ落ちるのはこれ。
  // MAX_PHRASE を超える塊には、いちばん切れ目らしい場所へ印を足しておく。
  const cuts = new Set(chosen);
  const edges = [...new Set([...segStarts, ...chosen])].sort((a, b) => a - b);
  const queue = [];
  for (let k = 0; k < edges.length - 1; k += 1) queue.push([edges[k], edges[k + 1]]);
  while (queue.length) {
    const [from, to] = queue.pop();
    if (to - from <= MAX_PHRASE) continue;
    // まず熟語を割らずに探し、見つからなければ熟語の中でも折る。
    // 「雇用関係助成金申請サポート」のような漢字続きは、そうしないと
    // どこでも折れず器から出る（services.html の320pxで10pxはみ出した）。
    let best = -1;
    let bestScore = -Infinity;
    for (const allowKanji of [false, true]) {
      for (let b = from + 1; b < to; b += 1) {
        if (!canBreakAt(b, allowKanji) || cuts.has(b)) continue;
        if (scores[b] > bestScore) { bestScore = scores[b]; best = b; }
      }
      if (best >= 0) break;
    }
    if (best < 0) continue;
    cuts.add(best);
    queue.push([from, best], [best, to]);
  }

  // 既にある印はそのまま数える（折れる場所として勘定しないと、
  // 長すぎる文節の割り足しが毎回ふえて安定しない）。
  const marks = new Set();
  for (const b of cuts) {
    const at = placeAt(b);
    if (at > 0 && !alreadyMarked(at)) marks.add(at);
  }
  if (!marks.size) return { html: stripped, added: 0 };

  const out = [];
  for (let i = 0; i < atoms.length; i += 1) {
    if (marks.has(i)) out.push('<wbr>');
    out.push(atoms[i].raw);
  }
  return { html: out.join(''), added: marks.size };
}

/**
 * HTML（文書でも断片でもよい）の対象要素へ <wbr> を入れ直す。
 * 既にある <wbr> は一度剥がすので、何度通しても同じ結果になる。
 * @param {string} html
 * @returns {{html: string, added: number}}
 */
export function markPhrases(html) {
  const targets = findTargets(html).sort((a, b) => b.start - a.start);
  let next = html;
  let added = 0;
  for (const { start, end, tag } of targets) {
    const inner = next.slice(start, end);
    const result = rebuild(inner, tag);
    if (result.html === inner) continue;
    next = next.slice(0, start) + result.html + next.slice(end);
    added += result.added;
  }
  return { html: next, added };
}
