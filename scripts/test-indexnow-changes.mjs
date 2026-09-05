import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  changedPublicUrlsFromGit,
  assertCoveredPublicHtmlPath,
  parseNameStatusZ,
  publicUrlForHtmlPath,
  publicUrlsFromDiffRecords,
} from './lib/indexnow-changes.mjs';

const origin = 'https://minano-sr.com';
const raw = [
  'M', 'blog/a.html',
  'A', 'about.html',
  'D', 'uploads/old.html',
  'R100', 'blog/old.html', 'blog/new.html',
  'C087', 'blog/source.html', 'blog/copy.html',
  'M', 'admin-post.html',
  'M', 'scripts/tool.mjs',
  'M', 'blog/a.html',
  '',
].join('\0');

const records = parseNameStatusZ(raw);
assert.deepEqual(publicUrlsFromDiffRecords(records, origin), [
  `${origin}/blog/a.html`,
  `${origin}/about.html`,
  `${origin}/uploads/old.html`,
  `${origin}/blog/old.html`,
  `${origin}/blog/new.html`,
  `${origin}/blog/copy.html`,
]);

assert.equal(publicUrlForHtmlPath('index.html', origin), `${origin}/`);
assert.equal(publicUrlForHtmlPath('./blog/記事.html', origin), `${origin}/blog/%E8%A8%98%E4%BA%8B.html`);
assert.equal(publicUrlForHtmlPath('blog/nested/a.html', origin), null);
assert.equal(publicUrlForHtmlPath('404.html', origin), null);
assert.equal(publicUrlForHtmlPath('_backup-old/index.html', origin), null);
assert.equal(publicUrlForHtmlPath('../outside.html', origin), null);
assert.doesNotThrow(() => assertCoveredPublicHtmlPath('admin-post.html'));
assert.doesNotThrow(() => assertCoveredPublicHtmlPath('.github/maintenance.html'));
assert.doesNotThrow(() => assertCoveredPublicHtmlPath('docs/example.html'));
assert.doesNotThrow(() => assertCoveredPublicHtmlPath('scripts/fixture.html'));
assert.doesNotThrow(() => assertCoveredPublicHtmlPath('scripts/tool.mjs'));
assert.doesNotThrow(() => assertCoveredPublicHtmlPath('shoshiki/D-01.html'));
assert.equal(publicUrlForHtmlPath('shoshiki/D-01.html', origin), null);
assert.equal(publicUrlForHtmlPath('shoshiki.html', origin), `${origin}/shoshiki.html`);
assert.deepEqual(publicUrlsFromDiffRecords([
  { code: 'M', path: '.github/maintenance.html' },
  { code: 'M', path: 'docs/example.html' },
  { code: 'M', path: 'scripts/fixture.html' },
], origin), []);
assert.throws(() => assertCoveredPublicHtmlPath('cases/new.html'), /判定できないHTML/);
assert.throws(() => assertCoveredPublicHtmlPath('blog/nested/new.html'), /判定できないHTML/);

assert.throws(() => parseNameStatusZ('R100\0blog/a.html\0'), /不完全/);
assert.throws(() => parseNameStatusZ('U\0blog/a.html\0'), /未対応/);
assert.throws(() => parseNameStatusZ('\0'), /statusが不正/);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'minano-indexnow-'));
const git = (...args) => execFileSync('git', args, {
  cwd: fixture,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
try {
  git('init', '--quiet');
  git('config', 'user.name', 'IndexNow Test');
  git('config', 'user.email', 'indexnow-test@example.invalid');
  fs.mkdirSync(path.join(fixture, 'blog'));
  fs.writeFileSync(path.join(fixture, 'index.html'), '<h1>before</h1>\n');
  fs.writeFileSync(path.join(fixture, 'blog', 'old.html'), '<h1>old</h1>\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'before');
  const before = git('rev-parse', 'HEAD');

  fs.writeFileSync(path.join(fixture, 'index.html'), '<h1>after</h1>\n');
  git('mv', 'blog/old.html', 'blog/new.html');
  fs.writeFileSync(path.join(fixture, 'admin-post.html'), '<h1>private</h1>\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'after');
  const after = git('rev-parse', 'HEAD');

  assert.deepEqual(changedPublicUrlsFromGit({ root: fixture, from: before, to: after, origin }), [
    `${origin}/blog/old.html`,
    `${origin}/blog/new.html`,
    `${origin}/`,
  ]);
  assert.throws(
    () => changedPublicUrlsFromGit({ root: fixture, from: after, to: before, origin }),
    /祖先ではありません/,
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log('IndexNow差分抽出テスト合格');
