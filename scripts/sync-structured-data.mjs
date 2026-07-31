import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
let changed = 0;

const faqMarker = 'FAQPage';
const serviceMarker = 'Service';
const breadcrumbMarker = 'BreadcrumbList';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, source) {
  const file = path.join(root, relativePath);
  const current = fs.readFileSync(file, 'utf8');
  if (current === source) return;
  changed += 1;
  if (!checkOnly) fs.writeFileSync(file, source, 'utf8');
  console.log(`${checkOnly ? '要更新' : '更新'}: ${relativePath}`);
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? all;
    const radix = entity[1].toLowerCase() === 'x' ? 16 : 10;
    const raw = radix === 16 ? entity.slice(2) : entity.slice(1);
    return String.fromCodePoint(Number.parseInt(raw, radix));
  });
}

function text(value) {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/[\s　]+/g, ' ')
      .trim(),
  );
}

function jsonLd(marker, data) {
  return [
    `<!-- Structured Data: ${marker} -->`,
    `<script type="application/ld+json" data-schema="${marker.toLowerCase()}">`,
    JSON.stringify(data, null, 2),
    '</script>',
  ].join('\n');
}

function replaceMarkedBlock(source, marker, block) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `\\n?<!-- Structured Data: ${escaped} -->\\s*<script[^>]*>[\\s\\S]*?<\\/script>\\n?`,
    'g',
  );
  const without = source.replace(pattern, '\n');
  if (!without.includes('</head>')) throw new Error(`${marker}: </head> が見つかりません`);
  return without.replace('</head>', `${block}\n</head>`);
}

function faqData(pairs) {
  if (!pairs.length) throw new Error('FAQが0件です');
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: answer,
      },
    })),
  };
}

function extractHomeFaq(source) {
  const questions = [...source.matchAll(
    /<span class="faq-q-text">([\s\S]*?)<\/span>\s*<\/span>/g,
  )].map((match) => text(match[1]));
  const answers = [...source.matchAll(
    /<div class="faq-a-in">([\s\S]*?)<\/div>/g,
  )].map((match) => text(match[1]));
  if (questions.length !== 6 || answers.length !== 6) {
    throw new Error(`index.html: FAQ抽出数が不正です（Q=${questions.length}, A=${answers.length}）`);
  }
  return questions.map((question, index) => ({ question, answer: answers[index] }));
}

function extractRecruitFaq(source) {
  const pairs = [...source.matchAll(
    /<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g,
  )].map((match) => ({ question: text(match[1]), answer: text(match[2]) }));
  if (pairs.length !== 4) throw new Error(`recruit.html: FAQ抽出数が不正です（${pairs.length}）`);
  return pairs;
}

function extractDefinitionFaq(source, relativePath) {
  const faqList = source.match(/<dl\b[^>]*class="[^"]*\bfaq\b[^"]*"[^>]*>([\s\S]*?)<\/dl>/i)?.[1];
  if (!faqList) throw new Error(`${relativePath}: dl.faqが見つかりません`);
  const pairs = [...faqList.matchAll(
    /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g,
  )].map((match) => ({ question: text(match[1]), answer: text(match[2]) }));
  if (!pairs.length) throw new Error(`${relativePath}: FAQを抽出できません`);
  return pairs;
}

function extractBonusFaq(source) {
  // 目次導入で h2 に id が付いたため、属性ありも拾う
  const section = source.match(/<h2[^>]*>よくある質問<\/h2>\s*<ul>([\s\S]*?)<\/ul>/);
  if (!section) throw new Error('blog/natsu-shoyo-tetsuzuki.html: FAQ節が見つかりません');
  const pairs = [...section[1].matchAll(
    /<li><b>([\s\S]*?)<\/b>\s*([\s\S]*?)<\/li>/g,
  )].map((match) => ({ question: text(match[1]), answer: text(match[2]) }));
  if (pairs.length !== 2) throw new Error(`賞与記事: FAQ抽出数が不正です（${pairs.length}）`);
  return pairs;
}

function syncFaq(relativePath, extractor) {
  const source = read(relativePath);
  const block = jsonLd(faqMarker, faqData(extractor(source, relativePath)));
  write(relativePath, replaceMarkedBlock(source, faqMarker, block));
}

const office = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  '@id': 'https://minano-sr.com/#office',
  name: 'みなの社会保険労務士事務所',
  url: 'https://minano-sr.com/',
  description:
    '富山の中小企業向けに助成金申請・就業規則作成・社会保険手続き・給与計算を提供する社会保険労務士事務所。来所・訪問・オンラインに対応し、全国からご相談いただけます。',
  image: 'https://minano-sr.com/assets/og/minano-og.png',
  telephone: '+81-90-8259-8774',
  email: 'contact@minano-sr.com',
  areaServed: ['富山県', '石川県', '日本'],
  address: {
    '@type': 'PostalAddress',
    postalCode: '931-8333',
    addressRegion: '富山県',
    addressLocality: '富山市',
    streetAddress: '蓮町1丁目7 SCOP富山',
    addressCountry: 'JP',
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: 36.741023,
    longitude: 137.225116,
  },
  openingHoursSpecification: {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    opens: '09:00',
    closes: '18:00',
  },
  priceRange: '月額 ¥35,000から（税抜）',
};

{
  const relativePath = 'index.html';
  let source = read(relativePath);
  const oldOffice = /<!-- Structured Data: (?:LocalBusiness \/ ProfessionalService|LocalBusiness) -->\s*<script[^>]*>[\s\S]*?<\/script>/;
  if (!oldOffice.test(source)) throw new Error('index.html: 事務所スキーマが見つかりません');
  source = source.replace(
    oldOffice,
    jsonLd('LocalBusiness', office),
  );
  source = replaceMarkedBlock(
    source,
    faqMarker,
    jsonLd(faqMarker, faqData(extractHomeFaq(source))),
  );
  write(relativePath, source);
}

syncFaq('recruit.html', extractRecruitFaq);

const definitionFaqArticles = [
  'blog/36kyotei-jogen-kanri.html',
  'blog/customer-harassment-gimuka-2026.html',
  'blog/fukugyo-kengyo-kisoku.html',
  'blog/getsugaku-henkou-todoke-zuiji-kaitei.html',
  'blog/joseikin-career-up-2026.html',
  'blog/kaigo-hoshu-kaitei-2027.html',
  'blog/kaigo-shogu-career-path-2026.html',
  'blog/kaigo-shogu-haibun-rule-2026.html',
  'blog/kaigo-shogu-new-services-2026.html',
  'blog/kaigo-shogu-todokede-2026.html',
  'blog/kaigo-technology-jininhaichi-2027.html',
  'blog/kintai-dx-donyu-junbi.html',
  'blog/kodomo-kosodate-shienkin-2026.html',
  'blog/kounenrei-koyo-keizoku-kyufu-2025.html',
  'blog/kyuyo-itaku-junbi.html',
  'blog/nenkyu-5days-kanribo.html',
  'blog/necchusho-taisaku-gimu.html',
  'blog/nendo-koshin-santei.html',
  'blog/nyusha-tetsuzuki-checklist.html',
  'blog/roudou-joken-tsuchisho-2024.html',
  'blog/roudousha-shishoubyou-houkoku-denshi.html',
  'blog/ryoritsu-shien-josei.html',
  'blog/shaho-tekiyo-kakudai-2026.html',
  'blog/shogaisha-hotei-koyoritsu-2026.html',
  'blog/shusseigo-shien-ikujijitan-kyufu.html',
  'blog/taishoku-trouble-prevention.html',
  'blog/tokutei-chiiki-kyotaku-service-2027.html',
  'blog/toyama-koyou-josei-2026-05.html',
  'blog/toyama-kyujin-chingin-data-2026.html',
  'blog/toyama-shokushu-betsu-kyujin-bairitsu-2026.html',
  'blog/harassment-madoguchi.html',
  'blog/ikukyu-kaisei-2026.html',
  'blog/shugyo-kisoku-template-risk.html',
  'blog/gyomu-kaizen-joseikin-2026.html',
];
definitionFaqArticles.forEach((relativePath) => syncFaq(relativePath, extractDefinitionFaq));
syncFaq('blog/natsu-shoyo-tetsuzuki.html', extractBonusFaq);

const services = {
  'uploads/service-dx.html': '労務システム導入・DX支援',
  'uploads/service-joseikin.html': '雇用関係助成金申請サポート',
  'uploads/service-kyuyo-keisan.html': '給与計算アウトソーシング',
  'uploads/service-romu-sodan.html': '労務トラブルのご相談',
  'uploads/service-shakai-hoken.html': '社会保険・労働保険手続き代行',
  'uploads/service-shugyo-kisoku.html': '就業規則の作成・見直し',
};

for (const [relativePath, name] of Object.entries(services)) {
  const source = read(relativePath);
  const description = source.match(/<meta name="description" content="([^"]+)">/)?.[1];
  const url = source.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  if (!description || !url) throw new Error(`${relativePath}: description/canonicalを取得できません`);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${url}#service`,
    name,
    serviceType: name,
    url,
    description: decodeEntities(description),
    provider: {
      '@type': 'LocalBusiness',
      '@id': 'https://minano-sr.com/#office',
      name: 'みなの社会保険労務士事務所',
    },
    areaServed: ['富山県', '石川県', '日本'],
    offers: {
      '@type': 'Offer',
      url: 'https://minano-sr.com/pricing.html',
      description: '料金・顧問プランの詳細は料金ページでご確認いただけます。',
    },
  };
  write(
    relativePath,
    replaceMarkedBlock(source, serviceMarker, jsonLd(serviceMarker, data)),
  );
}

{
  const relativePath = 'joseikin.html';
  const source = read(relativePath);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'ホーム',
        item: 'https://minano-sr.com/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: '令和8年度 使いやすい助成金5選',
        item: 'https://minano-sr.com/joseikin.html',
      },
    ],
  };
  write(
    relativePath,
    replaceMarkedBlock(source, breadcrumbMarker, jsonLd(breadcrumbMarker, data)),
  );
}

if (checkOnly && changed) {
  console.error(`構造化データが未同期です（${changed}ファイル）`);
  process.exitCode = 1;
} else {
  console.log(
    checkOnly
      ? '構造化データは最新です'
      : `構造化データを同期しました（${changed}ファイル更新）`,
  );
}
