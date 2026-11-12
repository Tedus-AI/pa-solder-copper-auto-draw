// Full screen: a header button, and "進入工具時自動全螢幕".
//
// Browsers only allow full screen from a user action (a click or a key press), never
// on page load. Auto full screen therefore happens on the first click or key press in
// the tool after it opens — once per page load, so leaving full screen with Esc is
// respected. Clicks inside dialogs are skipped: they may open a file or folder picker,
// which also needs that same user action.

export const AUTO_FULLSCREEN_KEY = 'pa-copper-cad.auto-fullscreen';

/** The auto full screen preference of this browser (on unless turned off). */
export function readAutoFullscreen(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(AUTO_FULLSCREEN_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function writeAutoFullscreen(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(AUTO_FULLSCREEN_KEY, on ? 'on' : 'off');
  } catch {}
}

/** Whether the first user action should enter full screen. */
export function shouldAutoEnter({ enabled, supported, active, target }) {
  if (!enabled || !supported || active) return false;
  if (target?.closest?.('dialog, input[type=file]')) return false;
  return true;
}

export function setupFullscreen({ $, doc = document }) {
  const button = $('fullscreen-toggle'),
    autoBox = $('auto-fullscreen');
  const supported = !!doc.fullscreenEnabled && typeof doc.documentElement.requestFullscreen === 'function';
  const active = () => !!doc.fullscreenElement;
  autoBox.checked = readAutoFullscreen();
  if (!supported) {
    button.hidden = true;
    autoBox.disabled = true;
    $('auto-fullscreen-note').textContent = '此瀏覽器不支援網頁全螢幕。';
  }
  const render = () => {
    const on = active();
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? '離開全螢幕（Esc）' : '全螢幕（F11 亦可）';
    button.setAttribute('aria-label', on ? '離開全螢幕' : '全螢幕');
  };
  const enter = () => doc.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  const toggle = () => (active() ? doc.exitFullscreen().catch(() => {}) : enter());
  button.addEventListener('click', toggle);
  doc.addEventListener('fullscreenchange', render);
  autoBox.addEventListener('change', () => writeAutoFullscreen(autoBox.checked));

  let tried = false;
  const first = event => {
    if (tried) return;
    // The full screen button handles its own click; Esc and modifier keys are not a start.
    if (event.target?.closest?.('#fullscreen-toggle')) return void (tried = true);
    if (event.type === 'keydown' && (event.key === 'Escape' || event.key === 'F11')) return;
    if (!shouldAutoEnter({ enabled: autoBox.checked, supported, active: active(), target: event.target })) {
      if (!event.target?.closest?.('dialog')) tried = true;
      return;
    }
    tried = true;
    enter();
  };
  doc.addEventListener('pointerdown', first, true);
  doc.addEventListener('keydown', first, true);
  render();
  return { toggle, active };
}
