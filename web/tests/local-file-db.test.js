import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalFileDb, backupsToPrune, BACKUP_PREFIX } from '../src/local-file-db.js';

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

test('a remembered database file is reopened silently, or asks for permission again', async () => {
  const handles = memoryHandles(),
    handle = fakeFile('db.json', '{"projects":{}}');
  await handles.set('database-file', handle);
  const db = new LocalFileDb({ handles });
  const restored = await db.tryRestore();
  assert.equal(restored.ok, true);
  assert.equal(restored.text, '{"projects":{}}');
  handle.disk.permission = 'prompt';
  const again = new LocalFileDb({ handles });
  assert.deepEqual(await again.tryRestore(), { ok: false, needsPermission: true, name: 'db.json' });
  assert.equal((await again.reconnect()).ok, true);
});

test('writes are serialized and coalesced to the newest text', async () => {
  const db = new LocalFileDb({ handles: memoryHandles() }),
    handle = fakeFile();
  await db.open(handle);
  const results = await Promise.all([db.write('1'), db.write('2'), db.write('3')]);
  assert.ok(results.every(r => r.ok));
  assert.equal(handle.disk.text, '3');
  assert.ok(handle.disk.writes <= 2, `coalesced, got ${handle.disk.writes} writes`);
});

test('a file changed by someone else is never overwritten unless the user chooses to', async () => {
  const db = new LocalFileDb({ handles: memoryHandles() }),
    handle = fakeFile('shared.json', 'A');
  await db.open(handle);
  handle.disk.text = 'colleague';
  handle.disk.lastModified += 10;
  assert.deepEqual(await db.write('mine'), { ok: false, conflict: true });
  assert.equal(handle.disk.text, 'colleague');
  assert.deepEqual(await db.write('mine again'), { ok: false, conflict: true });
  assert.equal(await db.read({ force: true }), 'colleague');
  assert.equal((await db.write('after reload')).ok, true);
  handle.disk.lastModified += 10;
  assert.equal((await db.write('forced', { overwrite: true })).ok, true);
  assert.equal(handle.disk.text, 'forced');
  handle.disk.permission = 'prompt';
  assert.deepEqual(await db.write('x'), { ok: false, needsPermission: true });
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
