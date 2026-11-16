// In-page specification viewer, the same as AI-Thermal's 規格書 viewer (sgSpecView):
// a floating, non-modal window — the page underneath stays editable — that is moved
// by its title bar, resized from any edge or corner, maximized by ⛶ or a double click
// on the title bar, and remembers its place. The file is fetched from SharePoint and
// shown in place: PDF in the browser's own viewer (with a thumbnail toggle), images
// and plain text directly; Office files open in Office Online (still no download).
// Several specifications of one PA get a file switcher row under the title.
//
// The blob's MIME type always comes from the file extension, never from the server:
// a blob: URL inherits this page's origin, so a file read as HTML could run script here.

const IMAGE = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};
const TEXT = ['txt', 'csv', 'log', 'md', 'json', 'xml'];
const OFFICE = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const TEXT_MAX = 512 * 1024;
const MIN_W = 360,
  MIN_H = 240;
const GEOM_KEY = 'pa-copper-cad.spec-view-geom',
  NAV_KEY = 'pa-copper-cad.spec-view-nav';

const extension = name =>
  (String(name || '')
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/) || [])[1] || '';
/** How a file is shown, from its extension only. */
export function specKind(name) {
  const ext = extension(name);
  if (ext === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
  if (IMAGE[ext]) return { kind: 'image', mime: IMAGE[ext] };
  if (TEXT.includes(ext)) return { kind: 'text', mime: 'text/plain' };
  if (OFFICE.includes(ext)) return { kind: 'office', mime: '' };
  return { kind: 'other', mime: '' };
}
export function sizeText(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}
/** Window geometry kept inside the viewport; 120 px of the title bar always stays reachable. */
export function clampGeometry(g, vw, vh) {
  const w = Math.min(Math.max(MIN_W, g.w), vw),
    h = Math.min(Math.max(MIN_H, g.h), vh);
  return { x: Math.min(Math.max(-(w - 120), g.x), vw - 120), y: Math.min(Math.max(0, g.y), vh - 48), w, h };
}

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
};
const el = (tag, attributes = {}, text = '') => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
};

/** Fetch with a 30 s timeout and one retry: network hiccups should not leave an empty window. */
async function fetchFile(url, fetchImpl) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      clearTimeout(timer);
      last = error;
      if (!attempt) await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  throw last || new Error('讀取失敗');
}

/**
 * fileMeta(path) → { downloadUrl, webUrl, name, size } | null (SharePoint, read only).
 * Returns { open(specs, index, context), close() }; specs are [{ path, name }].
 */
export function createSpecViewer({ fileMeta, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const layer = el('div', { class: 'spec-view-layer', hidden: '' });
  const box = el('div', { class: 'spec-view', role: 'dialog', 'aria-label': '規格書', tabindex: '-1' });
  for (const edge of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'])
    box.append(el('i', { class: `spec-view-rz ${edge}`, 'data-rz': edge }));
  const head = el('div', { class: 'spec-view-head', title: '拖曳標題列可移動視窗；雙擊切換全螢幕' });
  const titles = el('div', { class: 'spec-view-titles' }),
    title = el('div', { class: 'spec-view-title' }, '規格書'),
    sub = el('div', { class: 'spec-view-sub' });
  titles.append(title, sub);
  const button = (label, tip, extra = '') =>
    el('button', { type: 'button', class: `spec-view-btn ${extra}`.trim(), title: tip }, label);
  const navButton = button('☰ 縮圖', '顯示／隱藏 PDF 左側的頁面縮圖', 'icon'),
    tabButton = button('↗ 新分頁', '在瀏覽器新分頁開啟（不下載）'),
    downloadButton = button('⬇ 下載', '下載到電腦'),
    maxButton = button('⛶', '放大到全螢幕', 'icon'),
    closeButton = button('關閉', '關閉規格書（Esc）', 'primary');
  head.append(
    titles,
    el('div', { class: 'spec-view-spacer' }),
    navButton,
    tabButton,
    downloadButton,
    maxButton,
    closeButton,
  );
  const tabs = el('div', { class: 'spec-view-tabs', hidden: '' }),
    body = el('div', { class: 'spec-view-body' });
  box.append(head, tabs, body);
  layer.append(box);
  document.body.append(layer);

  let state = null,
    sequence = 0,
    maximized = false,
    showNav = storage.get(NAV_KEY) !== '0',
    geometry = null;
  try {
    const saved = JSON.parse(storage.get(GEOM_KEY) || 'null');
    if (saved && [saved.x, saved.y, saved.w, saved.h].every(Number.isFinite)) geometry = saved;
  } catch {
    /* ignore */
  }

  function applyGeometry() {
    if (!geometry) {
      const w = Math.min(920, Math.round(innerWidth * 0.62)),
        h = Math.round(innerHeight * 0.86);
      geometry = { x: innerWidth - w - 16, y: Math.round(innerHeight * 0.07), w, h };
    }
    geometry = clampGeometry(geometry, innerWidth, innerHeight);
    Object.assign(box.style, {
      left: `${geometry.x}px`,
      top: `${geometry.y}px`,
      width: `${geometry.w}px`,
      height: `${geometry.h}px`,
    });
    box.classList.toggle('maximized', maximized);
    maxButton.textContent = maximized ? '❐' : '⛶';
    maxButton.title = maximized ? '縮回視窗' : '放大到全螢幕';
    maxButton.classList.toggle('on', maximized);
  }
  // Move (title bar) and resize (edges, corners) with pointer capture; the iframe is
  // made inert meanwhile, or it would swallow the pointer events.
  function begin(event, mode) {
    if (maximized || event.button > 0) return;
    event.preventDefault();
    const start = { ...geometry },
      sx = event.clientX,
      sy = event.clientY,
      handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* not capturable */
    }
    box.classList.add('dragging');
    const move = e => {
      const dx = e.clientX - sx,
        dy = e.clientY - sy;
      let { x, y, w, h } = start;
      if (mode === 'move') {
        x += dx;
        y += dy;
      } else {
        if (mode.includes('e')) w = start.w + dx;
        if (mode.includes('s')) h = start.h + dy;
        if (mode.includes('w')) {
          w = start.w - dx;
          x = start.x + dx;
          if (w < MIN_W) {
            x -= MIN_W - w;
            w = MIN_W;
          }
        }
        if (mode.includes('n')) {
          h = start.h - dy;
          y = start.y + dy;
          if (h < MIN_H) {
            y -= MIN_H - h;
            h = MIN_H;
          }
        }
      }
      geometry = { x, y, w, h };
      applyGeometry();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      box.classList.remove('dragging');
      storage.set(GEOM_KEY, JSON.stringify(geometry));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
  head.addEventListener('pointerdown', event => {
    if (!event.target.closest('button,a')) begin(event, 'move');
  });
  head.addEventListener('dblclick', event => {
    if (!event.target.closest('button,a')) toggleMax();
  });
  for (const handle of box.querySelectorAll('.spec-view-rz'))
    handle.addEventListener('pointerdown', event => begin(event, handle.dataset.rz));
  addEventListener('resize', () => {
    if (!layer.hidden) applyGeometry();
  });
  // Not modal: Esc closes only while the focus is in the viewer, never while editing the page.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !layer.hidden && box.contains(document.activeElement)) {
      event.preventDefault();
      close();
    }
  });
  function toggleMax() {
    maximized = !maximized;
    applyGeometry();
  }

  const message = (icon, ...parts) => {
    const node = el('div', { class: 'spec-view-msg' });
    node.append(el('span', { class: 'spec-view-ico' }, icon), ...parts);
    body.replaceChildren(node);
  };
  const link = (label, href, primary = false) =>
    el('a', { class: `spec-view-btn${primary ? ' primary' : ''}`, href, target: '_blank', rel: 'noopener' }, label);
  function renderFrame() {
    if (!state?.blobUrl) return;
    const fragment =
      state.kind === 'pdf' ? `#toolbar=1&navpanes=${showNav ? 1 : 0}&pagemode=${showNav ? 'thumbs' : 'none'}` : '';
    body.replaceChildren(el('iframe', { src: state.blobUrl + fragment, title: state.name }));
    navButton.hidden = state.kind !== 'pdf';
    navButton.classList.toggle('on', showNav);
  }
  function release() {
    if (state?.blobUrl) URL.revokeObjectURL(state.blobUrl);
  }

  async function open(specs, index = 0, context = '') {
    if (!specs?.length) return;
    const k = Math.min(Math.max(0, index), specs.length - 1),
      spec = specs[k],
      seq = ++sequence;
    release();
    state = {
      specs,
      k,
      context,
      name: spec.name,
      kind: specKind(spec.name).kind,
      blobUrl: null,
      webUrl: null,
      downloadUrl: null,
    };
    title.textContent = spec.name;
    sub.textContent = [context, specs.length > 1 ? `第 ${k + 1} / ${specs.length} 份` : '']
      .filter(Boolean)
      .join('　·　');
    tabs.hidden = specs.length < 2;
    tabs.replaceChildren(
      ...(specs.length > 1
        ? specs.map((s, j) => {
            const tab = el(
              'button',
              { type: 'button', class: `spec-view-tab${j === k ? ' active' : ''}`, title: s.name },
              `📄 ${s.name}`,
            );
            tab.addEventListener('click', () => open(specs, j, context));
            return tab;
          })
        : []),
    );
    navButton.hidden = true;
    layer.hidden = false;
    applyGeometry();
    box.focus({ preventScroll: true });
    message('⏳', '讀取中…');
    try {
      const meta = await fileMeta(spec.path);
      if (seq !== sequence) return; // closed, or another file chosen meanwhile
      if (!meta?.downloadUrl) throw new Error('SharePoint 上找不到這份規格書');
      Object.assign(state, { webUrl: meta.webUrl, downloadUrl: meta.downloadUrl });
      const size = sizeText(meta.size);
      if (size) sub.textContent = [sub.textContent, size].filter(Boolean).join('　·　');
      const { kind, mime } = specKind(spec.name);
      if (kind === 'office' || kind === 'other') {
        const name = el('b', {}, spec.name);
        if (kind === 'office')
          message(
            '📄',
            name,
            el('br'),
            meta.webUrl
              ? 'Office 檔案瀏覽器無法就地顯示，可用 Office Online 線上開啟（一樣不必下載）。'
              : 'Office 檔案無法就地顯示，請用上方的「⬇ 下載」。',
            el('br'),
            el('br'),
            ...(meta.webUrl ? [link('🌐 用 Office Online 開啟', meta.webUrl, true)] : []),
          );
        else
          message(
            '📦',
            name,
            el('br'),
            '這個格式無法線上預覽，請用上方的「⬇ 下載」。',
            el('br'),
            el('br'),
            ...(meta.webUrl ? [link('🌐 在 SharePoint 開啟', meta.webUrl)] : []),
          );
        return;
      }
      const response = await fetchFile(meta.downloadUrl, fetchImpl);
      if (seq !== sequence) return;
      if (kind === 'text') {
        let text = await response.text();
        if (seq !== sequence) return;
        if (text.length > TEXT_MAX)
          text = `${text.slice(0, TEXT_MAX)}\n\n─── 檔案過大，僅顯示前 ${sizeText(TEXT_MAX)}，完整內容請下載 ───`;
        body.replaceChildren(el('pre', { class: 'spec-view-text' }, text));
        return;
      }
      const buffer = await response.arrayBuffer();
      if (seq !== sequence) return;
      state.blobUrl = URL.createObjectURL(new Blob([buffer], { type: mime }));
      if (kind === 'image') body.replaceChildren(el('img', { src: state.blobUrl, alt: spec.name }));
      else renderFrame();
    } catch (error) {
      if (seq !== sequence) return;
      message(
        '⚠️',
        '無法線上預覽：',
        el('b', {}, error?.message || String(error)),
        el('br'),
        '可以改用上方的「⬇ 下載」開啟這份規格書。',
      );
    }
  }
  function close() {
    sequence++; // results still on their way are dropped
    release();
    state = null;
    layer.hidden = true;
    body.replaceChildren();
    tabs.replaceChildren();
  }
  navButton.addEventListener('click', () => {
    showNav = !showNav;
    storage.set(NAV_KEY, showNav ? '1' : '0');
    renderFrame();
  });
  tabButton.addEventListener('click', () => {
    const url = state?.blobUrl || state?.webUrl || state?.downloadUrl;
    if (url) window.open(url, '_blank', 'noopener');
  });
  downloadButton.addEventListener('click', () => {
    if (!state) return;
    const href = state.blobUrl || state.downloadUrl;
    if (!href) return;
    const a = el('a', { href, download: state.name });
    document.body.append(a);
    a.click();
    a.remove();
  });
  maxButton.addEventListener('click', toggleMax);
  closeButton.addEventListener('click', close);
  return {
    open,
    close,
    get isOpen() {
      return !layer.hidden;
    },
  };
}
