'use strict';

/**
 * ページ内で完結するアクセシビリティ実測プローブ。
 *
 * Playwright の `page.evaluate(probeA11y, config)` へそのまま渡せるよう、
 * 外側の定数や関数を参照しない。返却配列は集計前に切り捨てない。
 *
 * @param {object} [config]
 * @returns {object}
 */
function probeA11y(config = {}) {
  const aaNormal = Number.isFinite(config.aaNormal) ? config.aaNormal : 4.5;
  const aaLarge = Number.isFinite(config.aaLarge) ? config.aaLarge : 3;
  const targetSize = Number.isFinite(config.targetSize) ? config.targetSize : 24;
  const photoSelectors = Array.isArray(config.photoSelectors)
    ? config.photoSelectors.filter((selector) => typeof selector === 'string' && selector.trim())
    : [];
  const scopeSelectors = Array.isArray(config.scopeSelectors)
    ? config.scopeSelectors.filter((selector) => typeof selector === 'string' && selector.trim())
    : [];
  const auditLayout = config.auditLayout !== false;
  const overflowTolerance = Number.isFinite(config.overflowTolerance)
    ? config.overflowTolerance
    : 1;

  // CSSOM の直列化はエンジンで異なるため、1px Canvasへ実際に描画し、
  // getImageDataのsRGB値へ統一する。display-p3もここでsRGBへ変換される。
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const colorContext = canvas.getContext('2d', {
    alpha: true,
    colorSpace: 'srgb',
    willReadFrequently: true,
  });
  const colorCache = new Map();

  const parseColor = (value) => {
    const cacheKey = String(value || '').trim();
    if (colorCache.has(cacheKey)) return colorCache.get(cacheKey);
    if (!cacheKey || !colorContext || (globalThis.CSS?.supports
      && !globalThis.CSS.supports('color', cacheKey))) {
      colorCache.set(cacheKey, null);
      return null;
    }

    let parsed = null;
    try {
      colorContext.clearRect(0, 0, 1, 1);
      // 無効値を前回値と取り違えないため、代入前に既知の色へ戻す。
      colorContext.fillStyle = 'rgba(1, 2, 3, 1)';
      colorContext.fillStyle = cacheKey;
      colorContext.fillRect(0, 0, 1, 1);
      const pixel = colorContext.getImageData(0, 0, 1, 1).data;
      parsed = {
        r: pixel[0],
        g: pixel[1],
        b: pixel[2],
        a: pixel[3] / 255,
      };
    } catch {
      parsed = null;
    }
    colorCache.set(cacheKey, parsed);
    return parsed;
  };

  // CSS compositingのsource-over。RGBは非乗算値として保持する。
  const sourceOver = (source, backdrop) => {
    const outA = source.a + backdrop.a * (1 - source.a);
    if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (source.r * source.a
        + backdrop.r * backdrop.a * (1 - source.a)) / outA,
      g: (source.g * source.a
        + backdrop.g * backdrop.a * (1 - source.a)) / outA,
      b: (source.b * source.a
        + backdrop.b * backdrop.a * (1 - source.a)) / outA,
      a: outA,
    };
  };

  const luminance = (color) => {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r)
      + 0.7152 * channel(color.g)
      + 0.0722 * channel(color.b);
  };

  const contrastRatio = (first, second) => {
    const firstLuminance = luminance(first);
    const secondLuminance = luminance(second);
    return (Math.max(firstLuminance, secondLuminance) + 0.05)
      / (Math.min(firstLuminance, secondLuminance) + 0.05);
  };

  const colorLabel = (color) => color
    ? `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Number(color.a.toFixed(3))})`
    : null;

  const splitTopLevel = (value) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === '(') depth += 1;
      else if (value[index] === ')') depth -= 1;
      else if (value[index] === ',' && depth === 0) {
        parts.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts;
  };

  const gradientStopColor = (value) => {
    const direct = parseColor(value);
    if (direct) return direct;
    // 色関数の後ろにstop位置が続く形を、関数名のallowlistなしで扱う。
    // `oklch(...) 0%` 等を方向指定と誤認して先頭stopを捨てない。
    for (let index = value.length - 1; index > 0; index -= 1) {
      if (!/\s/.test(value[index])) continue;
      const candidate = value.slice(0, index).trim();
      const parsed = parseColor(candidate);
      if (parsed) return parsed;
    }
    return null;
  };

  const solidGradientColor = (value) => {
    const match = value.match(/^linear-gradient\((.*)\)$/i);
    if (!match) return null;
    const parts = splitTopLevel(match[1]);
    const colors = [];
    for (let index = 0; index < parts.length; index += 1) {
      const color = gradientStopColor(parts[index]);
      if (!color && index === 0 && /^(?:to\s|[-+]?\d*\.?\d+(?:deg|grad|rad|turn)\b)/i.test(parts[index])) {
        continue; // 明示的な角度・方向指定だけを読み飛ばす
      }
      if (!color) return null;
      colors.push(color);
    }
    if (colors.length < 2) return null;
    const first = colors[0];
    const same = colors.every((color) => ['r', 'g', 'b', 'a'].every(
      (channel) => Math.abs(color[channel] - first[channel]) <= (channel === 'a' ? 1 / 255 : 1),
    ));
    return same ? first : null;
  };

  const resolveBackgroundLength = (value, reference, autoValue = null) => {
    const token = String(value || '').trim().toLowerCase();
    if (token === 'auto') return autoValue;
    const match = token.match(/^(-?\d*\.?\d+)(px|%)$/);
    if (!match) return null;
    const number = Number(match[1]);
    return match[2] === '%' ? reference * number / 100 : number;
  };

  const resolveBackgroundPosition = (value, freeSpace) => {
    const token = String(value || '').trim().toLowerCase();
    if (token === 'left' || token === 'top') return 0;
    if (token === 'center') return freeSpace / 2;
    if (token === 'right' || token === 'bottom') return freeSpace;
    return resolveBackgroundLength(token, freeSpace);
  };

  const backgroundOriginRect = (element, style) => {
    const rect = element.getBoundingClientRect();
    const border = {
      left: Number.parseFloat(style.borderLeftWidth) || 0,
      right: Number.parseFloat(style.borderRightWidth) || 0,
      top: Number.parseFloat(style.borderTopWidth) || 0,
      bottom: Number.parseFloat(style.borderBottomWidth) || 0,
    };
    const padding = {
      left: Number.parseFloat(style.paddingLeft) || 0,
      right: Number.parseFloat(style.paddingRight) || 0,
      top: Number.parseFloat(style.paddingTop) || 0,
      bottom: Number.parseFloat(style.paddingBottom) || 0,
    };
    let left = rect.left;
    let right = rect.right;
    let top = rect.top;
    let bottom = rect.bottom;
    if (style.backgroundOrigin === 'padding-box' || style.backgroundOrigin === 'content-box') {
      left += border.left;
      right -= border.right;
      top += border.top;
      bottom -= border.bottom;
    }
    if (style.backgroundOrigin === 'content-box') {
      left += padding.left;
      right -= padding.right;
      top += padding.top;
      bottom -= padding.bottom;
    }
    return {
      left,
      right,
      top,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };

  const solidImageTouchesText = (element, style, textRects) => {
    if (!textRects?.length) return null;
    if (style.backgroundRepeat !== 'no-repeat') return null;
    const sizeParts = style.backgroundSize.trim().split(/\s+/);
    if (sizeParts.length < 1 || sizeParts.length > 2) return null;
    const origin = backgroundOriginRect(element, style);
    const width = resolveBackgroundLength(sizeParts[0], origin.width, origin.width);
    const height = resolveBackgroundLength(sizeParts[1] ?? 'auto', origin.height, origin.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return false;

    const positionParts = style.backgroundPosition.trim().split(/\s+/);
    if (positionParts.length < 1 || positionParts.length > 2) return null;
    const offsetX = resolveBackgroundPosition(positionParts[0], origin.width - width);
    const offsetY = resolveBackgroundPosition(positionParts[1] ?? '50%', origin.height - height);
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return null;
    const imageRect = {
      left: origin.left + offsetX,
      right: origin.left + offsetX + width,
      top: origin.top + offsetY,
      bottom: origin.top + offsetY + height,
    };
    return textRects.some((rect) => rect.right > imageRect.left
      && rect.left < imageRect.right
      && rect.bottom > imageRect.top
      && rect.top < imageRect.bottom);
  };

  const selectorOf = (element) => {
    let selector = element.tagName.toLowerCase();
    if (element.id) selector += `#${element.id}`;
    const classNames = typeof element.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean)
      : [];
    if (classNames.length) selector += `.${classNames.join('.')}`;
    return selector;
  };

  const pathOf = (element) => {
    const segments = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segment += `#${current.id}`;
        segments.unshift(segment);
        break;
      }
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter((sibling) => sibling.tagName === current.tagName)
        : [];
      if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      segments.unshift(segment);
      if (current === document.body) break;
    }
    return segments.join(' > ');
  };

  const componentOf = (element) => {
    const owner = element.closest('[data-component], main, header, footer, nav, article, section');
    if (!owner) return 'body';
    if (owner.hasAttribute('data-component')) {
      return `data-component:${owner.getAttribute('data-component') || '(empty)'}`;
    }
    return selectorOf(owner);
  };

  const elements = [...document.querySelectorAll('body *')];
  const inScope = (element) => !scopeSelectors.length
    || scopeSelectors.some((selector) => element.matches(selector) || element.closest(selector));
  const scopedElements = elements.filter(inScope);
  const indexByElement = new Map(elements.map((element, index) => [element, index]));
  const identityOf = (element) => {
    const nodeIndex = indexByElement.get(element);
    const path = pathOf(element);
    const component = componentOf(element);
    const selector = selectorOf(element);
    return {
      nodeIndex,
      path,
      component,
      selector,
      key: `${nodeIndex}|${path}|${component}|${selector}`,
    };
  };

  const visualState = (element, options = {}) => {
    let unresolved = null;
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (!options.ignoreAriaHidden && current.getAttribute('aria-hidden') === 'true') {
        return { excluded: 'aria-hidden', unresolved: null };
      }
      if ((current.localName || '').toLowerCase() === 'details' && !current.open) {
        const summary = current.querySelector(':scope > summary');
        if (!summary?.contains(element)) {
          return { excluded: 'closed-details', unresolved: null };
        }
      }
      if (style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || style.contentVisibility === 'hidden') {
        return { excluded: 'not-rendered', unresolved: null };
      }
      const opacity = Number.parseFloat(style.opacity);
      if (Number.isFinite(opacity) && opacity <= 0) {
        return { excluded: 'opacity-zero', unresolved: null };
      }
      if (!unresolved && Number.isFinite(opacity) && opacity > 0 && opacity < 1) {
        unresolved = 'partial-opacity';
      }
      if (!unresolved && style.filter && style.filter !== 'none') {
        unresolved = 'filter';
      }
      if (!unresolved && style.mixBlendMode && style.mixBlendMode !== 'normal') {
        unresolved = 'mix-blend-mode';
      }
    }
    return { excluded: null, unresolved };
  };

  const backgroundOf = (element, textRects) => {
    // 子孫側の背景を先に積み、祖先背景をその背後へ置く。不透明になった時点で
    // それより外側は描画結果へ影響しないため、祖先の画像等も調べず確定できる。
    let candidates = [{ r: 0, g: 0, b: 0, a: 0 }];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      if (candidates.every((candidate) => candidate.a >= 0.999)) {
        return { colors: candidates, unresolved: null };
      }
      const style = getComputedStyle(current);
      if (style.backgroundBlendMode && style.backgroundBlendMode !== 'normal') {
        return { colors: null, unresolved: 'background-blend-mode' };
      }
      const layer = parseColor(style.backgroundColor);
      if (!layer) return { colors: null, unresolved: 'unparsed-background-color' };
      const withoutImage = candidates.map((candidate) => sourceOver(candidate, layer));
      if (style.backgroundImage && style.backgroundImage !== 'none') {
        const imageLayer = solidGradientColor(style.backgroundImage);
        if (!imageLayer) return { colors: null, unresolved: 'complex-background' };
        const touchesText = solidImageTouchesText(current, style, textRects);
        if (touchesText === null) {
          return { colors: null, unresolved: 'complex-background-geometry' };
        }
        if (!touchesText) {
          candidates = withoutImage;
          continue;
        }
        const imageBackdrop = sourceOver(imageLayer, layer);
        const withImage = candidates.map((candidate) => sourceOver(candidate, imageBackdrop));
        candidates = [...withoutImage, ...withImage];
      } else {
        candidates = withoutImage;
      }
    }
    // どの要素にも不透明背景がなければUAの既定キャンバス色を背後に置く。
    return {
      colors: candidates.map((candidate) => sourceOver(
        candidate,
        { r: 255, g: 255, b: 255, a: 1 },
      )),
      unresolved: null,
    };
  };

  const backgroundForText = (element, textRects, ownStyle = null) => {
    const base = backgroundOf(element, textRects);
    if (base.unresolved || !ownStyle) return base;

    const opacity = Number.parseFloat(ownStyle.opacity);
    if (Number.isFinite(opacity) && opacity > 0 && opacity < 1) {
      return { colors: null, unresolved: 'pseudo-partial-opacity' };
    }
    if (ownStyle.backgroundBlendMode && ownStyle.backgroundBlendMode !== 'normal') {
      return { colors: null, unresolved: 'pseudo-background-blend-mode' };
    }
    if (String(ownStyle.backgroundClip || '').includes('text')) {
      return { colors: null, unresolved: 'pseudo-background-clip-text' };
    }

    let layer = parseColor(ownStyle.backgroundColor);
    if (!layer) return { colors: null, unresolved: 'unparsed-pseudo-background-color' };
    if (ownStyle.backgroundImage && ownStyle.backgroundImage !== 'none') {
      const imageLayer = solidGradientColor(ownStyle.backgroundImage);
      if (!imageLayer) return { colors: null, unresolved: 'complex-pseudo-background' };
      // 疑似要素の実ボックスをDOM APIだけで一意に取れないため、
      // 両軸を通常反復する同色gradientだけを全面背景として扱う。
      // repeat-x / repeat-y / space / round / no-repeat は部分配置になり得るため推測しない。
      if (!/^repeat(?:\s+repeat)?$/.test(ownStyle.backgroundRepeat.trim())) {
        return { colors: null, unresolved: 'complex-pseudo-background-geometry' };
      }
      layer = sourceOver(imageLayer, layer);
    }
    return {
      colors: base.colors.map((backgroundColor) => sourceOver(layer, backgroundColor)),
      unresolved: null,
    };
  };

  const hasScrollableAncestor = (element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    return false;
  };

  const viewportWidth = document.documentElement.clientWidth;
  const overflow = [];
  for (const element of auditLayout ? elements : []) {
    const state = visualState(element);
    if (state.excluded) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    const intentionallyOffscreen = element.matches('.skip-link:not(:focus)');
    const intentionallyClippedMedia = element.matches(
      'image-slot > img[data-image-slot-public], .image-slot > img[data-image-slot-public]',
    ) && ['hidden', 'clip'].includes(getComputedStyle(element.parentElement).overflowX);
    // 流れるカード列（トップのTOPICS）は、視野より広い列をclipで見せる構成。
    // 列とカードのはみ出しは設計どおりなので、親が実際にclip/hiddenのときだけ除く。
    const marquee = element.closest('.tp-marquee');
    const intentionallyMarquee = Boolean(marquee)
      && ['hidden', 'clip'].includes(getComputedStyle(marquee).overflowX);
    if (!intentionallyOffscreen
        && !intentionallyClippedMedia
        && !intentionallyMarquee
        && (rect.right > viewportWidth + overflowTolerance || rect.left < -overflowTolerance)
        && !hasScrollableAncestor(element)) {
      overflow.push({
        ...identityOf(element),
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        viewportWidth,
      });
    }
  }

  const contrast = [];
  const contrastResults = [];
  const contrastUnresolved = [];
  const contrastCounts = {
    scanned: 0,
    excluded: 0,
    unresolved: 0,
    measured: 0,
    passed: 0,
    failed: 0,
    consistent: false,
  };

  const auditTextContrast = (element, text, style, identitySuffix = '', textRects = []) => {
    contrastCounts.scanned += 1;

    const identity = { ...identityOf(element) };
    if (identitySuffix) {
      identity.selector += identitySuffix;
      identity.path += identitySuffix;
      identity.key += identitySuffix;
    }
    const rect = element.getBoundingClientRect();
    const state = visualState(element);
    const inactiveOwner = element.closest(
      'button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled="true"]',
    );
    if (state.excluded || inactiveOwner || (rect.width <= 0 && rect.height <= 0)) {
      contrastCounts.excluded += 1;
      return;
    }

    if (photoSelectors.some((selector) => element.closest(selector))) {
      contrastCounts.excluded += 1;
      return;
    }

    let foreground = parseColor(style.color);
    const textStrokeWidth = Number.parseFloat(style.webkitTextStrokeWidth || '0');
    if (foreground?.a <= 0 && textStrokeWidth > 0) {
      foreground = parseColor(style.webkitTextStrokeColor);
    }
    if (identitySuffix) {
      const pseudoOpacity = Number.parseFloat(style.opacity);
      if (foreground && Number.isFinite(pseudoOpacity)) {
        foreground = { ...foreground, a: foreground.a * pseudoOpacity };
      }
    }
    if (foreground && foreground.a <= 0) {
      contrastCounts.excluded += 1;
      return;
    }

    const unresolvedReason = state.unresolved
      || (!foreground ? 'unparsed-text-color' : null);
    if (unresolvedReason) {
      contrastCounts.unresolved += 1;
      contrastUnresolved.push({ ...identity, text, reason: unresolvedReason });
      return;
    }

    const generatedPseudo = identitySuffix === '::before' || identitySuffix === '::after';
    const background = backgroundForText(element, textRects, generatedPseudo ? style : null);
    if (background.unresolved) {
      contrastCounts.unresolved += 1;
      contrastUnresolved.push({ ...identity, text, reason: background.unresolved });
      return;
    }

    const fontSize = Number.parseFloat(style.fontSize);
    const parsedWeight = Number.parseFloat(style.fontWeight);
    const fontWeight = Number.isFinite(parsedWeight)
      ? parsedWeight
      : (/bold/i.test(style.fontWeight) ? 700 : 400);
    if (!Number.isFinite(fontSize) || !Number.isFinite(fontWeight)) {
      contrastCounts.unresolved += 1;
      contrastUnresolved.push({ ...identity, text, reason: 'unparsed-font-metrics' });
      return;
    }
    const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const requiredRatio = large ? aaLarge : aaNormal;
    const measuredBackgrounds = background.colors.map((backgroundColor) => {
      const effectiveForeground = sourceOver(foreground, backgroundColor);
      return {
        backgroundColor,
        effectiveForeground,
        ratio: contrastRatio(effectiveForeground, backgroundColor),
      };
    }).sort((first, second) => first.ratio - second.ratio);
    const worst = measuredBackgrounds[0];
    const ratio = worst.ratio;
    const outcome = ratio + Number.EPSILON >= requiredRatio ? 'pass' : 'fail';
    const result = {
      ...identity,
      text,
      ratio: Number(ratio.toFixed(3)),
      need: requiredRatio,
      size: Number(fontSize.toFixed(2)),
      weight: fontWeight,
      color: style.color,
      foreground: colorLabel(worst.effectiveForeground),
      bg: colorLabel(worst.backgroundColor),
      outcome,
    };
    contrastResults.push(result);
    contrastCounts.measured += 1;
    if (outcome === 'fail') {
      contrast.push(result);
      contrastCounts.failed += 1;
    } else {
      contrastCounts.passed += 1;
    }
  };

  const directTextInfo = (element) => {
    const textNodes = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim());
    const text = textNodes
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const rects = textNodes.flatMap((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }));
    });
    return { text, rects };
  };

  const pseudoText = (style) => {
    const content = style.content;
    if (!content || content === 'none' || content === 'normal' || /^(?:url|image)\(/i.test(content)) return '';
    if ((content.startsWith('"') && content.endsWith('"'))
        || (content.startsWith("'") && content.endsWith("'"))) {
      try {
        return content.startsWith('"')
          ? JSON.parse(content)
          : content.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      } catch {
        return content.slice(1, -1);
      }
    }
    return content;
  };

  for (const element of scopedElements) {
    const direct = directTextInfo(element);
    if (direct.text.length >= 1) {
      auditTextContrast(element, direct.text, getComputedStyle(element), '', direct.rects);
    }
    for (const pseudo of ['::before', '::after']) {
      const style = getComputedStyle(element, pseudo);
      const text = pseudoText(style).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      auditTextContrast(element, text, style, pseudo, [element.getBoundingClientRect()]);
    }
  }
  for (const element of [...document.querySelectorAll('input[placeholder], textarea[placeholder]')].filter(inScope)) {
    // 入力値があるとplaceholderは描画されない。属性が残っているだけの文字を
    // 重複計測しないよう、実際に表示されている状態だけを対象にする。
    if (!element.matches(':placeholder-shown')) continue;
    const placeholder = (element.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
    if (!placeholder) continue;
    auditTextContrast(
      element,
      placeholder,
      getComputedStyle(element, '::placeholder'),
      '::placeholder',
      [element.getBoundingClientRect()],
    );
  }
  for (const element of [...document.querySelectorAll('input')].filter(inScope)) {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (!['button', 'submit', 'reset'].includes(type)) continue;
    const value = (element.value || '').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    auditTextContrast(element, value, getComputedStyle(element), '::value', [element.getBoundingClientRect()]);
  }

  contrastCounts.consistent = contrastCounts.scanned
    === contrastCounts.excluded
      + contrastCounts.unresolved
      + contrastCounts.passed
      + contrastCounts.failed
    && contrastCounts.measured === contrastCounts.passed + contrastCounts.failed;

  const interactiveRoles = new Set([
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem',
    'slider', 'spinbutton', 'scrollbar', 'combobox', 'searchbox', 'textbox',
    'gridcell',
  ]);
  const isTargetElement = (element) => {
    const localName = (element.localName || '').toLowerCase();
    if ((localName === 'a' || localName === 'area') && element.hasAttribute('href')) return true;
    if (/^(button|input|select|textarea|summary)$/.test(localName)) return true;
    if (localName === 'label' && element.control) return true;
    const role = (element.getAttribute('role') || '').toLowerCase();
    if (interactiveRoles.has(role)) return true;
    // image-slot編集用のonclickは本番で操作を実行せず、親リンクのtargetを
    // 分割するだけなので除外する。通常のonclickは引き続き監査対象。
    if (element.hasAttribute('onclick')
        && !/\bwindow\.omelette\b/.test(element.getAttribute('onclick') || '')) return true;
    return element.isContentEditable;
  };
  const targetElements = scopedElements.filter(isTargetElement);
  const targetCounts = {
    scanned: targetElements.length,
    excluded: 0,
    unresolved: 0,
    eligible: 0,
    passedSize: 0,
    passedSpacing: 0,
    passed: 0,
    failed: 0,
    consistent: false,
  };
  const eligibleTargets = [];
  const collisionTargets = [];
  const targetUnresolved = [];

  const pointerState = (element) => {
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hasAttribute('inert') || current.inert) return 'inert';
      if ((current.localName || '').toLowerCase() === 'details' && !current.open) {
        const summary = current.querySelector(':scope > summary');
        if (!summary?.contains(element)) return 'closed-details';
      }
      if (style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || style.contentVisibility === 'hidden') return 'not-rendered';
      if (style.pointerEvents === 'none') return 'pointer-events-none';
    }
    return null;
  };

  const isInlineException = (element) => {
    const display = getComputedStyle(element).display;
    if (display !== 'inline' && display !== 'inline-block') return false;
    if (element.closest('nav, menu, [role="menu"], .post-toc')) return false;
    const prose = element.closest('p, li, td, th, dd, dt, figcaption, blockquote');
    if (!prose) return false;
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (!(textNode.textContent || '').trim()) continue;
      let ownerTarget = textNode.parentElement;
      while (ownerTarget && ownerTarget !== prose && !isTargetElement(ownerTarget)) {
        ownerTarget = ownerTarget.parentElement;
      }
      if (!element.contains(textNode.parentElement)
          && (!ownerTarget || ownerTarget === prose || !isTargetElement(ownerTarget))) return true;
    }
    return false;
  };

  const parseRadius = (value, width, height) => {
    const parts = String(value || '0').trim().split(/\s+/);
    const resolve = (token, reference) => {
      const match = token.match(/^(-?\d*\.?\d+)(px|%)$/);
      if (!match) return null;
      return match[2] === '%' ? reference * Number(match[1]) / 100 : Number(match[1]);
    };
    const x = resolve(parts[0], width);
    const y = resolve(parts[1] ?? parts[0], height);
    return Number.isFinite(x) && Number.isFinite(y)
      ? { x: Math.max(0, x), y: Math.max(0, y) }
      : null;
  };

  const roundedRegion = (element, rect, style = getComputedStyle(element), source = 'element') => {
    const raw = [
      parseRadius(style.borderTopLeftRadius, rect.width, rect.height),
      parseRadius(style.borderTopRightRadius, rect.width, rect.height),
      parseRadius(style.borderBottomRightRadius, rect.width, rect.height),
      parseRadius(style.borderBottomLeftRadius, rect.width, rect.height),
    ];
    if (raw.some((radius) => !radius)) return null;
    const [topLeft, topRight, bottomRight, bottomLeft] = raw;
    const scale = Math.min(
      1,
      rect.width / Math.max(Number.EPSILON, topLeft.x + topRight.x),
      rect.width / Math.max(Number.EPSILON, bottomLeft.x + bottomRight.x),
      rect.height / Math.max(Number.EPSILON, topLeft.y + bottomLeft.y),
      rect.height / Math.max(Number.EPSILON, topRight.y + bottomRight.y),
    );
    return {
      source,
      rect,
      radii: raw.map((radius) => ({ x: radius.x * scale, y: radius.y * scale })),
    };
  };

  const parsePixel = (value) => {
    const match = String(value || '').trim().match(/^(-?\d*\.?\d+)px$/);
    return match ? Number(match[1]) : null;
  };

  const pseudoHitRegions = (element, elementRect) => {
    const regions = [];
    let unresolved = null;
    for (const pseudo of ['::before', '::after']) {
      const style = getComputedStyle(element, pseudo);
      if (!style.content || style.content === 'none' || style.content === 'normal') continue;
      if (style.pointerEvents === 'none' || style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.position !== 'absolute' && style.position !== 'fixed') continue;
      if (style.transform && style.transform !== 'none') {
        unresolved ||= `${pseudo}-transform`;
        continue;
      }
      if (style.position === 'absolute' && getComputedStyle(element).position === 'static') {
        unresolved ||= `${pseudo}-containing-block`;
        continue;
      }
      const width = parsePixel(style.width);
      const height = parsePixel(style.height);
      let left = parsePixel(style.left);
      let top = parsePixel(style.top);
      const right = parsePixel(style.right);
      const bottom = parsePixel(style.bottom);
      if (!Number.isFinite(left) && Number.isFinite(right) && Number.isFinite(width)) {
        left = elementRect.width - right - width;
      }
      if (!Number.isFinite(top) && Number.isFinite(bottom) && Number.isFinite(height)) {
        top = elementRect.height - bottom - height;
      }
      if (![width, height, left, top].every(Number.isFinite)) {
        unresolved ||= `${pseudo}-geometry`;
        continue;
      }
      const rect = {
        left: elementRect.left + left,
        top: elementRect.top + top,
        right: elementRect.left + left + width,
        bottom: elementRect.top + top + height,
        width,
        height,
      };
      const region = roundedRegion(element, rect, style, pseudo);
      if (!region) unresolved ||= `${pseudo}-radius`;
      else regions.push(region);
    }
    return { regions, unresolved };
  };

  const pointInRoundedRegion = (point, region) => {
    const { rect, radii } = region;
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) return false;
    const corners = [
      { radius: radii[0], cx: rect.left + radii[0].x, cy: rect.top + radii[0].y, xSide: 'left', ySide: 'top' },
      { radius: radii[1], cx: rect.right - radii[1].x, cy: rect.top + radii[1].y, xSide: 'right', ySide: 'top' },
      { radius: radii[2], cx: rect.right - radii[2].x, cy: rect.bottom - radii[2].y, xSide: 'right', ySide: 'bottom' },
      { radius: radii[3], cx: rect.left + radii[3].x, cy: rect.bottom - radii[3].y, xSide: 'left', ySide: 'bottom' },
    ];
    for (const corner of corners) {
      if (corner.radius.x <= 0 || corner.radius.y <= 0) continue;
      const inX = corner.xSide === 'left' ? point.x < corner.cx : point.x > corner.cx;
      const inY = corner.ySide === 'top' ? point.y < corner.cy : point.y > corner.cy;
      if (!inX || !inY) continue;
      const dx = (point.x - corner.cx) / corner.radius.x;
      const dy = (point.y - corner.cy) / corner.radius.y;
      if (dx ** 2 + dy ** 2 > 1 + 1e-7) return false;
    }
    return true;
  };

  const rectsOverlap = (first, second) => first.right > second.left + 1e-7
    && first.left < second.right - 1e-7
    && first.bottom > second.top + 1e-7
    && first.top < second.bottom - 1e-7;

  const sameAction = (first, second) => {
    const firstControl = first.element.localName === 'label' ? first.element.control : null;
    const secondControl = second.element.localName === 'label' ? second.element.control : null;
    if (firstControl === second.element || secondControl === first.element) return true;
    const firstName = (first.element.localName || '').toLowerCase();
    const secondName = (second.element.localName || '').toLowerCase();
    if ((firstName === 'a' || firstName === 'area') && (secondName === 'a' || secondName === 'area')) {
      return first.element.href && first.element.href === second.element.href;
    }
    return false;
  };

  const regionContainsSquare = (region, obstacles) => {
    if (region.rect.width + Number.EPSILON < targetSize
        || region.rect.height + Number.EPSILON < targetSize) return false;
    const xCandidates = new Set([
      region.rect.left,
      region.rect.right - targetSize,
      (region.rect.left + region.rect.right - targetSize) / 2,
    ]);
    const yCandidates = new Set([
      region.rect.top,
      region.rect.bottom - targetSize,
      (region.rect.top + region.rect.bottom - targetSize) / 2,
    ]);
    for (const obstacle of obstacles) {
      xCandidates.add(obstacle.left - targetSize);
      xCandidates.add(obstacle.right);
      yCandidates.add(obstacle.top - targetSize);
      yCandidates.add(obstacle.bottom);
    }
    for (const left of xCandidates) for (const top of yCandidates) {
      const square = { left, top, right: left + targetSize, bottom: top + targetSize };
      const corners = [
        { x: square.left, y: square.top },
        { x: square.right, y: square.top },
        { x: square.right, y: square.bottom },
        { x: square.left, y: square.bottom },
      ];
      if (!corners.every((point) => pointInRoundedRegion(point, region))) continue;
      if (obstacles.some((obstacle) => rectsOverlap(square, obstacle))) continue;
      return true;
    }
    return false;
  };

  const unionRect = (rects) => ({
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
    width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
    height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top)),
  });

  for (const element of targetElements) {
    // aria-hiddenやopacityはポインタのhit-testを止めない。見た目の状態とは分離する。
    const pointerExclusion = pointerState(element);
    const rect = element.getBoundingClientRect();
    const clientRects = [...element.getClientRects()]
      .filter((clientRect) => clientRect.width > 0 && clientRect.height > 0)
      .map((clientRect) => ({
        left: clientRect.left,
        top: clientRect.top,
        right: clientRect.right,
        bottom: clientRect.bottom,
        width: clientRect.width,
        height: clientRect.height,
      }));
    const localName = (element.localName || '').toLowerCase();
    const nativeDisabled = element.matches(':disabled');
    const labelControlDisabled = localName === 'label'
      && (!element.control
        || element.control.matches(':disabled')
        || element.control.closest('[inert]'));
    const inline = isInlineException(element);

    if (pointerExclusion || nativeDisabled || labelControlDisabled) {
      targetCounts.excluded += 1;
      continue;
    }
    if (inline) {
      targetCounts.excluded += 1;
      // Inline例外は自身の寸法要件だけを免除する。他の小targetのSpacing円と
      // 交差してよい根拠にはならないため、実在するtargetとして衝突判定へ残す。
      if (rect.width > 0 && rect.height > 0 && clientRects.length > 0) {
        collisionTargets.push({
          element,
          identity: identityOf(element),
          rect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          clientRects,
          normalSize: rect.width + Number.EPSILON >= targetSize
            && rect.height + Number.EPSILON >= targetSize,
        });
      }
      continue;
    }
    if (rect.width <= 0 || rect.height <= 0 || clientRects.length === 0) {
      targetCounts.unresolved += 1;
      targetUnresolved.push({
        ...identityOf(element),
        text: element.textContent.trim(),
        reason: 'zero-geometry',
        w: Number(rect.width.toFixed(2)),
        h: Number(rect.height.toFixed(2)),
      });
      continue;
    }

    const style = getComputedStyle(element);
    const complexShape = (style.clipPath && style.clipPath !== 'none')
      || (style.maskImage && style.maskImage !== 'none')
      || (style.webkitMaskImage && style.webkitMaskImage !== 'none')
      || (style.transform && style.transform !== 'none')
      || element instanceof SVGElement;
    const elementRegions = clientRects.map((clientRect) => roundedRegion(element, clientRect, style))
      .filter(Boolean);
    const pseudo = pseudoHitRegions(element, rect);
    if (complexShape || elementRegions.length !== clientRects.length) {
      targetCounts.unresolved += 1;
      targetUnresolved.push({
        ...identityOf(element),
        text: element.textContent.trim(),
        reason: complexShape ? 'complex-target-shape' : 'unparsed-target-radius',
        w: Number(rect.width.toFixed(2)),
        h: Number(rect.height.toFixed(2)),
      });
      collisionTargets.push({
        element,
        identity: identityOf(element),
        rect,
        clientRects,
        hitRegions: elementRegions,
        normalSize: false,
      });
      continue;
    }

    const hitRegions = [...elementRegions, ...pseudo.regions];
    const measuredTarget = {
      element,
      identity: identityOf(element),
      text: element.textContent.trim(),
      rect: unionRect(hitRegions.map((region) => region.rect)),
      clientRects,
      hitRegions,
      pseudoUnresolved: pseudo.unresolved,
      normalSize: false,
    };
    eligibleTargets.push(measuredTarget);
    collisionTargets.push(measuredTarget);
  }

  for (const current of eligibleTargets) {
    const obstacles = collisionTargets
      .filter((other) => other.element !== current.element
        && !other.element.contains(current.element)
        && !sameAction(current, other))
      .flatMap((other) => (other.hitRegions?.length
        ? other.hitRegions.map((region) => region.rect)
        : other.clientRects))
      .filter((otherRect) => current.hitRegions.some((region) => rectsOverlap(region.rect, otherRect)));
    current.normalSize = current.hitRegions.some((region) => regionContainsSquare(region, obstacles));
  }
  const resolvedTargets = [];
  for (const current of eligibleTargets) {
    // base要素だけで24px角を確保できる場合、transform付きの装飾疑似要素は
    // target寸法へ影響しない。baseが不足する場合だけ拡張量を未解決として止める。
    if (!current.normalSize && current.pseudoUnresolved) {
      targetCounts.unresolved += 1;
      targetUnresolved.push({
        ...current.identity,
        text: current.text,
        reason: current.pseudoUnresolved,
        w: Number(current.rect.width.toFixed(2)),
        h: Number(current.rect.height.toFixed(2)),
      });
      continue;
    }
    resolvedTargets.push(current);
  }
  targetCounts.eligible = resolvedTargets.length;
  const targetResults = [];
  const targets = [];
  const radius = targetSize / 2;
  const squaredRadius = radius ** 2;

  for (const current of resolvedTargets) {
    const base = {
      ...current.identity,
      text: current.text,
      w: Number(current.rect.width.toFixed(2)),
      h: Number(current.rect.height.toFixed(2)),
      rects: current.clientRects.map((rect) => ({
        left: Number(rect.left.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        bottom: Number(rect.bottom.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      })),
    };
    if (current.normalSize) {
      targetCounts.passedSize += 1;
      targetResults.push({ ...base, outcome: 'size-pass', collisions: [] });
      continue;
    }

    const center = {
      x: (current.rect.left + current.rect.right) / 2,
      y: (current.rect.top + current.rect.bottom) / 2,
    };
    const collisions = [];
    for (const other of collisionTargets) {
      if (other.element === current.element) continue;
      // 入れ子ではポインタのhit-testが内側targetを優先する。祖先targetは
      // 内側targetの有効領域を削らない一方、祖先側からは内側を障害物として扱う。
      if (other.element.contains(current.element)) continue;
      if (sameAction(current, other)) continue;

      const kinds = [];
      let nearestRectDistance = Infinity;
      const otherRects = other.hitRegions?.length
        ? other.hitRegions.map((region) => region.rect)
        : other.clientRects;
      for (const otherRect of otherRects) {
        const nearestX = Math.max(otherRect.left, Math.min(center.x, otherRect.right));
        const nearestY = Math.max(otherRect.top, Math.min(center.y, otherRect.bottom));
        const deltaX = center.x - nearestX;
        const deltaY = center.y - nearestY;
        const rectDistance = Math.hypot(deltaX, deltaY);
        nearestRectDistance = Math.min(nearestRectDistance, rectDistance);
        if (deltaX ** 2 + deltaY ** 2 < squaredRadius - 1e-7) {
          kinds.push('target-rectangle');
          break;
        }
      }

      let circleDistance = null;
      if (!other.normalSize) {
        const otherCenterX = (other.rect.left + other.rect.right) / 2;
        const otherCenterY = (other.rect.top + other.rect.bottom) / 2;
        circleDistance = Math.hypot(center.x - otherCenterX, center.y - otherCenterY);
        if (circleDistance < targetSize - 1e-7) kinds.push('small-target-circle');
      }

      if (kinds.length) {
        collisions.push({
          key: other.identity.key,
          selector: other.identity.selector,
          kinds: [...new Set(kinds)],
          rectangleDistance: Number(nearestRectDistance.toFixed(2)),
          circleDistance: circleDistance === null ? null : Number(circleDistance.toFixed(2)),
        });
      }
    }

    if (collisions.length) {
      targetCounts.failed += 1;
      const result = { ...base, outcome: 'fail', collisions };
      targetResults.push(result);
      targets.push(result);
    } else {
      targetCounts.passedSpacing += 1;
      targetResults.push({ ...base, outcome: 'spacing-pass', collisions: [] });
    }
  }

  targetCounts.passed = targetCounts.passedSize + targetCounts.passedSpacing;
  targetCounts.consistent = targetCounts.scanned
      === targetCounts.excluded
        + targetCounts.unresolved
        + targetCounts.passedSize
        + targetCounts.passedSpacing
        + targetCounts.failed
    && targetCounts.eligible
      === targetCounts.passedSize + targetCounts.passedSpacing + targetCounts.failed
    && targetCounts.passed === targetCounts.passedSize + targetCounts.passedSpacing;

  return {
    pageScrollsHorizontally: auditLayout
      ? document.documentElement.scrollWidth - document.documentElement.clientWidth
      : 0,
    overflowCount: overflow.length,
    overflow,
    contrast,
    contrastResults,
    contrastUnresolved,
    contrastCounts,
    targets,
    targetResults,
    targetUnresolved,
    targetCounts,
  };
}

module.exports = { probeA11y };
