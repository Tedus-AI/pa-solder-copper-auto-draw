// Project database: the working copy of every saved PA project.
//
// Layout (one JSON document):
//   { format: 'pa-copper-cad-db', version: 1,
//     projects: { [id]: { id, schema_version: 1, created_at, updated_at, design } },
//     sp_sync:  { dirty: { [id]: seq }, deleted: [id], etags: { [id]: eTag }, ctags: { [id]: cTag } } }
//
// Persistence (same model as Thermal-Test-Report-Builder):
//   · browser cache (localStorage) — always written, so the tool works with no setup;
//   · local database file (File System Access API, optional) — the shared working
//     file once chosen in 設定; see local-file-db.js;
//   · SharePoint (optional) — sp-sync.js pushes exactly the projects marked dirty
//     here and pulls what colleagues changed. Its bookkeeping (sp_sync) lives in this
//     document, so pending uploads survive a reload or a period offline.
// The active project is per browser and is kept outside the shared document.

export const DB_FORMAT = 'pa-copper-cad-db';
export const DB_VERSION = 1;
export const DB_CACHE_KEY = 'pa-copper-cad.db.v2';
export const LEGACY_STORAGE_KEY = 'pa-copper-cad.projects.v1';
export const ACTIVE_KEY = 'pa-copper-cad.active-project';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined || v === null ? v : structuredClone(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function emptyDb() {
  return { format: DB_FORMAT, version: DB_VERSION, projects: {}, sp_sync: emptySync() };
}
const emptySync = () => ({ dirty: {}, deleted: [], etags: {}, ctags: {} });

function validRecord(record) {
  return isObject(record) && typeof record.id === 'string' && isObject(record.design);
}

/** Parse and validate database text. Never substitutes an empty database for unreadable data. */
export function parseDbText(text) {
  if (!String(text).trim()) return emptyDb();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('資料庫檔案不是有效的 JSON（可能已毀損或被截斷），現有資料未被覆寫。');
  }
  return normalizeDb(data);
}

export function normalizeDb(data) {
  if (!isObject(data) || (data.format !== undefined && data.format !== DB_FORMAT))
    throw new Error('檔案不是 PA Copper CAD 專案資料庫。');
  const projects = data.projects ?? {};
  if (!isObject(projects) || Object.values(projects).some(r => !validRecord(r)))
    throw new Error('資料庫的專案資料格式不正確，現有資料未被覆寫。');
  const sync = isObject(data.sp_sync) ? data.sp_sync : {};
  return {
    format: DB_FORMAT,
    version: DB_VERSION,
    projects: clone(projects),
    sp_sync: {
      dirty: isObject(sync.dirty) ? clone(sync.dirty) : {},
      deleted: Array.isArray(sync.deleted) ? sync.deleted.filter(id => typeof id === 'string') : [],
      etags: isObject(sync.etags) ? clone(sync.etags) : {},
      ctags: isObject(sync.ctags) ? clone(sync.ctags) : {},
    },
  };
}

/** Projects in either database: the newer updated_at wins; ids only in `extra` are added. */
export function mergeProjects(base, extra) {
  const out = clone(base.projects);
  const added = [];
  for (const [id, record] of Object.entries(extra.projects ?? {})) {
    const mine = out[id];
    if (!mine || String(record.updated_at ?? '') > String(mine.updated_at ?? '')) {
      out[id] = clone(record);
      added.push(id);
    }
  }
  return { projects: out, added };
}

export class ProjectDatabase {
  constructor({ storage, cacheKey = DB_CACHE_KEY, legacyKey = LEGACY_STORAGE_KEY, activeKey = ACTIVE_KEY } = {}) {
    this.storage = storage;
    this.cacheKey = cacheKey;
    this.legacyKey = legacyKey;
    this.activeKey = activeKey;
    this.doc = null;
    this.file = null; // LocalFileDb once a database file is open
    this.generation = 0;
    this.listeners = { write: new Set(), change: new Set(), local: new Set() };
    this.localStatus = { state: 'cache', at: null, message: '' };
  }

  backend() {
    return this.storage ?? globalThis.localStorage;
  }

  // ───────── loading ─────────
  /** Read the browser cache (migrating the earlier localStorage project list once). */
  load() {
    let raw = null;
    try {
      raw = this.backend().getItem(this.cacheKey);
    } catch {
      throw new Error('瀏覽器儲存不可用；目前內容尚未儲存。');
    }
    if (raw) this.doc = parseDbText(raw);
    else this.doc = this.migrateLegacy();
    this.generation++;
    return this;
  }

  migrateLegacy() {
    const doc = emptyDb();
    let raw = null;
    try {
      raw = this.backend().getItem(this.legacyKey);
    } catch {
      return doc;
    }
    if (!raw) return doc;
    let legacy;
    try {
      legacy = JSON.parse(raw);
    } catch {
      throw new Error('瀏覽器中的專案資料無法讀取，現有資料未被覆寫。');
    }
    if (legacy?.schema_version !== 1 || !Array.isArray(legacy.projects) || legacy.projects.some(p => !validRecord(p)))
      throw new Error('瀏覽器中的專案資料無法讀取，現有資料未被覆寫。');
    for (const record of legacy.projects) {
      doc.projects[record.id] = clone(record);
      doc.sp_sync.dirty[record.id] = 1;
    }
    if (legacy.active_id) this.setActiveId(legacy.active_id);
    return doc;
  }

  ensure() {
    if (!this.doc) this.load();
    return this.doc;
  }

  /**
   * A local database file was opened. Its contents become the working copy; projects
   * only in this browser's cache (or newer here) are merged in so nothing is lost.
   * isNew: a brand-new empty file is seeded with the current cache.
   */
  async attachFile(file, text, { isNew = false } = {}) {
    const current = this.ensure();
    const fromFile = isNew ? emptyDb() : parseDbText(text);
    const merged = mergeProjects(fromFile, current);
    const doc = { ...fromFile, projects: merged.projects };
    for (const id of merged.added) doc.sp_sync.dirty[id] = (doc.sp_sync.dirty[id] || 0) + 1;
    this.doc = doc;
    this.file = file;
    this.generation++;
    this.emit('change', { source: 'file' });
    await this.persist();
    return { merged: merged.added.length };
  }

  detachFile() {
    this.file = null;
    this.setLocal('cache', '未設定本機資料庫檔案；專案暫存在此瀏覽器。');
  }

  /** Re-read the database file after someone else changed it (discards unsynced edits in this window). */
  async reloadFromFile() {
    if (!this.file) return;
    const text = await this.file.read({ force: true });
    this.doc = parseDbText(text);
    this.generation++;
    this.writeCache();
    this.emit('change', { source: 'file' });
    this.setLocal('saved', '已重新讀取資料庫檔案');
  }

  // ───────── project API (used by the project controls) ─────────
  list() {
    return Object.values(clone(this.ensure().projects)).sort((a, b) =>
      String(b.updated_at).localeCompare(String(a.updated_at)),
    );
  }
  get(id) {
    return clone(this.ensure().projects[id] ?? null);
  }
  activeId() {
    try {
      return this.backend().getItem(this.activeKey) || null;
    } catch {
      return null;
    }
  }
  setActiveId(id) {
    try {
      if (id) this.backend().setItem(this.activeKey, id);
      else this.backend().removeItem(this.activeKey);
    } catch {
      /* private mode */
    }
  }
  active() {
    this.ensure(); // loading may migrate the earlier store and its active project
    const id = this.activeId();
    return id ? this.get(id) : null;
  }
  activate(id) {
    if (!this.ensure().projects[id]) throw new Error('找不到這個已儲存的專案。');
    this.setActiveId(id);
  }
  save(design, { id = null } = {}) {
    const doc = this.ensure();
    const existing = id ? doc.projects[id] : null;
    const now = new Date().toISOString();
    const record = {
      id: existing?.id ?? newId(),
      schema_version: 1,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      design: clone(design),
    };
    const previous = doc.projects[record.id];
    doc.projects[record.id] = record;
    this.markDirty(record.id);
    try {
      this.writeCache();
    } catch (error) {
      if (previous) doc.projects[record.id] = previous;
      else delete doc.projects[record.id];
      throw error;
    }
    this.setActiveId(record.id);
    this.persistFile();
    return clone(record);
  }
  remove(id) {
    const doc = this.ensure();
    if (!doc.projects[id]) return;
    delete doc.projects[id];
    this.markDeleted(id);
    this.writeCache();
    if (this.activeId() === id) this.setActiveId(null);
    this.persistFile();
  }

  // ───────── persistence ─────────
  text() {
    return JSON.stringify(this.ensure());
  }
  writeCache() {
    try {
      this.backend().setItem(this.cacheKey, this.text());
    } catch {
      throw new Error('瀏覽器儲存失敗，可能已滿或被停用；目前內容尚未儲存。');
    }
  }
  /** Write the cache now and the database file (if any) through its queue. */
  async persist() {
    this.writeCache();
    await this.persistFile();
  }
  async persistFile() {
    if (!this.file) {
      this.setLocal('cache', '未設定本機資料庫檔案；專案暫存在此瀏覽器。');
      this.emit('write');
      return;
    }
    this.setLocal('saving', '寫入本機資料庫…');
    const result = await this.file.write(this.text());
    if (result.ok) this.setLocal('saved', '');
    else if (result.conflict) this.setLocal('conflict', '資料庫檔案已被其他人或其他分頁修改；為避免覆蓋已停止寫入。');
    else if (result.needsPermission) this.setLocal('needs-permission', '需要重新授權讀寫本機資料庫檔案。');
    else this.setLocal('error', result.message || '本機資料庫寫入失敗。');
    this.emit('write');
  }
  setLocal(state, message) {
    this.localStatus = { state, message: message || '', at: state === 'saved' ? new Date() : this.localStatus.at };
    this.emit('local', this.localStatus);
  }
  on(kind, fn) {
    this.listeners[kind].add(fn);
    return () => this.listeners[kind].delete(fn);
  }
  emit(kind, arg) {
    for (const fn of this.listeners[kind]) {
      try {
        fn(arg);
      } catch (error) {
        console.error(error);
      }
    }
  }

  // ───────── SharePoint bookkeeping ─────────
  markDirty(id) {
    const s = this.ensure().sp_sync;
    s.dirty[id] = (s.dirty[id] || 0) + 1;
    s.deleted = s.deleted.filter(x => x !== id);
  }
  markDeleted(id) {
    const s = this.ensure().sp_sync;
    delete s.dirty[id];
    if (s.etags[id] && !s.deleted.includes(id)) s.deleted.push(id);
  }

  /** API for sp-sync.js. Changes made here are sync results and never mark anything dirty. */
  get sync() {
    const db = this;
    return {
      generation: () => db.generation,
      state: () => clone(db.ensure().sp_sync),
      hasPending() {
        const s = db.ensure().sp_sync;
        return Object.keys(s.dirty).length > 0 || s.deleted.length > 0;
      },
      pendingCount() {
        const s = db.ensure().sp_sync;
        return Object.keys(s.dirty).length + s.deleted.length;
      },
      projectIds: () => Object.keys(db.ensure().projects),
      getProject: id => clone(db.ensure().projects[id] ?? null),
      markDirty: id => db.markDirty(id),
      setEtag(id, etag, ctag) {
        const s = db.ensure().sp_sync;
        s.etags[id] = etag;
        if (ctag) s.ctags[id] = ctag;
        else delete s.ctags[id];
      },
      applyRemote(id, record, etag, ctag) {
        db.ensure().projects[id] = clone(record);
        const s = db.ensure().sp_sync;
        delete s.dirty[id];
        s.etags[id] = etag;
        if (ctag) s.ctags[id] = ctag;
      },
      addProject(id, record) {
        db.ensure().projects[id] = { ...clone(record), id };
        db.markDirty(id);
      },
      removeLocal(id) {
        delete db.ensure().projects[id];
        const s = db.ensure().sp_sync;
        delete s.dirty[id];
        delete s.etags[id];
        delete s.ctags[id];
        if (db.activeId() === id) db.setActiveId(null);
      },
      /** Uploaded: keep it dirty only if it changed again during the upload. */
      markPushed(id, etag, seq, ctag) {
        const s = db.ensure().sp_sync;
        if (s.dirty[id] === seq) delete s.dirty[id];
        if (etag) s.etags[id] = etag;
        if (ctag) s.ctags[id] = ctag;
      },
      markDeletePushed(id) {
        const s = db.ensure().sp_sync;
        s.deleted = s.deleted.filter(x => x !== id);
        delete s.etags[id];
        delete s.ctags[id];
      },
      persist: () => db.persist(),
      notifyChanged: info => db.emit('change', { source: 'sharepoint', ...info }),
      backupText: () => db.text(),
    };
  }
}
