#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const skinPath = path.join(root, 'skin-v2.css');
const criticalBoundary = '/* ---------- セクション見出し（等高線ナンバー） ---------- */';
const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function findCriticalStyle(source) {
  const blocks = [...source.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)]
    .filter((match) => {
      const openingTag = match[0].match(/^<style\b[^>]*>/i)?.[0] ?? '';
      const id = openingTag.match(/\sid\s*=\s*(["'])(.*?)\1/i)?.[2];
      return id === 'critical-home';
    });

  if (blocks.length !== 1) {
    throw new Error(`index.html: #critical-home は1件必要です（現在${blocks.length}件）`);
  }
  return blocks[0];
}

function buildIndex(indexSource, skinSource) {
  const boundaryCount = occurrences(skinSource, criticalBoundary);
  if (boundaryCount !== 1) {
    throw new Error(`skin-v2.css: critical CSS境界は1件必要です（現在${boundaryCount}件）`);
  }

  const criticalSource = skinSource.slice(0, skinSource.indexOf(criticalBoundary)).trim();
  if (!criticalSource) {
    throw new Error('skin-v2.css: critical CSSとして生成できる内容がありません');
  }

  const style = findCriticalStyle(indexSource);
  const openingTag = style[0].match(/^<style\b[^>]*>/i)?.[0];
  const closingTag = style[0].match(/<\/style\s*>$/i)?.[0];
  if (!openingTag || !closingTag) {
    throw new Error('index.html: #critical-home のstyle要素を解析できません');
  }

  const generatedStyle = `${openingTag}\n${criticalSource}\n${closingTag}`;
  return indexSource.slice(0, style.index) + generatedStyle
    + indexSource.slice(style.index + style[0].length);
}

async function main() {
  if (unknownArgs.length) {
    throw new Error(`未対応の引数です: ${unknownArgs.join(', ')}`);
  }

  const [indexSource, skinSource] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(skinPath, 'utf8'),
  ]);
  const generated = buildIndex(indexSource, skinSource);

  if (generated === indexSource) {
    console.log('Critical CSSは最新です');
    return;
  }
  if (checkOnly) {
    console.error('index.html: #critical-home が skin-v2.css の先頭部分と同期していません');
    process.exitCode = 1;
    return;
  }

  await writeFile(indexPath, generated, 'utf8');
  console.log('更新: index.html の #critical-home');
}

main().catch((error) => {
  console.error(`Critical CSS同期に失敗しました: ${error.message}`);
  process.exitCode = 1;
});
