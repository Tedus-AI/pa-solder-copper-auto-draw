import './style.css';
import { zipSync, strToU8 } from 'fflate';
import { parse, stringify } from 'yaml';
import { defaults, fields, calculate, nativeJob, openingRecommendation } from './design.js';
import { faceViews } from './camera-views.js';
import { formatDimension } from './dimension-format.js';
import { drawing } from './dxf.js';
import { layoutGeometry, layoutDxf } from './layout.js';
import { CADViewer } from './viewer.js';

const $ = id => document.getElementById(id), base = import.meta.env.BASE_URL;
let worker, pending, counter=0, revision=0, result=null, draft=null, part='copper', busy=false, previewTimer;
let layoutKey='', cachedLayout=null;
const downloadButtons=['download-zip','download-dxf','download-step'];
$('creo-guide').href=`${base}WINDOWS_CREO7.md`;

const viewer=new CADViewer($('viewer'),(mode,refs,exploded)=>{
  for(const m of ['assembly','copper','preform','layout'])$(`tab-${m}`).classList.toggle('active',m===mode);
  for(const component of ['copper','preform','pcb','pa'])$(`ref-${component}`).checked=refs[component];
  $('explode').checked=exploded;
  $('reference-note').textContent=mode==='assembly'?'PCB／PA 僅位置參考，不參與3D出圖':mode==='layout'?'綠色＝綠漆覆蓋；灰色＝E-PAD開窗，單獨輸出Layout DXF':'目前零件的3D出圖預覽';
},dimension=>{
  document.querySelectorAll('.dimension-active').forEach(el=>el.classList.remove('dimension-active'));
  $('dimension-label').hidden=!dimension;
  if(dimension){
    const [group,key]=dimension.key.split('.');
    const title=fields[group][1][key];
    $('dimension-title').textContent=`${title} · ${dimension.label}`;
    $('dimension-context').textContent=dimension.note;
    document.querySelector(`input[name="${dimension.key}"]`)?.closest('label').classList.add('dimension-active');
  }
});

for(const group of ['package','stack','pcb','copper','preform','layout']){
  const [title,names]=fields[group],details=document.createElement('details');
  details.className='control-group';details.open=true;details.dataset.group=group;
  const summary=document.createElement('summary');summary.textContent=title;details.append(summary);
  const grid=document.createElement('div');grid.className='field-grid';
  for(const[key,title]of Object.entries(names)){
    const label=document.createElement('label');const caption=document.createElement('span');caption.textContent=title.replace(/ ±$/,'')+' =';label.append(caption);
    const input=document.createElement('input');input.type='number';input.name=`${group}.${key}`;input.id=`${group}-${key}`;
    input.step='any';input.min='0';input.max='10000';input.inputMode='decimal';input.required=key!=='thickness_override';input.value=defaults[group][key]??'';
    input.setAttribute('aria-label',`${title} mm`);label.append(input);grid.append(label);
  }
  details.append(grid);
  if(group==='pcb'){
    const links=document.createElement('div');links.className='linked-controls';
    links.innerHTML='<label><input id="pcb-auto" type="checkbox" checked>自動連動 M/N</label><select id="pcb-rule" aria-label="PCB 開窗設計規則"><option value="delta">Delta</option><option value="ampleon">Ampleon</option></select><p id="opening-chain"></p>';
    details.append(links);
  }
  if(group==='package'||group==='copper'||group==='stack'){
    const hint=document.createElement('p');hint.className='group-hint';hint.id=`${group}-derived`;details.append(hint);
  }
  $('fields').append(details);
}
function formValues(){
  const d={name:$('name').value.trim()};
  for(const[group,[,names]]of Object.entries(fields)){
    d[group]={};for(const key of Object.keys(names)){
      const v=$(`${group}-${key}`).value;
      if(!v&&key!=='thickness_override')throw new Error(`${names[key]} 不可留空。`);
      d[group][key]=v===''?null:Number(v);
    }
  }
  d.pcb.opening_mode=$('pcb-auto').checked?'auto':'manual';d.pcb.opening_rule=$('pcb-rule').value;
  return d;
}
function fill(d){$('name').value=d.name;for(const[group,[,names]]of Object.entries(fields))for(const key of Object.keys(names))$(`${group}-${key}`).value=d[group][key]??'';$('pcb-auto').checked=d.pcb.opening_mode==='auto';$('pcb-rule').value=d.pcb.opening_rule;syncLinkedFields(d);}
function syncLinkedFields(d){
  const auto=d.pcb.opening_mode==='auto',chain=openingRecommendation(d);
  for(const [i,key]of ['opening_length','opening_width'].entries()){
    const input=$(`pcb-${key}`);input.readOnly=auto;input.setAttribute('aria-readonly',String(auto));
    input.title=auto?'依 PA 尺寸、公差及開窗規則自動計算；取消「自動連動 M/N」可手動修改。':'手動開窗尺寸';
    if(auto){input.value=chain.rounded[i];d.pcb[key]=chain.rounded[i];}
  }
  $('opening-chain').textContent=`${auto?'自動':'建議'} M/N = 最大 PA＋貼片精度＋PCB 公差${chain.factor===.5?' / 2':''} → 向上取 0.1 mm`;
  return d;
}
function status(text){$('status').textContent=text;}
function error(message){$('error').textContent=message;$('error').hidden=!message;}
function layoutFor(r){
  const c=r.design.copper,b=r.design.pcb;
  const key=JSON.stringify([c.base_length,c.base_width,c.corner_radius,c.hole_diameter,c.hole_edge_offset,b.opening_length,b.opening_width,b.relief_diameter,r.design.layout]);
  if(key!==layoutKey){cachedLayout=layoutGeometry(r);layoutKey=key;}return cachedLayout;
}
function refreshPreview(showError=false){
  try{
    const r=calculate(syncLinkedFields(formValues())),layout=layoutFor(r);draft={results:r,layout};
    viewer.setDesign(r,layout);renderMetrics(r);$('viewer-placeholder').hidden=true;
    $('download-layout').disabled=false;$('viewer').dataset.previewValid='true';
    $('model-size').textContent=[['E',r.design.copper.base_length],['F',r.design.copper.base_width],['G',r.design.copper.base_thickness]].map(([name,value])=>formatDimension(name,value)).join(' · ');
    return draft;
  }catch(e){draft=null;viewer.clearAnnotation();$('preview-state').textContent='輸入無效 · 保留上次有效示意';$('download-layout').disabled=true;$('viewer').dataset.previewValid='false';if(showError)error(e.message);status(`參數未完成：${e.message}`);return null;}
}
function invalidate(){
  revision++;result=null;error('');downloadButtons.forEach(id=>$(id).disabled=true);$('download-layout').disabled=true;
  document.body.classList.remove('ready');$('viewer').dataset.ready='false';$('preview-state').textContent='即時預覽 · 出圖待更新';
  clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(refreshPreview())status('預覽已更新；按「建立出圖模型」後下載3D零件');},140);
}
$('design-form').addEventListener('input',invalidate);
$('pcb-auto').addEventListener('change',()=>{clearTimeout(previewTimer);refreshPreview(true);});
$('pcb-rule').addEventListener('change',()=>{clearTimeout(previewTimer);refreshPreview(true);});
$('design-form').addEventListener('focusin',event=>{
  if(event.target.type==='number'){
    clearTimeout(previewTimer);refreshPreview();viewer.selectDimension(event.target.name);
  }
});
$('reset').addEventListener('click',()=>{fill(structuredClone(defaults));invalidate();$('design-form').requestSubmit();});
$('import').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>128*1024)throw new Error('參數檔請小於128 KB。');const r=calculate(parse(await file.text(),{maxAliasCount:50}));fill(r.design);invalidate();$('design-form').requestSubmit();}
  catch(e){error(`匯入失敗：${e.message}`);}event.target.value='';
});
for(const mode of ['assembly','copper','preform','layout'])$(`tab-${mode}`).addEventListener('click',()=>{
  viewer.setMode(mode);if(['copper','preform'].includes(mode)){part=mode;$('export-part').value=mode;}
});
$('export-part').addEventListener('change',event=>part=event.target.value);
for(const component of ['copper','preform','pcb','pa'])$(`ref-${component}`).addEventListener('change',event=>viewer.setReference(component,event.target.checked));
$('explode').addEventListener('change',event=>viewer.setExploded(event.target.checked));
for(const view of ['iso',...faceViews])$(`view-${view}`).addEventListener('click',()=>viewer.setView(view));
$('dimension-clear').addEventListener('click',()=>{viewer.key=null;viewer.clearAnnotation();});
$('dimension-fit').addEventListener('click',()=>{if(viewer.key)viewer.selectDimension(viewer.key);});
$('help-open').addEventListener('click',()=>$('help-dialog').showModal());
$('help-close').addEventListener('click',()=>$('help-dialog').close());
$('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog'))$('help-dialog').close();});
function renderMetrics(r){
  for(const[id,v,digits]of [['metric-cuh',r.boss_total_height,4],['metric-z',r.calculated_thickness,6],['metric-model',r.model_thickness,6],['metric-volume',r.solder_volume,3],['v-cavity',r.cavity_volume,3],['v-boss',r.boss_volume,3],['v-area',r.preform_area,3]])$(id).textContent=v.toFixed(digits);
  $('trials').textContent=r.trial_thicknesses.map(v=>v.toFixed(4)).join(' / ')+' mm';
  $('warnings').replaceChildren(...r.warnings.map(message=>{const li=document.createElement('li');li.textContent=message;return li;}));
  $('layout-summary').textContent=[['R',r.design.layout.border_width],['S',r.design.layout.epad_size],['T',r.design.layout.web_width],['V',r.design.layout.hole_clearance]].map(([name,value])=>formatDimension(name,value,{prefix:name==='V'?'⌀':''})).join(' / ');
  $('package-derived').textContent=r.opening_chain.maximum.map((v,i)=>formatDimension(i?'PA(Wmax)':'PA(Lmax)',v)).join('；');
  $('copper-derived').textContent=[['I',r.boss_length],['H',r.boss_width],['HSK 深度',r.heatsink_depth]].map(([name,value])=>formatDimension(name,value)).join('；');
  $('stack-derived').textContent=`CuH(L) = C + A + B − SPH − D + K = ${r.boss_total_height.toFixed(4)} mm`;
  $('opening-chain').textContent=`${r.design.pcb.opening_mode==='auto'?'自動':'建議'} ${formatDimension('M',r.recommended_opening[0])}；${formatDimension('N',r.recommended_opening[1])}。${r.design.pcb.opening_rule==='delta'?'Delta':'Ampleon'}：最大 PA＋精度＋PCB 公差${r.opening_chain.factor===.5?' / 2':''}，向上取至 0.1 mm。`;
}
function layoutReport(g,r){return {rules:r.design.layout,grid_pitch:g.pitch,epad_cells:g.cells.length,epad_area_mm2:g.epad_area,mask_area_mm2:g.mask_area,edge_web_margins_mm:g.boundary_margins,chord_tolerance_mm:g.chord_tolerance,notes:g.notes};}
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


$('design-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;clearTimeout(previewTimer);error('');
  result=null;downloadButtons.forEach(id=>$(id).disabled=true);$('viewer').dataset.ready='false';
  const valid=refreshPreview(true);if(!valid)return;
  const current=revision;
  try{
    busy=true;$('generate').disabled=true;status('開始建立出圖模型…');
    const model=await requestModel(valid.results.design);
    if(current!==revision){status('參數已變更，請重新建立出圖模型');return;}
    result={...model,layout:valid.layout};draft={results:model.results,layout:valid.layout};
    viewer.setDesign(model.results,valid.layout,model.parts);renderMetrics(model.results);
    document.body.classList.add('ready');$('viewer').dataset.ready='true';$('preview-state').textContent='出圖模型已驗證';
    downloadButtons.forEach(id=>$(id).disabled=false);status('銅塊／錫片：單一實體、體積與 STEP 回讀通過');
  }catch(e){if(current===revision){error(e.message);status('出圖模型建立失敗；可修正參數後重建');}}
  finally{busy=false;$('generate').disabled=false;}
});
$('download-layout').addEventListener('click',()=>{
  clearTimeout(previewTimer);const current=refreshPreview(true);if(current)save(layoutDxf(current.results,current.layout),`${current.results.design.name}_layout_solder_mask.dxf`);
});
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
    files['layout_solder_mask.dxf'] = strToU8(layoutDxf(r, snapshot.layout));
    for (const [name, model] of Object.entries(snapshot.parts)) {
      files[`${name}.step`] = new Uint8Array(await model.step.arrayBuffer());
      files[`${name}.stl`] = new Uint8Array(await model.stl.arrayBuffer());
      files[`${name}.dxf`] = strToU8(drawing(r, name));
    }
    const report = { schema_version: 2, created_at_utc: new Date().toISOString(), engine: 'OpenCascade WebAssembly / Replicad', units: { length: 'mm', area: 'mm2', volume: 'mm3' },
      parameters: r.design, results: r, verification: snapshot.verification,
      cad_volumes_mm3: Object.fromEntries(Object.entries(snapshot.parts).map(([key, v]) => [key, v.volume])),
      native_prt: { status: 'not_generated', required_model_type: 'native_parametric_features', target: 'Creo Parametric 7.0.10.0 / Windows 11', reason: 'Requires local licensed Creo and real native parametric master models.' } };
    report.reference_geometry = { pcb: 'display_only', pa: 'display_only', note: 'PA casing/flange and six pins follow illustrative datasheet proportions; SPH fixes the lead reference plane. Only PA length, width, tolerance and SPH affect manufacturing calculations.' };
    report.layout = layoutReport(snapshot.layout, r);
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


refreshPreview();viewer.setView('iso');$('design-form').requestSubmit();
