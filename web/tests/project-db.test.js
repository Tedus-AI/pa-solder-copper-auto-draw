import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectDatabase, DB_CACHE_KEY, LEGACY_STORAGE_KEY, ACTIVE_KEY, parseDbText } from '../src/project-db.js';
import { calculate, defaults, normalizeProject } from '../src/design.js';

export function memoryStorage() {
  const values = new Map();
  return {
    values,
    blocked: false,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.blocked) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
const design = (name, change = d => d) => {
  const d = structuredClone(defaults);
  d.project = { ...d.project, name };
  change(d);
  return calculate(d).design;
};

test('a saved project restores complete parameters and tolerances in a new database instance', () => {
  const storage = memoryStorage(),
    db = new ProjectDatabase({ storage });
  const d = structuredClone(defaults);
  d.project = { name: '基地台專案 A', pa_brand: 'NXP', pa_model: 'PA 型號/780-M1P' };
  d.pcb.thickness = 2.1;
  d.tolerances['copper.corner_radius'] = { minus: 0.03, plus: 0.04 };
  const saved = calculate(d).design,
    record = db.save(saved);
  saved.project.name = '尚未儲存的修改';
  record.design.pcb.thickness = 9;
  const restored = new ProjectDatabase({ storage }).active();
  assert.equal(restored.design.project.name, '基地台專案 A');
  assert.equal(restored.design.project.pa_brand, 'NXP');
  assert.equal(restored.design.pcb.thickness, 2.1);
  assert.deepEqual(restored.design.tolerances['copper.corner_radius'], { minus: 0.03, plus: 0.04 });
  const editable = db.get(restored.id);
  editable.design.package.length = 99;
  assert.equal(db.get(restored.id).design.package.length, 20.57);
});

test('save updates one record, save-as preserves it, and active selection and deletion survive reload', () => {
  const storage = memoryStorage(),
    db = new ProjectDatabase({ storage });
  const first = db.save(design('A'));
  const updated = db.save(design('更新 A'), { id: first.id });
  assert.equal(updated.id, first.id);
  assert.equal(updated.created_at, first.created_at);
  assert.equal(db.list().length, 1);
  const second = db.save(design('另存 B'));
  assert.notEqual(second.id, first.id);
  assert.equal(db.list().length, 2);
  db.activate(first.id);
  assert.equal(new ProjectDatabase({ storage }).active().id, first.id);
  db.remove(second.id);
  assert.equal(db.active().id, first.id);
  db.remove(first.id);
  assert.equal(db.active(), null);
  assert.deepEqual(db.list(), []);
});

test('failed writes do not discard previous projects or claim to save a new active record', () => {
  const storage = memoryStorage(),
    db = new ProjectDatabase({ storage }),
    first = db.save(design('A'));
  const before = storage.getItem(DB_CACHE_KEY);
  storage.blocked = true;
  assert.throws(() => db.save(design('失敗')), /尚未儲存/);
  assert.equal(storage.getItem(DB_CACHE_KEY), before);
  assert.equal(db.list().length, 1);
  assert.equal(db.active().id, first.id);
});

test('unreadable stored data stays intact instead of being silently overwritten', () => {
  for (const [key, raw] of [
    [DB_CACHE_KEY, '{broken'],
    [DB_CACHE_KEY, JSON.stringify({ format: 'other' })],
    [LEGACY_STORAGE_KEY, JSON.stringify({ schema_version: 2, projects: [] })],
  ]) {
    const storage = memoryStorage();
    storage.values.set(key, raw);
    const db = new ProjectDatabase({ storage });
    assert.throws(() => db.save(design('A')), /未被覆寫|不是 PA Copper CAD/);
    assert.equal(storage.getItem(key), raw);
  }
  const unavailable = new ProjectDatabase({
    storage: {
      getItem() {
        throw new Error('SecurityError');
      },
    },
  });
  assert.throws(() => unavailable.list(), /尚未儲存/);
});

test('projects saved by the earlier browser store are migrated once and marked for SharePoint upload', () => {
  const storage = memoryStorage();
  const record = {
    id: 'old-1',
    schema_version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    design: design('舊專案'),
  };
  storage.values.set(LEGACY_STORAGE_KEY, JSON.stringify({ schema_version: 1, active_id: 'old-1', projects: [record] }));
  const db = new ProjectDatabase({ storage });
  assert.equal(db.active().design.project.name, '舊專案');
  assert.deepEqual(db.sync.state().dirty, { 'old-1': 1 });
  db.save(db.get('old-1').design, { id: 'old-1' });
  assert.ok(storage.getItem(DB_CACHE_KEY));
  assert.equal(storage.getItem(ACTIVE_KEY), 'old-1');
});

test('opening a database file merges newer browser projects and keeps the file as the working copy', async () => {
  const storage = memoryStorage(),
    db = new ProjectDatabase({ storage });
  const a = db.save(design('A 本機較新'));
  const c = db.save(design('C 只在本機'));
  const fileDoc = {
    format: 'pa-copper-cad-db',
    version: 1,
    projects: {
      [a.id]: { ...a, updated_at: '2000-01-01T00:00:00Z', design: design('A 檔案較舊') },
      b: {
        id: 'b',
        schema_version: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        design: design('B 只在檔案'),
      },
    },
    sp_sync: { dirty: {}, deleted: [], etags: { b: '"b,1"' }, ctags: {} },
  };
  const written = [];
  const file = { write: async text => (written.push(text), { ok: true }) };
  const changes = [];
  db.on('change', info => changes.push(info.source));
  const result = await db.attachFile(file, JSON.stringify(fileDoc));
  assert.equal(result.merged, 2);
  assert.deepEqual(
    db
      .list()
      .map(p => p.design.project.name)
      .sort(),
    ['A 本機較新', 'B 只在檔案', 'C 只在本機'].sort(),
  );
  assert.ok(db.sync.state().dirty[a.id] && db.sync.state().dirty[c.id]);
  assert.equal(db.sync.state().dirty.b, undefined);
  assert.equal(JSON.parse(written.at(-1)).projects.b.design.project.name, 'B 只在檔案');
  assert.equal(db.localStatus.state, 'saved');
  assert.deepEqual(changes, ['file']);
});

test('database file write problems are reported instead of claiming the project was saved', async () => {
  const db = new ProjectDatabase({ storage: memoryStorage() });
  for (const [result, state] of [
    [{ ok: false, conflict: true }, 'conflict'],
    [{ ok: false, needsPermission: true }, 'needs-permission'],
    [{ ok: false, message: 'disk full' }, 'error'],
  ]) {
    db.file = { write: async () => result };
    db.save(design('A'));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(db.localStatus.state, state);
  }
  assert.throws(() => parseDbText('{"projects":{"x":{"id":"x"}}}'), /格式不正確/);
});

test('SharePoint bookkeeping: an edit during upload stays pending, deletes are pushed only for synced projects', () => {
  const db = new ProjectDatabase({ storage: memoryStorage() });
  const a = db.save(design('A'));
  const seq = db.sync.state().dirty[a.id];
  db.save(design('A2'), { id: a.id });
  db.sync.markPushed(a.id, '"a,1"', seq, 'c1');
  assert.ok(db.sync.hasPending(), 'edited again while uploading');
  db.sync.markPushed(a.id, '"a,2"', db.sync.state().dirty[a.id], 'c2');
  assert.equal(db.sync.hasPending(), false);
  db.remove(a.id);
  assert.deepEqual(db.sync.state().deleted, [a.id]);
  const never = db.save(design('never uploaded'));
  db.remove(never.id);
  assert.deepEqual(db.sync.state().deleted, [a.id]);
  assert.equal(db.sync.pendingCount(), 1);
});

test('project metadata validates on its own, without a full design', () => {
  assert.deepEqual(normalizeProject({ name: '  RRU PA  ', pa_brand: ' NXP ', pa_model: 'X1' }), {
    name: 'RRU PA',
    pa_brand: 'NXP',
    pa_model: 'X1',
  });
  assert.throws(() => normalizeProject({ name: '' }), /專案名稱/);
  assert.throws(() => normalizeProject({ name: 'a\nb' }), /單行/);
});
