import test from 'node:test';
import assert from 'node:assert/strict';
import { SharePointSync, PROJECT_FORMAT, aiThermalProjects } from '../src/sp-sync.js';
import { ProjectDatabase } from '../src/project-db.js';
import { calculate, defaults } from '../src/design.js';
import { fakeGraph, fakeAuth, memoryStorage } from './fake-graph.js';

const design = name => {
  const d = structuredClone(defaults);
  d.project = { ...d.project, name };
  return calculate(d).design;
};
function setup(graph = fakeGraph()) {
  const storage = memoryStorage();
  const db = new ProjectDatabase({ storage });
  const auth = fakeAuth();
  const sp = new SharePointSync({ db, auth, fetchImpl: graph.fetchImpl, storage });
  storage.setItem('pa-copper-cad.sp.enabled', '1');
  const notices = [];
  sp.on('notice', n => notices.push(n));
  return { graph, storage, db, auth, sp, notices };
}
const remoteRecord = (graph, id) => JSON.parse(graph.read(`PA_Copper_CAD/Database/projects/${id}.json`));
const otherClient = (graph, id, name) => {
  const { project } = remoteRecord(graph, id);
  project.design = design(name);
  project.updated_at = new Date(Date.now() + 1000).toISOString();
  graph.write(
    `PA_Copper_CAD/Database/projects/${id}.json`,
    JSON.stringify({ format: PROJECT_FORMAT, id, project }),
    '同事 B',
  );
};

test('saved projects are uploaded once, one file per project, and the daily backup is written', async () => {
  const { graph, db, sp } = setup();
  const a = db.save(design('專案 A'));
  db.save(design('專案 B'));
  await sp.syncNow();
  assert.equal(sp.status.state, 'synced');
  assert.equal(remoteRecord(graph, a.id).format, PROJECT_FORMAT);
  assert.equal(remoteRecord(graph, a.id).project.design.project.name, '專案 A');
  assert.equal(db.sync.hasPending(), false);
  assert.ok(
    [...graph.files.keys()].some(p => /^PA_Copper_CAD\/Backup\/pa_copper_cad_backup_\d{4}-\d{2}-\d{2}\.json$/.test(p)),
  );
  const puts = graph.calls.filter(c => c.startsWith('PUT') && c.includes('/projects/')).length;
  await sp.syncNow();
  assert.equal(
    graph.calls.filter(c => c.startsWith('PUT') && c.includes('/projects/')).length,
    puts,
    'nothing changed → nothing uploaded',
  );
});

test('projects changed or deleted by colleagues are pulled into the local database', async () => {
  const { graph, db, sp } = setup();
  const a = db.save(design('專案 A'));
  const b = db.save(design('專案 B'));
  await sp.syncNow();
  otherClient(graph, a.id, '專案 A（同事改）');
  graph.files.delete(`PA_Copper_CAD/Database/projects/${b.id}.json`);
  const changes = [];
  db.on('change', info => changes.push(info));
  await sp.syncNow();
  assert.equal(db.get(a.id).design.project.name, '專案 A（同事改）');
  assert.equal(db.get(b.id), null);
  assert.deepEqual(changes.at(-1).pulled, [a.id]);
  assert.deepEqual(changes.at(-1).removed, [b.id]);
  assert.equal(db.sync.hasPending(), false);
});

test('both sides changed: our version is written and theirs is kept as a conflict copy', async () => {
  const { graph, db, sp, notices } = setup();
  const a = db.save(design('專案 A'));
  await sp.syncNow();
  otherClient(graph, a.id, '專案 A 同事版');
  db.save(design('專案 A 我的版'), { id: a.id });
  await sp.syncNow();
  await sp.syncNow();
  assert.equal(remoteRecord(graph, a.id).project.design.project.name, '專案 A 我的版');
  const names = db.list().map(p => p.design.project.name);
  assert.ok(names.includes('專案 A 我的版'));
  const copy = names.find(n => n.includes('衝突副本'));
  assert.match(copy, /^專案 A 同事版（衝突副本 · 同事 B · /);
  assert.ok(calculate(db.list().find(p => p.design.project.name === copy).design), 'the copy is a valid design');
  assert.equal(notices.length, 1);
  assert.equal(db.sync.hasPending(), false, 'the conflict copy is uploaded too');
});

test('a project deleted here but changed on SharePoint meanwhile is restored, not deleted', async () => {
  const { graph, db, sp, notices } = setup();
  const a = db.save(design('專案 A'));
  await sp.syncNow();
  db.remove(a.id);
  otherClient(graph, a.id, '專案 A 同事又改');
  await sp.syncNow();
  assert.equal(db.get(a.id).design.project.name, '專案 A 同事又改');
  assert.ok(graph.read(`PA_Copper_CAD/Database/projects/${a.id}.json`));
  assert.match(notices[0], /未從 SharePoint 刪除/);
  const b = db.save(design('專案 B'));
  await sp.syncNow();
  db.remove(b.id);
  await sp.syncNow();
  assert.equal(
    graph.read(`PA_Copper_CAD/Database/projects/${b.id}.json`),
    null,
    'an unchanged project is deleted remotely',
  );
});

test('the project being edited is never replaced by a pulled version until editing ends', async () => {
  const { graph, db, sp } = setup();
  const a = db.save(design('專案 A'));
  await sp.syncNow();
  otherClient(graph, a.id, '專案 A 同事版');
  sp.setEditing(a.id);
  await sp.syncNow();
  assert.equal(db.get(a.id).design.project.name, '專案 A', 'held back while editing');
  sp.setEditing(null);
  await sp.running;
  assert.equal(db.get(a.id).design.project.name, '專案 A 同事版');
});

test('signed out or offline: changes stay pending and the status says why', async () => {
  const { db, sp, auth } = setup();
  auth.signedIn = false;
  db.save(design('專案 A'));
  await sp.syncNow();
  assert.equal(sp.status.state, 'needs-login');
  assert.equal(db.sync.hasPending(), true);
  auth.signedIn = true;
  const offline = new SharePointSync({
    db,
    auth,
    storage: memoryStorage(),
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  offline.storage.setItem('pa-copper-cad.sp.enabled', '1');
  await offline.syncNow();
  clearTimeout(offline.retryTimer);
  assert.equal(offline.status.state, 'pending');
  assert.match(offline.status.message, /無法連線到 SharePoint/);
});

test("AI-Thermal's project list is read only and downloaded again only when its file changed", async () => {
  const graph = fakeGraph();
  graph.write(
    'ToolDatabase/thermal_db.json',
    JSON.stringify({
      projects: { p2: { project_name: 'RRU B', band: 'FR2' }, p1: { project_name: 'RRU A' }, bad: null },
      rf_library: {},
    }),
  );
  const { sp } = setup(graph);
  const first = await sp.readAiThermalProjects();
  assert.deepEqual(first.projects, [
    { id: 'p1', name: 'RRU A', band: 'FR1' },
    { id: 'p2', name: 'RRU B', band: 'FR2' },
  ]);
  assert.equal(first.fresh, true);
  const downloads = () => graph.calls.filter(c => c.includes('thermal_db.json:/content')).length;
  const before = downloads();
  assert.equal((await sp.readAiThermalProjects()).fresh, false);
  assert.equal(downloads(), before);
  assert.equal(
    graph.calls.filter(c => !c.startsWith('GET')).filter(c => c.includes('ToolDatabase')).length,
    0,
    'never written',
  );
  assert.deepEqual(aiThermalProjects({ projects: [] }), []);
});
