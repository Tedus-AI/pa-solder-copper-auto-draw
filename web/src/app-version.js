// Tool version: shown in the header and in 設定 → 版本, and checked against the
// deployed website so an open page can tell that a newer tool has been published.
//
// The build (vite.config.js) defines __APP_INFO__ = { version, commit, built } —
// package.json "version", the 7-character commit and the build time — and writes the
// same object to version.json next to index.html. A page compares its own build with
// the deployed version.json; a different commit or version that was built later is a
// newer tool.

/* global __APP_INFO__ */
export const APP_INFO = Object.freeze(
  typeof __APP_INFO__ === 'object' && __APP_INFO__ ? __APP_INFO__ : { version: '0.0.0', commit: 'dev', built: '' },
);

export const VERSION_FILE = 'version.json';
// An open page re-checks every 30 minutes, and when the window is used again after 5 minutes.
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const FOCUS_RECHECK_MS = 5 * 60 * 1000;

/** "v1.10.0" */
export const versionLabel = (info = APP_INFO) => `v${info.version}`;

/** Build time in local time and commit, e.g. "2026-11-11 14:05 · 80e65ac". */
export function buildLabel(info = APP_INFO) {
  const time = new Date(info.built);
  if (Number.isNaN(time.getTime())) return info.commit;
  const p = n => String(n).padStart(2, '0');
  const date = `${time.getFullYear()}-${p(time.getMonth() + 1)}-${p(time.getDate())}`;
  return `${date} ${p(time.getHours())}:${p(time.getMinutes())} · ${info.commit}`;
}

/** A well-formed version.json object, or null. */
export function parseVersionInfo(value) {
  if (!value || typeof value !== 'object') return null;
  const { version, commit, built } = value;
  if (typeof version !== 'string' || typeof commit !== 'string' || typeof built !== 'string') return null;
  if (Number.isNaN(Date.parse(built))) return null;
  return { version, commit, built };
}

/** True when the deployed build is another build of the tool, made after this one. */
export function isNewerBuild(deployed, current = APP_INFO) {
  if (!deployed) return false;
  if (deployed.commit === current.commit && deployed.version === current.version) return false;
  const a = Date.parse(deployed.built),
    b = Date.parse(current.built);
  return Number.isNaN(b) || a > b;
}

/**
 * The deployed version.json, bypassing the browser and GitHub Pages caches;
 * null when it cannot be read (offline, or the development server).
 */
export async function fetchDeployedInfo(url, fetchImpl = globalThis.fetch) {
  try {
    const target = new URL(url);
    target.searchParams.set('t', String(Date.now()));
    const response = await fetchImpl(target.href, { cache: 'no-store' });
    if (!response.ok) return null;
    return parseVersionInfo(await response.json());
  } catch {
    return null;
  }
}

/**
 * Header version label, the 設定 → 版本 section and the "有新版本" button.
 * @param hasUnsavedChanges () => boolean: reloading asks first when the project has unsaved edits
 * @param beforeReload called right before the page reloads
 */
export function setupVersionUI({
  $,
  hasUnsavedChanges = () => false,
  beforeReload = () => {},
  url,
  fetchImpl,
  now = () => Date.now(),
}) {
  const label = versionLabel(),
    build = buildLabel();
  $('app-version').textContent = label;
  $('app-version').title = `PA Copper CAD ${label}\n建置 ${build}`;
  $('settings-version').textContent = label;
  $('settings-build').textContent = build;
  const deployed = $('settings-deployed'),
    banner = $('app-update'),
    reloadButton = $('version-reload');
  const versionUrl = url || new URL(VERSION_FILE, document.baseURI).href;
  let pending = null,
    lastCheck = 0;

  function show(remote) {
    const newer = isNewerBuild(remote);
    if (!remote) deployed.textContent = '無法讀取（離線或本機開發版）';
    else
      deployed.textContent = `${versionLabel(remote)}（${buildLabel(remote)}）${newer ? '：有新版本，重新整理即可更新' : '：已是最新版本'}`;
    deployed.dataset.state = !remote ? 'unknown' : newer ? 'update' : 'current';
    banner.hidden = !newer;
    reloadButton.hidden = !newer;
    if (newer) {
      $('app-update-version').textContent = versionLabel(remote);
      banner.title = `網站已發佈新版本 ${versionLabel(remote)}（${buildLabel(remote)}），目前使用 ${label}（${build}）。點選重新整理以更新。`;
    }
  }
  function check() {
    if (!pending) {
      deployed.textContent = '檢查中…';
      pending = fetchDeployedInfo(versionUrl, fetchImpl)
        .then(remote => {
          lastCheck = now();
          show(remote);
          return remote;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  }
  function reload() {
    if (
      hasUnsavedChanges() &&
      !confirm('目前專案有未儲存的修改，重新整理後會遺失。\n\n按「取消」回到工具先儲存；按「確定」直接重新整理。')
    )
      return;
    beforeReload(); // the question was just asked here; the page's own leave guard stays quiet
    location.reload();
  }
  banner.addEventListener('click', reload);
  reloadButton.addEventListener('click', reload);
  $('version-check').addEventListener('click', check);
  const recheck = () => {
    if (now() - lastCheck >= FOCUS_RECHECK_MS) check();
  };
  window.addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recheck();
  });
  setInterval(check, CHECK_INTERVAL_MS);
  check();
  return { check, reload };
}
