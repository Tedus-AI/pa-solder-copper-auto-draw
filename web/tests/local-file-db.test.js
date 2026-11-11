import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalFileDb, backupsToPrune, BACKUP_PREFIX, projectFileName, parseProjectFile } from '../src/local-file-db.js';
import { PROJECT_FORMAT } from '../src/sp-sync.js';

// File System Access API stand-ins: a file handle on a shared "disk".
function fakeFile(name = 'pa_copper_cad_db.json', text = '') {
  const disk = { text, lastModified: 1, permission: 'granted', writes: 0 };
  const handle = {
    name,
    kind: 'file',
    disk,
    async getFile() {
      return { text: async () => disk.text, lastModified: disk.lastModified, size: disk.text.length };
    },
    async queryPermission() {
      return disk.permission;
    },
    async requestPermission() {
      return (disk.permission = 'granted');
    },
    async createWritable() {
      let buffer = '';
      return {
        write: async t => (buffer += t),
        close: async () => {
          disk.text = buffer;
          disk.lastModified++;
          disk.writes++;
        },
      };
    },
  };
  return handle;
}
function fakeDir(name = 'backups') {
  const files = new Map();
  return {
    name,
    files,
    async queryPermission() {
      return 'granted';
    },
    async getFileHandle(file, opts = {}) {
      if (!files.has(file)) {
        if (!opts.create) throw new DOMException('missing', 'NotFoundError');
        files.set(file, fakeFile(file));
      }
      return files.get(file);
    },
    async removeEntry(file) {
      files.delete(file);
    },
    async *entries() {
      for (const [file, handle] of files) yield [file, handle];
    },
  };
}
const memoryHandles = () => {
  const m = new Map();
  return { get: async k => m.get(k) ?? null, set: async (k, v) => (v === null ? m.delete(k) : m.set(k, v)) };
};

// A folder tree on a shared "disk": nested directories of fakeFile handles.
function fakeFolder(name = 'PA_DB') {
  const dirs = new Map(),
    files = new Map(),
    state = { permission: 'granted' };
  const folder = {
    name,
    kind: 'directory',
    dirs,
    files,
    state,
    async queryPermission() {
      return state.permission;
    },
    async requestPermission() {
      return (state.permission = 'granted');
    },
    async getDirectoryHandle(child, opts = {}) {
      if (!dirs.has(child)) {
        if (!opts.create) throw new DOMException('missing', 'NotFoundError');
        const sub = fakeFolder(child);
        sub.state = state;
        dirs.set(child, sub);
      }
      return dirs.get(child);
    },
    async getFileHandle(file, opts = {}) {
      if (!files.has(file)) {
        if (!opts.create) throw new DOMException('missing', 'NotFoundError');
        files.set(file, fakeFile(file));
      }
      return files.get(file);
    },
    async removeEntry(file) {
      files.delete(file);
    },
    async *entries() {
      for (const [file, handle] of files) yield [file, handle];
      for (const [dir, handle] of dirs) yield [dir, handle];
    },
  };
  return folder;
}
const record = (id, name, updated = '2026-11-01T00:00:00.000Z') => ({
  id,
  schema_version: 1,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: updated,
  design: { project: { name } },
});
const dbOf = (...records) => JSON.stringify({ projects: Object.fromEntries(records.map(r => [r.id, r])) });
const projectsDir = folder => folder.dirs.get('Database').dirs.get('projects');
const colleagueWrites = (folder, rec) => {
  const file = fakeFile(projectFileName(rec), JSON.stringify({ format: PROJECT_FORMAT, id: rec.id, project: rec }));
  file.disk.lastModified = 100 + Math.random();
  projectsDir(folder).files.set(projectFileName(rec), file);
};

test('a remembered database folder is reopened silently, or asks for permission again', async () => {
  const handles = memoryHandles(),
    folder = fakeFolder();
  await handles.set('database-folder', folder);
  const db = new LocalFileDb({ handles });
  const restored = await db.tryRestore();
  assert.equal(restored.ok, true);
  assert.deepEqual(JSON.parse(restored.text).projects, {});
  folder.state.permission = 'prompt';
  const again = new LocalFileDb({ handles });
  assert.deepEqual(await again.tryRestore(), { ok: false, needsPermission: true, name: 'PA_DB' });
  assert.equal((await again.reconnect()).ok, true);
  // the earlier single database file is recognised and the user asked to choose a folder
  const legacy = memoryHandles();
  await legacy.set('database-file', fakeFile('pa_copper_cad_db.json'));
  assert.deepEqual(await new LocalFileDb({ handles: legacy }).tryRestore(), {
    ok: false,
    legacy: true,
    name: 'pa_copper_cad_db.json',
  });
});

test('every project is its own JSON file; only changed projects are written; renames move the file', async () => {
  const db = new LocalFileDb({ handles: memoryHandles() }),
    folder = fakeFolder();
  await db.open(folder);
  const a = record('aaaaaaaa-1111', 'RRU A'),
    b = record('bbbbbbbb-2222', '基地台 / B');
  assert.equal((await db.write(dbOf(a, b))).ok, true);
  const dir = projectsDir(folder);
  assert.deepEqual([...dir.files.keys()].sort(), ['RRU A_aaaaaaaa.json', '基地台 _ B_bbbbbbbb.json']);
  const saved = JSON.parse(dir.files.get('RRU A_aaaaaaaa.json').disk.text);
  assert.deepEqual([saved.format, saved.id, saved.project.design.project.name], [PROJECT_FORMAT, a.id, 'RRU A']);
  assert.equal(parseProjectFile(dir.files.get('RRU A_aaaaaaaa.json').disk.text).id, a.id);
  const writesB = dir.files.get('基地台 _ B_bbbbbbbb.json').disk.writes;
  const renamed = { ...a, updated_at: '2026-11-02T00:00:00.000Z', design: { project: { name: 'RRU A2' } } };
  assert.equal((await db.write(dbOf(renamed, b))).ok, true);
  assert.deepEqual([...dir.files.keys()].sort(), ['RRU A2_aaaaaaaa.json', '基地台 _ B_bbbbbbbb.json']);
  assert.equal(dir.files.get('基地台 _ B_bbbbbbbb.json').disk.writes, writesB, 'unchanged project not rewritten');
  assert.equal((await db.write(dbOf(renamed))).ok, true);
  assert.deepEqual([...dir.files.keys()], ['RRU A2_aaaaaaaa.json'], 'a deleted project deletes its file');
  // reopening reads the folder back
  const other = new LocalFileDb({ handles: memoryHandles() });
  assert.deepEqual(Object.keys(JSON.parse((await other.open(folder)).text).projects), [a.id]);
});

test("colleagues' projects come in; the same project changed on both sides is never overwritten", async () => {
  const db = new LocalFileDb({ handles: memoryHandles() }),
    folder = fakeFolder();
  await db.open(folder);
  const a = record('aaaaaaaa-1111', 'A'),
    b = record('bbbbbbbb-2222', 'B');
  await db.write(dbOf(a, b));
  // a colleague adds C and deletes B
  const c = record('cccccccc-3333', 'C');
  colleagueWrites(folder, c);
  projectsDir(folder).files.delete(projectFileName(b));
  const sync = await db.write(dbOf(a, b));
  assert.equal(sync.ok, true);
  assert.deepEqual(
    sync.incoming.map(r => r.id),
    [c.id],
  );
  assert.deepEqual(sync.removed, [b.id]);
  // the colleague edits A while A is edited here too → stop, nothing overwritten
  const theirs = { ...a, updated_at: '2026-11-05T00:00:00.000Z', design: { project: { name: 'A' }, note: 'theirs' } };
  colleagueWrites(folder, theirs);
  const mine = { ...a, updated_at: '2026-11-06T00:00:00.000Z', design: { project: { name: 'A' }, note: 'mine' } };
  assert.equal((await db.write(dbOf(mine, c))).conflict, true);
  assert.equal(JSON.parse(projectsDir(folder).files.get(projectFileName(a)).disk.text).project.design.note, 'theirs');
  assert.equal((await db.write(dbOf(mine, c))).conflict, true, 'stays stopped until reload or overwrite');
  assert.equal(JSON.parse(await db.read({ force: true })).projects[a.id].design.note, 'theirs');
  assert.equal((await db.write(dbOf(mine, c), { overwrite: true })).ok, true);
  assert.equal(JSON.parse(projectsDir(folder).files.get(projectFileName(a)).disk.text).project.design.note, 'mine');
  folder.state.permission = 'prompt';
  assert.deepEqual(await db.write(dbOf(mine)), { ok: false, needsPermission: true });
});

test('daily backups keep the newest 30 and never replace a larger backup with a much smaller one', async () => {
  const db = new LocalFileDb({ handles: memoryHandles() }),
    dir = fakeDir();
  db.backupDir = dir;
  for (let day = 1; day <= 32; day++) {
    const r = await db.writeBackup('{"projects":{}}', new Date(2026, 0, day, 9, 0, 0));
    assert.equal(r.ok, true);
  }
  assert.equal(dir.files.size, 30);
  assert.ok(!dir.files.has(`${BACKUP_PREFIX}2026-01-01.json`));
  const big = 'x'.repeat(5000);
  await db.writeBackup(big, new Date(2026, 1, 10, 9, 0, 0));
  const small = await db.writeBackup('{}', new Date(2026, 1, 10, 15, 30, 5));
  assert.equal(small.name, `${BACKUP_PREFIX}2026-02-10_153005.json`);
  assert.equal(dir.files.get(`${BACKUP_PREFIX}2026-02-10.json`).disk.text, big);
  assert.deepEqual(
    backupsToPrune(['other.txt', `${BACKUP_PREFIX}2026-01-02.json`, `${BACKUP_PREFIX}2026-01-01.json`], 1),
    [`${BACKUP_PREFIX}2026-01-01.json`],
  );
});
