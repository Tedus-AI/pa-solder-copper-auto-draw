// Local database file and automatic backup folder (File System Access API),
// ported from Thermal-Test-Report-Builder's fileDb.js.
//
// · The database file is chosen once in 設定 and can live on a shared drive. Its
//   handle is kept in IndexedDB; after a reload the browser may ask again for
//   permission (one click on 重新授權).
// · Writes are serialized and coalesced (one in flight, one queued with the latest text).
// · Before each write the file's lastModified is compared with the value after our own
//   last read/write. If someone else (another tab, a colleague on the shared drive, a
//   sync client) changed it, writing stops — nothing is overwritten — until the user
//   reloads the file or explicitly overwrites it.
// · The backup folder receives one file per day (pa_copper_cad_backup_YYYY-MM-DD.json),
//   keeping the newest BACKUP_KEEP. A much smaller snapshot never replaces the day's
//   backup; it goes to a time-stamped file instead.

export const BACKUP_PREFIX = 'pa_copper_cad_backup_';
export const BACKUP_KEEP = 30;
const IDB_NAME = 'pa-copper-cad-files';
const DB_HANDLE_KEY = 'database-file';
const BACKUP_HANDLE_KEY = 'backup-folder';

export function localDateStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localTimeStamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Backup names to delete so only the newest `keep` remain (names sort by date/time). */
export function backupsToPrune(names, keep = BACKUP_KEEP) {
  const backups = names.filter(n => n.startsWith(BACKUP_PREFIX) && n.endsWith('.json')).sort();
  return backups.length > keep ? backups.slice(0, backups.length - keep) : [];
}

export const fileApiSupported = () =>
  typeof window !== 'undefined' &&
  typeof window.showOpenFilePicker === 'function' &&
  typeof window.showDirectoryPicker === 'function';

/** Minimal IndexedDB key/value store for file handles. */
export class HandleStore {
  constructor(indexedDB = globalThis.indexedDB) {
    this.idb = indexedDB;
    this.opening = null;
  }
  open() {
    if (!this.idb) return Promise.reject(new Error('IndexedDB unavailable'));
    this.opening ??= new Promise((resolve, reject) => {
      const req = this.idb.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.opening;
  }
  async get(key) {
    try {
      const db = await this.open();
      return await new Promise(resolve => {
        const req = db.transaction('handles', 'readonly').objectStore('handles').get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }
  async set(key, value) {
    try {
      const db = await this.open();
      await new Promise(resolve => {
        const tx = db.transaction('handles', 'readwrite');
        if (value === null) tx.objectStore('handles').delete(key);
        else tx.objectStore('handles').put(value, key);
        tx.oncomplete = tx.onerror = () => resolve();
      });
    } catch {
      /* the handle is just not remembered */
    }
  }
}

export class LocalFileDb {
  constructor({ handles = new HandleStore(), picker = globalThis.window } = {}) {
    this.handles = handles;
    this.picker = picker;
    this.handle = null;
    this.backupDir = null;
    this.knownLastModified = null;
    this.conflict = false;
    this.pending = null; // queued text (latest wins)
    this.tail = Promise.resolve();
    this.lastWrite = null;
  }

  name() {
    return this.handle?.name ?? null;
  }
  isReady() {
    return this.handle !== null;
  }
  hasConflict() {
    return this.conflict;
  }

  // ───────── opening ─────────
  /** Page load, no user gesture: reuse a remembered file when permission is still granted. */
  async tryRestore() {
    const saved = await this.handles.get(DB_HANDLE_KEY);
    if (!saved) return { ok: false, reason: 'none' };
    let state;
    try {
      state = await saved.queryPermission({ mode: 'readwrite' });
    } catch {
      return { ok: false, reason: 'error' };
    }
    if (state !== 'granted') return { ok: false, needsPermission: true, name: saved.name };
    return this.open(saved);
  }
  /** Click handler: re-grant permission for the remembered file. */
  async reconnect() {
    const saved = await this.handles.get(DB_HANDLE_KEY);
    if (!saved) return this.pick();
    try {
      if ((await saved.requestPermission({ mode: 'readwrite' })) !== 'granted') return { ok: false, reason: 'denied' };
    } catch {
      return { ok: false, reason: 'error' };
    }
    return this.open(saved);
  }
  /** Click handler: choose an existing database file. */
  async pick() {
    let handle;
    try {
      [handle] = await this.picker.showOpenFilePicker({
        types: [{ description: 'PA Copper CAD 資料庫', accept: { 'application/json': ['.json'] } }],
        multiple: false,
      });
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'error', message: error?.message };
    }
    await this.flush();
    const result = await this.open(handle);
    if (result.ok) await this.handles.set(DB_HANDLE_KEY, handle);
    return result;
  }
  /** Click handler: create a new, empty database file. */
  async create() {
    let handle;
    try {
      handle = await this.picker.showSaveFilePicker({
        suggestedName: 'pa_copper_cad_db.json',
        types: [{ description: 'PA Copper CAD 資料庫', accept: { 'application/json': ['.json'] } }],
      });
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'error', message: error?.message };
    }
    await this.flush();
    this.handle = handle;
    this.knownLastModified = null;
    this.conflict = false;
    await this.handles.set(DB_HANDLE_KEY, handle);
    return { ok: true, name: handle.name, isNew: true, text: '' };
  }
  async open(handle) {
    try {
      const file = await handle.getFile();
      const text = await file.text();
      this.handle = handle;
      this.knownLastModified = file.lastModified;
      this.conflict = false;
      return { ok: true, name: handle.name, text };
    } catch (error) {
      return { ok: false, reason: 'error', message: `無法讀取資料庫檔案：${error?.message ?? error}` };
    }
  }
  async forget() {
    await this.flush();
    this.handle = null;
    this.knownLastModified = null;
    this.conflict = false;
    await this.handles.set(DB_HANDLE_KEY, null);
  }

  // ───────── reading / writing ─────────
  async read({ force = false } = {}) {
    if (!this.handle) throw new Error('尚未開啟本機資料庫檔案。');
    await this.flush();
    const file = await this.handle.getFile();
    const text = await file.text();
    this.knownLastModified = file.lastModified;
    if (force) this.conflict = false;
    return text;
  }
  /** Resolves once every queued write has settled. */
  flush() {
    return this.tail;
  }
  /** Queue the latest database text. → { ok } | { conflict } | { needsPermission } | { message } */
  write(text, { overwrite = false } = {}) {
    if (!this.handle) return Promise.resolve({ ok: false, message: '尚未開啟本機資料庫檔案。' });
    if (this.pending) {
      this.pending.text = text;
      this.pending.overwrite ||= overwrite;
      return this.pending.promise;
    }
    const job = { text, overwrite };
    job.promise = this.tail.then(async () => {
      this.pending = null;
      return this.writeNow(job.text, job.overwrite);
    });
    this.pending = job;
    this.tail = job.promise.catch(() => {});
    return job.promise;
  }
  async writeNow(text, overwrite) {
    const handle = this.handle;
    if (!handle) return { ok: false, message: '尚未開啟本機資料庫檔案。' };
    try {
      if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted')
        return { ok: false, needsPermission: true };
      if (overwrite) this.conflict = false;
      if (this.conflict) return { ok: false, conflict: true };
      if (!overwrite && this.knownLastModified !== null) {
        const current = await handle.getFile();
        if (current.lastModified !== this.knownLastModified) {
          this.conflict = true;
          return { ok: false, conflict: true };
        }
      }
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      this.knownLastModified = (await handle.getFile()).lastModified;
      this.lastWrite = new Date();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: `本機資料庫寫入失敗：${error?.message ?? error}` };
    }
  }

  // ───────── backup folder ─────────
  backupDirName() {
    return this.backupDir?.name ?? null;
  }
  async tryRestoreBackupDir() {
    const saved = await this.handles.get(BACKUP_HANDLE_KEY);
    if (!saved) return { ok: false, reason: 'none' };
    try {
      if ((await saved.queryPermission({ mode: 'readwrite' })) === 'granted') {
        this.backupDir = saved;
        return { ok: true, name: saved.name };
      }
      return { ok: false, needsPermission: true, name: saved.name };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }
  async pickBackupDir() {
    try {
      const handle = await this.picker.showDirectoryPicker({ mode: 'readwrite' });
      this.backupDir = handle;
      await this.handles.set(BACKUP_HANDLE_KEY, handle);
      return { ok: true, name: handle.name };
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'error', message: error?.message };
    }
  }
  async reconnectBackupDir() {
    const saved = await this.handles.get(BACKUP_HANDLE_KEY);
    if (!saved) return this.pickBackupDir();
    try {
      if ((await saved.requestPermission({ mode: 'readwrite' })) !== 'granted') return { ok: false, reason: 'denied' };
      this.backupDir = saved;
      return { ok: true, name: saved.name };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }
  /** Write today's backup (replacing today's unless the new one is far smaller), then prune. */
  async writeBackup(text, now = new Date()) {
    const dir = this.backupDir;
    if (!dir) return { ok: false, reason: 'none' };
    try {
      if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') return { ok: false, needsPermission: true };
      const date = localDateStr(now);
      let name = `${BACKUP_PREFIX}${date}.json`;
      try {
        const existing = await (await dir.getFileHandle(name)).getFile();
        if (existing.size > 1024 && existing.size > text.length * 2)
          name = `${BACKUP_PREFIX}${date}_${localTimeStamp(now)}.json`;
      } catch {
        /* no backup yet today */
      }
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
      const names = [];
      for await (const [entry, handle] of dir.entries()) if (handle.kind === 'file') names.push(entry);
      for (const old of backupsToPrune(names)) {
        try {
          await dir.removeEntry(old);
        } catch {
          /* next time */
        }
      }
      return { ok: true, name };
    } catch (error) {
      return { ok: false, reason: 'error', message: String(error?.message ?? error) };
    }
  }
}

/** Download the whole database as a JSON file (works in every browser). */
export function downloadBackup(text, now = new Date()) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${BACKUP_PREFIX}${localDateStr(now)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
