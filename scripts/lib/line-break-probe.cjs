/**
 * ブラウザー内で日本語の「泣き別れ」を実測する共通probe。
 *
 * probeLineBreaks は Playwright の page.evaluate() に関数として渡すため、
 * Node.js側の値をclosure参照しない。
 */

async function revealLineBreakContent() {
  document.documentElement.style.scrollBehavior = 'auto';
  document.body.style.scrollBehavior = 'auto';

  const waitForLayout = () => new Promise(
    (resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  const documentHeight = () => Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  );
  const step = Math.max(320, Math.floor(innerHeight * 0.75));

  // content-visibility:auto の節を間なく表示領域へ送り、遅延描画で文書高が
  // 伸びる場合も追随する。最大3巡で無限に伸びるページでも終了を保証する。
  for (let pass = 0; pass < 3; pass += 1) {
    const heightBefore = documentHeight();
    const bottom = Math.max(0, heightBefore - innerHeight);
    for (let y = 0; y < bottom; y += step) {
      scrollTo(0, y);
      await waitForLayout();
    }
    scrollTo(0, bottom);
    await waitForLayout();
    if (documentHeight() <= heightBefore + 1) break;
  }

  scrollTo(0, 0);
  await waitForLayout();
}

async function prepareLineBreakProbe(page) {
  await page.waitForFunction(() => {
    const style = document.querySelector('link[data-async-style]');
    return !style || style.media === 'all';
  }, null, { timeout: 8000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(revealLineBreakContent);
}

function probeLineBreaks() {
  const out = [];
  const seen = new Set();
  const vw = document.documentElement.clientWidth;
  const targetSelector = 'h1,h2,h3,h4,p,li,dd,figcaption,blockquote';
  const targets = document.querySelectorAll(targetSelector);
  let candidateCount = 0;
  let eligibleCount = 0;
  let measuredCount = 0;
  targets.forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    // strong/a/span等のインライン要素内も含める。最寄りの監査対象が自身の文字だけを採り、
    // li内のpなどを親子双方で二重計上しない。
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim().length) continue;
      if (node.parentElement?.closest(targetSelector) !== el) continue;
      nodes.push(node);
    }
    if (!nodes.length) return;
    const full = el.textContent.replace(/\s+/g, '');
    if (full.length < 12) return;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    candidateCount += 1;
    // 旧AUDITと同じ対象集合を維持する。PCのmax-widthカラムではeligible=0も
    // あり得るため、候補を走査できたかと監査対象になったかを別々に数える。
    if (box.width < vw * 0.55) return;
    eligibleCount += 1;

    const lines = [];
    for (const node of nodes) {
      const t = node.textContent;
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (/\s/.test(ch)) continue;
        const rg = document.createRange();
        rg.setStart(node, i); rg.setEnd(node, i + 1);
        const r = rg.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const top = Math.round(r.top);
        let line = lines.find((l) => Math.abs(l.top - top) <= 3);
        if (!line) { line = { top, chars: '' }; lines.push(line); }
        line.chars += ch;
      }
    }
    if (lines.length) measuredCount += 1;
    if (lines.length < 2) return;
    lines.sort((a, b) => a.top - b.top);
    const last = lines[lines.length - 1];
    if (last.chars.length > 1) return;

    const key = el.tagName + '|' + full.slice(0, 40) + '|' + last.chars;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 28),
      text: el.textContent.trim().slice(0, 48),
      orphan: last.chars,
      prev: lines.length >= 2 ? lines[lines.length - 2].chars.slice(-18) : '',
    });
  });
  return {
    measured: candidateCount > 0 && measuredCount === eligibleCount,
    targetCount: targets.length,
    candidateCount,
    eligibleCount,
    measuredCount,
    findings: out,
  };
}

module.exports = {
  prepareLineBreakProbe,
  probeLineBreaks,
  revealLineBreakContent,
};
