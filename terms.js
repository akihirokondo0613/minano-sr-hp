(function () {
  'use strict';

  if (typeof window.__mnTermsReinit === 'function') {
    window.__mnTermsReinit();
    return;
  }

  const TERMS = [
    // 出典: https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.html
    {
      key: '算定基礎届',
      yomi: 'さんていきそとどけ',
      desc: '4〜6月に支払われた給与をもとに、社会保険料のベースになる金額（標準報酬月額）を年に1回決め直す届出。毎年7月10日までに、会社が年金事務所へ提出します。'
    },
    {
      key: '年度更新',
      yomi: 'ねんどこうしん',
      desc: '1年分の労働保険料を精算し、次の1年分を申告・納付する手続き。毎年6月1日から7月10日までの間に、会社が行います。'
    },
    {
      key: '標準報酬月額',
      yomi: 'ひょうじゅんほうしゅうげっがく',
      desc: '社会保険料や将来の年金額を計算するときの基準になる金額。実際の給与を等級表にあてはめて決めます。'
    },
    {
      key: '定時決定',
      yomi: 'ていじけってい',
      desc: '標準報酬月額を年に1回見直す仕組み。算定基礎届の提出がこれにあたり、決まった額はその年の9月分から翌年8月分まで使われます。'
    },
    // 出典: https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150515-02.html
    {
      key: '月額変更届',
      yomi: 'げつがくへんこうとどけ',
      desc: '基本給や手当などの固定的賃金が変わり、その後3か月の各月が必要な給与計算対象日数を満たし、標準報酬月額がその変動と同じ方向に原則2等級以上変わるときの届出。4か月目から改定します。'
    },
    {
      key: '資格取得届',
      yomi: 'しかくしゅとくとどけ',
      desc: '従業員が社会保険（健康保険・厚生年金）に入るときの届出。入社日から5日以内に会社が提出します。'
    },
    {
      key: '資格喪失届',
      yomi: 'しかくそうしつとどけ',
      desc: '従業員が社会保険から抜けるときの届出。退職日の翌日から5日以内に会社が提出します。'
    },
    {
      key: '離職票',
      yomi: 'りしょくひょう',
      desc: '退職した方が失業給付を受けるために必要な書類。会社がハローワークで発行の手続きをし、本人へ渡します。'
    },
    {
      key: '被扶養者',
      yomi: 'ひふようしゃ',
      desc: '健康保険で、加入者本人に生計を支えられている家族のこと。収入などの条件を満たすと、家族分の保険料を負担せずに健康保険を使えます。'
    },
    // 出典: https://www.mhlw.go.jp/content/000600768.pdf
    {
      key: '36協定',
      yomi: 'さぶろくきょうてい',
      desc: '会社が法定労働時間を超える残業や法定休日労働をさせるため、過半数労働組合または過半数代表者と結ぶ協定。開始前に労働基準監督署へ届け出る必要があります。'
    },
    {
      key: '労使協定',
      yomi: 'ろうしきょうてい',
      desc: '会社と従業員代表が取り交わす書面の約束。36協定のほか、変形労働時間制や賃金からの控除などで必要になります。'
    },
    {
      key: '割増賃金',
      yomi: 'わりましちんぎん',
      desc: '残業・休日・深夜に働いた分に、通常の賃金へ上乗せして支払うお金。いわゆる残業代のことです。'
    },
    {
      key: '固定残業代',
      yomi: 'こていざんぎょうだい',
      desc: '毎月あらかじめ決まった額の残業代を、実際の残業時間にかかわらず支払う方式。何時間分かを明示し、超えた分は追加で払う必要があります。'
    },
    {
      key: '賃金台帳',
      yomi: 'ちんぎんだいちょう',
      desc: '従業員ごとの賃金の支払い内容を記録する帳簿。労働者名簿・出勤簿とあわせて、会社に備え付けが義務づけられています。'
    },
    {
      key: '労働者名簿',
      yomi: 'ろうどうしゃめいぼ',
      desc: '従業員の氏名・生年月日・業務内容などを記録する帳簿。会社に備え付けが義務づけられています。'
    },
    {
      key: '出勤簿',
      yomi: 'しゅっきんぼ',
      desc: '従業員の出退勤や労働時間を記録するもの。タイムカードや勤怠システムの記録もこれにあたります。'
    },
    {
      key: '電子申請',
      yomi: 'でんししんせい',
      desc: '社会保険や雇用保険の手続きを、窓口や郵送ではなくインターネットで行う方法。特定の法人には一部手続きで義務づけられています。'
    },
    {
      key: '労働保険',
      yomi: 'ろうどうほけん',
      desc: '労災保険と雇用保険をまとめた呼び方。従業員を1人でも雇うと、原則として加入する必要があります。'
    },
    {
      key: '労災保険',
      yomi: 'ろうさいほけん',
      desc: '仕事中や通勤中のケガ・病気を補償する国の保険。保険料は全額を会社が負担します。'
    },
    {
      key: '是正勧告',
      yomi: 'ぜせいかんこく',
      desc: '労働基準監督署の調査で法令違反が見つかったときに、期限を示して改善を求める文書。放置すると、より重い措置に進むことがあります。'
    },
    // 出典: https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20141203.html
    {
      key: '賞与支払届',
      yomi: 'しょうよしはらいとどけ',
      desc: '賞与を支給した事業主が、支給額などを日本年金機構へ届け出る書類。届出内容をもとに標準賞与額と社会保険料が決まり、賞与支払日から5日以内に提出します。'
    },
    // 出典: https://www.check-roudou.mhlw.go.jp/study/roudousya_yukyu.html
    {
      key: '年次有給休暇',
      yomi: 'ねんじゆうきゅうきゅうか',
      desc: '一定期間勤務し、出勤率などの要件を満たした労働者が、賃金を受けながら休める制度。原則は入社6か月・出勤率8割以上で10日です。週4日以下かつ週30時間未満の人は、所定労働日数に応じて比例付与されます。'
    },
    // 出典: https://www.kyoukaikenpo.or.jp/benefit/injury_and_sickness_allowance/
    {
      key: '傷病手当金',
      yomi: 'しょうびょうてあてきん',
      desc: '健康保険の被保険者が、業務外の病気やけがで仕事に就けず、給与が出ない、または傷病手当金より少ないときの給付。連続3日間の待期後、4日目以降の休業日が対象です。'
    },
    // 出典: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/keiyaku/index.html
    {
      key: '労働条件通知書',
      yomi: 'ろうどうじょうけんつうちしょ',
      desc: '労働契約を結ぶ際に、会社が労働者へ労働条件を明示するための文書。契約期間、就業場所・業務、労働時間、賃金などは原則書面で明示し、本人が希望すれば一定の電子的方法も使えます。'
    },
    // 出典: https://www.mhlw.go.jp/content/001234797.pdf
    {
      key: '雇用契約書',
      yomi: 'こようけいやくしょ',
      desc: '会社と労働者が、働くことと賃金を支払うことへの合意や労働条件を確認する書面。契約自体は合意で成立しますが、内容はできる限り書面で確認することとされています。'
    }
  ];

  const SORTED_TERMS = TERMS.slice().sort(function (a, b) {
    return b.key.length - a.key.length;
  });
  const EXCLUDED_SELECTOR = [
    'h1',
    'h2',
    'h3',
    'nav',
    '.nav',
    '.footer',
    '.breadcrumb',
    'script',
    'style',
    'noscript',
    'template',
    'a',
    'button',
    '.term',
    'input',
    'textarea',
    'select',
    'option',
    'label',
    'summary',
    'svg',
    'canvas',
    'iframe',
    'object',
    'embed',
    'audio',
    'video',
    'code',
    'pre',
    'kbd',
    'samp',
    'var',
    'ruby',
    'rt',
    'rp',
    '[contenteditable]',
    '[aria-hidden="true"]'
  ].join(',');

  const VIEWPORT_GUTTER = 12;
  const POP_GAP = 10;
  let controller = null;
  let initSerial = 0;

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function getViewport() {
    const viewport = window.visualViewport;
    if (viewport) {
      return {
        left: viewport.offsetLeft,
        top: viewport.offsetTop,
        width: viewport.width,
        height: viewport.height
      };
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest(EXCLUDED_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function nextMatch(text, cursor, usedTerms) {
    let best = null;
    SORTED_TERMS.forEach(function (term) {
      if (usedTerms.has(term.key)) return;
      const index = text.indexOf(term.key, cursor);
      if (index < 0) return;
      if (!best || index < best.index || (index === best.index && term.key.length > best.term.key.length)) {
        best = { term: term, index: index };
      }
    });
    return best;
  }

  function createController() {
    const body = document.body;
    const main = document.querySelector('main');
    const abortController = new AbortController();
    const signal = abortController.signal;
    const markers = [];
    const popovers = [];
    const pairs = new Map();
    const usedTerms = new Set();
    const hoverFine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const serial = ++initSerial;
    let activeMarker = null;
    let frame = 0;
    let destroyed = false;

    function closeActive() {
      if (!activeMarker) return;
      const popover = pairs.get(activeMarker);
      activeMarker.classList.remove('open', 'is-open');
      activeMarker.setAttribute('aria-expanded', 'false');
      if (popover) {
        popover.classList.remove('open', 'is-open');
        popover.dataset.open = 'false';
      }
      activeMarker = null;
    }

    function positionPopover(marker) {
      const popover = pairs.get(marker);
      if (!popover || !marker.isConnected || !popover.isConnected) {
        closeActive();
        return;
      }

      const previous = {
        display: popover.style.display,
        visibility: popover.style.visibility,
        opacity: popover.style.opacity,
        transition: popover.style.transition
      };
      popover.style.display = 'block';
      popover.style.visibility = 'hidden';
      popover.style.opacity = '0';
      popover.style.transition = 'none';
      popover.style.left = '0px';
      popover.style.top = '0px';

      const markerRect = marker.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const viewport = getViewport();
      const viewportLeft = viewport.left + VIEWPORT_GUTTER;
      const viewportTop = viewport.top + VIEWPORT_GUTTER;
      const viewportRight = viewport.left + viewport.width - VIEWPORT_GUTTER;
      const viewportBottom = viewport.top + viewport.height - VIEWPORT_GUTTER;
      const anchorX = markerRect.left + markerRect.width / 2;
      const idealLeft = anchorX - popoverRect.width / 2;
      const left = clamp(idealLeft, viewportLeft, viewportRight - popoverRect.width);
      const roomBelow = viewportBottom - markerRect.bottom - POP_GAP;
      const roomAbove = markerRect.top - viewportTop - POP_GAP;
      const useTop = popoverRect.height > roomBelow && roomAbove > roomBelow;
      const idealTop = useTop
        ? markerRect.top - POP_GAP - popoverRect.height
        : markerRect.bottom + POP_GAP;
      const top = clamp(idealTop, viewportTop, viewportBottom - popoverRect.height);
      const arrowX = clamp(anchorX - left, 16, Math.max(16, popoverRect.width - 16));

      popover.dataset.side = useTop ? 'top' : 'bottom';
      if (idealLeft < viewportLeft) popover.dataset.align = 'left';
      else if (idealLeft + popoverRect.width > viewportRight) popover.dataset.align = 'right';
      else popover.dataset.align = 'center';
      popover.style.setProperty('--term-arrow-x', arrowX + 'px');
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
      popover.style.display = previous.display;
      popover.style.visibility = previous.visibility;
      popover.style.opacity = previous.opacity;
      popover.style.transition = previous.transition;
    }

    function openMarker(marker, mode) {
      if (destroyed || !pairs.has(marker)) return;
      if (activeMarker && activeMarker !== marker) closeActive();
      activeMarker = marker;
      marker.dataset.openMode = mode || '';
      marker.classList.add('open', 'is-open');
      marker.setAttribute('aria-expanded', 'true');
      const popover = pairs.get(marker);
      popover.classList.add('open', 'is-open');
      popover.dataset.open = 'true';
      positionPopover(marker);
      window.requestAnimationFrame(function () {
        if (activeMarker === marker) positionPopover(marker);
      });
    }

    function toggleMarker(marker, mode, wasOpen) {
      if (wasOpen === true || (wasOpen === undefined && activeMarker === marker)) closeActive();
      else openMarker(marker, mode);
    }

    function schedulePosition() {
      if (!activeMarker || frame) return;
      frame = window.requestAnimationFrame(function () {
        frame = 0;
        if (activeMarker) positionPopover(activeMarker);
      });
    }

    function addMarker(term, markerIndex) {
      const marker = document.createElement('span');
      const popover = document.createElement('span');
      const title = document.createElement('b');
      const description = document.createElement('span');
      const popoverId = 'mn-term-pop-' + serial + '-' + markerIndex;

      marker.className = 'term';
      marker.tabIndex = 0;
      marker.setAttribute('role', 'button');
      marker.setAttribute('aria-describedby', popoverId);
      marker.setAttribute('aria-expanded', 'false');
      marker.dataset.termKey = term.key;
      marker.textContent = term.key;

      popover.className = 'term-pop';
      popover.id = popoverId;
      popover.setAttribute('role', 'tooltip');
      popover.dataset.open = 'false';
      popover.style.position = 'fixed';
      title.textContent = term.key + '（' + term.yomi + '）';
      description.textContent = term.desc;
      popover.append(title, description);
      body.appendChild(popover);

      markers.push(marker);
      popovers.push(popover);
      pairs.set(marker, popover);
      return marker;
    }

    if (main) {
      const textNodes = collectTextNodes(main);
      let markerIndex = 0;

      textNodes.forEach(function (node) {
        if (!node.isConnected || !node.parentElement || node.parentElement.closest(EXCLUDED_SELECTOR)) return;
        const text = node.nodeValue;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        let match = nextMatch(text, cursor, usedTerms);
        if (!match) return;

        while (match) {
          if (match.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
          markerIndex += 1;
          fragment.appendChild(addMarker(match.term, markerIndex));
          usedTerms.add(match.term.key);
          cursor = match.index + match.term.key.length;
          match = nextMatch(text, cursor, usedTerms);
        }
        if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
        node.replaceWith(fragment);
      });
    }

    markers.forEach(function (marker) {
      let pointerType = '';
      let wasOpenOnPointerDown = false;

      marker.addEventListener('pointerenter', function () {
        if (hoverFine.matches) openMarker(marker, 'hover');
      }, { signal: signal });
      marker.addEventListener('pointerleave', function () {
        if (!hoverFine.matches || activeMarker !== marker) return;
        if (document.activeElement !== marker) closeActive();
      }, { signal: signal });
      marker.addEventListener('focus', function () {
        openMarker(marker, 'focus');
      }, { signal: signal });
      marker.addEventListener('blur', function () {
        if (activeMarker !== marker) return;
        if (hoverFine.matches && marker.matches(':hover')) return;
        closeActive();
      }, { signal: signal });
      marker.addEventListener('pointerdown', function (event) {
        pointerType = event.pointerType || '';
        wasOpenOnPointerDown = activeMarker === marker;
      }, { signal: signal });
      marker.addEventListener('click', function (event) {
        event.stopPropagation();
        if (pointerType === 'touch' || pointerType === 'pen' || !hoverFine.matches) {
          toggleMarker(marker, 'pointer', wasOpenOnPointerDown);
        } else {
          openMarker(marker, 'pointer');
        }
        pointerType = '';
      }, { signal: signal });
      marker.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const lockedOpen = activeMarker === marker && marker.dataset.openMode === 'keyboard';
          toggleMarker(marker, 'keyboard', lockedOpen);
        }
      }, { signal: signal });
    });

    document.addEventListener('pointerdown', function (event) {
      if (!activeMarker) return;
      const popover = pairs.get(activeMarker);
      if (activeMarker.contains(event.target) || (popover && popover.contains(event.target))) return;
      closeActive();
    }, { signal: signal });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeActive();
    }, { signal: signal });
    window.addEventListener('scroll', schedulePosition, { passive: true, capture: true, signal: signal });
    window.addEventListener('resize', schedulePosition, { passive: true, signal: signal });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('scroll', schedulePosition, { passive: true, signal: signal });
      window.visualViewport.addEventListener('resize', schedulePosition, { passive: true, signal: signal });
    }

    body.dataset.mnTermsReady = 'true';

    return {
      body: body,
      markerCount: markers.length,
      close: closeActive,
      reposition: schedulePosition,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        abortController.abort();
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        closeActive();
        popovers.forEach(function (popover) {
          popover.remove();
        });
        markers.forEach(function (marker) {
          if (marker.parentNode) marker.replaceWith(document.createTextNode(marker.dataset.termKey || marker.textContent));
        });
        if (body.dataset.mnTermsReady === 'true') delete body.dataset.mnTermsReady;
      }
    };
  }

  window.__mnTermsReinit = function () {
    if (controller && controller.body === document.body && document.body.dataset.mnTermsReady === 'true') {
      controller.reposition();
      return controller;
    }
    if (controller) controller.destroy();
    controller = createController();
    window.__mnTermsController = controller;
    return controller;
  };

  function initialize() {
    window.__mnTermsReinit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
