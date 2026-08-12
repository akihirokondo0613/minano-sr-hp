import { execFileSync } from 'node:child_process';

const EXCLUDED_HTML = [
  /^\.github\//,
  /^_backup/,
  /^docs\//,
  /^node_modules\//,
  /^scripts\//,
  /(^|\/)admin-post\.html$/,
  /(^|\/)icon-catalog\.html$/,
  /(^|\/)404\.html$/,
  /(^|\/)motion-lab\.html$/,
  /(^|\/)email-preview\.html$/,
  /(^|\/)_wcheck\.html$/,
];

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function publicUrlForHtmlPath(value, origin) {
  const rel = normalizePath(value);
  if (!rel || rel.startsWith('/') || rel.includes('/../') || rel.startsWith('../')) return null;
  if (EXCLUDED_HTML.some((pattern) => pattern.test(rel))) return null;

  const isRootHtml = /^[^/]+\.html$/.test(rel);
  const isSectionHtml = /^(?:blog|uploads)\/[^/]+\.html$/.test(rel);
  if (!isRootHtml && !isSectionHtml) return null;

  if (rel === 'index.html') return `${origin}/`;
  return new URL(rel, `${origin}/`).href;
}

export function assertCoveredPublicHtmlPath(value) {
  const rel = normalizePath(value);
  if (!rel.toLowerCase().endsWith('.html')) return;
  if (EXCLUDED_HTML.some((pattern) => pattern.test(rel))) return;
  if (publicUrlForHtmlPath(rel, 'https://example.invalid')) return;
  throw new Error(`公開対象か判定できないHTMLパスです: ${rel}`);
}

export function parseNameStatusZ(value) {
  const fields = Buffer.isBuffer(value)
    ? value.toString('utf8').split('\0')
    : String(value).split('\0');
  if (fields.at(-1) === '') fields.pop();

  const records = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^[A-Z][0-9]*$/.test(status || '')) {
      throw new Error(`git diffのstatusが不正です: ${status || '(空)'}`);
    }

    const code = status[0];
    if (code === 'R' || code === 'C') {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      if (!oldPath || !newPath) throw new Error(`git diffの${code}レコードが不完全です`);
      records.push({ code, oldPath: normalizePath(oldPath), newPath: normalizePath(newPath) });
      continue;
    }

    if (!['A', 'M', 'D', 'T'].includes(code)) {
      throw new Error(`未対応のgit diff statusです: ${status}`);
    }
    const filePath = fields[index++];
    if (!filePath) throw new Error(`git diffの${code}レコードが不完全です`);
    records.push({ code, path: normalizePath(filePath) });
  }
  return records;
}

export function publicUrlsFromDiffRecords(records, origin) {
  const urls = [];
  for (const record of records) {
    if (record.code === 'R') {
      assertCoveredPublicHtmlPath(record.oldPath);
      assertCoveredPublicHtmlPath(record.newPath);
      urls.push(publicUrlForHtmlPath(record.oldPath, origin));
      urls.push(publicUrlForHtmlPath(record.newPath, origin));
    } else if (record.code === 'C') {
      assertCoveredPublicHtmlPath(record.newPath);
      urls.push(publicUrlForHtmlPath(record.newPath, origin));
    } else {
      assertCoveredPublicHtmlPath(record.path);
      urls.push(publicUrlForHtmlPath(record.path, origin));
    }
  }
  return [...new Set(urls.filter(Boolean))];
}

function resolveCommit(root, ref, label) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`${label}をcommitとして解決できません: ${ref}`);
  }
}

export function changedPublicUrlsFromGit({ root, from, to = 'HEAD', origin }) {
  const fromCommit = resolveCommit(root, from, '変更前ref');
  const toCommit = resolveCommit(root, to, '変更後ref');
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', fromCommit, toCommit], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    throw new Error(`変更前refが変更後refの祖先ではありません: ${from} -> ${to}`);
  }

  const diff = execFileSync(
    'git',
    ['diff', '--name-status', '-z', '--find-renames', fromCommit, toCommit, '--'],
    { cwd: root, encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 },
  );
  return publicUrlsFromDiffRecords(parseNameStatusZ(diff), origin);
}
