import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changedPublicUrlsFromGit,
  publicUrlForHtmlPath,
} from './lib/indexnow-changes.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.INDEXNOW_ROOT
  ? path.resolve(process.env.INDEXNOW_ROOT)
  : scriptRoot;
const host = 'minano-sr.com';
const origin = `https://${host}`;
const key = '85dc66a4f952381a9f0c3877409afb84';
const keyFile = `${key}.txt`;
const keyLocation = `https://${host}/${keyFile}`;
const endpoint = 'https://api.indexnow.org/indexnow';

function parseArgs(argv) {
  const options = { checkOnly: false, submit: false, all: false, changedFrom: '', changedTo: 'HEAD', urls: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') options.checkOnly = true;
    else if (arg === '--submit') options.submit = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--changed-from' || arg === '--changed-to') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg}にはrefが必要です`);
      if (arg === '--changed-from') options.changedFrom = value;
      else options.changedTo = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`未知の引数です: ${arg}`);
    } else {
      options.urls.push(arg);
    }
  }
  if (options.checkOnly === options.submit) {
    throw new Error('使い方: --check または --submit のどちらか一方を指定してください');
  }
  if (options.changedTo !== 'HEAD' && !options.changedFrom) {
    throw new Error('--changed-toは--changed-fromと一緒に指定してください');
  }
  const selectors = Number(options.all) + Number(Boolean(options.changedFrom)) + Number(Boolean(options.urls.length));
  if (selectors > 1) throw new Error('--all、差分ref、URLの同時指定はできません');
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error('使い方: node scripts/submit-indexnow.mjs --check|--submit [--all | --changed-from REF [--changed-to REF] | URL...]');
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
      !url.password &&
      publicUrlForHtmlPath(
        url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)),
        origin,
      ) === url.href
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

let sourceUrls;
if (options.changedFrom) {
  sourceUrls = changedPublicUrlsFromGit({
    root,
    from: options.changedFrom,
    to: options.changedTo,
    origin,
  });
} else {
  sourceUrls = options.urls.length ? options.urls : sitemapUrls;
}
for (const value of sourceUrls) {
  if (!isAllowedUrl(value)) throw new Error(`対象外のURLです: ${value}`);
}
const urlList = [...new Set(sourceUrls.map((value) => new URL(value).href))];
if (urlList.length > 10_000) throw new Error('IndexNowの1回の上限10,000 URLを超えています');
if (options.changedFrom || options.urls.length) {
  console.log(`IndexNow対象URL: ${urlList.length}件`);
  for (const value of urlList) console.log(`- ${value}`);
}

if (options.checkOnly) {
  const invalidCases = [
    `http://${host}/`,
    `https://www.${host}/`,
    `https://${host}:8443/`,
    `https://${host}/?preview=1`,
    `https://${host}/#section`,
    `https://${host}/admin-post.html`,
  ];
  for (const value of invalidCases) {
    if (isAllowedUrl(value)) throw new Error(`URL検証が不正なURLを許可しました: ${value}`);
  }
}

const payload = { host, key, keyLocation, urlList };
if (options.checkOnly) {
  console.log(`IndexNowチェック合格: ${urlList.length} URL / key ${keyFile}`);
  process.exit(0);
}

if (!urlList.length) {
  console.log('IndexNow送信省略: 変更された公開HTMLはありません');
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
