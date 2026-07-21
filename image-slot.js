/**
 * <image-slot> — user-fillable image placeholder.
 *
 * Drop this into a deck, mockup, or page wherever you want the user to
 * supply an image. You control the slot's shape and size; the user fills it
 * by dragging an image file onto it (or clicking to browse). The dropped
 * image persists across reloads via a .image-slots.state.json sidecar —
 * same read-via-fetch / write-via-window.omelette pattern as
 * design_canvas.jsx, so the filled slot shows on share links, downloaded
 * zips, and PPTX export. Outside the omelette runtime the slot is read-only.
 *
 * The host bridge only allows sidecar writes at the project root, so the
 * HTML that uses this component is assumed to live at the project root too
 * (same constraint as design_canvas.jsx).
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload —
 *                every slot on the page needs a distinct id.
 *   shape        'rect' | 'rounded' | 'circle' | 'pill'   (default 'rounded')
 *                'circle' applies 50% border-radius; on a non-square slot
 *                that's an ellipse — set equal width and height for a true
 *                circle.
 *   radius       Corner radius in px for 'rounded'.       (default 12)
 *   mask         Any CSS clip-path value. Overrides `shape` — use this for
 *                hexagons, blobs, arbitrary polygons.
 *   fit          object-fit: cover | contain | fill.       (default 'cover')
 *                With cover (the default) double-clicking the filled slot
 *                enters a reframe mode: the whole image spills past the mask
 *                (translucent outside, opaque inside), drag to reposition,
 *                corner-drag to scale. The crop persists alongside the image
 *                in the sidecar. contain/fill stay static.
 *   position     object-position for fit=contain|fill.     (default '50% 50%')
 *   crop-scale   Public/edit fallback crop scale for fit=cover. (default 1)
 *   crop-x       Public/edit fallback horizontal offset in frame %. (default 0)
 *   crop-y       Public/edit fallback vertical offset in frame %.   (default 0)
 *   placeholder  Empty-state caption.                      (default 'Drop an image')
 *   src          Optional initial/fallback image URL. A user drop overrides
 *                it; clearing the drop reveals src again.
 *
 * Size and layout come from ordinary CSS on the element — width/height
 * inline or from a parent grid — so it composes with any layout.
 *
 * Usage:
 *   <script src="image-slot.js"></script>
 *   <image-slot id="hero"   style="width:800px;height:450px" shape="rounded" radius="20"
 *               placeholder="Drop a hero image"></image-slot>
 *   <image-slot id="avatar" style="width:120px;height:120px" shape="circle"></image-slot>
 *   <image-slot id="kite"   style="width:300px;height:300px"
 *               mask="polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"></image-slot>
 */

(() => {
  const STATE_BASENAME = '.image-slots.state.json';
  // 公開サイトでは assets/ 配下の画像ファイルが正本。編集用の data URL を含む
  // sidecar（約1.6MB）と localStorage は、書き込みブリッジがある編集画面だけで使う。
  // これにより公開ページでは src/srcset を即座に描画し、sidecar の二重取得を防ぐ。
  const EDIT_MODE = !!(window.omelette && window.omelette.writeFile);
  // 読み込みは常に「サイトのルート」の状態ファイルを見る。uploads/ ・ blog/ 配下の
  // ページは ../ を付けてルートへ解決する。書き込み（window.omelette.writeFile）は
  // ホストが常にルート直下へ保存するので、これで全ページが“同じ1ファイル”を読み書きする。
  // → どのページで写真を差し替えても、その場で自動的にルートの状態ファイルへ保存され、
  //   他ページにもそのまま反映される（旧：読み込みだけページ相対でズレ→「保存して」が必要だった）。
  const ROOT_PREFIX = /\/(uploads|blog)\/[^\/]*$/.test(location.pathname) ? '../' : '';
  const STATE_FILE = ROOT_PREFIX + STATE_BASENAME;  // fetch（読み込み）用：ルートへ解決
  const STATE_WRITE = ROOT_PREFIX + STATE_BASENAME; // 書き込み（window.omelette.writeFile）も同じくルートへ解決。
  // 旧実装は STATE_WRITE を常にルート直下のベース名のみにしていたが、writeFile はホストが
  // 「現在ページのディレクトリ」を基準に解決するため、blog/・uploads/ 配下のページで書き込むと
  // 実際には blog/.image-slots.state.json 等、存在しない別ファイルへ書き込もうとして失敗し続けていた
  // （"saving for this file is paused after repeated failures" 警告の原因）。読み込みと同じ ../ 解決に統一。
  // localStorage mirror so user drops survive page-to-page navigation even in
  // viewing environments where the file-write bridge (window.omelette) isn't
  // available — the sidecar write may silently no-op, localStorage never does.
  const LS_KEY = 'mn-image-slots-state-v1';
  function readLocal() {
    try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; }
    catch (e) { return null; }
  }
  function writeLocal() {
    // 重要：localStorage はサイト全体で共有され、別ページのスロット（例：トップの
    // hero-main）も同じキーに入る。サイドカーの fetch(load) が解決する前に
    // 別ページで画像をドロップすると、未マージの不完全な slots で全体を上書きし、
    // 他ページのスロットを消してしまう（＝富山写真消失バグ）。
    // → 既存の localStorage を土台に、今わかっている slots を重ね、削除済み(tombstones)
    //   だけを除いて保存する。これで他ページのエントリを巻き込んで消さない。
    try {
      const existing = readLocal() || {};
      const out = Object.assign({}, existing, slots);
      for (const id of tombstones) delete out[id];
      localStorage.setItem(LS_KEY, JSON.stringify(out));
    } catch (e) {}
  }
  // 2× a ~600px slot in a 1920-wide deck — retina-sharp without making the
  // sidecar enormous. A 1200px WebP at q=0.85 is ~150-300KB.
  const MAX_DIM = 1200;
  // Raster formats only. SVG is excluded (can carry script; createImageBitmap
  // on SVG blobs is inconsistent). GIF is excluded because the canvas
  // re-encode keeps only the first frame, so an animated GIF would silently
  // go still — better to reject than surprise.
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];
  const RESPONSIVE_BASENAMES = new Set([
    '02_hokuriku_region_wide', '03_why_meeting_male', '04_subsidy_support_female',
    '06_system_pc_operation', '08_office_work', '14_punctual_deadline',
    '16_local_office_building', '17_admin_work_female',
    '18_payroll_calculation', '21_remote_work',
  ]);

  function responsiveSrcset(src) {
    const m = src.match(/(?:^|\/)([^\/]+)\.webp(?:[?#].*)?$/i);
    if (!m || !RESPONSIVE_BASENAMES.has(m[1])) return '';
    const stem = src.replace(/\.webp(?:[?#].*)?$/i, '');
    return stem + '-480.webp 480w, ' + stem + '-960.webp 960w';
  }

  // 公開サイトは編集UI・ghost画像・ドラッグ処理を一切生成しない軽量版を使う。
  // 同じページに多数あるスロットごとにShadow DOM一式を組み立てるコストを避け、
  // native imgの遅延読込・srcset・object-fitだけで表示する。
  if (!EDIT_MODE) {
    if (!document.getElementById('mn-image-slot-public-style')) {
      const style = document.createElement('style');
      style.id = 'mn-image-slot-public-style';
      style.textContent =
        'image-slot{display:inline-block;position:relative;vertical-align:top;width:240px;height:160px;overflow:hidden;background:rgba(0,0,0,.04)}' +
        'image-slot>img[data-image-slot-public]{display:block;width:100%;height:100%;max-width:none;-webkit-user-drag:none;user-select:none}';
      document.head.appendChild(style);
    }

    const publicCropObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          entries.forEach((entry) => entry.target._applyPublicCrop());
        })
      : null;

    class PublicImageSlot extends HTMLElement {
      static get observedAttributes() {
        return ['shape', 'radius', 'mask', 'fit', 'position', 'src', 'srcset', 'sizes', 'eager',
          'crop-scale', 'crop-x', 'crop-y'];
      }

      connectedCallback() {
        this._renderPublic();
        if (publicCropObserver) publicCropObserver.observe(this);
      }

      disconnectedCallback() {
        if (publicCropObserver) publicCropObserver.unobserve(this);
      }

      attributeChangedCallback() { if (this.isConnected) this._renderPublic(); }

      _renderPublic() {
        if (!this._img) {
          this._img = document.createElement('img');
          this._img.alt = '';
          this._img.draggable = false;
          this._img.decoding = 'async';
          this._img.setAttribute('data-image-slot-public', '');
          this._img.addEventListener('load', () => this._applyPublicCrop());
          this.appendChild(this._img);
        }

        const src = this.getAttribute('src') || '';
        const srcset = this.getAttribute('srcset') || responsiveSrcset(src);
        const sizes = this.getAttribute('sizes') || '(max-width: 760px) 92vw, 50vw';
        const eager = this.hasAttribute('eager');
        this._img.loading = eager ? 'eager' : 'lazy';
        if (eager) this._img.fetchPriority = 'high';
        else this._img.removeAttribute('fetchpriority');
        if (srcset) {
          this._img.srcset = srcset;
          this._img.sizes = sizes;
        } else {
          this._img.removeAttribute('srcset');
          this._img.removeAttribute('sizes');
        }
        if (src && this._img.getAttribute('src') !== src) this._img.src = src;
        if (!src) this._img.removeAttribute('src');
        const mask = this.getAttribute('mask') || '';
        const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
        let radius = '';
        if (shape === 'circle') radius = '50%';
        else if (shape === 'pill') radius = '9999px';
        else if (shape === 'rounded') {
          const n = Number.parseFloat(this.getAttribute('radius'));
          radius = (Number.isFinite(n) ? n : 12) + 'px';
        }
        this.style.borderRadius = mask ? '' : radius;
        this.style.clipPath = mask;
        this._applyPublicCrop();
      }

      _applyPublicCrop() {
        if (!this._img) return;
        const fit = this.getAttribute('fit') || 'cover';
        const position = this.getAttribute('position') || '50% 50%';
        const rawScale = Number.parseFloat(this.getAttribute('crop-scale'));
        const rawX = Number.parseFloat(this.getAttribute('crop-x'));
        const rawY = Number.parseFloat(this.getAttribute('crop-y'));
        const s = Number.isFinite(rawScale) ? Math.max(1, Math.min(5, rawScale)) : 1;
        let x = Number.isFinite(rawX) ? rawX : 0;
        let y = Number.isFinite(rawY) ? rawY : 0;
        const iw = this._img.naturalWidth;
        const ih = this._img.naturalHeight;
        const fw = this.clientWidth;
        const fh = this.clientHeight;
        const hasCrop = Math.abs(s - 1) > 0.000001 || Math.abs(x) > 0.000001 || Math.abs(y) > 0.000001;

        if (fit !== 'cover' || !hasCrop || !iw || !ih || !fw || !fh) {
          this._img.style.position = '';
          this._img.style.width = '100%';
          this._img.style.height = '100%';
          this._img.style.left = '';
          this._img.style.top = '';
          this._img.style.transform = '';
          this._img.style.objectFit = fit;
          this._img.style.objectPosition = position;
          return;
        }

        // 編集モードと同じ cover 基準の寸法・移動量で描画する。
        // 状態ファイルを公開側で取得せず、HTMLに焼き込んだ調整値だけを使う。
        const base = Math.max(fw / iw, fh / ih);
        const mx = Math.max(0, (iw * base * s / fw - 1) * 50);
        const my = Math.max(0, (ih * base * s / fh - 1) * 50);
        x = Math.max(-mx, Math.min(mx, x));
        y = Math.max(-my, Math.min(my, y));
        const k = base * s;
        this._img.style.position = 'absolute';
        this._img.style.width = (iw * k / fw * 100) + '%';
        this._img.style.height = (ih * k / fh * 100) + '%';
        this._img.style.left = (50 + x) + '%';
        this._img.style.top = (50 + y) + '%';
        this._img.style.transform = 'translate(-50%,-50%)';
        this._img.style.objectFit = '';
        this._img.style.objectPosition = '';
      }
    }

    customElements.define('image-slot', PublicImageSlot);
    return;
  }

  // ── Shared sidecar store ────────────────────────────────────────────────
  // One fetch + immediate write-on-change for every <image-slot> on the
  // page. Reads via fetch() so viewing works anywhere the HTML and sidecar
  // are served together; writes go through window.omelette.writeFile, which
  // the host allowlists to *.state.json basenames only.
  const subs = new Set();
  let slots = {};
  // ids explicitly cleared before the sidecar fetch resolved — otherwise
  // the merge below can't tell "never set" from "just deleted" and would
  // resurrect the sidecar's stale value.
  const tombstones = new Set();
  let loaded = false;
  let loadP = null;

  function load() {
    if (loadP) return loadP;
    if (!EDIT_MODE) {
      loaded = true;
      loadP = Promise.resolve().then(() => { subs.forEach((fn) => fn()); });
      return loadP;
    }
    // file://（DLして直接開く）では、ブラウザがローカルファイルへの fetch をブロックする。
    // その場合は fetch を試みず即解決して loaded を立て、src（本ファイル化した画像）へ
    // 確実にフォールバックさせる。これをしないと「サイドカー読み込み待ち(pending)」のまま
    // 画像が一切出ない。localStorage は従来どおり併用する。
    var canFetch = location.protocol !== 'file:';
    loadP = (canFetch
        ? fetch(STATE_FILE).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : Promise.resolve(null))
      .then((j) => {
        // Precedence: localStorage (this browser's un-synced drops) < sidecar
        // (the SHARED, canonical file) < in-memory changes that raced ahead of
        // this load. つまり「共有ファイルが正本」。どの端末から開いても、共有ファイルに
        // 入っている画像は必ず同じものが出る（端末ごとの古い localStorage で上書きされない）。
        // 共有ファイルに無いスロットだけ localStorage で補完するので、まだ同期されていない
        // その端末だけの一時ドロップは消えずに表示され、ページ遷移でも残る
        // （ファイルがそのキーを持たない＝上書きしようがないため）。
        const ls = readLocal();
        let base = (ls && typeof ls === 'object') ? Object.assign({}, ls) : {};
        if (j && typeof j === 'object') base = Object.assign(base, j);
        const merged = Object.assign(base, slots);
        for (const k in slots) {
          if (merged[k] && !merged[k].u) {
            const src = (j && j[k]) || (ls && ls[k]);
            if (src) merged[k].u = typeof src === 'string' ? src : src.u;
          }
        }
        for (const id of tombstones) delete merged[id];
        slots = merged;
        tombstones.clear();
      })
      .then(() => { loaded = true; subs.forEach((fn) => fn()); });
    return loadP;
  }

  // Serialize writes so two near-simultaneous drops on different slots
  // can't reorder at the backend and leave the sidecar with only the
  // first. A save requested mid-flight just marks dirty and re-fires on
  // completion with the then-current slots.
  let saving = false;
  let saveDirty = false;
  function save() {
    writeLocal();
    if (saving) { saveDirty = true; return; }
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    saving = true;
    Promise.resolve(w(STATE_WRITE, JSON.stringify(slots)))
      .catch(() => {})
      .then(() => { saving = false; if (saveDirty) { saveDirty = false; save(); } });
  }

  const S_MAX = 5;
  const clampS = (s) => Math.max(1, Math.min(S_MAX, s));

  // Normalize a stored slot value. Pre-reframe sidecars stored a bare
  // data-URL string; newer ones store {u, s, x, y}. Either shape is valid.
  function getSlot(id) {
    const v = slots[id];
    if (!v) return null;
    return typeof v === 'string' ? { u: v, s: 1, x: 0, y: 0 } : v;
  }

  function setSlot(id, val) {
    if (!id) return;
    if (val) { slots[id] = val; tombstones.delete(id); }
    else {
      delete slots[id];
      if (!loaded) tombstones.add(id);
      // 削除を localStorage にも即反映する（このIDだけ。他ページのエントリには触れない）。
      // これをしないと writeLocal の既存マージ（Object.assign(existing, slots)）で
      // 消した画像が localStorage から復活し、リロードで戻ってしまう。
      try {
        const ls = readLocal();
        if (ls && (id in ls)) { delete ls[id]; localStorage.setItem(LS_KEY, JSON.stringify(ls)); }
      } catch (e) {}
    }
    subs.forEach((fn) => fn());
    // A drop is rare + high-value — write immediately so nav-away can't lose
    // it. Gate on the initial read so we don't overwrite a sidecar we haven't
    // merged yet; the merge in load() keeps this change once the read lands.
    if (loaded) save(); else load().then(save);
  }

  // ── Image downscale ─────────────────────────────────────────────────────
  // Encode through a canvas so the sidecar carries resized bytes, not the
  // raw upload. Longest side is capped at 2× the slot's rendered width
  // (retina) and at MAX_DIM. WebP keeps alpha and is ~10× smaller than PNG
  // for photos, so there's no need for per-image format picking.
  async function toDataUrl(file, targetW) {
    const bitmap = await createImageBitmap(file);
    try {
      const cap = Math.min(MAX_DIM, Math.max(1, Math.round(targetW * 2)) || MAX_DIM);
      const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return canvas.toDataURL('image/webp', 0.85);
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  // ── Custom element ──────────────────────────────────────────────────────
  const stylesheet =
    ':host{display:inline-block;position:relative;vertical-align:top;' +
    '  font:13px/1.3 system-ui,-apple-system,sans-serif;color:rgba(0,0,0,.55);width:240px;height:160px}' +
    '.frame{position:absolute;inset:0;overflow:hidden;background:rgba(0,0,0,.04)}' +
    // .frame img (clipped) and .spill (unclipped ghost + handles) share the
    // same left/top/width/height in frame-%, computed by _applyView(), so the
    // inside-mask crop and the outside-mask spill stay pixel-aligned.
    '.frame img{position:absolute;max-width:none;transform:translate(-50%,-50%);' +
    '  -webkit-user-drag:none;user-select:none;touch-action:none}' +
    // Reframe mode (double-click): the full image spills past the mask. The
    // spill layer is sized to the IMAGE bounds so its corners are where the
    // resize handles belong. The ghost <img> inside is translucent; the real
    // clipped <img> underneath shows the opaque in-mask crop.
    '.spill{position:absolute;transform:translate(-50%,-50%);display:none;z-index:1;' +
    '  cursor:grab;touch-action:none}' +
    ':host([data-panning]) .spill{cursor:grabbing}' +
    '.spill .ghost{position:absolute;inset:0;width:100%;height:100%;opacity:.35;' +
    '  pointer-events:none;-webkit-user-drag:none;user-select:none;' +
    '  box-shadow:0 0 0 1px rgba(0,0,0,.2),0 12px 32px rgba(0,0,0,.2)}' +
    '.spill .handle{position:absolute;width:12px;height:12px;border-radius:50%;' +
    '  background:#fff;box-shadow:0 0 0 1.5px #c96442,0 1px 3px rgba(0,0,0,.3);' +
    '  transform:translate(-50%,-50%)}' +
    '.spill .handle[data-c=nw]{left:0;top:0;cursor:nwse-resize}' +
    '.spill .handle[data-c=ne]{left:100%;top:0;cursor:nesw-resize}' +
    '.spill .handle[data-c=sw]{left:0;top:100%;cursor:nesw-resize}' +
    '.spill .handle[data-c=se]{left:100%;top:100%;cursor:nwse-resize}' +
    ':host([data-reframe]){z-index:10}' +
    ':host([data-reframe]) .spill{display:block}' +
    ':host([data-reframe]) .frame{box-shadow:0 0 0 2px #c96442}' +
    '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' +
    '  cursor:pointer;user-select:none}' +
    '.empty svg{opacity:.45}' +
    '.empty .cap{max-width:90%;font-weight:500;letter-spacing:.01em}' +
    '.empty .sub{font-size:11px}' +
    '.empty .sub u{text-underline-offset:2px;text-decoration-color:rgba(0,0,0,.25)}' +
    '.empty:hover .sub u{color:rgba(0,0,0,.75);text-decoration-color:currentColor}' +
    ':host([data-over]) .frame{outline:2px solid #c96442;outline-offset:-2px;' +
    '  background:rgba(201,100,66,.10)}' +
    '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(0,0,0,.25);' +
    '  transition:border-color .12s}' +
    ':host([data-over]) .ring{border-color:#c96442}' +
    ':host([data-filled]) .ring{display:none}' +
    // Controls sit BELOW the mask (top:100%), absolutely positioned so the
    // author-declared slot height is unaffected. The gap is padding, not a
    // top offset, so the hover target stays contiguous with the frame.
    '.ctl{position:absolute;top:100%;left:50%;transform:translateX(-50%);padding-top:8px;' +
    '  display:flex;gap:6px;opacity:0;pointer-events:none;transition:opacity .12s;z-index:2;' +
    '  white-space:nowrap}' +
    ':host([data-filled][data-editable]:hover) .ctl,:host([data-reframe]) .ctl' +
    '  {opacity:1;pointer-events:auto}' +
    '.ctl button{appearance:none;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;' +
    '  background:rgba(0,0,0,.65);color:#fff;font:11px/1 system-ui,-apple-system,sans-serif;' +
    '  backdrop-filter:blur(6px)}' +
    '.ctl button:hover{background:rgba(0,0,0,.8)}' +
    '.err{position:absolute;left:8px;bottom:8px;right:8px;color:#b3261e;font-size:11px;' +
    '  background:rgba(255,255,255,.85);padding:4px 6px;border-radius:5px;pointer-events:none}';

  const icon =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' +
    '<path d="m21 15-5-5L5 21"/></svg>';

  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['shape', 'radius', 'mask', 'fit', 'position', 'placeholder', 'src', 'srcset', 'sizes', 'id',
        'crop-scale', 'crop-x', 'crop-y'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      // .spill and .ctl sit OUTSIDE .frame so overflow:hidden + border-radius
      // on the frame (circle, pill, rounded) can't clip them.
      root.innerHTML =
        '<style>' + stylesheet + '</style>' +
        '<div class="frame" part="frame">' +
        '  <img part="image" alt="" draggable="false" decoding="async" style="display:none">' +
        '  <div class="empty" part="empty">' + icon +
        '    <div class="cap"></div>' +
        '    <div class="sub">or <u>browse files</u></div></div>' +
        '  <div class="ring" part="ring"></div>' +
        '</div>' +
        '<div class="spill">' +
        '  <img class="ghost" alt="" draggable="false" loading="lazy" decoding="async">' +
        '  <div class="handle" data-c="nw"></div><div class="handle" data-c="ne"></div>' +
        '  <div class="handle" data-c="sw"></div><div class="handle" data-c="se"></div>' +
        '</div>' +
        '<div class="ctl"><button data-act="replace" title="Replace image">Replace</button>' +
        '  <button data-act="clear" title="Remove image">Remove</button></div>' +
        '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._ring = root.querySelector('.ring');
      this._img = root.querySelector('.frame img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._sub = root.querySelector('.sub');
      this._spill = root.querySelector('.spill');
      this._ghost = root.querySelector('.ghost');
      this._err = null;
      this._input = root.querySelector('input');
      this._depth = 0;
      this._gen = 0;
      this._view = { s: 1, x: 0, y: 0 };
      this._subFn = () => this._render();
      // Shadow-DOM listeners live with the shadow DOM — bound once here so
      // disconnect/reconnect (e.g. React remount) doesn't stack handlers.
      this._empty.addEventListener('click', () => this._input.click());
      root.addEventListener('click', (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'replace') { this._exitReframe(true); this._input.click(); }
        if (act === 'clear') {
          this._exitReframe(false);
          this._gen++;
          this._local = null;
          if (this.id) setSlot(this.id, null); else this._render();
        }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
      // naturalWidth/Height aren't known until load — re-apply so the cover
      // baseline is computed from real dimensions, not the 100%×100% fallback.
      this._img.addEventListener('load', () => this._applyView());
      // Gated on editable + fit=cover so share links and contain/fill slots
      // stay static.
      this.addEventListener('dblclick', (e) => {
        if (!this.hasAttribute('data-editable') || !this._reframes()) return;
        e.preventDefault();
        if (this.hasAttribute('data-reframe')) this._exitReframe(true);
        else this._enterReframe();
      });
      // Pan + resize both originate on the spill layer. A handle pointerdown
      // drives an aspect-locked resize anchored at the opposite corner; any
      // other pointerdown on the spill pans. Offsets are frame-% so a
      // reframed slot survives responsive resize / PPTX export.
      this._spill.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        e.stopPropagation();
        this._spill.setPointerCapture(e.pointerId);
        const rect = this.getBoundingClientRect();
        const fw = rect.width || 1, fh = rect.height || 1;
        const corner = e.target.getAttribute && e.target.getAttribute('data-c');
        let move;
        if (corner) {
          // Resize about the OPPOSITE corner. Viewport-px throughout (rect
          // fw/fh, not clientWidth) so the math survives a transform:scale()
          // ancestor — deck_stage renders slides scaled-to-fit.
          const iw = this._img.naturalWidth || 1, ih = this._img.naturalHeight || 1;
          const base = Math.max(fw / iw, fh / ih);
          const sx = corner.includes('e') ? 1 : -1;
          const sy = corner.includes('s') ? 1 : -1;
          const s0 = this._view.s;
          const w0 = iw * base * s0, h0 = ih * base * s0;
          const cx0 = (50 + this._view.x) / 100 * fw;
          const cy0 = (50 + this._view.y) / 100 * fh;
          const ox = cx0 - sx * w0 / 2, oy = cy0 - sy * h0 / 2;
          const diag0 = Math.hypot(w0, h0);
          const ux = sx * w0 / diag0, uy = sy * h0 / diag0;
          move = (ev) => {
            const proj = (ev.clientX - rect.left - ox) * ux +
                         (ev.clientY - rect.top - oy) * uy;
            const s = clampS(s0 * proj / diag0);
            const d = diag0 * s / s0;
            this._view.s = s;
            this._view.x = (ox + ux * d / 2) / fw * 100 - 50;
            this._view.y = (oy + uy * d / 2) / fh * 100 - 50;
            this._clampView();
            this._applyView();
          };
        } else {
          this.setAttribute('data-panning', '');
          const start = { px: e.clientX, py: e.clientY, x: this._view.x, y: this._view.y };
          move = (ev) => {
            this._view.x = start.x + (ev.clientX - start.px) / fw * 100;
            this._view.y = start.y + (ev.clientY - start.py) / fh * 100;
            this._clampView();
            this._applyView();
          };
        }
        const up = () => {
          try { this._spill.releasePointerCapture(e.pointerId); } catch {}
          this._spill.removeEventListener('pointermove', move);
          this._spill.removeEventListener('pointerup', up);
          this._spill.removeEventListener('pointercancel', up);
          this.removeAttribute('data-panning');
          this._dragUp = null;
        };
        // Stashed so _exitReframe (Escape / outside-click mid-drag) can
        // tear the capture + listeners down synchronously.
        this._dragUp = up;
        this._spill.addEventListener('pointermove', move);
        this._spill.addEventListener('pointerup', up);
        this._spill.addEventListener('pointercancel', up);
      });
      // Wheel zoom stays available inside reframe mode as a trackpad nicety —
      // zooms toward the cursor (offset' = cursor·(1-k) + offset·k).
      this.addEventListener('wheel', (e) => {
        if (!this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        const r = this.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width * 100 - 50;
        const cy = (e.clientY - r.top) / r.height * 100 - 50;
        const prev = this._view.s;
        const next = clampS(prev * Math.pow(1.0015, -e.deltaY));
        if (next === prev) return;
        const k = next / prev;
        this._view.s = next;
        this._view.x = cx * (1 - k) + this._view.x * k;
        this._view.y = cy * (1 - k) + this._view.y * k;
        this._clampView();
        this._applyView();
      }, { passive: false });
    }

    connectedCallback() {
      // Warn once per page — an id-less slot works for the session but
      // cannot persist, and two id-less slots would share nothing.
      if (!this.id && !ImageSlot._warned) {
        ImageSlot._warned = true;
        console.warn('<image-slot> without an id will not persist its dropped image.');
      }
      this.addEventListener('dragenter', this);
      this.addEventListener('dragover', this);
      this.addEventListener('dragleave', this);
      this.addEventListener('drop', this);
      subs.add(this._subFn);
      // width%/height% in _applyView encode the frame aspect at call time —
      // a host resize (responsive grid, pane divider) would stretch the
      // image until the next _render. Re-render on size change: _render()
      // re-seeds _view from stored before clamp/apply, so a shrink→grow
      // cycle round-trips instead of ratcheting x/y toward the narrower
      // frame's clamp range.
      if (EDIT_MODE) {
        this._ro = new ResizeObserver(() => this._render());
        this._ro.observe(this);
      }
      load();
      this._render();
    }

    disconnectedCallback() {
      subs.delete(this._subFn);
      this.removeEventListener('dragenter', this);
      this.removeEventListener('dragover', this);
      this.removeEventListener('dragleave', this);
      this.removeEventListener('drop', this);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      this._exitReframe(false);
    }

    _enterReframe() {
      if (this.hasAttribute('data-reframe')) return;
      this.setAttribute('data-reframe', '');
      this._applyView();
      // Close on click outside (the spill handler stopPropagation()s so
      // in-image drags don't reach this) and on Escape. Listeners are held
      // on the instance so _exitReframe / disconnectedCallback can detach
      // exactly what was attached.
      this._outside = (e) => {
        if (e.composedPath && e.composedPath().includes(this)) return;
        this._exitReframe(true);
      };
      this._esc = (e) => { if (e.key === 'Escape') this._exitReframe(true); };
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
    }

    _exitReframe(commit) {
      if (!this.hasAttribute('data-reframe')) return;
      if (this._dragUp) this._dragUp();
      this.removeAttribute('data-reframe');
      this.removeAttribute('data-panning');
      if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
      if (this._esc) document.removeEventListener('keydown', this._esc, true);
      this._outside = this._esc = null;
      if (commit) this._commitView();
    }

    attributeChangedCallback() { if (this.shadowRoot) this._render(); }

    // handleEvent — one listener object for all four drag events keeps the
    // add/remove symmetric and the depth counter correct.
    handleEvent(e) {
      if (e.type === 'dragenter' || e.type === 'dragover') {
        // Without preventDefault the browser never fires 'drop'.
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (e.type === 'dragenter') this._depth++;
        this.setAttribute('data-over', '');
      } else if (e.type === 'dragleave') {
        // dragenter/leave fire for every descendant crossing — count depth
        // so hovering the icon inside the empty state doesn't flicker.
        if (--this._depth <= 0) { this._depth = 0; this.removeAttribute('data-over'); }
      } else if (e.type === 'drop') {
        e.preventDefault();
        e.stopPropagation();
        this._depth = 0;
        this.removeAttribute('data-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._ingest(f);
      }
    }

    async _ingest(file) {
      this._setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) {
        this._setError('Drop a PNG, JPEG, WebP, or AVIF image.');
        return;
      }
      // toDataUrl can take hundreds of ms on a large photo. A Clear or a
      // newer drop during that window would be clobbered when this await
      // resumes — bump + capture a generation so stale encodes bail.
      const gen = ++this._gen;
      try {
        const w = this.clientWidth || this.offsetWidth || MAX_DIM;
        const url = await toDataUrl(file, w);
        if (gen !== this._gen) return;
        // Only exit reframe once the new image is in hand — a rejected type
        // or decode failure leaves the in-progress crop untouched.
        this._exitReframe(false);
        const val = { u: url, s: 1, x: 0, y: 0 };
        setSlot(this.id || '', val);
        // Keep a session-local copy for id-less slots so the drop still
        // shows, even though it cannot persist.
        if (!this.id) { this._local = val; this._render(); }
      } catch (err) {
        if (gen !== this._gen) return;
        this._setError('Could not read that image.');
        console.warn('<image-slot> ingest failed:', err);
      }
    }

    _setError(msg) {
      if (this._err) { this._err.remove(); this._err = null; }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err'; d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => { if (this._err === d) { d.remove(); this._err = null; } }, 3000);
    }

    // Reframing (pan/resize) is only meaningful for fit=cover — contain/fill
    // keep the old object-fit path and double-click is a no-op.
    _reframes() {
      return this.hasAttribute('data-filled') &&
        (this.getAttribute('fit') || 'cover') === 'cover';
    }

    // Cover-baseline geometry, shared by clamp/apply/resize. Null until the
    // img has loaded (naturalWidth is 0 before that) or when the slot has no
    // layout box — ResizeObserver fires with a 0×0 rect under display:none,
    // and clamping against a degenerate 1×1 frame would silently pull the
    // stored pan toward zero.
    _geom() {
      const iw = this._img.naturalWidth, ih = this._img.naturalHeight;
      const fw = this.clientWidth, fh = this.clientHeight;
      if (!iw || !ih || !fw || !fh) return null;
      return { iw, ih, fw, fh, base: Math.max(fw / iw, fh / ih) };
    }

    _clampView() {
      // Pan range on each axis is half the overflow past the frame edge.
      const g = this._geom();
      if (!g) return;
      const mx = Math.max(0, (g.iw * g.base * this._view.s / g.fw - 1) * 50);
      const my = Math.max(0, (g.ih * g.base * this._view.s / g.fh - 1) * 50);
      this._view.x = Math.max(-mx, Math.min(mx, this._view.x));
      this._view.y = Math.max(-my, Math.min(my, this._view.y));
    }

    _applyView() {
      const fit = this.getAttribute('fit') || 'cover';
      if (!EDIT_MODE) {
        this._img.style.width = '100%';
        this._img.style.height = '100%';
        this._img.style.left = '50%';
        this._img.style.top = '50%';
        this._img.style.objectFit = fit;
        this._img.style.objectPosition = this.getAttribute('position') || '50% 50%';
        return;
      }
      const g = this._geom();
      if (fit !== 'cover' || !g) {
        // Non-cover, or dimensions not known yet (before img load).
        this._img.style.width = '100%';
        this._img.style.height = '100%';
        this._img.style.left = '50%';
        this._img.style.top = '50%';
        this._img.style.objectFit = fit;
        this._img.style.objectPosition = this.getAttribute('position') || '50% 50%';
        return;
      }
      // Cover baseline: img fills the frame on its tighter axis at s=1, so
      // pan works immediately on the overflowing axis without zooming first.
      // Width/height and left/top are all frame-% — depends only on the
      // frame aspect ratio, so a responsive resize keeps the same crop. The
      // spill layer mirrors the same box so its corners = image corners.
      const k = g.base * this._view.s;
      const w = (g.iw * k / g.fw * 100) + '%';
      const h = (g.ih * k / g.fh * 100) + '%';
      const l = (50 + this._view.x) + '%';
      const t = (50 + this._view.y) + '%';
      this._img.style.width = w; this._img.style.height = h;
      this._img.style.left = l; this._img.style.top = t;
      this._img.style.objectFit = '';
      this._spill.style.width = w; this._spill.style.height = h;
      this._spill.style.left = l; this._spill.style.top = t;
    }

    _commitView() {
      const v = { s: this._view.s, x: this._view.x, y: this._view.y };
      if (this._userUrl) v.u = this._userUrl;
      // Framing-only (no u) persists too so an author-src slot remembers its
      // crop; clearing the sidecar still falls through to src=.
      if (this.id) setSlot(this.id, v);
      else { this._local = v; }
    }

    _render() {
      // Shape / mask. Presets use border-radius so the dashed ring can
      // follow the rounded outline; clip-path is only applied for an
      // explicit `mask` (the ring is hidden there since a rectangle
      // dashed border chopped by an arbitrary polygon looks broken).
      const mask = this.getAttribute('mask');
      const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
      let radius = '';
      if (shape === 'circle') radius = '50%';
      else if (shape === 'pill') radius = '9999px';
      else if (shape === 'rounded') {
        const n = parseFloat(this.getAttribute('radius'));
        radius = (Number.isFinite(n) ? n : 12) + 'px';
      }
      this._frame.style.borderRadius = mask ? '' : radius;
      this._frame.style.clipPath = mask || '';
      this._ring.style.borderRadius = mask ? '' : radius;
      this._ring.style.display = mask ? 'none' : '';

      // Controls and reframe entry gate on this so share links stay read-only.
      const editable = EDIT_MODE;
      this.toggleAttribute('data-editable', editable);
      this._sub.style.display = editable ? '' : 'none';

      // Content. The sidecar is also writable by the agent's write_file
      // tool, so its value isn't guaranteed canvas-originated — only accept
      // data:image/ URLs from it. The `src` attribute is author-controlled
      // (Claude wrote it into the HTML) so it passes through unchanged.
      let stored = this.id ? getSlot(this.id) : this._local;
      if (stored && stored.u && !/^data:image\//i.test(stored.u)) stored = null;
      const srcAttr = this.getAttribute('src') || '';
      const srcsetAttr = this.getAttribute('srcset') || responsiveSrcset(srcAttr);
      const sizesAttr = this.getAttribute('sizes') || '(max-width: 760px) 92vw, 50vw';
      this._userUrl = (stored && stored.u) || null;
      // For a persistable slot, wait for the sidecar to finish loading before
      // falling back to the author `src` — otherwise the default image flashes
      // for a frame before the user's saved drop hydrates. While pending, show
      // just the frame background (no image, no empty placeholder).
      const pending = !!this.id && !loaded && !this._userUrl;
      const url = this._userUrl || (pending ? '' : srcAttr);
      // Don't clobber an in-flight reframe with a store-triggered re-render.
      if (!this.hasAttribute('data-reframe')) {
        const attrS = Number.parseFloat(this.getAttribute('crop-scale'));
        const attrX = Number.parseFloat(this.getAttribute('crop-x'));
        const attrY = Number.parseFloat(this.getAttribute('crop-y'));
        this._view = {
          s: stored && Number.isFinite(stored.s) ? clampS(stored.s) :
            (Number.isFinite(attrS) ? clampS(attrS) : 1),
          x: stored && Number.isFinite(stored.x) ? stored.x : (Number.isFinite(attrX) ? attrX : 0),
          y: stored && Number.isFinite(stored.y) ? stored.y : (Number.isFinite(attrY) ? attrY : 0),
        };
      }
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop an image';
      // Toggle via style.display — the [hidden] attribute alone loses to
      // the display:flex / display:block rules in the stylesheet above.
      if (this.getAttribute('eager') !== null) {
        this._img.setAttribute('fetchpriority', 'high');
        this._img.setAttribute('loading', 'eager');
      } else {
        this._img.setAttribute('loading', 'lazy');
      }
      if (url) {
        // LQIP生成は別の Image() で全画像を先読みするため、公開画面では
        // native lazy-loading を優先する。編集画面だけ従来のプレビューを残す。
        if (EDIT_MODE) this._setLqip(url);
        if (!this._userUrl && srcsetAttr) {
          this._img.setAttribute('srcset', srcsetAttr);
          if (sizesAttr) this._img.setAttribute('sizes', sizesAttr);
        } else {
          this._img.removeAttribute('srcset');
          this._img.removeAttribute('sizes');
        }
        if (this._img.getAttribute('src') !== url) {
          this._img.src = url;
          if (EDIT_MODE) this._ghost.src = url;
        }
        this._img.style.display = 'block';
        this._empty.style.display = 'none';
        this.setAttribute('data-filled', '');
        this._clampView();
        this._applyView();
      } else {
        this._img.style.display = 'none';
        this._img.removeAttribute('src');
        this._img.removeAttribute('srcset');
        this._img.removeAttribute('sizes');
        this._ghost.removeAttribute('src');
        // While the sidecar is still loading, show just the frame background —
        // not the "drop an image" placeholder — so a saved slot doesn't flash
        // its empty state before hydrating.
        this._empty.style.display = pending ? 'none' : 'flex';
        this.removeAttribute('data-filled');
      }
    }
    // blur-up：表示する画像から極小のぼかし版を作り、スロットの下地に敷く。
    // 本画像が来るまでの一瞬も“ぼやけた写真”が見え、黒や無地が出ない。全スロット共通。
    _setLqip(url) {
      if (!url || this._lqipUrl === url) return;
      this._lqipUrl = url;
      var self = this;
      var im = new Image();
      im.onload = function () {
        try {
          var w = 40, h = Math.max(1, Math.round(w * im.height / im.width));
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(im, 0, 0, w, h);
          var d = c.toDataURL('image/jpeg', 0.6);
          self.style.backgroundImage = 'url(' + d + ')';
          self.style.backgroundSize = 'cover';
          self.style.backgroundPosition = 'center';
        } catch (e) {}
      };
      im.src = url;
    }
  }

  if (!customElements.get('image-slot')) {
    customElements.define('image-slot', ImageSlot);
  }
})();
