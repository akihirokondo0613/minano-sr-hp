#!/usr/bin/env node
// Lighthouse 用の検証サーバー。本番（XServer）と同じく文字系の資産を圧縮して配信する。
// python3 -m http.server は非圧縮のため、HTML 約180KB がそのまま転送量・LCPに乗り、
// 本番（brotli・モバイル性能0.99）と CI（0.88〜0.91）が大きく食い違っていた（2026-10-08）。
// 使い方: node scripts/serve-compressed.mjs [port]   ※リポジトリ直下を配信する

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8765);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.woff2': 'font/woff2',
};
// 本番が圧縮する文字系だけを圧縮する（画像・PDF・ZIPは元から圧縮済み）
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.txt', '.xml', '.svg']);

async function resolveFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, `.${rel}`);
  // リポジトリの外を読ませない
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  try {
    const info = await stat(file);
    if (info.isDirectory()) return resolveFile(`${rel}/`);
    return file;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  try {
    const file = await resolveFile(req.url || '/');
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    let body = await readFile(file);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    const accept = String(req.headers['accept-encoding'] || '');
    if (COMPRESSIBLE.has(ext)) {
      headers.Vary = 'Accept-Encoding';
      if (/\bbr\b/.test(accept)) {
        body = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
        headers['Content-Encoding'] = 'br';
      } else if (/\bgzip\b/.test(accept)) {
        body = zlib.gzipSync(body);
        headers['Content-Encoding'] = 'gzip';
      }
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`圧縮配信の検証サーバー: http://127.0.0.1:${port}/`);
});
