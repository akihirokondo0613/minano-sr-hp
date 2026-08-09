import fs from 'node:fs';
import path from 'node:path';

const HOME_FAQ_PATH = 'index.html';
const RECRUIT_FAQ_PATH = 'recruit.html';
const BONUS_FAQ_PATH = 'blog/natsu-shoyo-tetsuzuki.html';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function attributeValue(openTag, name) {
  const escaped = escapeRegExp(name);
  const match = openTag.match(
    new RegExp(`(?:\\s|<)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function hasClass(openTag, className) {
  const classes = attributeValue(openTag, 'class');
  return classes?.split(/\s+/).includes(className) ?? false;
}

function hasId(openTag, id) {
  return attributeValue(openTag, 'id') === id;
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    yen: '¥',
  };

  const decoded = value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot|yen);/gi, (all, entity) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? all;
    const hexadecimal = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return all;
    return String.fromCodePoint(codePoint);
  });
  const unsupported = decoded.match(/&(?:#[xX][\da-fA-F]+|#\d+|[a-z][\da-z]+);/i);
  if (unsupported) {
    throw new Error(`未対応のHTML文字参照です: ${unsupported[0]}`);
  }
  return decoded;
}

export function faqText(value) {
  return decodeEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/[\s　]+/g, ' ')
      .trim(),
  );
}

function findElements(source, tagName, predicate = () => true) {
  const escaped = escapeRegExp(tagName);
  const pattern = new RegExp(`<\\/?${escaped}\\b[^>]*>`, 'gi');
  const searchable = source.replace(
    /<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    (ignored) => ' '.repeat(ignored.length),
  );
  const stack = [];
  const found = [];

  for (const match of searchable.matchAll(pattern)) {
    const token = source.slice(match.index, match.index + match[0].length);
    const closing = /^<\//.test(token);
    if (closing) {
      const opening = stack.pop();
      if (!opening) continue;
      if (opening.target) {
        found.push({
          start: opening.start,
          openEnd: opening.end,
          closeStart: match.index,
          end: match.index + token.length,
          openTag: opening.token,
          inner: source.slice(opening.end, match.index),
        });
      }
      continue;
    }

    const target = predicate(token);
    if (/\/\s*>$/.test(token)) {
      if (target) throw new Error(`${tagName}: 自己終了タグはFAQコンテナに使えません`);
      continue;
    }
    stack.push({
      start: match.index,
      end: match.index + token.length,
      token,
      target,
    });
  }

  const unclosedTarget = stack.find((opening) => opening.target);
  if (unclosedTarget) throw new Error(`${tagName}: 閉じタグが見つかりません`);
  return found.sort((left, right) => left.start - right.start);
}

function oneElement(elements, relativePath, label) {
  if (elements.length !== 1) {
    throw new Error(`${relativePath}: ${label}は1件必要です（現在${elements.length}件）`);
  }
  return elements[0];
}

function isIgnorableGap(value) {
  return value.replace(/<!--[\s\S]*?-->/g, '').trim() === '';
}

function ensureDirectChildren(container, children, relativePath, label) {
  if (!children.length) throw new Error(`${relativePath}: ${label}を抽出できません`);
  let cursor = 0;
  for (const child of children) {
    if (child.start < cursor || !isIgnorableGap(container.slice(cursor, child.start))) {
      throw new Error(`${relativePath}: ${label}以外の内容または入れ子が混在しています`);
    }
    cursor = child.end;
  }
  if (!isIgnorableGap(container.slice(cursor))) {
    throw new Error(`${relativePath}: ${label}以外の内容が混在しています`);
  }
}

function validatePairs(pairs, relativePath) {
  if (!pairs.length) throw new Error(`${relativePath}: 表示FAQを抽出できません`);
  for (const [index, pair] of pairs.entries()) {
    if (!pair.question || !pair.answer) {
      throw new Error(`${relativePath}: 表示FAQ ${index + 1}件目の質問または回答が空です`);
    }
  }
  return pairs;
}

function extractHomeFaq(source, relativePath) {
  const section = oneElement(
    findElements(source, 'section', (tag) => hasId(tag, 'faq')),
    relativePath,
    'section#faq',
  );
  const wrapper = oneElement(
    findElements(section.inner, 'div', (tag) => hasClass(tag, 'faq-wrap')),
    relativePath,
    '.faq-wrap',
  );
  const items = findElements(wrapper.inner, 'div', (tag) => hasClass(tag, 'faq-item'));
  ensureDirectChildren(wrapper.inner, items, relativePath, '.faq-item');

  const pairs = items.map((item, index) => {
    const question = oneElement(
      findElements(item.inner, 'span', (tag) => hasClass(tag, 'faq-q-text')),
      relativePath,
      `.faq-item ${index + 1}件目の.faq-q-text`,
    );
    const answer = oneElement(
      findElements(item.inner, 'div', (tag) => hasClass(tag, 'faq-a-in')),
      relativePath,
      `.faq-item ${index + 1}件目の.faq-a-in`,
    );
    if (question.start > answer.start) {
      throw new Error(`${relativePath}: .faq-item ${index + 1}件目は質問の後に回答が必要です`);
    }
    return { question: faqText(question.inner), answer: faqText(answer.inner) };
  });
  return validatePairs(pairs, relativePath);
}

function extractRecruitFaq(source, relativePath) {
  const container = oneElement(
    findElements(source, 'div', (tag) => hasClass(tag, 'rc-faq')),
    relativePath,
    '.rc-faq',
  );
  const details = findElements(container.inner, 'details');
  ensureDirectChildren(container.inner, details, relativePath, '.rc-faq直下のdetails');

  const pairs = details.map((detail, index) => {
    const question = oneElement(
      findElements(detail.inner, 'summary'),
      relativePath,
      `details ${index + 1}件目のsummary`,
    );
    const answers = findElements(detail.inner, 'p');
    const answer = oneElement(answers, relativePath, `details ${index + 1}件目のp`);
    ensureDirectChildren(
      detail.inner,
      [question, answer].sort((a, b) => a.start - b.start),
      relativePath,
      'summaryとp',
    );
    if (question.start > answer.start) {
      throw new Error(`${relativePath}: details ${index + 1}件目はsummaryの後にpが必要です`);
    }
    return { question: faqText(question.inner), answer: faqText(answer.inner) };
  });
  return validatePairs(pairs, relativePath);
}

function extractDefinitionPairs(container, relativePath) {
  const pattern = /<\/?(dt|dd)\b[^>]*>/gi;
  const tokens = [...container.matchAll(pattern)];
  if (!tokens.length || tokens.length % 4 !== 0) {
    throw new Error(`${relativePath}: dl.faqのdt/dd構造が不正です`);
  }

  const pairs = [];
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 4) {
    const [dtOpen, dtClose, ddOpen, ddClose] = tokens.slice(index, index + 4);
    const shapes = [dtOpen, dtClose, ddOpen, ddClose].map((token) => ({
      name: token[1].toLowerCase(),
      closing: /^<\//.test(token[0]),
    }));
    if (
      shapes[0].name !== 'dt' || shapes[0].closing ||
      shapes[1].name !== 'dt' || !shapes[1].closing ||
      shapes[2].name !== 'dd' || shapes[2].closing ||
      shapes[3].name !== 'dd' || !shapes[3].closing ||
      !isIgnorableGap(container.slice(cursor, dtOpen.index)) ||
      !isIgnorableGap(container.slice(dtClose.index + dtClose[0].length, ddOpen.index))
    ) {
      throw new Error(`${relativePath}: dl.faqはdtとddを交互に並べてください`);
    }

    pairs.push({
      question: faqText(container.slice(dtOpen.index + dtOpen[0].length, dtClose.index)),
      answer: faqText(container.slice(ddOpen.index + ddOpen[0].length, ddClose.index)),
    });
    cursor = ddClose.index + ddClose[0].length;
  }
  if (!isIgnorableGap(container.slice(cursor))) {
    throw new Error(`${relativePath}: dl.faqの末尾にdt/dd以外の内容があります`);
  }
  return validatePairs(pairs, relativePath);
}

function definitionFaqContainers(source) {
  return findElements(source, 'dl', (tag) => hasClass(tag, 'faq'));
}

function extractDefinitionFaq(source, relativePath, containers = definitionFaqContainers(source)) {
  const container = oneElement(containers, relativePath, 'dl.faq');
  return extractDefinitionPairs(container.inner, relativePath);
}

function extractBonusFaq(source, relativePath) {
  const headings = findElements(source, 'h2')
    .filter((heading) => faqText(heading.inner) === 'よくある質問');
  const heading = oneElement(headings, relativePath, '「よくある質問」のh2');
  const following = source.slice(heading.end);
  const lists = findElements(following, 'ul');
  if (!lists.length || !isIgnorableGap(following.slice(0, lists[0].start))) {
    throw new Error(`${relativePath}: 「よくある質問」のh2直後にulが必要です`);
  }
  const list = lists[0];
  const items = findElements(list.inner, 'li');
  ensureDirectChildren(list.inner, items, relativePath, 'FAQのli');

  const pairs = items.map((item, index) => {
    const bold = oneElement(
      findElements(item.inner, 'b'),
      relativePath,
      `FAQのli ${index + 1}件目のb`,
    );
    if (!isIgnorableGap(item.inner.slice(0, bold.start))) {
      throw new Error(`${relativePath}: FAQのli ${index + 1}件目は先頭のbを質問にしてください`);
    }
    return {
      question: faqText(bold.inner),
      answer: faqText(item.inner.slice(bold.end)),
    };
  });
  return validatePairs(pairs, relativePath);
}

function read(root, relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}: ファイルが見つかりません`);
  return fs.readFileSync(file, 'utf8');
}

function withFileContext(relativePath, callback) {
  try {
    return callback();
  } catch (error) {
    if (error.message.startsWith(`${relativePath}:`)) throw error;
    throw new Error(`${relativePath}: ${error.message}`);
  }
}

export function discoverFaqPages(root) {
  const pages = [];
  const homeSource = read(root, HOME_FAQ_PATH);
  pages.push({
    relativePath: HOME_FAQ_PATH,
    pairs: withFileContext(
      HOME_FAQ_PATH,
      () => extractHomeFaq(homeSource, HOME_FAQ_PATH),
    ),
  });

  const recruitSource = read(root, RECRUIT_FAQ_PATH);
  pages.push({
    relativePath: RECRUIT_FAQ_PATH,
    pairs: withFileContext(
      RECRUIT_FAQ_PATH,
      () => extractRecruitFaq(recruitSource, RECRUIT_FAQ_PATH),
    ),
  });

  const blogDir = path.join(root, 'blog');
  const blogFiles = fs.readdirSync(blogDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of blogFiles) {
    const relativePath = `blog/${fileName}`;
    const source = read(root, relativePath);
    const containers = withFileContext(relativePath, () => definitionFaqContainers(source));
    if (relativePath === BONUS_FAQ_PATH) {
      if (containers.length) {
        throw new Error(`${relativePath}: 賞与記事ではdl.faqではなく専用のFAQ節を使ってください`);
      }
      pages.push({
        relativePath,
        pairs: withFileContext(relativePath, () => extractBonusFaq(source, relativePath)),
      });
    } else if (containers.length) {
      pages.push({
        relativePath,
        pairs: withFileContext(
          relativePath,
          () => extractDefinitionFaq(source, relativePath, containers),
        ),
      });
    }
  }

  return pages;
}
