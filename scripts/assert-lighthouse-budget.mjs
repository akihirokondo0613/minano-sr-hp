import { readFile } from 'node:fs/promises';
import process from 'node:process';

const profiles = {
  mobile: { performance: 0.88, lcp: 3800, tbt: 200, cls: 0.1, bytes: 600 * 1024 },
  desktop: { performance: 0.95, lcp: 2000, tbt: 150, cls: 0.1, bytes: 700 * 1024 },
};

const [profileName, reportPath] = process.argv.slice(2);
const budget = profiles[profileName];
if (!budget || !reportPath) {
  console.error('使い方: node scripts/assert-lighthouse-budget.mjs <mobile|desktop> <report.json>');
  process.exit(2);
}

const report = JSON.parse(await readFile(reportPath, 'utf8'));
const values = {
  performance: report.categories.performance.score,
  lcp: report.audits['largest-contentful-paint'].numericValue,
  tbt: report.audits['total-blocking-time'].numericValue,
  cls: report.audits['cumulative-layout-shift'].numericValue,
  bytes: report.audits['total-byte-weight'].numericValue,
};
const failures = Object.entries(budget)
  .filter(([key, limit]) => key === 'performance' ? values[key] < limit : values[key] > limit)
  .map(([key, limit]) => `${key}: 実測 ${values[key]} / 基準 ${key === 'performance' ? '以上' : '以下'} ${limit}`);

console.log(`${profileName}: performance=${Math.round(values.performance * 100)}, LCP=${Math.round(values.lcp)}ms, TBT=${Math.round(values.tbt)}ms, CLS=${values.cls.toFixed(3)}, 転送=${Math.round(values.bytes / 1024)}KiB`);
if (failures.length) {
  console.error('Lighthouse性能基準を満たしていません。');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
