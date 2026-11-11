// Local database folder and automatic backup folder (File System Access API).
//
// · The database is a folder chosen once in 設定; it can live on a shared drive. Every
//   project is its own JSON file, laid out as on SharePoint:
//     <folder>/Database/projects/<專案名稱>_<ID 前 8 碼>.json   { format, id, project }
//     <folder>/Watermark/                                     drawing PDF watermark
//   The folder handle is kept in IndexedDB; after a reload the browser may ask again for
//   permission (one click on 重新授權).
// · Writes are serialized and coalesced (one in flight, one queued with the latest text).
//   Only projects that changed are written; a renamed project moves to its new file name.
// · Each write first looks at the folder: projects a colleague added or changed come in
//   (returned as `incoming`), projects a colleague deleted go (`removed`). When the same
//   project changed both here and in the folder, writing stops — nothing is overwritten —
//   until the user reloads the folder or explicitly overwrites.
// · The backup folder receives one file per day (pa_copper_cad_backup_YYYY-MM-DD.json, a
//   snapshot of every project), keeping the newest BACKUP_KEEP. A much smaller snapshot
//   never replaces the day's backup; it goes to a time-stamped file instead.

import { PROJECT_FORMAT } from './sp-sync.js';

export const BACKUP_PREFIX = 'pa_copper_cad_backup_';
export const BACKUP_KEEP = 30;
const IDB_NAME = 'pa-copper-cad-files';
const DB_HANDLE_KEY = 'database-folder';
const LEGACY_HANDLE_KEY = 'database-file'; // the earlier single database file
export const PROJECTS_PATH = ['Database', 'projects'];

/** File name of a project in the database folder: 專案名稱_<ID 前 8 碼>.json. */
export function projectFileName(record) {
  const name =
    String(record?.design?.project?.name || '未命名專案')
      // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 80) || '未命名專案';
  return `${name}_${String(record.id)
    .replace(/[^0-9A-Za-z-]/g, '')
    .slice(0, 8)}.json`;
}

/** A project file's record, or null when the file is not a PA Copper CAD project. */
export function parseProjectFile(text) {
  try {
    const data = JSON.parse(text);
    const record = data?.format === PROJECT_FORMAT ? data.project : null;
    if (!record || typeof record !== 'object' || typeof record.design !== 'object' || typeof data.id !== 'string')
      return null;
    return { ...record, id: data.id };
  } catch {
    return null;
  }
}
const projectFileText = record =>
  JSON.stringify({ format: PROJECT_FORMAT, id: record.id, project: record }, null, 2) + '\n';
const dbText = projects => JSON.stringify({ format: 'pa-copper-cad-db', version: 1, projects });
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
    this.root = null; // database folder
    this.backupDir = null;
    this.known = new Map(); // id → { file, lastModified, json } as last read or written
    this.conflict = false;
    this.pending = null; // queued text (latest wins)
    this.tail = Promise.resolve();
    this.lastWrite = null;
    this.storesSync = false; // SharePoint bookkeeping stays in the browser
  }

  name() {
    return this.root?.name ?? null;
  }
  rootDir() {
    return this.root;
  }
  isReady() {
    return this.root !== null;
  }
  hasConflict() {
    return this.conflict;
  }

  // ───────── opening ─────────
  /** Page load, no user gesture: reuse a remembered folder when permission is still granted. */
  async tryRestore() {
    const saved = await this.handles.get(DB_HANDLE_KEY);
    if (!saved) {
      const legacy = await this.handles.get(LEGACY_HANDLE_KEY);
      return legacy ? { ok: false, legacy: true, name: legacy.name } : { ok: false, reason: 'none' };
    }
    let state;
    try {
      state = await saved.queryPermission({ mode: 'readwrite' });
    } catch {
      return { ok: false, reason: 'error' };
    }
    if (state !== 'granted') return { ok: false, needsPermission: true, name: saved.name };
    return this.open(saved);
  }
  /** Click handler: re-grant permission for the remembered folder. */
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
  /** Click handler: choose the database folder (new or existing). */
  async pick() {
    let handle;
    try {
      handle = await this.picker.showDirectoryPicker({ id: 'pa-copper-cad-db', mode: 'readwrite' });
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'error', message: error?.message };
    }
    await this.flush();
    const result = await this.open(handle);
    if (result.ok) {
      await this.handles.set(DB_HANDLE_KEY, handle);
      await this.handles.set(LEGACY_HANDLE_KEY, null);
    }
    return result;
  }
  /** Read every project file of a folder; → { ok, name, text, isNew } (text: a database document). */
  async open(root) {
    try {
      this.root = root;
      this.known = new Map();
      this.conflict = false;
      const projects = await this.scan();
      return { ok: true, name: root.name, text: dbText(projects), isNew: Object.keys(projects).length === 0 };
    } catch (error) {
      this.root = null;
      return { ok: false, reason: 'error', message: `無法讀取資料庫資料夾：${error?.message ?? error}` };
    }
  }
  async forget() {
    await this.flush();
    this.root = null;
    this.known = new Map();
    this.conflict = false;
    await this.handles.set(DB_HANDLE_KEY, null);
  }

  // ───────── folder access ─────────
  async projectsDir(create) {
    let dir = this.root;
    for (const part of PROJECTS_PATH) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }
  async listFiles(dir) {
    const out = [];
    for await (const [name, handle] of dir.entries())
      if (handle.kind === 'file' && name.toLowerCase().endsWith('.json'))
        out.push({ name, handle, file: await handle.getFile() });
    return out;
  }
  /** All projects in the folder; resets what is known about its files. */
  async scan() {
    const projects = {};
    this.known = new Map();
    let dir;
    try {
      dir = await this.projectsDir(false);
    } catch {
      return projects; // no Database/projects yet: a new database folder
    }
    for (const { name, file } of await this.listFiles(dir)) {
      const record = parseProjectFile(await file.text());
      if (!record) continue;
      const prev = projects[record.id];
      if (prev && String(prev.updated_at) >= String(record.updated_at)) continue;
      projects[record.id] = record;
      this.known.set(record.id, { file: name, lastModified: file.lastModified, json: JSON.stringify(record) });
    }
    return projects;
  }

  // ───────── reading / writing ─────────
  async read({ force = false } = {}) {
    if (!this.root) throw new Error('尚未開啟本機資料庫資料夾。');
    await this.flush();
    const projects = await this.scan();
    if (force) this.conflict = false;
    return dbText(projects);
  }
  /** Resolves once every queued write has settled. */
  flush() {
    return this.tail;
  }
  /**
   * Queue the latest database text. → { ok, incoming, removed } | { conflict } |
   * { needsPermission } | { message }. incoming: records colleagues added or changed in
   * the folder; removed: ids of projects they deleted.
   */
  write(text, { overwrite = false } = {}) {
    if (!this.root) return Promise.resolve({ ok: false, message: '尚未開啟本機資料庫資料夾。' });
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
    const root = this.root;
    if (!root) return { ok: false, message: '尚未開啟本機資料庫資料夾。' };
    try {
      if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted')
        return { ok: false, needsPermission: true };
      if (overwrite) this.conflict = false;
      if (this.conflict) return { ok: false, conflict: true };
      const mine = JSON.parse(text).projects ?? {};
      const dir = await this.projectsDir(true);
      const files = await this.listFiles(dir),
        names = new Set(files.map(f => f.name)),
        incoming = [],
        removed = [];
      // 1. files a colleague added or changed since we last read or wrote them
      for (const { name, file } of files) {
        const knownEntry = [...this.known.values()].find(k => k.file === name);
        if (knownEntry && knownEntry.lastModified === file.lastModified) continue;
        const record = parseProjectFile(await file.text());
        if (!record) continue;
        const prev = this.known.get(record.id),
          own = mine[record.id];
        const ownChanged = !!own && (!prev || JSON.stringify(own) !== prev.json);
        if (ownChanged && prev && !overwrite) {
          this.conflict = true;
          return { ok: false, conflict: true, project: record.id };
        }
        const keepOwn = ownChanged && (overwrite || String(own.updated_at) >= String(record.updated_at));
        this.known.set(record.id, {
          file: name,
          lastModified: file.lastModified,
          json: keepOwn ? '' : JSON.stringify(record),
        });
        if (keepOwn) continue;
        incoming.push(record);
        mine[record.id] = record;
      }
      // 2. files a colleague deleted: the project goes too, unless it changed here
      for (const [id, k] of [...this.known]) {
        if (names.has(k.file)) continue;
        if (!overwrite && mine[id] && JSON.stringify(mine[id]) === k.json) {
          removed.push(id);
          delete mine[id];
        }
        this.known.delete(id);
      }
      // 3. projects changed here: one file each; a rename moves the file
      for (const [id, record] of Object.entries(mine)) {
        const json = JSON.stringify(record),
          k = this.known.get(id);
        if (k && k.json === json) continue;
        const name = projectFileName(record),
          handle = await dir.getFileHandle(name, { create: true }),
          writable = await handle.createWritable();
        await writable.write(projectFileText(record));
        await writable.close();
        if (k && k.file !== name) await dir.removeEntry(k.file).catch(() => {});
        this.known.set(id, { file: name, lastModified: (await handle.getFile()).lastModified, json });
      }
      // 4. projects deleted here
      for (const [id, k] of [...this.known])
        if (!Object.hasOwn(mine, id)) {
          await dir.removeEntry(k.file).catch(() => {});
          this.known.delete(id);
        }
      this.lastWrite = new Date();
      return { ok: true, incoming, removed };
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
