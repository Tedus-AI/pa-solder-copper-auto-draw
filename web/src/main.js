import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { zipSync, strToU8 } from 'fflate';
import { parse, stringify } from 'yaml';
import { defaults, fields, calculate, nativeJob } from './design.js';
import { drawing } from './dxf.js';

const $ = id => document.getElementById(id), base = import.meta.env.BASE_URL;
let worker, pending, counter = 0, revision = 0, result = null, part = 'copper', busy = false;
const downloadButtons = ['download-zip', 'download-dxf', 'download-step'];
$('creo-guide').href = `${base}WINDOWS_CREO7.md`;

for (const [group, [title, names]] of Object.entries(fields)) {
  const details = document.createElement('details');
  details.className = 'control-group'; details.open = ['package', 'pcb', 'copper'].includes(group);
  const summary = document.createElement('summary'); summary.textContent = title; details.append(summary);
  const grid = document.createElement('div'); grid.className = 'field-grid';
  for (const [key, title] of Object.entries(names)) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement('input');
    input.type = 'number'; input.name = `${group}.${key}`; input.id = `${group}-${key}`;
    input.step = 'any'; input.min = '0'; input.max = '10000'; input.inputMode = 'decimal';
    input.required = key !== 'thickness_override'; input.value = defaults[group][key] ?? '';
    input.setAttribute('aria-label', `${title} mm`); label.append(input); grid.append(label);
  }
  details.append(grid); $('fields').append(details);
}

function formValues() {
  const d = { name: $('name').value.trim() };
  for (const [group, [, names]] of Object.entries(fields)) {
    d[group] = {};
    for (const key of Object.keys(names)) {
      const v = $(`${group}-${key}`).value;
      if (!v && key !== 'thickness_override') throw new Error(`${names[key]} 不可留空。`);
      d[group][key] = v === '' ? null : Number(v);
    }
  }
  return d;
}

function fill(d) {
  $('name').value = d.name;
  for (const [group, [, names]] of Object.entries(fields)) for (const key of Object.keys(names)) $(`${group}-${key}`).value = d[group][key] ?? '';
}

function status(text) { $('status').textContent = text; }
function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function invalidate() {
  revision++; result = null; error('');
  downloadButtons.forEach(id => $(id).disabled = true);
  document.body.classList.remove('ready'); $('viewer').dataset.ready = 'false';
  clearModel(); $('viewer-placeholder').hidden = false; $('viewer-placeholder').textContent = '參數已變更，請重新建立模型。';
  $('model-size').textContent = '';
  for (const id of ['metric-cuh', 'metric-z', 'metric-model', 'metric-volume', 'v-cavity', 'v-boss', 'v-area', 'trials']) $(id).textContent = '—';
  status('參數已變更，尚未更新模型');
}
$('design-form').addEventListener('input', invalidate);
$('reset').addEventListener('click', () => { fill(structuredClone(defaults)); invalidate(); $('design-form').requestSubmit(); });
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 128 * 1024) throw new Error('參數檔請小於128 KB。');
    const data = parse(await file.text(), { maxAliasCount: 50 });
    const r = calculate(data); fill(r.design); invalidate(); $('design-form').requestSubmit();
  } catch (e) { invalidate(); error(`匯入失敗：${e.message}`); }
  event.target.value = '';
});

function requestModel(design) {
  if (!worker) {
    worker = new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (!pending || data.id !== pending.id) return;
      if (data.status) { if (pending.revision === revision) status(data.status); return; }
      clearTimeout(pending.timer);
      const { resolve, reject } = pending; pending = null;
      data.error ? reject(new Error(data.error)) : resolve(data.result);
    };
    worker.onerror = event => {
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error(event.message || 'CAD 引擎無法載入，請重新整理後再試。')); pending = null; }
      worker.terminate(); worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { worker.terminate(); worker = null; pending = null; reject(new Error('CAD 引擎載入逾時，請檢查網路後重新建立。')); }, 120000);
    pending = { id, revision, timer, resolve, reject }; worker.postMessage({ id, design });
  });
}

$('design-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  invalidate(); const current = revision;
  try {
    const r = calculate(formValues());
    busy = true; $('generate').disabled = true;
    $('viewer-placeholder').textContent = '正在瀏覽器內建立實體，首次載入約需數秒…';
    status('開始建模…');
    const model = await requestModel(r.design);
    if (current !== revision) { status('參數已變更，請重新建立模型'); return; }
    result = model;
    renderMetrics(model.results); showPart(part);
    document.body.classList.add('ready'); $('viewer').dataset.ready = 'true';
    downloadButtons.forEach(id => $(id).disabled = false);
    status('單一實體 · 體積與 STEP 回讀驗證通過');
  } catch (e) {
    if (current === revision) { error(e.message); status('無法建立，請檢查設計參數'); $('viewer-placeholder').textContent = '調整參數後，重新建立模型。'; }
  } finally { busy = false; $('generate').disabled = false; }
});

function renderMetrics(r) {
  for (const [id, v, digits] of [['metric-cuh', r.boss_total_height, 4], ['metric-z', r.calculated_thickness, 6], ['metric-model', r.model_thickness, 6], ['metric-volume', r.solder_volume, 3], ['v-cavity', r.cavity_volume, 3], ['v-boss', r.boss_volume, 3], ['v-area', r.preform_area, 3]]) $(id).textContent = v.toFixed(digits);
  $('trials').textContent = r.trial_thicknesses.map(v => v.toFixed(4)).join(' / ') + ' mm';
  $('warnings').replaceChildren(...r.warnings.map(message => { const li = document.createElement('li'); li.textContent = message; return li; }));
}

const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10000);
camera.up.set(0, 0, 1);
let renderer, controls, group = null, scale = 40, target = new THREE.Vector3(0, 0, 0);
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0); $('viewer').prepend(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  controls.dampingFactor = .1; controls.minDistance = .2; controls.maxDistance = 3000;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb2bba3, 2.2));
  const light = new THREE.DirectionalLight(0xffffff, 3.3); light.position.set(20, -25, 50); scene.add(light);
  const fillLight = new THREE.DirectionalLight(0xffffff, 1.6); fillLight.position.set(-30, 20, 15); scene.add(fillLight);
  const grid = new THREE.GridHelper(100, 20, 0xd9dfcf, 0xe6eadf); grid.rotation.x = Math.PI / 2; grid.position.z = -.08; scene.add(grid);
  const resize = () => { const { width, height } = $('viewer').getBoundingClientRect(); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); };
  new ResizeObserver(resize).observe($('viewer')); resize();
  const animate = () => { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }; animate();
} catch { renderer = null; }

function clearModel() {
  if (group) { scene.remove(group); group.traverse(o => { o.geometry?.dispose(); if (o.material) o.material.dispose(); }); group = null; }
  $('viewer').querySelector('svg')?.remove();
}

function setView(top = false) {
  if (!renderer || !controls) return;
  controls.target.copy(target);
  camera.position.copy(target).add(top ? new THREE.Vector3(.0001, -.0001, scale * 2.25) : new THREE.Vector3(scale * 1.0, -scale * 1.2, scale * 1.0));
  camera.lookAt(target); controls.update();
}

function showPart(next) {
  part = next;
  $('tab-copper').classList.toggle('active', part === 'copper'); $('tab-preform').classList.toggle('active', part === 'preform');
  if (!result) return;
  clearModel();
  const model = result.parts[part], [low, high] = model.bounds;
  const sizes = high.map((n, i) => n - low[i]); scale = Math.max(sizes[0], sizes[1]);
  target.set(...high.map((n, i) => (n + low[i]) / 2));
  $('model-size').textContent = sizes.map(v => v.toFixed(3)).join(' × ') + ' mm';
  if (renderer) {
    group = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(model.mesh.vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(model.mesh.normals, 3));
    geometry.setIndex(model.mesh.triangles);
    const material = new THREE.MeshStandardMaterial({ color: part === 'copper' ? 0xbb7d4b : 0x9ca8aa, metalness: part === 'copper' ? .5 : .45, roughness: .4 });
    group.add(new THREE.Mesh(geometry, material));
    const edgeGeometry = new THREE.BufferGeometry(); edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(model.edges.lines, 3));
    group.add(new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: part === 'copper' ? 0x835831 : 0x647876, transparent: true, opacity: .45 })));
    scene.add(group); setView();
  } else {
    const r = result.results, c = r.design.copper;
    const points = part === 'preform' ? `${-r.boss_length / 2},${-r.boss_width / 2} ${r.boss_length / 2},${-r.boss_width / 2} ${r.boss_length / 2},${r.boss_width / 2} ${-r.boss_length / 2},${r.boss_width / 2}` : `${-c.base_length / 2},${-c.base_width / 2} ${c.base_length / 2},${-c.base_width / 2} ${c.base_length / 2},${c.base_width / 2} ${-c.base_length / 2},${c.base_width / 2}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `${-scale} ${-scale / 2} ${scale * 2} ${scale}`); svg.style.cssText = 'width:100%;height:100%';
    const polygon = document.createElementNS(svg.namespaceURI, 'polygon'); polygon.setAttribute('points', points); polygon.setAttribute('fill', '#bc8754'); svg.append(polygon); $('viewer').prepend(svg);
  }
  $('viewer-placeholder').hidden = true;
}
$('tab-copper').addEventListener('click', () => showPart('copper'));
$('tab-preform').addEventListener('click', () => showPart('preform'));
$('view-top').addEventListener('click', () => setView(true)); $('view-iso').addEventListener('click', () => setView());

function save(data, name) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('download-step').addEventListener('click', () => { if (result) save(result.parts[part].step, `${result.results.design.name}_${part}.step`); });
$('download-dxf').addEventListener('click', () => { if (result) save(drawing(result.results, part), `${result.results.design.name}_${part}.dxf`); });
const json = obj => JSON.stringify(obj, null, 2) + '\n';
$('download-zip').addEventListener('click', async () => {
  if (!result) return;
  const snapshot = result; $('download-zip').disabled = true;
  try {
    const r = snapshot.results, files = {};
    for (const [name, model] of Object.entries(snapshot.parts)) {
      files[`${name}.step`] = new Uint8Array(await model.step.arrayBuffer());
      files[`${name}.stl`] = new Uint8Array(await model.stl.arrayBuffer());
      files[`${name}.dxf`] = strToU8(drawing(r, name));
    }
    const report = { schema_version: 2, created_at_utc: new Date().toISOString(), engine: 'OpenCascade WebAssembly / Replicad', units: { length: 'mm', area: 'mm2', volume: 'mm3' },
      parameters: r.design, results: r, verification: snapshot.verification,
      cad_volumes_mm3: Object.fromEntries(Object.entries(snapshot.parts).map(([key, v]) => [key, v.volume])),
      native_prt: { status: 'not_generated', required_model_type: 'native_parametric_features', target: 'Creo Parametric 7.0.10.0 / Windows 11', reason: 'Requires local licensed Creo and real native parametric master models.' } };
    files['report.json'] = strToU8(json(report)); files['parameters.yaml'] = strToU8(stringify(r.design));
    files['creo_job.json'] = strToU8(json(nativeJob(r)));
    for (const path of ['creo_runner.py', 'WINDOWS_CREO7.md', 'THIRD_PARTY_LICENSES.txt']) {
      const response = await fetch(base + path);
      if (!response.ok) throw new Error(`${path} 下載失敗（${response.status}），請重新整理網站。`);
      files[path] = new Uint8Array(await response.arrayBuffer());
    }
    const hashes = {};
    for (const [name, bytes] of Object.entries(files)) hashes[name] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
    files['sha256.json'] = strToU8(json(hashes));
    save(zipSync(files, { level: 6 }), `${r.design.name}.zip`);
  } catch (e) { error(`打包失敗：${e.message}`); }
  finally { $('download-zip').disabled = !result; }
});

renderMetrics(calculate(defaults));
$('design-form').requestSubmit();
