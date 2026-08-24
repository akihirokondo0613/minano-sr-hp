import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverFaqPages } from './lib/faq-source.mjs';

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

function jsonLd(marker, data) {
  return [
    `<!-- Structured Data: ${marker} -->`,
    `<script type="application/ld+json" data-schema="${marker.toLowerCase()}">`,
    JSON.stringify(data, null, 2),
    '</script>',
  ].join('\n');
}

function markedBlockPattern(marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\n?<!--\\s*Structured Data:\\s*${escaped}\\s*-->\\s*` +
      '<script\\b[^>]*>[\\s\\S]*?<\\/script>\\n?',
    'gi',
  );
}

function findMarkedBlocks(source, marker) {
  return [...source.matchAll(markedBlockPattern(marker))];
}

function replaceMarkedBlock(source, marker, block) {
  const matches = findMarkedBlocks(source, marker);
  if (matches.length > 1) {
    throw new Error(`${marker}: 構造化データのマーク付きブロックが複数あります`);
  }
  const without = matches.length ? source.replace(markedBlockPattern(marker), '\n') : source;
  if (!without.includes('</head>')) throw new Error(`${marker}: </head> が見つかりません`);
  return without.replace('</head>', `${block}\n</head>`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  );
}

function markedJson(source, marker) {
  const matches = findMarkedBlocks(source, marker);
  if (matches.length > 1) {
    throw new Error(`${marker}: 構造化データのマーク付きブロックが複数あります`);
  }
  if (!matches.length) return { found: false };
  const json = matches[0][0].match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (json === undefined) return { found: true };
  try {
    return { found: true, data: JSON.parse(json) };
  } catch {
    return { found: true };
  }
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

function syncMarkedSource(source, marker, data) {
  const existing = markedJson(source, marker);
  if (
    existing.data !== undefined &&
    JSON.stringify(canonicalJson(existing.data)) === JSON.stringify(canonicalJson(data))
  ) {
    return source;
  }
  return replaceMarkedBlock(source, marker, jsonLd(marker, data));
}

function syncFaqSource(source, pairs) {
  return syncMarkedSource(source, faqMarker, faqData(pairs));
}

const faqPages = discoverFaqPages(root);
const faqByPath = new Map(faqPages.map((page) => [page.relativePath, page.pairs]));

const office = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  '@id': 'https://minano-sr.com/#office',
  name: 'みなの社会保険労務士事務所',
  url: 'https://minano-sr.com/',
  description:
    '富山の中小企業向けに助成金申請・就業規則作成・社会保険手続き・給与計算を提供する社会保険労務士事務所。来所・訪問・オンラインに対応し、全国からご相談いただけます。',
  image: 'https://minano-sr.com/assets/og/minano-og.png',
  logo: 'https://minano-sr.com/assets/og/logo-512.png',
  telephone: '+81-90-8259-8774',
  email: 'contact@minano-sr.com',
  // 市町村名まで持たせる。「社労士 高岡」のような市町村ロングテールに対して、
  // 本文（about.htmlの対応地域欄）とエンティティの両方で一致させるため。
  areaServed: [
    '富山県', '富山市', '高岡市', '射水市', '砺波市', '魚津市',
    '滑川市', '黒部市', '氷見市', '小矢部市', '南砺市',
    '上市町', '立山町', '舟橋村', '入善町', '朝日町',
    '日本',
  ],
  address: {
    '@type': 'PostalAddress',
    postalCode: '931-8333',
    addressRegion: '富山県',
    addressLocality: '富山市',
    streetAddress: '蓮町1丁目7-4 SCOP TOYAMA',
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

const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': 'https://minano-sr.com/#website',
  url: 'https://minano-sr.com/',
  name: 'みなの社会保険労務士事務所',
  alternateName: 'minano-sr.com',
  inLanguage: 'ja-JP',
  publisher: {
    '@id': 'https://minano-sr.com/#office',
  },
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
  source = syncMarkedSource(source, 'WebSite', website);
  source = syncFaqSource(source, faqByPath.get(relativePath));
  write(relativePath, source);
}

for (const { relativePath, pairs } of faqPages) {
  if (relativePath === 'index.html') continue;
  const source = read(relativePath);
  write(relativePath, syncFaqSource(source, pairs));
}

const services = {
  'uploads/service-dx.html': '労務システム導入・DX支援',
  'uploads/service-joseikin.html': '助成金申請サポート',
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
    areaServed: [
      '富山県', '富山市', '高岡市', '射水市', '砺波市', '魚津市',
      '滑川市', '黒部市', '氷見市', '小矢部市', '南砺市',
      '上市町', '立山町', '舟橋村', '入善町', '朝日町', '日本',
    ],
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
        name: '助成金',
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
