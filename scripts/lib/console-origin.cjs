'use strict';
/**
 * コンソールのエラーが「自分の配信元」以外から出たものかを見る。
 * 外部の埋め込み（Google マップなど）が自分のスクリプトの中で出す一過性のエラーで
 * CI が赤くなるのを防ぐ（2026-09-11、最終CTA 40条件が about.html の地図で落ちた）。
 * 各台本の requestfailed・response は前から「自分の配信元だけ見る」原則。console もそろえる。
 * 出所が分からないもの（location が空・URL として壊れている）は判断できないので残す。
 * 自分のページの未捕捉エラーは pageerror が別に拾う。
 */
function isForeignConsoleError(message, base) {
  const location = (message && typeof message.location === 'function' && message.location().url) || '';
  if (!location) return false;
  try {
    return new URL(location).origin !== new URL(base).origin;
  } catch {
    return false;
  }
}

module.exports = { isForeignConsoleError };
