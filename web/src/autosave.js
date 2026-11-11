// Auto-save: an edited project is saved AUTOSAVE_DELAY_MS after the last change,
// through the normal save path — browser cache, the local database folder and
// SharePoint (uploaded by sp-sync a few seconds later, or when the connection
// returns). The 儲存 button still saves at once.
//
// A project that has a record is updated in place. A new project gets a record as
// soon as it has a name of its own (not the default 未命名專案), so trying numbers
// out on an unnamed project never fills the shared database. A record the user has
// just deleted is not re-created until it is saved by hand or renamed.

export const AUTOSAVE_DELAY_MS = 2000;
export const AUTOSAVE_KEY = 'pa-copper-cad.autosave';

/**
 * What auto-save does with the current edits:
 * 'update' the open record, 'create' a record, or nothing —
 * 'off' (turned off), 'unnamed' (new project without a name), 'deleted' (record just deleted).
 */
export function autosaveMode({ enabled, activeId, name, defaultName, deletedName = null }) {
  if (!enabled) return 'off';
  if (activeId) return 'update';
  const clean = String(name ?? '').trim();
  if (!clean || clean === defaultName) return 'unnamed';
  if (deletedName !== null && clean === deletedName) return 'deleted';
  return 'create';
}

const HINTS = {
  update: '將自動儲存',
  create: '將自動建立專案並儲存',
  unnamed: '尚未儲存；輸入專案名稱後自動儲存',
  deleted: '記錄已刪除；按「儲存」可重新建立',
};

/** Status text after a change, e.g. "試片已鎖定，" + hint. */
export function autosaveHint(mode, hasRecord) {
  return mode === 'off' ? `尚未儲存；請按「儲存」${hasRecord ? '' : '建立專案'}保存` : HINTS[mode];
}

/** The auto-save preference of this browser (on unless turned off). */
export function readAutosavePreference(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(AUTOSAVE_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function writeAutosavePreference(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(AUTOSAVE_KEY, on ? 'on' : 'off');
  } catch {}
}

/** Debounced save: schedule() after every change; flush() saves a pending change now. */
export class AutoSaver {
  constructor({ save, delay = AUTOSAVE_DELAY_MS, timers = globalThis }) {
    this.save = save;
    this.delay = delay;
    this.timers = timers;
    this.timer = null;
  }
  get pending() {
    return this.timer !== null;
  }
  schedule() {
    this.cancel();
    this.timer = this.timers.setTimeout(() => this.flush(), this.delay);
  }
  cancel() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
  /** Saves at once when a save is pending; returns what save returned, or false. */
  flush() {
    if (this.timer === null) return false;
    this.cancel();
    return this.save();
  }
}
