// Watermark file for the 2D drawing PDFs (設定 → 浮水印).
//
// The file is kept as its own file in a Watermark folder next to the database —
// never inside the project database JSON:
//   · SharePoint (when 雙存檔 is on): Thermal-Spec-DB / 文件 / PA_Copper_CAD / Watermark /
//   · local: <database folder> / Watermark /  (or a separately chosen folder)
//   · this browser keeps a copy (IndexedDB) so PDFs can be made offline.
// Each Watermark folder holds the file and watermark.json (file name, size, SHA-256,
// time and the appearance). The newest copy wins when the folders are read again.
//
// Appearance follows Acrobat's 「新增浮水印」 from a file, as in the user's reference PDF:
// 80 % of the page (relative scale), 50 % opacity, 0° rotation, behind the page content.

import { HandleStore } from './local-file-db.js';
// The reference PDF's values; dxf-pdf.js uses the same defaults (kept out of this
// module's imports so pdf-lib loads only when a PDF is made).
export const DEFAULT_WATERMARK_APPEARANCE = { scale: 80, opacity: 50, rotation: 0 };

export const WATERMARK_FOLDER = 'Watermark';
export const WATERMARK_META = 'watermark.json';
export const WATERMARK_FORMAT = 'pa-copper-cad-watermark-v1';
export const MAX_WATERMARK_BYTES = 20 * 1024 * 1024;
const SP_SIMPLE_UPLOAD = 4 * 1024 * 1024; // Graph simple upload limit
const CACHE_KEY = 'watermark-file',
  FOLDER_KEY = 'watermark-folder';
const LS_APPEARANCE = 'pa-copper-cad.watermark-appearance';

const TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' };

/** File kind from its first bytes (the name is only a hint). */
export function watermarkKind(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  return null;
}

/** Appearance within Acrobat's ranges; missing values take the reference's defaults. */
export function normalizeAppearance(value = {}) {
  const pick = (key, lo, hi) => {
    const v = Number(value?.[key]);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_WATERMARK_APPEARANCE[key];
  };
  return { scale: pick('scale', 1, 100), opacity: pick('opacity', 0, 100), rotation: pick('rotation', -180, 180) };
}

/** A safe single file name, keeping the extension of the detected kind. */
export function watermarkFileName(name, kind) {
  const ext = kind === 'jpg' ? 'jpg' : kind;
  const stem =
    String(name || 'watermark')
      .replace(/\.[^.]*$/, '')
      // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
      .trim() || 'watermark';
  return `${stem}.${ext}`;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
}

export class WatermarkStore {
  constructor({
    handles = new HandleStore(),
    sp = null,
    storage = globalThis.localStorage,
    picker = globalThis.window,
    dbFolder = () => null,
  } = {}) {
    this.dbFolder = dbFolder; // the local database folder, used unless a folder is chosen here
    this.handles = handles;
    this.sp = sp;
    this.storage = storage;
    this.picker = picker;
    this.folder = null;
    this.record = undefined; // undefined = not read yet
  }

  // ───────── appearance ─────────
  appearance() {
    try {
      return normalizeAppearance(JSON.parse(this.storage?.getItem(LS_APPEARANCE) || '{}'));
    } catch {
      return normalizeAppearance();
    }
  }
  setAppearance(value) {
    const appearance = normalizeAppearance(value);
    try {
      this.storage?.setItem(LS_APPEARANCE, JSON.stringify(appearance));
    } catch {
      /* not remembered */
    }
    return appearance;
  }

  // ───────── browser copy ─────────
  async cached() {
    if (this.record === undefined) {
      const saved = await this.handles.get(CACHE_KEY);
      this.record = saved?.bytes ? { ...saved, bytes: new Uint8Array(saved.bytes) } : null;
    }
    return this.record;
  }
  async keep(record) {
    this.record = record;
    await this.handles.set(CACHE_KEY, record ? { ...record, bytes: record.bytes.slice().buffer } : null);
  }

  // ───────── local Watermark folder ─────────
  base() {
    return this.folder ?? this.dbFolder() ?? null;
  }
  folderName() {
    return this.base()?.name ?? null;
  }
  async tryRestoreFolder() {
    const saved = await this.handles.get(FOLDER_KEY);
    if (!saved) return { ok: false, reason: 'none' };
    try {
      if ((await saved.queryPermission({ mode: 'readwrite' })) === 'granted') {
        this.folder = saved;
        return { ok: true, name: saved.name };
      }
      return { ok: false, needsPermission: true, name: saved.name };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }
  async pickFolder() {
    try {
      const handle = await this.picker.showDirectoryPicker({ mode: 'readwrite' });
      this.folder = handle;
      await this.handles.set(FOLDER_KEY, handle);
      return { ok: true, name: handle.name };
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'error', message: error?.message };
    }
  }
  async reconnectFolder() {
    const saved = await this.handles.get(FOLDER_KEY);
    if (!saved) return this.pickFolder();
    try {
      if ((await saved.requestPermission({ mode: 'readwrite' })) !== 'granted') return { ok: false, reason: 'denied' };
      this.folder = saved;
      return { ok: true, name: saved.name };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }
  async localDir(create) {
    const base = this.base();
    if (!base) return null;
    if ((await base.queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
    try {
      return await base.getDirectoryHandle(WATERMARK_FOLDER, { create });
    } catch {
      return null;
    }
  }
  async writeLocal(record, meta) {
    const dir = await this.localDir(true);
    if (!dir) return false;
    for (const [name, data] of [
      [record.name, record.bytes],
      [WATERMARK_META, JSON.stringify(meta, null, 2) + '\n'],
    ]) {
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(data);
      await writable.close();
    }
    for await (const [name, handle] of dir.entries())
      if (handle.kind === 'file' && name !== record.name && name !== WATERMARK_META)
        await dir.removeEntry(name).catch(() => {});
    return true;
  }
  async readLocal() {
    const dir = await this.localDir(false);
    if (!dir) return null;
    try {
      const meta = JSON.parse(await (await (await dir.getFileHandle(WATERMARK_META)).getFile()).text());
      if (meta?.format !== WATERMARK_FORMAT || !meta.file) return null;
      const bytes = new Uint8Array(await (await (await dir.getFileHandle(meta.file)).getFile()).arrayBuffer());
      return { meta, bytes };
    } catch {
      return null;
    }
  }

  // ───────── SharePoint Watermark folder ─────────
  spReady() {
    return !!(this.sp?.isEnabled() && this.sp.account());
  }
  spPath(name) {
    return `${this.sp.config.root}/${WATERMARK_FOLDER}/${name}`;
  }
  async writeSharePoint(record, meta) {
    if (!this.spReady()) return { ok: false, reason: 'off' };
    if (record.size > SP_SIMPLE_UPLOAD) return { ok: false, reason: 'size' };
    await this.sp.resolveSite(false);
    await this.sp.uploadBytes(this.spPath(record.name), record.bytes, TYPES[record.kind]);
    await this.sp.uploadBytes(this.spPath(WATERMARK_META), JSON.stringify(meta, null, 2) + '\n', 'application/json');
    return { ok: true };
  }
  async readSharePoint({ interactive = false } = {}) {
    if (!this.sp?.isEnabled() || (!interactive && !this.sp.account())) return null;
    await this.sp.resolveSite(interactive);
    const metaFile = await this.sp.downloadBytes(this.spPath(WATERMARK_META));
    if (!metaFile) return null;
    const meta = JSON.parse(new TextDecoder().decode(metaFile.bytes));
    if (meta?.format !== WATERMARK_FORMAT || !meta.file) return null;
    const file = await this.sp.downloadBytes(this.spPath(meta.file));
    return file ? { meta, bytes: file.bytes } : null;
  }

  // ───────── operations ─────────
  /** Store a newly chosen file: browser copy, local folder and SharePoint. */
  async upload(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_WATERMARK_BYTES) throw new Error('浮水印檔案超過 20 MB。');
    const kind = watermarkKind(bytes);
    if (!kind) throw new Error('浮水印檔案須為 PDF、PNG 或 JPG。');
    const record = {
      name: watermarkFileName(file.name, kind),
      kind,
      size: bytes.length,
      sha256: await sha256(bytes),
      updated_at: new Date().toISOString(),
      bytes,
    };
    return this.store(record);
  }
  meta(record) {
    const { name, kind, size, sha256: hash, updated_at } = record;
    return {
      format: WATERMARK_FORMAT,
      file: name,
      kind,
      size,
      sha256: hash,
      updated_at,
      appearance: this.appearance(),
    };
  }
  async store(record) {
    await this.keep(record);
    const meta = this.meta(record),
      saved = ['此瀏覽器'],
      notes = [];
    try {
      if (await this.writeLocal(record, meta)) saved.push(`本機 ${this.folderName()}/${WATERMARK_FOLDER}`);
      else if (this.base()) notes.push('本機資料夾需要重新授權');
    } catch (error) {
      notes.push(`本機資料夾寫入失敗：${error.message}`);
    }
    try {
      const sp = await this.writeSharePoint(record, meta);
      if (sp.ok) saved.push(`SharePoint ${this.sp.config.root}/${WATERMARK_FOLDER}`);
      else if (sp.reason === 'size') notes.push('檔案超過 4 MB，未上傳 SharePoint');
    } catch (error) {
      notes.push(`SharePoint 上傳失敗：${error.message}`);
    }
    return { record, saved, notes };
  }
  /** Save the appearance into the folders' watermark.json as well. */
  async saveAppearance(value) {
    const appearance = this.setAppearance(value);
    const record = await this.cached();
    if (record) await this.store(record).catch(() => {});
    return appearance;
  }
  async remove() {
    await this.keep(null);
    const notes = [];
    try {
      const dir = await this.localDir(false);
      if (dir)
        for await (const [name, handle] of dir.entries())
          if (handle.kind === 'file') await dir.removeEntry(name).catch(() => {});
    } catch (error) {
      notes.push(error.message);
    }
    if (this.spReady())
      try {
        await this.sp.resolveSite(false);
        for (const item of await this.sp.listChildren(`${this.sp.config.root}/${WATERMARK_FOLDER}`))
          if (!item.isFolder) await this.sp.deleteRemote(this.spPath(item.name));
      } catch (error) {
        notes.push(`SharePoint：${error.message}`);
      }
    return { notes };
  }
  /**
   * Read the Watermark folders again and keep the newest copy (by its time).
   * Background use reads SharePoint only when already signed in.
   */
  async refresh({ interactive = false } = {}) {
    let best = await this.cached();
    const found = [];
    const consider = (got, source) => {
      if (!got?.meta?.updated_at || !got.bytes?.length) return;
      found.push(source);
      if (!best || Date.parse(got.meta.updated_at) > Date.parse(best.updated_at))
        best = {
          name: got.meta.file,
          kind: watermarkKind(got.bytes),
          size: got.bytes.length,
          sha256: got.meta.sha256 ?? null,
          updated_at: got.meta.updated_at,
          bytes: got.bytes,
          source,
        };
      if (got.meta.appearance && best?.updated_at === got.meta.updated_at) this.setAppearance(got.meta.appearance);
    };
    consider(await this.readLocal().catch(() => null), 'local');
    try {
      consider(await this.readSharePoint({ interactive }), 'sharepoint');
    } catch {
      /* offline or signed out: keep the browser copy */
    }
    if (best && best !== this.record) await this.keep(best);
    return { record: best, found };
  }
  /** The watermark for a PDF export: browser copy, else the folders. */
  async load() {
    return (await this.cached()) ?? (await this.refresh({ interactive: false })).record ?? null;
  }
}
