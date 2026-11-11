import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APP_INFO,
  versionLabel,
  buildLabel,
  parseVersionInfo,
  isNewerBuild,
  fetchDeployedInfo,
  setupVersionUI,
} from '../src/app-version.js';

const current = { version: '1.10.0', commit: '80e65ac', built: '2026-11-11T06:05:00.000Z' };

test('version label follows package.json; outside a build the info is a placeholder', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(versionLabel({ ...current, version }), `v${version}`);
  assert.deepEqual(APP_INFO, { version: '0.0.0', commit: 'dev', built: '' });
});

test('build label: local build time and commit', () => {
  const built = new Date(2026, 10, 11, 14, 5).toISOString();
  assert.equal(buildLabel({ ...current, built }), '2026-11-11 14:05 · 80e65ac');
  assert.equal(buildLabel({ version: '0.0.0', commit: 'dev', built: '' }), 'dev');
});

test('version.json must have version, commit and a build time', () => {
  assert.deepEqual(parseVersionInfo({ ...current, extra: 1 }), current);
  for (const bad of [null, 'v1', {}, { ...current, built: 'soon' }, { ...current, commit: 7 }])
    assert.equal(parseVersionInfo(bad), null);
});

test('newer build: another commit or version built later', () => {
  assert.equal(isNewerBuild(null, current), false);
  assert.equal(isNewerBuild(current, current), false);
  assert.equal(
    isNewerBuild({ ...current, built: '2026-11-12T00:00:00.000Z' }, current),
    false,
    'same build redeployed',
  );
  assert.equal(isNewerBuild({ ...current, commit: 'abc1234', built: '2026-11-12T00:00:00.000Z' }, current), true);
  assert.equal(isNewerBuild({ ...current, version: '1.11.0', built: '2026-11-12T00:00:00.000Z' }, current), true);
  assert.equal(
    isNewerBuild({ ...current, commit: 'abc1234', built: '2026-11-10T00:00:00.000Z' }, current),
    false,
    'older',
  );
});

test('deployed version.json is fetched past the caches; failures give null', async () => {
  const calls = [];
  const ok = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => current };
  };
  assert.deepEqual(await fetchDeployedInfo('https://example.test/app/version.json', ok), current);
  assert.match(calls[0].url, /^https:\/\/example\.test\/app\/version\.json\?t=\d+$/);
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(await fetchDeployedInfo('https://example.test/v.json', async () => ({ ok: false })), null);
  assert.equal(
    await fetchDeployedInfo('https://example.test/v.json', async () => ({
      ok: true,
      json: async () => JSON.parse('<!doctype html>'),
    })),
    null,
    'development server answers with the page',
  );
  assert.equal(
    await fetchDeployedInfo('https://example.test/v.json', async () => {
      throw new TypeError('offline');
    }),
    null,
  );
});

test('settings and header show the deployed version and the update button', async () => {
  const elements = new Map();
  const element = () => {
    const listeners = {};
    return {
      textContent: '',
      title: '',
      hidden: true,
      dataset: {},
      listeners,
      addEventListener: (type, fn) => (listeners[type] = fn),
    };
  };
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const saved = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval };
  globalThis.window = { addEventListener() {} };
  globalThis.document = { baseURI: 'https://example.test/app/', addEventListener() {}, visibilityState: 'visible' };
  globalThis.setInterval = () => 0;
  try {
    let deployed = { version: '0.0.0', commit: 'dev', built: '2026-01-01T00:00:00.000Z' };
    const fetchImpl = async () => ({ ok: true, json: async () => deployed });
    const ui = setupVersionUI({ $, fetchImpl });
    assert.equal($('app-version').textContent, 'v0.0.0');
    assert.equal($('settings-version').textContent, 'v0.0.0');
    await ui.check();
    assert.match($('settings-deployed').textContent, /已是最新版本$/);
    assert.equal($('app-update').hidden, true);
    deployed = { version: '1.11.0', commit: 'abc1234', built: '2026-11-12T00:00:00.000Z' };
    await ui.check();
    assert.equal($('app-update').hidden, false);
    assert.equal($('version-reload').hidden, false);
    assert.equal($('app-update-version').textContent, 'v1.11.0');
    assert.match($('settings-deployed').textContent, /^v1\.11\.0（.*abc1234）：有新版本/);
  } finally {
    Object.assign(globalThis, saved);
  }
});
