import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = 'minano-sr.com';
const origin = `https://${host}`;
const key = '85dc66a4f952381a9f0c3877409afb84';
const keyFile = `${key}.txt`;
const keyLocation = `https://${host}/${keyFile}`;
const endpoint = 'https://api.indexnow.org/indexnow';

const checkOnly = process.argv.includes('--check');
const submit = process.argv.includes('--submit');
if (checkOnly === submit) {
  console.error('使い方: node scripts/submit-indexnow.mjs --check [URL...] | --submit [URL...]');
  process.exit(2);
}

const decodeXml = (value) => value
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'");

const isAllowedUrl = (value) => {
  try {
    const url = new URL(value);
    return (
      url.origin === origin &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

const localKey = fs.readFileSync(path.join(root, keyFile), 'utf8').trim();
if (localKey !== key) throw new Error(`IndexNowキーファイルが不正です: ${keyFile}`);

const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1]));
if (!sitemapUrls.length) throw new Error('sitemap.xmlからURLを取得できません');

const positionalUrls = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const sourceUrls = positionalUrls.length ? positionalUrls : sitemapUrls;
for (const value of sourceUrls) {
  if (!isAllowedUrl(value)) throw new Error(`対象外のURLです: ${value}`);
}
const urlList = [...new Set(sourceUrls.map((value) => new URL(value).href))];
if (urlList.length > 10_000) throw new Error('IndexNowの1回の上限10,000 URLを超えています');

if (checkOnly) {
  const invalidCases = [
    `http://${host}/`,
    `https://www.${host}/`,
    `https://${host}:8443/`,
    `https://${host}/?preview=1`,
    `https://${host}/#section`,
  ];
  for (const value of invalidCases) {
    if (isAllowedUrl(value)) throw new Error(`URL検証が不正なURLを許可しました: ${value}`);
  }
}

const payload = { host, key, keyLocation, urlList };
if (checkOnly) {
  console.log(`IndexNowチェック合格: ${urlList.length} URL / key ${keyFile}`);
  process.exit(0);
}

const keyResponse = await fetch(`${keyLocation}?verify=${Date.now()}`, {
  headers: { 'user-agent': 'minano-sr-indexnow/1.0' },
});
if (!keyResponse.ok || (await keyResponse.text()).trim() !== key) {
  throw new Error(`本番のIndexNowキーを確認できません: HTTP ${keyResponse.status}`);
}

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'minano-sr-indexnow/1.0',
  },
  body: JSON.stringify(payload),
});
if (![200, 202].includes(response.status)) {
  const body = (await response.text()).slice(0, 500);
  throw new Error(`IndexNow送信失敗: HTTP ${response.status}${body ? ` / ${body}` : ''}`);
}

console.log(`IndexNow送信完了: HTTP ${response.status} / ${urlList.length} URL`);
