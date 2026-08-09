#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetBaseRef = (process.env.ASSET_VERSION_BASE_REF || '').trim();

function validateAssetBaseRef(ref) {
  if (!ref) return '';
  if (!/^[0-9a-f]{40}$/i.test(ref)) {
    return `ASSET_VERSION_BASE_REF が40桁のcommit SHAではありません: ${ref}`;
  }
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: root,
      stdio: 'ignore',
    });
    return '';
  } catch {
    return `ASSET_VERSION_BASE_REF をローカル履歴で解決できません: ${ref}`;
  }
}

const assetBaseError = validateAssetBaseRef(assetBaseRef);
const tasks = [
  {
    name: 'ブログ読了時間の同期確認',
    args: ['scripts/sync-blog-read-times.mjs', '--check'],
  },
  {
    name: 'ブログ記事監査',
    args: ['scripts/audit-blog.mjs', '--check'],
  },
  {
    name: 'ブログ日付の同期確認',
    args: ['scripts/sync-blog-dates.mjs', '--check'],
  },
  {
    name: '構造化データの同期確認',
    args: ['scripts/sync-structured-data.mjs', '--check'],
  },
  {
    name: '資産版の同期確認',
    args: ['scripts/sync-asset-version.mjs', '--check'],
  },
  {
    name: '構造化データ検査',
    args: ['scripts/check-structured-data.mjs'],
  },
  {
    name: 'キャッシュ版検査',
    args: [
      'scripts/check-asset-version.mjs',
      ...(assetBaseRef ? [assetBaseRef] : []),
    ],
    setupError: assetBaseError,
  },
  {
    name: 'IndexNow通知対象の検査',
    args: ['scripts/submit-indexnow.mjs', '--check'],
  },
  {
    name: 'sitemap生成',
    args: ['gen-sitemap.js'],
  },
  {
    name: '静的な性能検査',
    args: ['scripts/check-performance-budget.mjs'],
  },
];

function commandText(args) {
  return [process.execPath, ...args].join(' ');
}

function runTask(task) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(process.execPath, task.args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', (error) => finish({ exitCode: null, signal: null, error }));
    child.once('close', (exitCode, signal) => finish({ exitCode, signal, error: null }));
  });
}

const failures = [];
for (const [index, task] of tasks.entries()) {
  const label = `[${index + 1}/${tasks.length}] ${task.name}`;
  console.log(`\n${label}`);
  console.log(`$ ${commandText(task.args)}`);
  if (task.setupError) console.error(`事前条件エラー: ${task.setupError}`);

  const result = await runTask(task);
  const failed = Boolean(task.setupError) || result.exitCode !== 0;
  if (failed) {
    const reason = task.setupError
      || result.error?.message
      || (result.signal ? `signal ${result.signal}` : `exit ${result.exitCode ?? 'unknown'}`);
    failures.push({ name: task.name, command: commandText(task.args), reason });
    console.error(`✗ ${task.name}: ${reason}`);
  } else {
    console.log(`✓ ${task.name}`);
  }
}

if (failures.length) {
  console.error(`\n公開前チェック失敗: ${failures.length}/${tasks.length}件`);
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.reason}`);
    console.error(`  ${failure.command}`);
  }
  process.exitCode = 1;
} else {
  console.log(`\n公開前チェック合格: ${tasks.length}/${tasks.length}件`);
}
