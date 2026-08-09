import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverFaqPages } from './lib/faq-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const expectedServicePages = new Set([
  'uploads/service-dx.html',
  'uploads/service-joseikin.html',
  'uploads/service-kyuyo-keisan.html',
  'uploads/service-romu-sodan.html',
  'uploads/service-shakai-hoken.html',
  'uploads/service-shugyo-kisoku.html',
]);

let faqPages;
try {
  faqPages = discoverFaqPages(root);
} catch (error) {
  console.error('表示FAQの構造に問題が見つかりました。');
  console.error(`- ${error.message}`);
  process.exit(1);
}
const displayedFaqs = new Map(
  faqPages.map(({ relativePath, pairs }) => [relativePath, pairs]),
);

function walkHtml(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name.startsWith('_backup_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkHtml(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) result.push(full);
  }
  return result;
}

function typeOf(item) {
  return Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  return [value, ...(Array.isArray(value['@graph']) ? value['@graph'].flatMap(flattenJsonLd) : [])];
}

function parseSchemas(relativePath, source) {
  const schemas = [];
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const typeMatch = match[1].match(
      /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
    );
    const scriptType = typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3];
    if (scriptType?.toLowerCase() !== 'application/ld+json') continue;
    try {
      schemas.push(...flattenJsonLd(JSON.parse(match[2])));
    } catch (error) {
      errors.push(`${relativePath}: JSON-LDを解析できません（${error.message}）`);
    }
  }
  return schemas;
}

const pages = new Map();
for (const full of walkHtml(root)) {
  const relativePath = path.relative(root, full).split(path.sep).join('/');
  if (relativePath === 'admin-post.html' || relativePath === 'icon-catalog.html') continue;
  const source = fs.readFileSync(full, 'utf8');
  pages.set(relativePath, {
    source,
    schemas: parseSchemas(relativePath, source),
  });
}

const articleIndex = new Map(
  JSON.parse(fs.readFileSync(path.join(root, 'blog/articles.json'), 'utf8')).map((article) => [
    article.slug,
    article,
  ]),
);

for (const [relativePath, { source, schemas }] of pages) {
  if (!relativePath.startsWith('blog/')) continue;
  const articleSchemas = schemas.filter((schema) => typeOf(schema).includes('Article'));
  if (articleSchemas.length !== 1) {
    errors.push(`${relativePath}: Articleは1件必要です（現在${articleSchemas.length}件）`);
    continue;
  }

  const slug = path.basename(relativePath, '.html');
  const indexed = articleIndex.get(slug);
  const published = source.match(
    /<meta property=["']article:published_time["'] content=["']([^"']+)["']>/i,
  )?.[1];
  const modified = source.match(
    /<meta property=["']article:modified_time["'] content=["']([^"']+)["']>/i,
  )?.[1];
  const article = articleSchemas[0];

  if (!indexed) {
    errors.push(`${relativePath}: blog/articles.jsonに記事がありません`);
  } else if (
    published !== article.datePublished ||
    modified !== article.dateModified ||
    indexed.date !== article.datePublished ||
    indexed.updated !== article.dateModified
  ) {
    errors.push(`${relativePath}: OGP・Article・articles.jsonの日付が一致していません`);
  }
}

for (const [relativePath, { schemas }] of pages) {
  const faqSchemas = schemas.filter((schema) => typeOf(schema).includes('FAQPage'));
  const displayedPairs = displayedFaqs.get(relativePath);

  if (!displayedPairs && faqSchemas.length) {
    errors.push(`${relativePath}: 表示上のFAQが0件なのにFAQPageがあります`);
  } else if (displayedPairs) {
    if (faqSchemas.length !== 1) {
      errors.push(`${relativePath}: FAQPageは1件必要です（現在${faqSchemas.length}件）`);
      continue;
    }
    const entities = faqSchemas[0].mainEntity;
    if (!Array.isArray(entities) || entities.length !== displayedPairs.length) {
      errors.push(
        `${relativePath}: FAQPageの質問数が表示FAQと一致しません` +
          `（表示${displayedPairs.length}件、構造化データ${entities?.length ?? 0}件）`,
      );
      continue;
    }
    for (const [index, entity] of entities.entries()) {
      const answer = entity?.acceptedAnswer;
      if (
        entity?.['@type'] !== 'Question' ||
        typeof entity?.name !== 'string' ||
        !entity.name.trim() ||
        answer?.['@type'] !== 'Answer' ||
        typeof answer?.text !== 'string' ||
        !answer.text.trim()
      ) {
        errors.push(`${relativePath}: FAQPage ${index + 1}件目の質問または回答が不正です`);
      } else if (
        entity.name !== displayedPairs[index].question ||
        answer.text !== displayedPairs[index].answer
      ) {
        errors.push(`${relativePath}: FAQPage ${index + 1}件目が表示FAQと一致していません`);
      }
    }
  }
}

for (const [relativePath, { schemas }] of pages) {
  const serviceSchemas = schemas.filter((schema) => typeOf(schema).includes('Service'));
  const shouldHaveService = expectedServicePages.has(relativePath);
  if (!shouldHaveService && serviceSchemas.length) {
    errors.push(`${relativePath}: 対象外ページにServiceスキーマがあります`);
    continue;
  }
  if (!shouldHaveService) continue;
  if (serviceSchemas.length !== 1) {
    errors.push(`${relativePath}: Serviceスキーマは1件必要です（現在${serviceSchemas.length}件）`);
    continue;
  }
  const service = serviceSchemas[0];
  if (
    service.provider?.['@id'] !== 'https://minano-sr.com/#office' ||
    !Array.isArray(service.areaServed) ||
    !service.areaServed.includes('日本') ||
    service.offers?.['@type'] !== 'Offer' ||
    service.offers?.url !== 'https://minano-sr.com/pricing.html'
  ) {
    errors.push(`${relativePath}: Serviceのprovider・areaServed・offersが不正です`);
  }
}

{
  const indexSchemas = pages.get('index.html')?.schemas ?? [];
  const localBusinesses = indexSchemas.filter((schema) => typeOf(schema).includes('LocalBusiness'));
  const websites = indexSchemas.filter((schema) => typeOf(schema).includes('WebSite'));
  const deprecatedProfessionalService = indexSchemas.some((schema) =>
    typeOf(schema).includes('ProfessionalService'));
  if (localBusinesses.length !== 1) {
    errors.push(`index.html: LocalBusinessは1件必要です（現在${localBusinesses.length}件）`);
  } else {
    const office = localBusinesses[0];
    if (
      office['@id'] !== 'https://minano-sr.com/#office' ||
      office.telephone !== '+81-90-8259-8774' ||
      office.address?.streetAddress !== '蓮町1丁目7-4 SCOP TOYAMA' ||
      office.geo?.latitude !== 36.741023 ||
      office.geo?.longitude !== 137.225116 ||
      !Array.isArray(office.areaServed) ||
      !office.areaServed.includes('日本') ||
      office.openingHoursSpecification?.opens !== '09:00' ||
      office.openingHoursSpecification?.closes !== '18:00' ||
      typeof office.priceRange !== 'string' ||
      !office.priceRange
    ) {
      errors.push('index.html: LocalBusinessの地域・所在地・営業時間・料金情報が不正です');
    }
  }
  if (deprecatedProfessionalService) {
    errors.push('index.html: 非推奨のProfessionalServiceが残っています');
  }
  if (websites.length !== 1) {
    errors.push(`index.html: WebSiteは1件必要です（現在${websites.length}件）`);
  } else {
    const website = websites[0];
    if (
      website['@id'] !== 'https://minano-sr.com/#website' ||
      website.url !== 'https://minano-sr.com/' ||
      website.name !== 'みなの社会保険労務士事務所' ||
      website.alternateName !== 'minano-sr.com' ||
      website.inLanguage !== 'ja-JP' ||
      website.publisher?.['@id'] !== 'https://minano-sr.com/#office'
    ) {
      errors.push('index.html: WebSiteのサイト名・URL・publisherが不正です');
    }
  }
}

{
  const recruitSchemas = pages.get('recruit.html')?.schemas ?? [];
  if (recruitSchemas.some((schema) => typeOf(schema).includes('JobPosting'))) {
    errors.push('recruit.html: 求人一覧ページにJobPostingを置くことはGoogleの要件違反です');
  }
}

{
  const breadcrumbSchemas = (pages.get('joseikin.html')?.schemas ?? [])
    .filter((schema) => typeOf(schema).includes('BreadcrumbList'));
  const items = breadcrumbSchemas[0]?.itemListElement;
  if (
    breadcrumbSchemas.length !== 1 ||
    !Array.isArray(items) ||
    items.length !== 2 ||
    items[0]?.position !== 1 ||
    items[1]?.position !== 2 ||
    items[1]?.item !== 'https://minano-sr.com/joseikin.html'
  ) {
    errors.push('joseikin.html: BreadcrumbListが不正です');
  }
}

{
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-public.yml'), 'utf8');
  for (const excluded of ['AGENTS.md', 'CLAUDE.md', 'admin-post.html', 'icon-catalog.html', 'mascot.js']) {
    if (!new RegExp(`rm -f[^\\n]*\\b${excluded.replace('.', '\\.')}\\b`).test(workflow)) {
      errors.push(`deploy-public.yml: ${excluded}の公開除外がありません`);
    }
  }
  if (!/rm -f assets\/cat-walk-\*\.webp/.test(workflow)) {
    errors.push('deploy-public.yml: 猫画像の公開除外がありません');
  }
}

// 旧NAPが指示書・台帳から公開物や設定へ再流入するのを止める（2026-08 実際に指示書へ残っていた）
const RETIRED_NAP = ['090-2838-8252', '蓮町1丁目7番3号'];
for (const [relativePath, { source }] of pages) {
  for (const retired of RETIRED_NAP) {
    if (source.includes(retired)) errors.push(`${relativePath}: 旧NAP「${retired}」が残っています`);
  }
}

const faqTotal = faqPages.reduce((sum, { pairs }) => sum + pairs.length, 0);
if (errors.length) {
  console.error('構造化データ／公開除外チェックで問題が見つかりました。');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `構造化データチェック合格: FAQPage ${faqPages.length}ページ・${faqTotal}問、` +
  `Service ${expectedServicePages.size}ページ、LocalBusiness 1件、WebSite 1件、BreadcrumbList 1件。`,
);
