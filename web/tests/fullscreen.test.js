import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_FULLSCREEN_KEY, readAutoFullscreen, writeAutoFullscreen, shouldAutoEnter } from '../src/fullscreen.js';

test('auto full screen is on unless turned off in this browser', () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(readAutoFullscreen(storage), true);
  writeAutoFullscreen(false, storage);
  assert.equal(data.get(AUTO_FULLSCREEN_KEY), 'off');
  assert.equal(readAutoFullscreen(storage), false);
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readAutoFullscreen(broken), true);
});

test('first action enters full screen, except in dialogs and file pickers', () => {
  const at = selector => ({ closest: s => (s.split(',').some(p => p.trim() === selector) ? {} : null) });
  const base = { enabled: true, supported: true, active: false, target: at('button') };
  assert.equal(shouldAutoEnter(base), true);
  assert.equal(shouldAutoEnter({ ...base, enabled: false }), false);
  assert.equal(shouldAutoEnter({ ...base, supported: false }), false);
  assert.equal(shouldAutoEnter({ ...base, active: true }), false);
  assert.equal(shouldAutoEnter({ ...base, target: at('dialog') }), false);
  assert.equal(shouldAutoEnter({ ...base, target: at('input[type=file]') }), false);
});
