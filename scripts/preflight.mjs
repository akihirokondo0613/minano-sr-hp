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
    name: '関連記事の同期確認',
    args: ['scripts/sync-related-posts.mjs', '--check'],
  },
  {
    name: 'トップTOPICSの同期確認',
    args: ['scripts/sync-home-topics.mjs', '--check'],
  },
  {
    name: '助成金の解説ページの同期確認',
    args: ['scripts/build-joseikin-guides.mjs', '--check'],
  },
  {
    name: '富山の窓口一覧の同期確認',
    args: ['scripts/build-toyama-madoguchi.mjs', '--check'],
  },
  {
    name: '業務ページ料金の同期確認',
    args: ['scripts/sync-service-prices.mjs', '--check'],
  },
  {
    // 窓口一覧の管轄を反転して表を作るので、窓口ページの生成より後ろに置く。
    name: '業務ページの富山の窓口の同期確認',
    args: ['scripts/sync-service-toyama.mjs', '--check'],
  },
  {
    // 最低賃金の数値は service-toyama.json、窓口は toyama-madoguchi.json を読むので、その後ろに置く。
    name: '富山ローカルページの同期確認',
    args: ['scripts/build-toyama-local-pages.mjs', '--check'],
  },
  {
    name: '助成金の対象チェックの同期確認',
    args: ['scripts/sync-joseikin-check.mjs', '--check'],
  },
  {
    // 文節印より先に置く。リンクで包んでから印を打ち直す順序にそろえる。
    name: '本文の制度リンクの同期確認',
    args: ['scripts/sync-inline-links.mjs', '--check'],
  },
  {
    // 生成物の中の見出しは各生成器が印を打つので、それらの後ろに置く。
    name: '文節印（改行位置）の同期確認',
    args: ['scripts/sync-phrase-breaks.mjs', '--check'],
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
    name: 'Critical CSSの同期確認',
    args: ['scripts/sync-critical-css.mjs', '--check'],
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
    name: 'IndexNow差分抽出の検査',
    args: ['scripts/test-indexnow-changes.mjs'],
  },
  {
    name: 'IndexNow通知対象の検査',
    args: ['scripts/submit-indexnow.mjs', '--check'],
  },
  {
    name: 'llms.txt',
    args: ['scripts/build-llms.mjs', '--check'],
  },
  {
    name: 'AIに聞いてみるブロック',
    args: ['scripts/sync-ask-ai.mjs', '--check'],
  },
  {
    name: '士業向けページ',
    args: ['scripts/build-partner-page.mjs', '--check'],
  },
  {
    name: '資料室ページ',
    args: ['scripts/build-shiryo-page.mjs', '--check'],
  },
  {
    name: 'sitemap生成',
    args: ['gen-sitemap.js'],
  },
  {
    name: '重複idの検査',
    args: ['scripts/check-duplicate-ids.mjs'],
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
