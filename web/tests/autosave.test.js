import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_KEY,
  AutoSaver,
  autosaveMode,
  autosaveHint,
  readAutosavePreference,
  writeAutosavePreference,
} from '../src/autosave.js';

const base = { enabled: true, activeId: null, name: '', defaultName: '未命名專案', deletedName: null };

test('auto-save updates an open record; a new project only once it has a name of its own', () => {
  assert.equal(autosaveMode({ ...base, activeId: 'p1', name: '未命名專案' }), 'update');
  assert.equal(autosaveMode({ ...base, name: '  ' }), 'unnamed');
  assert.equal(autosaveMode({ ...base, name: ' 未命名專案 ' }), 'unnamed');
  assert.equal(autosaveMode({ ...base, name: 'RRU 4T4R PA' }), 'create');
  assert.equal(autosaveMode({ ...base, name: 'RRU 4T4R PA', deletedName: 'RRU 4T4R PA' }), 'deleted');
  assert.equal(autosaveMode({ ...base, name: 'RRU 4T4R PA v2', deletedName: 'RRU 4T4R PA' }), 'create');
  assert.equal(autosaveMode({ ...base, enabled: false, activeId: 'p1' }), 'off');
});

test('status hints', () => {
  assert.equal(autosaveHint('update', true), '將自動儲存');
  assert.equal(autosaveHint('create', false), '將自動建立專案並儲存');
  assert.equal(autosaveHint('unnamed', false), '尚未儲存；輸入專案名稱後自動儲存');
  assert.equal(autosaveHint('deleted', false), '記錄已刪除；按「儲存」可重新建立');
  assert.equal(autosaveHint('off', true), '尚未儲存；請按「儲存」保存');
  assert.equal(autosaveHint('off', false), '尚未儲存；請按「儲存」建立專案保存');
});

test('preference: on unless turned off; unavailable storage keeps it on', () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(readAutosavePreference(storage), true);
  writeAutosavePreference(false, storage);
  assert.equal(data.get(AUTOSAVE_KEY), 'off');
  assert.equal(readAutosavePreference(storage), false);
  writeAutosavePreference(true, storage);
  assert.equal(readAutosavePreference(storage), true);
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readAutosavePreference(broken), true);
  assert.doesNotThrow(() => writeAutosavePreference(false, broken));
});

test('debounce: saves once, 2 s after the last change; flush saves a pending change at once', () => {
  let now = 0,
    nextId = 1;
  const timers = new Map();
  const fake = {
    setTimeout: (fn, ms) => (timers.set(nextId, { fn, at: now + ms }), nextId++),
    clearTimeout: id => timers.delete(id),
  };
  const advance = ms => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) timers.delete(id) && t.fn();
  };
  let saves = 0;
  const saver = new AutoSaver({ save: () => ++saves, timers: fake });
  assert.equal(AUTOSAVE_DELAY_MS, 2000);
  saver.schedule();
  advance(1500);
  saver.schedule(); // another change restarts the wait
  advance(1500);
  assert.equal(saves, 0);
  advance(500);
  assert.equal(saves, 1);
  assert.equal(saver.pending, false);
  assert.equal(saver.flush(), false, 'nothing pending');
  saver.schedule();
  assert.equal(saver.flush(), 2);
  advance(5000);
  assert.equal(saves, 2, 'a flushed change is not saved again');
  saver.schedule();
  saver.cancel();
  advance(5000);
  assert.equal(saves, 2);
});
