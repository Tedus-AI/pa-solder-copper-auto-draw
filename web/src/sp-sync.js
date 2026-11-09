// SharePoint dual save (Microsoft Graph), ported from Thermal-Test-Report-Builder's
// spSync.js and reduced to what PA projects need (no pictures, no TIM library).
//
// Same Azure app and SharePoint site (Thermal-Spec-DB) as the other thermal tools.
// This tool keeps its own folder in the site's 文件 (Shared Documents) library:
//
//   PA_Copper_CAD/Database/projects/<projectId>.json   one file per saved project
//   PA_Copper_CAD/Backup/pa_copper_cad_backup_YYYY-MM-DD.json   whole database, newest 2
//   ToolDatabase/thermal_db.json                         read only: AI-Thermal's projects
//
// Folders are created by the first upload. The local working copy (project-db.js)
// marks every changed project dirty; this engine uploads exactly those and pulls
// projects colleagues changed. Each upload uses If-Match: <eTag>:
//   · changed on SharePoint since our last sync → our version is written and theirs is
//     kept as a separate 「衝突副本」 project — nothing is silently overwritten;
//   · deleted here but changed there meanwhile → restored, not deleted;
//   · offline / signed out → changes stay marked and go up on the next sync.
// A new eTag with an unchanged cTag (content tag) is the same content, never an edit.

export const SP_CONFIG = {
  clientId: '17fc1ab4-0ab0-4520-9315-6faa86d9e8ec',
  authority: 'https://login.microsoftonline.com/19f25823-17ff-421f-ad4e-8fed035aedda',
  scopes: ['Files.ReadWrite.All', 'Sites.Read.All', 'Sites.ReadWrite.All'],
  siteHostname: 'deltao365.sharepoint.com',
  sitePath: '/sites/Thermal-Spec-DB',
  siteName: 'Thermal-Spec-DB',
  root: 'PA_Copper_CAD',
  aiThermalDb: 'ToolDatabase/thermal_db.json',
};
export const PROJECT_FORMAT = 'pa-copper-cad-project-v1';
export const SP_BACKUP_PREFIX = 'pa_copper_cad_backup_';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const GET_MS = 30000,
  PUT_MS = 120000;
const PUSH_DEBOUNCE_MS = 4000,
  POLL_MS = 60000,
  RETRY_MS = 30000,
  BACKUP_KEEP = 2;
const LS_ENABLED = 'pa-copper-cad.sp.enabled';
const LS_BACKUP = 'pa-copper-cad.sp.last-backup';
const LS_AI_THERMAL = 'pa-copper-cad.ai-thermal-projects';

const enc = p => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');
const mkErr = (message, props) => Object.assign(new Error(message), props || {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byName = item => item?.lastModifiedBy?.user?.displayName || '';
const metaOf = j => ({
  id: j.id || null,
  etag: j.eTag || null,
  ctag: j.cTag || null,
  size: Number(j.size) || 0,
  modified: j.lastModifiedDateTime || null,
  by: byName(j),
});
/** Same content: the same version (eTag), or a newer eTag with the same content tag. */
export const sameContent = (a, b) => !!(a && b && ((a.etag && a.etag === b.etag) || (a.ctag && a.ctag === b.ctag)));
function stamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const projectName = record => record?.design?.project?.name || '未命名專案';

/** AI-Thermal's thermal_db.json → [{ id, name, band }] sorted by name (read only). */
export function aiThermalProjects(db) {
  const projects = db && typeof db === 'object' ? db.projects : null;
  if (!projects || typeof projects !== 'object') return [];
  return Object.entries(projects)
    .filter(([, p]) => p && typeof p === 'object')
    .map(([id, p]) => ({ id, name: String(p.project_name || id).trim(), band: p.band === 'FR2' ? 'FR2' : 'FR1' }))
    .filter(p => p.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export class SharePointSync {
  constructor({
    db,
    auth,
    fetchImpl = (...args) => globalThis.fetch(...args),
    storage = globalThis.localStorage,
    config = SP_CONFIG,
  }) {
    this.db = db;
    this.auth = auth;
    this.fetch = fetchImpl;
    this.storage = storage;
    this.config = config;
    this.projectsFolder = `${config.root}/Database/projects`;
    this.backupFolder = `${config.root}/Backup`;
    this.siteId = null;
    this.status = { state: 'off', message: '', lastSync: null, pending: 0 };
    this.listeners = { status: new Set(), notice: new Set() };
    this.running = null;
    this.again = false;
    this.pushTimer = null;
    this.retryTimer = null;
    this.pollTimer = null;
    this.editingId = null; // the active project while it has unsaved edits: never replaced by a pull
    this.deferred = new Set();
    this.unhook = null;
  }

  // ───────── small helpers ─────────
  lsGet(key) {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  lsSet(key, value) {
    try {
      if (value === null) this.storage?.removeItem(key);
      else this.storage?.setItem(key, value);
    } catch {
      /* private mode */
    }
  }
  isEnabled() {
    return this.lsGet(LS_ENABLED) === '1';
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
  setStatus(state, message) {
    this.status = {
      state,
      message: message || '',
      lastSync: state === 'synced' ? new Date() : this.status.lastSync,
      pending: this.db.sync.pendingCount(),
    };
    this.emit('status', this.status);
  }
  location() {
    return `${this.config.siteName} / 文件 / ${this.config.root}`;
  }
  account() {
    return this.auth.account();
  }

  // ───────── Graph ─────────
  async timed(url, opts, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      return await this.fetch(url, { ...opts, signal: ctl.signal });
    } catch (error) {
      throw mkErr(
        error?.name === 'AbortError'
          ? `SharePoint 連線逾時（${Math.round(ms / 1000)} 秒沒有回應）`
          : `無法連線到 SharePoint（${error?.message ?? error}）`,
        { network: true },
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async httpErr(res) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || j?.error?.code || '';
    } catch {
      /* not JSON */
    }
    const s = res.status;
    const msg =
      s === 401
        ? 'Microsoft 登入已過期，請重新登入'
        : s === 403
          ? `沒有權限存取 SharePoint 網站 ${this.config.siteName}（請確認帳號有該網站的編輯權限）`
          : s === 404
            ? '在 SharePoint 上找不到'
            : s === 409
              ? 'SharePoint 上已有同名檔案'
              : s === 412
                ? '檔案剛被其他人更新'
                : s === 423
                  ? 'SharePoint 檔案被鎖定'
                  : s === 429
                    ? 'SharePoint 要求放慢速度（429）'
                    : s === 507
                      ? 'SharePoint 空間不足'
                      : `SharePoint 錯誤 ${s}`;
    return mkErr(msg + (detail && s !== 404 && s !== 412 ? `：${detail}` : ''), {
      status: s,
      auth: s === 401,
      conflict: s === 412 || s === 409,
    });
  }
  /** Graph request with timeout; GET retries once on network errors / 429 / 5xx. */
  async graph(path, o = {}) {
    const method = o.method || 'GET';
    const url = /^https:/.test(path) ? path : GRAPH + path;
    const tries = method === 'GET' ? 2 : 1;
    let last = null;
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(700);
      const headers = { Authorization: `Bearer ${await this.auth.token(!!o.interactive)}`, ...(o.headers || {}) };
      let res;
      try {
        res = await this.timed(
          url,
          { method, headers, body: o.body, cache: 'no-store' },
          o.timeout || (method === 'GET' ? GET_MS : PUT_MS),
        );
      } catch (error) {
        last = error;
        continue;
      }
      if (res.ok || o.ok?.(res.status)) return res;
      last = await this.httpErr(res);
      if (!(res.status === 429 || res.status >= 500)) break;
    }
    throw last;
  }
  async resolveSite(interactive) {
    if (this.siteId) return this.siteId;
    const res = await this.graph(`/sites/${this.config.siteHostname}:${this.config.sitePath}?$select=id`, {
      interactive,
      ok: s => s === 404,
    });
    if (res.status === 404)
      throw mkErr(`找不到 SharePoint 網站 ${this.config.siteHostname}${this.config.sitePath}`, { status: 404 });
    this.siteId = (await res.json()).id;
    return this.siteId;
  }
  byPath(path) {
    return `/sites/${this.siteId}/drive/root:/${enc(path)}`;
  }
  projectPath(id) {
    return `${this.projectsFolder}/${id}.json`;
  }
  async listChildren(path) {
    const out = [];
    let url = `${this.byPath(path)}:/children?$select=id,name,eTag,cTag,size,lastModifiedDateTime,lastModifiedBy,file,folder&$top=200`;
    while (url) {
      const res = await this.graph(url, { ok: s => s === 404 });
      if (res.status === 404) return out;
      const j = await res.json();
      for (const it of j.value || []) out.push({ ...metaOf(it), name: it.name || '', isFolder: !!it.folder });
      url = j['@odata.nextLink'] || null;
    }
    return out;
  }
  async listRemote() {
    const out = new Map();
    for (const it of await this.listChildren(this.projectsFolder)) {
      const m = !it.isFolder && /^(.+)\.json$/i.exec(it.name);
      if (m) out.set(m[1], it);
    }
    return out;
  }
  async itemMeta(path) {
    const res = await this.graph(`${this.byPath(path)}?$select=id,eTag,cTag,size,lastModifiedDateTime,lastModifiedBy`, {
      ok: s => s === 404,
    });
    if (res.status === 404) return null;
    return metaOf(await res.json());
  }
  /** Download JSON together with the eTag / cTag of exactly that content. */
  async downloadJson(path, want) {
    for (let i = 0; i < 3; i++) {
      const res = await this.graph(`${this.byPath(path)}:/content`);
      const text = await res.text();
      const meta = await this.itemMeta(path);
      if (!meta) throw mkErr('SharePoint 上的檔案剛被刪除', { status: 404, vanished: true });
      if (want && !sameContent(meta, want) && i < 2) {
        want = meta;
        continue;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw mkErr(`SharePoint 上的 ${path.split('/').pop()} 不是有效的 JSON`);
      }
      return { data, ...meta };
    }
    throw mkErr('SharePoint 檔案一直在變動，請稍後再試');
  }
  async downloadProject(id, want) {
    const got = await this.downloadJson(this.projectPath(id), want);
    const record = got.data?.format === PROJECT_FORMAT ? got.data.project : null;
    if (!record || typeof record !== 'object' || typeof record.design !== 'object')
      throw mkErr(`SharePoint 上的專案檔 ${id}.json 格式不正確`);
    return { ...got, data: undefined, record: { ...record, id } };
  }
  async uploadJson(path, obj, ifMatch, create) {
    const headers = { 'Content-Type': 'application/json' };
    if (ifMatch) headers['If-Match'] = ifMatch;
    const q = create ? '?@microsoft.graph.conflictBehavior=fail' : '';
    const res = await this.graph(`${this.byPath(path)}:/content${q}`, {
      method: 'PUT',
      body: JSON.stringify(obj),
      headers,
    });
    return metaOf(await res.json().catch(() => ({})));
  }
  uploadProject(id, record, ifMatch, create) {
    return this.uploadJson(this.projectPath(id), { format: PROJECT_FORMAT, id, project: record }, ifMatch, create);
  }
  async deleteRemote(path, ifMatch) {
    await this.graph(this.byPath(path), {
      method: 'DELETE',
      headers: ifMatch ? { 'If-Match': ifMatch } : {},
      ok: s => s === 404,
    });
  }

  // ───────── sync run ─────────
  async runSync() {
    const sync = this.db.sync;
    if (!this.isEnabled()) return;
    const gen = sync.generation();
    const stale = () => sync.generation() !== gen;
    const notes = [];
    const info = { pulled: [], removed: [], pushed: 0, copies: 0, restored: [] };
    let localChanged = false,
      rerun = false;
    this.setStatus('syncing', '同步中…');
    clearTimeout(this.retryTimer);
    try {
      await this.auth.token(false);
      await this.resolveSite(false);
      const remote = await this.listRemote();
      if (stale()) return;

      const keepRemoteCopy = (record, meta) => {
        const copy = structuredClone(record);
        const who = meta?.by || 'SharePoint';
        const suffix = `（衝突副本 · ${who} · ${stamp(meta?.modified)}）`;
        const name = projectName(record);
        copy.design.project = {
          ...(copy.design.project || {}),
          name: (name.slice(0, Math.max(1, 100 - suffix.length)) + suffix).slice(0, 100),
        };
        copy.created_at = copy.updated_at = new Date().toISOString();
        const id = globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        sync.addProject(id, copy);
        info.copies++;
        rerun = true;
        notes.push(`「${name}」同時在 SharePoint 被 ${who} 修改：保留你的版本，對方版本另存為「衝突副本」。`);
      };

      // ── pull: projects created / changed / deleted by other people ──
      let st = sync.state();
      const base = id => ({ etag: st.etags[id] || null, ctag: st.ctags[id] || null });
      const localIds = new Set(sync.projectIds());
      for (const [id, r] of remote) {
        if (st.dirty[id] !== undefined || st.deleted.includes(id)) continue;
        if (st.etags[id] === r.etag) continue;
        if (r.ctag && st.ctags[id] === r.ctag) {
          sync.setEtag(id, r.etag, r.ctag);
          localChanged = true;
          continue;
        }
        if (id === this.editingId) {
          this.deferred.add(id);
          continue;
        }
        let got;
        try {
          got = await this.downloadProject(id, r);
        } catch (error) {
          if (error.vanished) continue;
          throw error;
        }
        if (stale()) return;
        if (!st.etags[id] && localIds.has(id)) {
          if (sameJson(sync.getProject(id), got.record)) sync.setEtag(id, got.etag, got.ctag);
          else sync.markDirty(id);
        } else {
          sync.applyRemote(id, got.record, got.etag, got.ctag);
          info.pulled.push(id);
        }
        localChanged = true;
      }
      for (const id of Object.keys(st.etags)) {
        if (remote.has(id) || st.dirty[id] !== undefined || st.deleted.includes(id) || !localIds.has(id)) continue;
        if (id === this.editingId) {
          this.deferred.add(id);
          continue;
        }
        sync.removeLocal(id);
        info.removed.push(id);
        localChanged = true;
      }
      for (const id of localIds) {
        if (!st.etags[id] && st.dirty[id] === undefined && !remote.has(id)) {
          sync.markDirty(id);
          localChanged = true;
        }
      }
      if (stale()) return;
      if (localChanged) await sync.persist();

      // ── push: projects changed here ──
      st = sync.state();
      for (const id of Object.keys(st.dirty)) {
        if (stale()) return;
        const seq = st.dirty[id];
        const local = sync.getProject(id);
        if (!local) continue;
        const r = remote.get(id);
        let ifMatch = st.etags[id] || null,
          baseCtag = st.ctags[id] || null,
          create = !r;
        if (r && r.etag !== ifMatch) {
          if (r.ctag && r.ctag === baseCtag) ifMatch = r.etag;
          else {
            const got = await this.downloadProject(id, r);
            if (!sameJson(local, got.record)) keepRemoteCopy(got.record, got);
            ifMatch = got.etag;
            baseCtag = got.ctag;
            create = false;
          }
        }
        let up;
        try {
          up = await this.uploadProject(id, local, ifMatch, create);
        } catch (error) {
          if (!error.conflict) throw error;
          const m = await this.itemMeta(this.projectPath(id));
          if (m && m.ctag && m.ctag === baseCtag) up = await this.uploadProject(id, local, m.etag, false);
          else if (m) {
            const got = await this.downloadProject(id, m);
            if (!sameJson(local, got.record)) keepRemoteCopy(got.record, got);
            up = await this.uploadProject(id, local, got.etag, false);
          } else up = await this.uploadProject(id, local, null, true);
        }
        sync.markPushed(id, up.etag, seq, up.ctag);
        info.pushed++;
      }
      for (const id of st.deleted) {
        if (stale()) return;
        const r = remote.get(id);
        const restore = async want => {
          const got = await this.downloadProject(id, want);
          sync.applyRemote(id, got.record, got.etag, got.ctag);
          info.restored.push(id);
          notes.push(
            `「${projectName(got.record)}」已被 ${got.by || '其他人'} 修改，未從 SharePoint 刪除，已還原到本機。`,
          );
        };
        if (!r) {
          sync.markDeletePushed(id);
          continue;
        }
        if (!sameContent(r, base(id))) {
          await restore(r);
          continue;
        }
        try {
          await this.deleteRemote(this.projectPath(id), r.etag);
          sync.markDeletePushed(id);
        } catch (error) {
          if (!error.conflict) throw error;
          const m = await this.itemMeta(this.projectPath(id));
          if (!m) sync.markDeletePushed(id);
          else if (sameContent(m, base(id))) {
            await this.deleteRemote(this.projectPath(id), m.etag);
            sync.markDeletePushed(id);
          } else await restore(m);
        }
      }
      if (stale()) return;
      await sync.persist();
      await this.maybeBackup();
      this.setStatus('synced', '');
      if (info.pulled.length || info.removed.length || info.copies || info.restored.length) sync.notifyChanged(info);
      notes.forEach(n => this.emit('notice', n));
      if (rerun || sync.hasPending()) this.schedulePush(1500);
    } catch (error) {
      if (error?.auth) this.setStatus('needs-login', error.message);
      else {
        this.setStatus(sync.hasPending() ? 'pending' : 'error', error?.message || String(error));
        this.retryTimer = setTimeout(() => this.autoSync(), RETRY_MS);
      }
      notes.forEach(n => this.emit('notice', n));
    }
  }

  /** Daily backup of the whole database, newest BACKUP_KEEP kept. A missed backup never fails the sync. */
  async maybeBackup(now = new Date()) {
    const today = localDate(now);
    if (this.lsGet(LS_BACKUP) === today) return;
    try {
      const name = `${SP_BACKUP_PREFIX}${today}.json`;
      const items = (await this.listChildren(this.backupFolder)).filter(
        it => !it.isFolder && it.name.startsWith(SP_BACKUP_PREFIX) && it.name.endsWith('.json'),
      );
      if (!items.some(it => it.name === name)) {
        await this.graph(`${this.byPath(`${this.backupFolder}/${name}`)}:/content`, {
          method: 'PUT',
          body: this.db.sync.backupText(),
          headers: { 'Content-Type': 'application/json' },
        });
        items.push({ name });
      }
      this.lsSet(LS_BACKUP, today);
      const names = items.map(it => it.name).sort();
      for (const old of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
        try {
          await this.deleteRemote(`${this.backupFolder}/${old}`, null);
        } catch {
          /* next time */
        }
      }
    } catch {
      /* next sync retries */
    }
  }

  // ───────── scheduling ─────────
  syncNow() {
    if (!this.isEnabled()) return Promise.resolve();
    clearTimeout(this.pushTimer);
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runSync().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.schedulePush(500);
      }
    });
    return this.running;
  }
  autoSync() {
    return this.syncNow();
  }
  schedulePush(ms = PUSH_DEBOUNCE_MS) {
    if (!this.isEnabled() || !this.auth.account()) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.autoSync(), ms);
  }
  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (globalThis.document?.visibilityState !== 'hidden' && this.isEnabled() && this.auth.account()) this.autoSync();
    }, POLL_MS);
  }
  stopTimers() {
    clearTimeout(this.pushTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
  hookLocalWrites() {
    if (this.unhook) return;
    this.unhook = this.db.on('write', () => {
      if (!this.isEnabled() || !this.auth.account()) {
        if (this.isEnabled())
          this.setStatus(this.status.state === 'off' ? 'pending' : this.status.state, this.status.message);
        return;
      }
      if (this.running) {
        this.again ||= this.db.sync.hasPending();
        return;
      }
      if (this.db.sync.hasPending()) {
        this.setStatus('pending', '');
        this.schedulePush();
      }
    });
  }

  // ───────── public actions ─────────
  /** Turn on dual save (click handler: may open the Microsoft sign-in popup). */
  async enable() {
    this.hookLocalWrites();
    this.lsSet(LS_ENABLED, '1');
    const r = await this.signIn();
    if (!r.ok) {
      this.lsSet(LS_ENABLED, null);
      this.setStatus('off', '');
      return r;
    }
    try {
      await this.resolveSite(true);
    } catch (error) {
      this.setStatus('error', error.message);
      return { ok: false, reason: 'error', error: error.message };
    }
    this.startPolling();
    await this.syncNow();
    return { ok: true };
  }
  disable() {
    this.lsSet(LS_ENABLED, null);
    this.stopTimers();
    this.setStatus('off', '');
  }
  async signIn(opts) {
    const r = await this.auth.signIn(opts);
    if (r.ok) this.siteId = null;
    return r;
  }
  async relogin() {
    const r = await this.signIn();
    if (r.ok) {
      this.startPolling();
      await this.syncNow();
    }
    return r;
  }
  /** Page load: restore a previous sign-in silently and sync. */
  async tryRestore() {
    this.hookLocalWrites();
    if (!this.isEnabled()) {
      this.setStatus('off', '');
      return;
    }
    try {
      await this.auth.init();
    } catch (error) {
      this.setStatus('error', error.message);
      return;
    }
    if (!this.auth.account()) {
      this.setStatus('needs-login', '尚未登入 Microsoft 帳號');
      return;
    }
    this.startPolling();
    await this.syncNow();
  }
  /** The active project while it has unsaved edits is never replaced by a pulled version. */
  setEditing(id) {
    const was = this.editingId;
    this.editingId = id || null;
    if (!this.editingId && was && this.deferred.size) {
      this.deferred.clear();
      if (this.isEnabled() && this.auth.account()) this.syncNow();
    }
  }
  async folderUrl() {
    await this.resolveSite(true);
    const res = await this.graph(`${this.byPath(this.config.root)}?$select=webUrl`, {
      interactive: true,
      ok: s => s === 404,
    });
    if (res.status === 404) return null;
    return (await res.json()).webUrl || null;
  }

  // ───────── AI-Thermal project list (read only) ─────────
  cachedAiThermal() {
    try {
      const v = JSON.parse(this.lsGet(LS_AI_THERMAL) || 'null');
      return v && Array.isArray(v.projects) ? v : null;
    } catch {
      return null;
    }
  }
  /**
   * AI-Thermal-pad-and-stud-size-Evaluation-Tool's projects from its shared
   * ToolDatabase/thermal_db.json. Never written. Downloaded again only when its
   * eTag changed. Background use: no sign-in popup unless `interactive`.
   */
  async readAiThermalProjects({ interactive = false } = {}) {
    await this.resolveSite(interactive);
    const path = this.config.aiThermalDb;
    const cached = this.cachedAiThermal();
    const meta = await this.itemMeta(path);
    if (!meta) throw mkErr(`SharePoint 上找不到 AI-Thermal 資料庫 ${path}`, { status: 404 });
    if (cached && cached.etag && cached.etag === meta.etag) return { ...cached, fresh: false };
    const got = await this.downloadJson(path, meta);
    const result = { etag: got.etag, at: new Date().toISOString(), projects: aiThermalProjects(got.data) };
    this.lsSet(LS_AI_THERMAL, JSON.stringify(result));
    return { ...result, fresh: true };
  }
}
