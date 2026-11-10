import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WatermarkStore,
  watermarkKind,
  normalizeAppearance,
  watermarkFileName,
  WATERMARK_FOLDER,
  WATERMARK_META,
  DEFAULT_WATERMARK_APPEARANCE,
} from '../src/watermark-store.js';

const pdf = new Uint8Array(readFileSync(new URL('../../浮水印.pdf', import.meta.url)));
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

class Handles {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    return this.map.get(key) ?? null;
  }
  async set(key, value) {
    if (value === null) this.map.delete(key);
    else this.map.set(key, value);
  }
}
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.get(k) ?? null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
}
/** In-memory FileSystemDirectoryHandle with the methods the store uses. */
class Dir {
  constructor(name) {
    this.name = name;
    this.kind = 'directory';
    this.files = new Map();
    this.dirs = new Map();
  }
  async queryPermission() {
    return 'granted';
  }
  async getDirectoryHandle(name, { create } = {}) {
    if (!this.dirs.has(name)) {
      if (!create) throw new DOMException('missing', 'NotFoundError');
      this.dirs.set(name, new Dir(name));
    }
    return this.dirs.get(name);
  }
  async getFileHandle(name, { create } = {}) {
    if (!this.files.has(name) && !create) throw new DOMException('missing', 'NotFoundError');
    const dir = this;
    return {
      kind: 'file',
      async createWritable() {
        const parts = [];
        return {
          async write(data) {
            parts.push(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
          },
          async close() {
            dir.files.set(name, new Blob(parts));
          },
        };
      },
      async getFile() {
        return dir.files.get(name);
      },
    };
  }
  async removeEntry(name) {
    this.files.delete(name);
  }
  async *entries() {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }];
  }
}
/** SharePoint double: a path → bytes map. */
class FakeSharePoint {
  constructor() {
    this.files = new Map();
    this.config = { root: 'PA_Copper_CAD' };
  }
  isEnabled() {
    return true;
  }
  account() {
    return { name: 'tester' };
  }
  async resolveSite() {}
  async uploadBytes(path, bytes) {
    this.files.set(path, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes));
  }
  async downloadBytes(path) {
    return this.files.has(path) ? { bytes: this.files.get(path) } : null;
  }
  async listChildren(folder) {
    return [...this.files.keys()]
      .filter(p => p.startsWith(folder + '/'))
      .map(p => ({ name: p.slice(folder.length + 1), isFolder: false }));
  }
  async deleteRemote(path) {
    this.files.delete(path);
  }
}
const file = (bytes, name) => ({ name, arrayBuffer: async () => bytes.buffer.slice(0) });

test('watermark file checks: kind from the bytes, Acrobat appearance ranges, safe names', () => {
  assert.equal(watermarkKind(pdf), 'pdf');
  assert.equal(watermarkKind(png), 'png');
  assert.equal(watermarkKind(new Uint8Array([0xff, 0xd8, 0xff])), 'jpg');
  assert.equal(watermarkKind(new Uint8Array([1, 2])), null);
  assert.deepEqual(DEFAULT_WATERMARK_APPEARANCE, { scale: 80, opacity: 50, rotation: 0 });
  assert.deepEqual(normalizeAppearance({ scale: 250, opacity: -5, rotation: 'x' }), {
    scale: 100,
    opacity: 0,
    rotation: 0,
  });
  assert.equal(watermarkFileName('浮水印.PDF', 'pdf'), '浮水印.pdf');
  assert.equal(watermarkFileName('a/b:c.jpeg', 'jpg'), 'a_b_c.jpg');
});

test('upload keeps the file in its own Watermark folders, never in the project database', async () => {
  const sp = new FakeSharePoint(),
    folder = new Dir('PA_DB'),
    handles = new Handles();
  const store = new WatermarkStore({
    handles,
    sp,
    storage: new MemoryStorage(),
    picker: { showDirectoryPicker: async () => folder },
  });
  assert.equal((await store.pickFolder()).ok, true);
  const { record, saved, notes } = await store.upload(file(pdf, '浮水印.pdf'));
  assert.deepEqual(notes, []);
  assert.equal(saved.length, 3);
  assert.equal(record.kind, 'pdf');
  // local: <folder>/Watermark/浮水印.pdf + watermark.json
  const local = folder.dirs.get(WATERMARK_FOLDER);
  assert.deepEqual([...local.files.keys()].sort(), [WATERMARK_META, '浮水印.pdf'].sort());
  const meta = JSON.parse(await local.files.get(WATERMARK_META).text());
  assert.equal(meta.file, '浮水印.pdf');
  assert.deepEqual(meta.appearance, DEFAULT_WATERMARK_APPEARANCE);
  assert.equal(meta.size, pdf.length);
  // SharePoint: PA_Copper_CAD/Watermark/…
  assert.deepEqual([...sp.files.keys()].sort(), [
    'PA_Copper_CAD/Watermark/watermark.json',
    'PA_Copper_CAD/Watermark/浮水印.pdf',
  ]);
  assert.deepEqual(sp.files.get('PA_Copper_CAD/Watermark/浮水印.pdf'), pdf);
  // a new store (another session) reads the browser copy
  const again = new WatermarkStore({ handles, sp, storage: new MemoryStorage() });
  assert.deepEqual((await again.load()).bytes, pdf);
  await assert.rejects(store.upload(file(new Uint8Array([1, 2, 3]), 'x.txt')), /PDF、PNG 或 JPG/);
});

test('refresh takes a newer watermark from SharePoint; remove clears every copy', async () => {
  const sp = new FakeSharePoint(),
    storage = new MemoryStorage();
  const older = new WatermarkStore({ handles: new Handles(), sp, storage });
  await older.upload(file(pdf, 'old.pdf'));
  // another computer uploads a PNG later
  const other = new WatermarkStore({ handles: new Handles(), sp, storage: new MemoryStorage() });
  await new Promise(r => setTimeout(r, 5));
  await other.upload(file(png, 'logo.png'));
  const { record, found } = await older.refresh();
  assert.equal(record.name, 'logo.png');
  assert.deepEqual(found, ['sharepoint']);
  assert.equal((await older.cached()).kind, 'png');
  await older.remove();
  assert.equal(await older.cached(), null);
  assert.equal(sp.files.size, 0);
  // appearance changes are remembered and written next to the file
  const store = new WatermarkStore({ handles: new Handles(), sp, storage });
  await store.upload(file(pdf, 'w.pdf'));
  assert.deepEqual(await store.saveAppearance({ scale: 60, opacity: 30, rotation: 45 }), {
    scale: 60,
    opacity: 30,
    rotation: 45,
  });
  const meta = JSON.parse(new TextDecoder().decode(sp.files.get('PA_Copper_CAD/Watermark/watermark.json')));
  assert.deepEqual(meta.appearance, { scale: 60, opacity: 30, rotation: 45 });
});
