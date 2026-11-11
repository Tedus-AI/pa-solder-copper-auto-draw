// Header save-status chips, the 設定 dialog (database file, backup folder,
// SharePoint dual save, AI-Thermal project list, help) and the project-name
// combobox fed by AI-Thermal's projects.
import { fileApiSupported, downloadBackup, localDateStr } from './local-file-db.js';

const LS_LOCAL_BACKUP = 'pa-copper-cad.local-backup-date';
const $ = id => document.getElementById(id);
const time = d =>
  d ? new Date(d).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const lsGet = k => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** Chip text + mark for each sync state. */
export function sharePointChip(status, enabled) {
  if (!enabled || status.state === 'off') return { state: 'off', mark: '○', text: '未連線' };
  if (status.state === 'syncing') return { state: 'busy', mark: '⟳', text: '同步中' };
  if (status.state === 'synced') return { state: 'ok', mark: '✓', text: `已儲存 ${time(status.lastSync)}` };
  if (status.state === 'pending')
    return { state: 'warn', mark: '…', text: status.pending ? `待上傳 ${status.pending}` : '等待同步' };
  if (status.state === 'needs-login') return { state: 'warn', mark: '!', text: '請重新登入' };
  return { state: 'error', mark: '!', text: '同步錯誤' };
}
export function localChip(status, savedInCacheAt) {
  if (status.state === 'saved') return { state: 'ok', mark: '✓', text: `已儲存 ${time(status.at)}` };
  if (status.state === 'saving') return { state: 'busy', mark: '⟳', text: '寫入中' };
  if (status.state === 'conflict') return { state: 'error', mark: '!', text: '檔案衝突' };
  if (status.state === 'needs-permission') return { state: 'warn', mark: '!', text: '需重新授權' };
  if (status.state === 'error') return { state: 'error', mark: '!', text: '寫入失敗' };
  return { state: 'warn', mark: '!', text: savedInCacheAt ? `瀏覽器暫存 ${time(savedInCacheAt)}` : '瀏覽器暫存' };
}

export function setupStorageUI({ db, fileDb, sp, onNotice = () => {} }) {
  const dialog = $('settings-dialog');
  let cacheSavedAt = null;
  let aiProjects = sp.cachedAiThermal()?.projects ?? [];
  let aiState = sp.cachedAiThermal()
    ? `${aiProjects.length} 個專案（上次從 SharePoint 讀取 ${new Date(sp.cachedAiThermal().at).toLocaleString('zh-TW', { hour12: false })}）`
    : '尚未讀取';
  let aiLoading = null;
  const fileApi = fileApiSupported();

  const setChip = (id, chip, title) => {
    const button = $(id);
    button.dataset.state = chip.state;
    button.querySelector('.chip-mark').textContent = chip.mark;
    $(`${id}-text`).textContent = chip.text;
    button.title = title;
  };
  function renderSharePoint() {
    const status = sp.status;
    const enabled = sp.isEnabled();
    const chip = sharePointChip(status, enabled);
    setChip(
      'status-sharepoint',
      chip,
      `SharePoint 雙存檔：${chip.text}${status.message ? `\n${status.message}` : ''}\n位置：${sp.location()}\n點選開啟設定`,
    );
    const account = sp.account();
    $('settings-sp-state').textContent = enabled
      ? `${chip.text}${status.message ? `｜${status.message}` : ''}`
      : '未開啟';
    $('settings-sp-account').textContent = account
      ? `${account.name}${account.email && account.email !== account.name ? `（${account.email}）` : ''}`
      : '未登入';
    $('sp-enable').hidden = enabled;
    for (const id of ['sp-sync-now', 'sp-disable', 'sp-folder']) $(id).hidden = !enabled;
    $('sp-relogin').hidden = !enabled;
  }
  function renderLocal() {
    const status = db.localStatus;
    const chip = localChip(status, cacheSavedAt);
    const fileName = fileDb.name();
    setChip(
      'status-local',
      chip,
      `本機資料庫資料夾：${fileName ?? '未設定（專案暫存在此瀏覽器）'}\n${chip.text}${status.message ? `\n${status.message}` : ''}\n點選開啟設定`,
    );
    $('settings-db-file').textContent = fileName ? `${fileName}（每個專案一份 JSON）` : '未設定（專案暫存在此瀏覽器）';
    $('db-forget').hidden = !fileName;
    $('db-reconnect').hidden = status.state !== 'needs-permission';
    $('db-conflict').hidden = status.state !== 'conflict';
    $('settings-backup-dir').textContent = fileDb.backupDirName() ?? '未設定';
    $('backup-now').disabled = !fileDb.backupDirName();
    for (const id of ['db-open', 'backup-pick']) $(id).disabled = !fileApi;
    $('file-api-note').hidden = fileApi;
  }
  const localMessage = (text, failed = false) => {
    const out = $('settings-local-message');
    out.textContent = text;
    out.classList.toggle('save-error', failed);
  };
  const spMessage = (text, failed = false) => {
    const out = $('settings-sp-message');
    out.textContent = text;
    out.classList.toggle('save-error', failed);
  };
  const reasonText = r =>
    r.reason === 'cancelled'
      ? '已取消。'
      : r.reason === 'denied'
        ? '未取得讀寫權限。'
        : r.reason === 'popup'
          ? '登入視窗被瀏覽器封鎖，請允許彈出視窗後再試。'
          : r.message || r.error || '操作失敗。';

  // ───────── local database file ─────────
  async function attach(result) {
    if (!result.ok) {
      localMessage(reasonText(result), result.reason !== 'cancelled');
      return false;
    }
    try {
      const merged = await db.attachFile(fileDb, result.text, { isNew: !!result.isNew });
      const count = db.list().length;
      localMessage(
        result.isNew
          ? `已設定資料庫資料夾 ${result.name}：${count} 個專案已各自存成 JSON（Database/projects）。`
          : `已開啟資料庫資料夾 ${result.name}（${count} 個專案，每個專案一份 JSON）${merged.merged ? `，並合併此瀏覽器的 ${merged.merged} 個較新專案` : ''}。`,
      );
      if (sp.isEnabled()) sp.syncNow();
      return true;
    } catch (error) {
      await fileDb.forget();
      db.detachFile();
      localMessage(error.message, true);
      return false;
    } finally {
      renderLocal();
    }
  }
  $('db-open').addEventListener('click', async () => attach(await fileDb.pick()));
  $('db-import').addEventListener('click', () => $('db-import-file').click());
  $('db-import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { added } = await db.importText(await file.text());
      localMessage(
        `已匯入 ${file.name}：${added} 個專案${fileDb.isReady() ? '已寫入資料庫資料夾' : '已存在此瀏覽器'}（同一專案保留較新的版本）。`,
      );
    } catch (error) {
      localMessage(`匯入失敗：${error.message}`, true);
    }
    renderLocal();
  });
  $('db-reconnect').addEventListener('click', async () => attach(await fileDb.reconnect()));
  $('db-forget').addEventListener('click', async () => {
    await fileDb.forget();
    db.detachFile();
    localMessage('已中斷本機資料庫資料夾；專案改為暫存在此瀏覽器，資料夾內的檔案未刪除。');
    renderLocal();
  });
  $('db-reload').addEventListener('click', async () => {
    try {
      await db.reloadFromFile();
      localMessage('已重新讀取資料庫資料夾；此視窗尚未寫入的修改已捨棄。');
    } catch (error) {
      localMessage(error.message, true);
    }
    renderLocal();
  });
  $('db-overwrite').addEventListener('click', async () => {
    const result = await fileDb.write(db.text(), { overwrite: true });
    if (result.ok) db.setLocal('saved', '');
    localMessage(result.ok ? '已以目前內容覆寫資料庫資料夾中的專案檔。' : result.message || '覆寫失敗。', !result.ok);
    renderLocal();
  });

  // ───────── backup folder ─────────
  async function backupNow(manual) {
    const result = await fileDb.writeBackup(db.text());
    if (result.ok) {
      lsSet(LS_LOCAL_BACKUP, localDateStr());
      if (manual) localMessage(`已備份 ${result.name}。`);
    } else if (manual) localMessage(result.needsPermission ? '需要重新授權備份資料夾。' : reasonText(result), true);
    renderLocal();
    return result;
  }
  $('backup-pick').addEventListener('click', async () => {
    const result = await fileDb.pickBackupDir();
    if (result.ok) await backupNow(true);
    else localMessage(reasonText(result), result.reason !== 'cancelled');
    renderLocal();
  });
  $('backup-reconnect').addEventListener('click', async () => {
    const result = await fileDb.reconnectBackupDir();
    $('backup-reconnect').hidden = result.ok;
    if (!result.ok) localMessage(reasonText(result), true);
    renderLocal();
  });
  $('backup-now').addEventListener('click', () => backupNow(true));
  $('backup-download').addEventListener('click', () => downloadBackup(db.text()));
  db.on('local', state => {
    if (state.state === 'cache') cacheSavedAt = new Date();
    renderLocal();
    if (fileDb.backupDirName() && lsGet(LS_LOCAL_BACKUP) !== localDateStr() && state.state !== 'saving')
      backupNow(false);
  });

  // ───────── SharePoint ─────────
  $('sp-enable').addEventListener('click', async () => {
    spMessage('正在開啟 Microsoft 登入…');
    const result = await sp.enable();
    spMessage(
      result.ok ? '已開啟 SharePoint 雙存檔。' : reasonText(result),
      !result.ok && result.reason !== 'cancelled',
    );
    if (result.ok) loadAiProjects({ interactive: false });
    renderSharePoint();
  });
  $('sp-disable').addEventListener('click', () => {
    sp.disable();
    spMessage('已關閉 SharePoint 雙存檔；專案仍保存在本機。');
    renderSharePoint();
  });
  $('sp-sync-now').addEventListener('click', () => sp.syncNow());
  $('sp-relogin').addEventListener('click', async () => {
    const result = await sp.signIn({ select: true });
    spMessage(result.ok ? '已登入。' : reasonText(result), !result.ok && result.reason !== 'cancelled');
    if (result.ok) {
      sp.startPolling();
      sp.syncNow();
      loadAiProjects({ interactive: false });
    }
    renderSharePoint();
  });
  $('sp-folder').addEventListener('click', async () => {
    const tab = window.open('', '_blank');
    try {
      const url = await sp.folderUrl();
      if (url && tab) tab.location.href = url;
      else {
        tab?.close();
        spMessage('SharePoint 上還沒有 PA_Copper_CAD 資料夾（第一次同步後才會建立）。');
      }
    } catch (error) {
      tab?.close();
      spMessage(error.message, true);
    }
  });
  sp.on('status', status => {
    renderSharePoint();
    if (status.state === 'synced' && !aiLoading && !sp.aiLoadedThisSession) loadAiProjects({ interactive: false });
  });
  sp.on('notice', onNotice);

  // ───────── AI-Thermal project list ─────────
  async function loadAiProjects({ interactive }) {
    if (aiLoading) return aiLoading;
    $('settings-ai-state').textContent = '讀取中…';
    aiLoading = (async () => {
      try {
        const result = await sp.readAiThermalProjects({ interactive });
        aiProjects = result.projects;
        sp.aiLoadedThisSession = true;
        aiState = `${aiProjects.length} 個專案（${new Date(result.at).toLocaleString('zh-TW', { hour12: false })} 從 SharePoint 讀取）`;
      } catch (error) {
        aiState = error.auth
          ? '需要登入 SharePoint 才能讀取（先開啟 SharePoint 雙存檔）'
          : `讀取失敗：${error.message}`;
      } finally {
        $('settings-ai-state').textContent = aiState;
        aiLoading = null;
        combobox.refresh();
      }
    })();
    return aiLoading;
  }
  $('ai-refresh').addEventListener('click', () => {
    sp.lsSet('pa-copper-cad.ai-thermal-projects', null);
    loadAiProjects({ interactive: sp.isEnabled() });
  });
  $('settings-ai-state').textContent = aiState;

  const combobox = setupProjectCombobox({
    input: $('project-name'),
    toggle: $('project-options-toggle'),
    list: $('project-options'),
    projects: () => aiProjects,
    emptyText: () =>
      aiLoading
        ? '讀取 AI-Thermal 專案清單中…'
        : !sp.isEnabled()
          ? '開啟 SharePoint 雙存檔後，可從 AI-Thermal 專案清單選擇（設定）'
          : aiState.startsWith('讀取失敗') || aiState.startsWith('需要')
            ? aiState
            : 'AI-Thermal 沒有符合的專案',
    onOpen: () => {
      if (sp.isEnabled() && sp.account() && !aiLoading && !sp.aiLoadedThisSession)
        loadAiProjects({ interactive: false });
    },
  });

  // ───────── dialog ─────────
  const open = () => {
    renderLocal();
    renderSharePoint();
    if (!dialog.open) dialog.showModal();
  };
  $('settings-open').addEventListener('click', open);
  $('status-sharepoint').addEventListener('click', open);
  $('status-local').addEventListener('click', open);
  $('settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  // ───────── start-up ─────────
  async function start() {
    renderLocal();
    renderSharePoint();
    if (fileApi) {
      const restored = await fileDb.tryRestore();
      if (restored.ok) await attach(restored);
      else if (restored.legacy)
        localMessage(
          `本機資料庫已改為「資料庫資料夾」，每個專案一份 JSON。請按「選擇資料庫資料夾…」（可選原本 ${restored.name} 所在的資料夾），此瀏覽器的專案會逐一寫入；原資料庫檔可用「匯入 JSON 檔…」匯入。`,
        );
      else if (restored.needsPermission) {
        db.setLocal('needs-permission', `需要重新授權讀寫 ${restored.name}（設定 → 重新授權）。`);
        $('settings-db-file').textContent = restored.name;
      }
      const backup = await fileDb.tryRestoreBackupDir();
      $('backup-reconnect').hidden = !backup.needsPermission;
    }
    renderLocal();
    // Colleagues' projects in a shared database folder come in when this window is used again.
    window.addEventListener('focus', () => {
      if (fileDb.isReady() && !fileDb.hasConflict()) db.persistFile();
    });
    await sp.tryRestore();
  }
  return { start, open, renderLocal, renderSharePoint, loadAiProjects, combobox };
}

/** Text input + ▾ list of AI-Thermal projects (filtered by what is typed). */
export function setupProjectCombobox({ input, toggle, list, projects, emptyText, onOpen = () => {} }) {
  let active = -1;
  let showAll = false;
  const items = () => {
    const query = showAll ? '' : input.value.trim().toLowerCase();
    const all = projects();
    return query ? all.filter(p => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query)) : all;
  };
  function render() {
    const matches = items();
    list.replaceChildren();
    if (!matches.length) {
      const li = document.createElement('li');
      li.className = 'combobox-empty';
      li.textContent = emptyText();
      list.append(li);
    }
    matches.forEach((project, index) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.id = `project-option-${index}`;
      li.dataset.name = project.name;
      li.setAttribute('aria-selected', String(index === active));
      const name = document.createElement('span');
      name.textContent = project.name;
      const meta = document.createElement('small');
      meta.textContent = `${project.band} · ${project.id}`;
      li.append(name, meta);
      list.append(li);
    });
    input.setAttribute('aria-activedescendant', active >= 0 ? `project-option-${active}` : '');
  }
  function openList(all = false) {
    showAll = all;
    active = -1;
    onOpen();
    render();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function closeList() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  }
  function choose(name) {
    input.value = name;
    closeList();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
  toggle.addEventListener('click', () => (list.hidden ? openList(true) : closeList()));
  input.addEventListener('input', event => {
    if (event.isTrusted) openList(false);
  });
  input.addEventListener('keydown', event => {
    const count = list.hidden ? 0 : list.querySelectorAll('[role=option]').length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (list.hidden) openList(true);
      else active = Math.min(count - 1, active + 1);
      render();
    } else if (event.key === 'ArrowUp' && !list.hidden) {
      event.preventDefault();
      active = Math.max(0, active - 1);
      render();
    } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();
      choose(list.querySelectorAll('[role=option]')[active].dataset.name);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.stopPropagation();
      closeList();
    }
  });
  list.addEventListener('pointerdown', event => {
    const option = event.target.closest('[role=option]');
    if (!option) return;
    event.preventDefault();
    choose(option.dataset.name);
  });
  input.addEventListener('blur', () => setTimeout(closeList, 120));
  document.addEventListener('pointerdown', event => {
    if (!list.hidden && !event.target.closest?.('.combobox')) closeList();
  });
  return {
    refresh() {
      if (!list.hidden) render();
    },
    open: openList,
    close: closeList,
  };
}
