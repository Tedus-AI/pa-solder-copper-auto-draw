import './style.css';
import { zipSync, strToU8 } from 'fflate';
import { stringify } from 'yaml';
import { defaults, fields, calculate, nativeJob, openingRecommendation, ceilTenth, normalizeProject } from './design.js';
import { toleranceDefaults, getTolerance, toleranceText, toleranceSource, toleranceSuffix } from './tolerances.js';
import { faceViews } from './camera-views.js';
import { formatDimension } from './dimension-format.js';
import { drawing } from './dxf.js';
import { layoutGeometry, layoutDxf } from './layout.js';
import { copperDrawingText, drawingLayout, encodeDxf, DRAWING_TEMPLATE_PATH } from './copper-drawing.js';
import { preformDrawingText, preformDrawingLayout, drawnThickness } from './preform-drawing.js';
import { emptyPartNumbers, cleanPartNo, fullPartNumber, titleBlockPartNumber, REVISIONS, PART_LABELS, PART_NO_BASE_LENGTH } from './part-numbers.js';
import { outputFileName } from './file-names.js';
import { WatermarkStore } from './watermark-store.js';
import { CADViewer } from './viewer.js';
import { ProjectDatabase } from './project-db.js';
import { LocalFileDb } from './local-file-db.js';
import { SharePointSync } from './sp-sync.js';
import { MsalAuth } from './msal-auth.js';
import { setupStorageUI } from './storage-ui.js';
import {chamferFor,TRIAL_DELTA,emptyTrial,trialChoices} from './preform-rules.js';
import { createCalculationGuide } from './calculation-guide.js';

const $ = id => document.getElementById(id), base = import.meta.env.BASE_URL;
let worker, pending, counter=0, revision=0, result=null, draft=null, part='copper', busy=false, previewTimer;
let layoutKey='', cachedLayout=null, tolerancesUnlocked=false,trialRecord=emptyTrial(),partNumbers=emptyPartNumbers();
const projectStore=new ProjectDatabase(),localFile=new LocalFileDb(),spSync=new SharePointSync({db:projectStore,auth:new MsalAuth()});let activeProjectId=null,activeRecordStamp=null,rebuildQueued=false,projectMetadataValid=true,projectDirty=false;
// Export buttons follow one state: the verified CAD model (STEP, outline DXF, bundle),
// the live preview (2D drawing DXF/PDF, E-PAD Layout DXF) and the selected part.
const exportsRunning=new Set();
function refreshExportButtons(){
  const model=!!result&&projectMetadataValid,preview=!!draft&&projectMetadataValid,drawn=part!=='layout';
  const ready={'download-zip':model,'download-step':model&&drawn,'download-dxf':drawn?model:preview,'download-drawing':preview&&drawn,'download-drawing-pdf':preview&&drawn};
  for(const[id,ok]of Object.entries(ready))$(id).disabled=!ok||exportsRunning.has(id);
}
const formulaButtons=new Map();let activeFormulaButton=null;
const calculationIds=new Set(['metric-z','metric-model','metric-volume','v-cavity','v-boss','v-area','trials']);
const openCalculationGuide=createCalculationGuide(()=>calculate(syncLinkedFields(formValues())));
function showCalculationGuide(){try{hideFormula();openCalculationGuide();}catch(e){error(e.message);}}
const formulaTooltip=document.createElement('div');formulaTooltip.id='formula-tooltip';formulaTooltip.setAttribute('role','tooltip');formulaTooltip.hidden=true;document.body.append(formulaTooltip);
function hideFormula(){formulaTooltip.hidden=true;if(activeFormulaButton)activeFormulaButton.setAttribute('aria-expanded','false');activeFormulaButton=null;}
function showFormula(button){
  if(button.hidden||!button.dataset.formula)return;
  if(activeFormulaButton&&activeFormulaButton!==button)activeFormulaButton.setAttribute('aria-expanded','false');
  activeFormulaButton=button;formulaTooltip.textContent=button.dataset.formula;formulaTooltip.hidden=false;button.setAttribute('aria-expanded','true');
  const rect=button.getBoundingClientRect(),width=formulaTooltip.offsetWidth,height=formulaTooltip.offsetHeight;
  formulaTooltip.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2))+'px';
  formulaTooltip.style.top=(rect.bottom+height+12<innerHeight?rect.bottom+7:Math.max(8,rect.top-height-7))+'px';
}
function formulaHelp(container,id,label){
  let button=formulaButtons.get(id);
  if(!button){
    button=document.createElement('button');button.type='button';button.className='formula-help';button.textContent='?';button.dataset.formulaId=id;button.setAttribute('aria-label',`${label}的計算方式`);button.setAttribute('aria-describedby','formula-tooltip');button.setAttribute('aria-expanded','false');
    button.addEventListener('pointerenter',()=>showFormula(button));button.addEventListener('pointerleave',()=>{if(document.activeElement!==button)hideFormula();});button.addEventListener('focus',()=>showFormula(button));button.addEventListener('blur',hideFormula);
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(calculationIds.has(id))showCalculationGuide();else showFormula(button);});
    formulaButtons.set(id,button);
  }
  if(container&&button.parentElement!==container)container.append(button);return button;
}
function setFormula(id,text,visible=true){const button=formulaButtons.get(id);if(!button)return;button.dataset.formula=text;button.hidden=!visible;if(!visible&&activeFormulaButton===button)hideFormula();}
window.addEventListener('resize',hideFormula);
let scrollFrame=0;
document.addEventListener('scroll',()=>{
  // Reposition at most once per frame; scroll events can fire many times per frame.
  if(!activeFormulaButton||scrollFrame)return;
  scrollFrame=requestAnimationFrame(()=>{
    scrollFrame=0;if(!activeFormulaButton)return;
    const rect=activeFormulaButton.getBoundingClientRect();
    // A tap can finish scrolling its focused control after the click event.
    // Keep an on-screen formula anchored instead of immediately dismissing it.
    if(rect.bottom<0||rect.top>innerHeight)hideFormula();else showFormula(activeFormulaButton);
  });
},{capture:true,passive:true});
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideFormula();});document.addEventListener('pointerdown',event=>{if(!event.target.closest('.formula-help')&&!formulaTooltip.contains(event.target))hideFormula();});

$('creo-guide').href=`${base}WINDOWS_CREO7.md`;
// Compact visible labels retain the full quantity name in their formula help.
for(const[id,label]of [['metric-z','計算 Z ='],['metric-model','模型 Z ='],['metric-volume','錫量 V₁ =']])$(id).parentElement.querySelector('span').firstChild.textContent=label;
const toleranceLegend=$('tolerance-status').parentElement.querySelector('small');toleranceLegend.title=toleranceLegend.textContent;toleranceLegend.textContent='−／＋偏差；* 原資料未指定，空白暫按 0';
document.querySelector('.tolerance-toolbar').title=toleranceLegend.title;

const viewer=new CADViewer($('viewer'),(mode,refs,exploded)=>{
  for(const m of ['assembly','copper','preform','layout'])$(`tab-${m}`).classList.toggle('active',m===mode);
  for(const component of ['copper','preform','pcb','pa','epad'])$(`ref-${component}`).checked=refs[component];
  $('explode').checked=exploded;
  $('reference-note').textContent=mode==='assembly'?'PCB／PA 僅位置參考，不參與3D出圖':mode==='layout'?'綠色＝綠漆覆蓋；灰色＝E-PAD開窗，單獨輸出Layout DXF':'目前零件的3D出圖預覽';
},dimension=>{
  document.querySelectorAll('.dimension-active').forEach(el=>el.classList.remove('dimension-active'));
  $('dimension-label').hidden=!dimension;
  if(dimension){
    const [group,key]=dimension.key.split('.');
    const title=fields[group]?.[1]?.[key]||dimension.key;
    $('dimension-title').textContent=`${title} · ${dimension.label}`;
    $('dimension-context').textContent=dimension.note;
    document.querySelector(`input[name="${dimension.key}"]`)?.closest('.dimension-row')?.classList.add('dimension-active');
  }
});

const fieldPath=(group,key)=>`${group}.${key}`;
const inputFor=path=>$(path.replace('.','-'));
const titleFor=path=>{const[group,key]=path.split('.');return fields[group]?.[1]?.[key]||path;};
const allPaths=Object.entries(fields).flatMap(([group,[,names]])=>Object.keys(names).map(key=>fieldPath(group,key)));
const groupPaths=group=>allPaths.filter(path=>path.startsWith(group+'.'));
const hasPath=path=>allPaths.includes(path);
const sourceFor=path=>toleranceDefaults[path]?.source||'未指定';
const compactCaptions={'boss.center_from_left':'距左邊 Xc','boss.center_from_bottom':'距下邊 Yc','preform.thickness_override':'選定錫厚 Z','stack.board_solder':'銅塊／PCB 錫厚 B'};
const unknownTolerance=path=>/未指定|未提供|unknown/i.test(sourceFor(path));
const uiGroups=[
  {id:'package',title:'PA 封裝',paths:groupPaths('package'),open:true},
  {id:'pcb',title:'PCB 開孔',paths:groupPaths('pcb'),open:true},
  {id:'copper',title:'銅塊基座',paths:groupPaths('copper').filter(path=>path!=='copper.pad_size'),open:true},
  {id:'boss',title:'中凸台／四角小凸台',paths:[...groupPaths('boss'),'copper.pad_size','stack.pad_height'].filter(hasPath),open:true},
  {id:'stack',title:'高度堆疊',paths:groupPaths('stack').filter(path=>path!=='stack.pad_height'),open:true},
  {id:'preform',title:'錫片設計',paths:groupPaths('preform'),open:true},
  {id:'layout',title:'綠漆／E-PAD',paths:groupPaths('layout'),open:true},
];
const controlColumns=[0,1].map(index=>{const column=document.createElement('div');column.className='control-column';column.dataset.column=index;$('fields').append(column);return column;});
const groupPanels=new Map();
for(const group of uiGroups){
  if(!group.paths.length)continue;
  const details=document.createElement('details');details.className='control-group';details.open=group.open;details.dataset.group=group.id;
  const summary=document.createElement('summary');summary.textContent=group.title;details.append(summary);
  const grid=document.createElement('div');grid.className='field-grid tolerance-grid';
  const head=document.createElement('div');head.className='dimension-head';head.innerHTML='<span>尺寸 · mm</span><span title="設計尺寸（Typ.）：未加上下公差的設計值">Typ.</span><span>− 公差</span><span>＋ 公差</span>';grid.append(head);
  for(const path of group.paths){
    const[g,key]=path.split('.'),title=titleFor(path),row=document.createElement('div');row.className='dimension-row';row.dataset.dimension=path;
    const caption=document.createElement('label');caption.htmlFor=path.replace('.','-');caption.title=title;const captionText=document.createElement('span');captionText.className='dimension-caption';captionText.textContent=(compactCaptions[path]||title).replace(/ ±$/,'')+' =';caption.append(captionText);
    const source=document.createElement('span');source.className='tolerance-source'+(unknownTolerance(path)?' unspecified':'');source.textContent=unknownTolerance(path)?'*':'·';source.title=unknownTolerance(path)?'資料未指定公差；分析暫按 0，解鎖後可手動輸入。':sourceFor(path);caption.append(source);row.append(caption);
    if(['pcb.opening_length','pcb.opening_width','boss.length','boss.width','boss.total_height','preform.length','preform.width','boss.center_from_left','boss.center_from_bottom','preform.chamfer','preform.trial_delta'].includes(path))formulaHelp(caption,path,title);
    const input=document.createElement('input');input.type='number';input.className='nominal-input';input.name=path;input.id=path.replace('.','-');
    input.step='any';input.min='0';input.max='10000';input.inputMode='decimal';input.required=key!=='thickness_override';input.value=defaults[g][key]??'';
    input.setAttribute('aria-label',`${title} mm`);if(key==='thickness_override')input.placeholder='自動';row.append(input);
    const pair=getTolerance(defaults,path);
    for(const sign of ['minus','plus']){
      const tol=document.createElement('input');tol.type='number';tol.className='tolerance-input';tol.id=`tol-${path.replace('.','-')}-${sign}`;tol.name=`tolerances.${path}.${sign}`;tol.dataset.fieldKey=path;tol.dataset.toleranceSide=sign;
      tol.step='any';tol.min='0';tol.max='10000';tol.inputMode='decimal';tol.readOnly=true;tol.setAttribute('aria-readonly','true');tol.required=!unknownTolerance(path);
      tol.value=unknownTolerance(path)&&pair[sign]===0?'':pair[sign];tol.placeholder='—';tol.title=`${sourceFor(path)}；${sign==='minus'?'下偏差':'上偏差'}（輸入非負值）`;
      tol.setAttribute('aria-label',`${title} ${sign==='minus'?'下':'上'}公差 mm`);row.append(tol);
    }
    grid.append(row);
  }
  details.append(grid);
  if(group.id==='preform'){const button=document.createElement('button');button.id='calculation-guide-open';button.type='button';button.className='guide-launch';button.textContent='錫厚圖解／計算表 ↗';details.append(button);
    const trials=document.createElement('div');trials.className='trial-selection';trials.innerHTML='<div id="trial-candidates" class="trial-candidates"></div><label for="trial-choice">錫片厚度驗證後選定</label><div class="trial-confirm"><select id="trial-choice" aria-label="錫片厚度驗證後選定"></select><button id="trial-lock" type="button" aria-pressed="false" title="鎖定此案的驗證結果">🔓</button></div><p id="trial-result-status" aria-live="polite"></p>';const selectedRow=grid.querySelector('[data-dimension="preform.thickness_override"]');const toleranceText=document.createElement('span');toleranceText.id='thickness-tolerance-text';toleranceText.className='tolerance-text';toleranceText.title='錫片厚度 Z 的製造公差；按「解鎖公差」可修改上下偏差';selectedRow.append(toleranceText);trials.append(selectedRow);details.append(trials);}

  if(group.id==='copper'){const box=document.createElement('fieldset');box.className='hole-selection';box.innerHTML='<legend>吊掛孔角位（俯視，可複選）</legend>'+[['top_left','左上'],['top_right','右上'],['bottom_left','左下'],['bottom_right','右下']].map(([key,label])=>`<label><input type="checkbox" data-hole-corner="${key}">${label}</label>`).join('');details.append(box);}
  if(group.id==='pcb'){
    const links=document.createElement('div');links.className='linked-controls';links.innerHTML='<label><input id="pcb-auto" type="checkbox" checked>開窗 M/N 自動計算</label><select id="pcb-rule" aria-label="PCB 開窗設計規則"><option value="delta">Delta</option><option value="ampleon">Ampleon</option></select><p id="opening-chain"></p>';details.append(links);
    const analysis=document.createElement('div');analysis.id='gap-analysis';analysis.className='gap-analysis';
    analysis.innerHTML='<div class="gap-heading"><strong>PA 底座／PCB 開窗單邊間隙</strong><span id="gap-state"></span></div><table><thead><tr><th>方向</th><th title="設計尺寸（Typ.）算出的單邊間隙">Typ.</th><th>最小</th><th>最大</th></tr></thead><tbody><tr><th>X</th><td><span id="gap-x-nominal">—</span></td><td><span id="gap-x-min">—</span></td><td><span id="gap-x-max">—</span></td></tr><tr><th>Y</th><td><span id="gap-y-nominal">—</span></td><td><span id="gap-y-min">—</span></td><td><span id="gap-y-max">—</span></td></tr></tbody></table><p id="gap-assumptions">PA／PCB 開窗固定同心；單位 mm。</p>';
    details.append(analysis);for(const axis of ['x','y'])for(const kind of ['nominal','min','max'])formulaHelp(analysis.querySelector(`#gap-${axis}-${kind}`).parentElement,`gap-${axis}-${kind}`,`${axis.toUpperCase()} ${kind==='nominal'?'設計尺寸（Typ.）':kind==='min'?'最小':'最大'}單邊間隙`);
  }
  if(group.id==='boss'){
    const links=document.createElement('div');links.className='linked-controls boss-links';links.innerHTML='<label><input id="boss-size-auto" type="checkbox" checked>I/H 跟隨 PA</label><span class="fixed-height-note">L 由 C／K／SPH 自動計算</span><button id="boss-center" type="button">置中</button><p id="boss-derived"></p>';details.append(links);
  }
  if(['package','copper','stack'].includes(group.id)){
    const hint=document.createElement('p');hint.className='group-hint';hint.id=`${group.id}-derived`;details.append(hint);
  }
  groupPanels.set(group.id,details);
}
// Copper base and both boss levels belong to one part and one settings group.
const copperPanel=groupPanels.get('copper'),bossPanel=groupPanels.get('boss');
copperPanel.querySelector('summary').textContent='銅塊';copperPanel.classList.add('integrated-copper');
const copperSections=document.createElement('div');copperSections.className='copper-sections';
for(const [panel,title,key]of [[copperPanel,'基座','base'],[bossPanel,'中凸台／四角小凸台','boss']]){
  const section=document.createElement('section');section.className='copper-subgroup';section.dataset.subgroup=key;
  const heading=document.createElement('h3');heading.textContent=title;section.append(heading);
  for(const child of [...panel.children])if(child.tagName!=='SUMMARY')section.append(child);
  copperSections.append(section);
}
copperPanel.append(copperSections);
const upper=document.createElement('div');upper.className='control-region upper-controls';
controlColumns[0].append(groupPanels.get('package'),groupPanels.get('stack'));controlColumns[1].append(groupPanels.get('pcb'));upper.append(...controlColumns);
const lower=document.createElement('div');lower.className='control-region lower-controls';lower.append(groupPanels.get('preform'),groupPanels.get('layout'));
$('fields').replaceChildren(upper,copperPanel,lower);
for(const[id,label]of [['metric-l','中凸台總高'],['metric-z','計算錫厚'],['metric-model','模型錫厚'],['metric-volume','所需錫量']])formulaHelp($(id).parentElement.querySelector('span'),id,label);
for(const[id,label]of [['v-cavity','容腔體積'],['v-boss','凸台體積'],['v-area','錫片面積'],['trials','三款試片厚度']]){const button=formulaHelp(null,id,label);$(id).insertAdjacentElement('afterend',button);}
function updateToleranceLock(){
  document.querySelectorAll('.tolerance-input').forEach(input=>{input.readOnly=!tolerancesUnlocked;input.setAttribute('aria-readonly',String(!tolerancesUnlocked));});
  $('tolerance-unlock').textContent=tolerancesUnlocked?'鎖定公差':'解鎖公差';$('tolerance-unlock').setAttribute('aria-pressed',String(tolerancesUnlocked));
  $('tolerance-status').textContent=tolerancesUnlocked?'可修改上下公差':'公差已鎖定';
  $('design-form').classList.toggle('tolerances-unlocked',tolerancesUnlocked);
}
function formValues(){
  const d=structuredClone(defaults);d.name=$('name').value.trim();d.project={name:$('project-name').value.trim(),project_id:$('project-id').value.trim(),pa_brand:$('pa-brand').value.trim(),pa_model:$('pa-model').value.trim()};d.tolerances={};
  for(const path of allPaths){
    const[group,key]=path.split('.'),v=inputFor(path).value;
    if(!v&&key!=='thickness_override')throw new Error(`${titleFor(path)} 不可留空。`);
    d[group][key]=v===''?null:Number(v);d.tolerances[path]={};
    for(const sign of ['minus','plus']){
      const raw=$(`tol-${path.replace('.','-')}-${sign}`).value;
      if(raw===''&&!unknownTolerance(path))throw new Error(`${titleFor(path)} 的${sign==='minus'?'下':'上'}公差不可留空。`);
      d.tolerances[path][sign]=raw===''?0:Number(raw);
    }
  }
  d.trial_result=structuredClone(trialRecord);d.part_numbers=structuredClone(partNumbers);
  d.copper.hole_corners=[...document.querySelectorAll('[data-hole-corner]:checked')].map(e=>e.dataset.holeCorner);
  d.pcb.opening_mode=$('pcb-auto').checked?'auto':'manual';d.pcb.opening_rule=$('pcb-rule').value;
  d.boss.size_mode=$('boss-size-auto').checked?'auto':'manual';d.boss.height_mode='auto';
  return d;
}
function fill(d){
  trialRecord=structuredClone(d.trial_result??emptyTrial());partNumbers=structuredClone(d.part_numbers??emptyPartNumbers());renderPartNumber();
  projectMetadataValid=true;$('name').value=d.name;
  $('project-name').value=d.project?.name??d.name??'未命名專案';$('project-id').value=d.project?.project_id??'';$('pa-brand').value=d.project?.pa_brand??'';$('pa-model').value=d.project?.pa_model??defaults.project?.pa_model??'H-37248KC-6/2';
  for(const path of allPaths){const[group,key]=path.split('.');inputFor(path).value=d[group][key]??'';const pair=getTolerance(d,path);for(const sign of ['minus','plus'])$(`tol-${path.replace('.','-')}-${sign}`).value=unknownTolerance(path)&&pair[sign]===0?'':pair[sign];}
  document.querySelectorAll('[data-hole-corner]').forEach(e=>e.checked=(d.copper.hole_corners??defaults.copper.hole_corners).includes(e.dataset.holeCorner));
  $('pcb-auto').checked=d.pcb.opening_mode==='auto';$('pcb-rule').value=d.pcb.opening_rule;
  $('boss-size-auto').checked=d.boss.size_mode==='auto';
  tolerancesUnlocked=false;updateToleranceLock();syncLinkedFields(d);
}
function derivedValue(path,value,readonly,title){const input=inputFor(path);if(!input)return;input.readOnly=readonly;input.setAttribute('aria-readonly',String(readonly));input.title=title||'';if(readonly){input.value=Number(value.toFixed(6));const[group,key]=path.split('.');return[key,value,group];}}
function syncLinkedFields(d){
  const auto=d.pcb.opening_mode==='auto',chain=openingRecommendation(d);
  for(const[i,key]of ['opening_length','opening_width'].entries()){
    const path=`pcb.${key}`;derivedValue(path,chain.rounded[i],auto,auto?'自動依 PA 上公差與本欄開窗下公差推導；取消自動可修改設計尺寸（Typ.）。':'手動開窗尺寸');if(auto)d.pcb[key]=chain.rounded[i];
  }
  const sizeAuto=d.boss.size_mode==='auto';d.boss.height_mode='auto';
  for(const key of ['lead_solder','board_solder','flange_gap']){d.stack[key]=defaults.stack[key];derivedValue(`stack.${key}`,d.stack[key],true,'製程建議定值；L 由 PCB 板厚 C、小凸台高度 K 與 PA 支撐高度 SPH 自動計算。');}
  for(const [key,value]of [['length',ceilTenth(d.package.length)],['width',ceilTenth(d.package.width)]]){derivedValue(`boss.${key}`,value,sizeAuto,'I/H 依 PA 設計尺寸（Typ.）向上取至 0.1 mm；取消跟隨可修改。');if(sizeAuto)d.boss[key]=value;}
  const height=d.pcb.thickness+d.stack.lead_solder+d.stack.board_solder-d.package.support_height-d.stack.flange_gap+d.stack.pad_height;
  derivedValue('boss.total_height',height,true,'L 自動計算；調整 PCB 板厚 C 或小凸台高度 K，SPH 從 PA 封裝帶入。');d.boss.total_height=height;
  for(const key of ['length','width']){derivedValue(`preform.${key}`,d.boss[key],true,'錫片長寬跟隨中凸台 I/H。');d.preform[key]=d.boss[key];}
  d.preform.chamfer=chamferFor(d.copper.pad_size);d.preform.trial_delta=TRIAL_DELTA;
  derivedValue('preform.chamfer',d.preform.chamfer,true,'Y = round(2 × J + √2 × 0.2828, 2) mm；固定間隙基準，取兩位小數。');
  inputFor('preform.chamfer').value=d.preform.chamfer.toFixed(2);
  derivedValue('preform.trial_delta',TRIAL_DELTA,true,'三款試片固定採計算厚度 ±0.15 mm。');
  inputFor('preform.thickness_override').readOnly=true;inputFor('preform.thickness_override').setAttribute('aria-readonly','true');
  return d;
}
function status(text){$('status').textContent=text;}
function error(message){$('error').textContent=message;$('error').hidden=!message;}
function layoutFor(r){
  const c=r.design.copper,b=r.design.pcb;
  const key=JSON.stringify([c.base_length,c.base_width,c.corner_radius,c.hole_diameter,c.hole_edge_offset,c.hole_corners,b.opening_length,b.opening_width,b.relief_diameter,r.boss_center,r.design.layout]);
  if(key!==layoutKey){cachedLayout=layoutGeometry(r);layoutKey=key;}return cachedLayout;
}
function refreshPreview(showError=false){
  try{
    const r=calculate(syncLinkedFields(formValues())),layout=layoutFor(r);draft={results:r,layout};
    viewer.setDesign(r,layout);renderMetrics(r);$('viewer-placeholder').hidden=true;
    refreshExportButtons();$('viewer').dataset.previewValid='true';
    $('model-size').textContent=[['E',r.design.copper.base_length],['F',r.design.copper.base_width],['G',r.design.copper.base_thickness]].map(([name,value])=>formatDimension(name,value)).join(' · ');
    return draft;
  }catch(e){draft=null;viewer.clearAnnotation();$('preview-state').textContent='輸入無效 · 保留上次有效示意';refreshExportButtons();$('viewer').dataset.previewValid='false';if(showError)error(e.message);status(`參數未完成：${e.message}`);return null;}
}
function invalidate(){
  revision++;result=null;error('');refreshExportButtons();
  document.body.classList.remove('ready');$('viewer').dataset.ready='false';$('preview-state').textContent='即時預覽 · 出圖待更新';
  clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(refreshPreview())status('預覽已更新；按「建立出圖模型」後下載3D零件');},140);
}

// Only this controller knows about the browser repository. CAD calculations
// continue to use a complete Design object, ready for a future backend adapter.
function syncProjectMetadata(){
  const project=normalizeProject({name:$('project-name').value.trim(),project_id:$('project-id').value.trim(),pa_brand:$('pa-brand').value.trim(),pa_model:$('pa-model').value.trim()});
  for(const value of [result,draft])if(value?.results?.design)value.results.design.project=structuredClone(project);
  projectMetadataValid=true;refreshExportButtons();
  return project;
}
function markDirty(message='有未儲存的變更'){projectDirty=true;projectMessage(message);}
function projectMessage(message,failed=false){spSync.setEditing(projectDirty?activeProjectId:null);const output=$('project-save-status');output.textContent=message;output.title=message;output.classList.toggle('save-error',failed);}
function refreshProjectList(){
  const select=$('project-select'),placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='載入已儲存專案…';
  select.replaceChildren(placeholder);
  for(const record of projectStore.list()){
    const option=document.createElement('option');option.value=record.id;
    const project=record.design.project;option.textContent=`${project?.name||record.design.name}${project?.project_id?'（'+project.project_id+'）':''}${project?.pa_model?' · '+project.pa_model:''}`;select.append(option);
  }
  select.value=activeProjectId||'';$('project-delete').disabled=!activeProjectId;
}
function submitProjectModel(){if(busy)rebuildQueued=true;else $('design-form').requestSubmit();}
function saveProject(asNew=false){
  try{
    clearTimeout(previewTimer);const design=calculate(syncLinkedFields(formValues())).design;
    const record=projectStore.save(design,{id:asNew?null:activeProjectId});activeProjectId=record.id;activeRecordStamp=record.updated_at;
    $('project-name').value=design.project.name;$('project-id').value=design.project.project_id;$('pa-brand').value=design.project.pa_brand;$('pa-model').value=design.project.pa_model;syncProjectMetadata();refreshProjectList();
    projectDirty=false;projectMessage(`已儲存 ${new Date(record.updated_at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`);return record;
  }catch(e){projectMessage(e.message,true);return null;}
}
function initializeProjects(){
  fill(structuredClone(defaults));
  try{
    const record=projectStore.active();
    if(record){const design=calculate(record.design).design;fill(design);activeProjectId=record.id;activeRecordStamp=record.updated_at;projectDirty=false;projectMessage('已恢復最近儲存專案');}
    refreshProjectList();
  }catch(e){projectMessage(e.message,true);$('project-delete').disabled=true;}
}
// Projects changed underneath the editor: a database file was opened / re-read, or
// SharePoint delivered colleagues' changes. The active project is reloaded only when
// it has no unsaved edits (the sync engine never replaces it while it is being edited).
projectStore.on('change',info=>{
  refreshProjectList();
  if(!activeProjectId)return;
  const record=projectStore.get(activeProjectId);
  if(!record){activeProjectId=null;refreshProjectList();projectMessage(info.source==='sharepoint'?'此專案已在 SharePoint 被刪除；畫面內容保留':'資料庫中沒有此專案；畫面內容保留');return;}
  const touched=info.source==='file'||(info.pulled||[]).includes(activeProjectId)||(info.restored||[]).includes(activeProjectId);
  if(!touched||projectDirty||record.updated_at===activeRecordStamp)return;
  try{fill(calculate(record.design).design);activeRecordStamp=record.updated_at;projectDirty=false;projectMessage(info.source==='sharepoint'?'已載入同事在 SharePoint 更新的版本':'已從資料庫檔案載入');invalidate();submitProjectModel();}
  catch(e){projectMessage(e.message,true);}
});
const storageUI=setupStorageUI({db:projectStore,fileDb:localFile,sp:spSync,onNotice:message=>projectMessage(message)});
$('project-save').addEventListener('click',()=>saveProject());
$('project-save-as').addEventListener('click',()=>saveProject(true));
$('project-select').addEventListener('change',()=>{
  const id=$('project-select').value;if(!id)return;
  try{
    const record=projectStore.get(id);if(!record)throw new Error('找不到這個專案。');
    const design=calculate(record.design).design;projectStore.activate(id);activeProjectId=id;activeRecordStamp=record.updated_at;fill(design);refreshProjectList();
    projectDirty=false;projectMessage('已載入儲存專案');invalidate();submitProjectModel();
  }catch(e){projectMessage(e.message,true);}
});
$('project-delete').addEventListener('click',()=>{
  if(!activeProjectId)return;
  try{projectStore.remove(activeProjectId);activeProjectId=null;refreshProjectList();projectMessage('已刪除記錄，畫面內容保留');}
  catch(e){projectMessage(e.message,true);}
});

$('design-form').addEventListener('input',event=>{
  if(['project-name','project-id','pa-brand','pa-model'].includes(event.target.id)){
    try{syncProjectMetadata();markDirty();}
    catch(e){projectMetadataValid=false;refreshExportButtons();projectMessage(e.message,true);}
    return;
  }
  invalidate();markDirty();
});
$('pcb-auto').addEventListener('change',()=>{clearTimeout(previewTimer);refreshPreview(true);});
$('pcb-rule').addEventListener('change',()=>{clearTimeout(previewTimer);refreshPreview(true);});
$('boss-size-auto').addEventListener('change',()=>{clearTimeout(previewTimer);refreshPreview(true);});
$('boss-center').addEventListener('click',()=>{inputFor('boss.center_from_left').value=Number(inputFor('copper.base_length').value)/2;inputFor('boss.center_from_bottom').value=Number(inputFor('copper.base_width').value)/2;invalidate();refreshPreview(true);});
$('tolerance-unlock').addEventListener('click',()=>{tolerancesUnlocked=!tolerancesUnlocked;updateToleranceLock();});
$('design-form').addEventListener('focusin',event=>{
  if(event.target.type==='number'){
    clearTimeout(previewTimer);refreshPreview();if(event.target.classList.contains('tolerance-input'))viewer.selectTolerance(event.target.dataset.fieldKey);else viewer.selectDimension(event.target.name);
  }
});
for(const mode of ['assembly','copper','preform','layout'])$(`tab-${mode}`).addEventListener('click',()=>{
  viewer.setMode(mode);if(['copper','preform','layout'].includes(mode))selectExportPart(mode);
});
$('export-part').addEventListener('change',event=>selectExportPart(event.target.value));
for(const component of ['copper','preform','pcb','pa','epad'])$(`ref-${component}`).addEventListener('change',event=>viewer.setReference(component,event.target.checked));
for(const component of ['copper','preform','pcb','pa','epad']){
 const label=$(`ref-${component}`).closest('label'),button=document.createElement('button');button.type='button';button.className='transparency-toggle';button.dataset.transparency=component;button.textContent='◐';button.setAttribute('aria-label',`${label.textContent.trim()}透明切換`);button.setAttribute('aria-pressed',String(viewer.transparent[component]));button.title='切換半透明／實體（保留零件顯示）';label.insertAdjacentElement('afterend',button);button.addEventListener('click',()=>{viewer.setTransparency(component,!viewer.transparent[component]);button.setAttribute('aria-pressed',String(viewer.transparent[component]));});
}
$('explode').addEventListener('change',event=>viewer.setExploded(event.target.checked));
for(const view of ['iso','iso-bottom',...faceViews])$(`view-${view}`).addEventListener('click',()=>viewer.setView(view));
$('view-orthographic').addEventListener('click',()=>viewer.setView(viewer.lastOrthographicView||'top'));
$('view-grid').addEventListener('click',()=>{viewer.setGridVisible(!viewer.grid?.visible);$('view-grid').setAttribute('aria-pressed',String(viewer.grid?.visible??false));});
$('dimension-clear').addEventListener('click',()=>{viewer.key=null;viewer.clearAnnotation();});
$('dimension-fit').addEventListener('click',()=>{if(viewer.key){if(viewer.toleranceFocus===viewer.key)viewer.selectTolerance(viewer.key);else viewer.selectDimension(viewer.key);}});
$('calculation-guide-open').addEventListener('click',showCalculationGuide);
$('help-open').addEventListener('click',()=>{$('settings-dialog').close();$('help-dialog').showModal();});
$('help-close').addEventListener('click',()=>$('help-dialog').close());
$('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog'))$('help-dialog').close();});
function renderTrial(r){
  const labels=['下','中','上'];$('trial-candidates').replaceChildren(...r.trial_thicknesses.map((v,i)=>{const el=document.createElement('span');el.textContent=`${labels[i]} ${v.toFixed(2)}`;el.classList.toggle('selected',trialChoices[i]===trialRecord.choice);return el;}));
  $('trial-choice').replaceChildren(...r.trial_thicknesses.map((v,i)=>{const el=document.createElement('option');el.value=trialChoices[i];el.textContent=`${labels[i]}：${v.toFixed(2)} mm`;return el;}));$('trial-choice').value=trialRecord.choice;$('trial-choice').disabled=trialRecord.locked;
  $('trial-lock').textContent=trialRecord.locked?'🔒':'🔓';$('trial-lock').setAttribute('aria-pressed',String(trialRecord.locked));$('trial-lock').title=trialRecord.locked?'解鎖後重新選定試片':'鎖定並儲存此案的驗證結果';
  $('trial-result-status').textContent=r.trial_status==='stale'?`尺寸已變更；原記錄 ${trialRecord.value.toFixed(2)} mm，請解鎖重新驗證。`:r.trial_status==='locked'?`已鎖定 ${trialRecord.value.toFixed(2)} mm`:'未鎖定 · 選定並驗證後按鎖頭';$('trial-result-status').dataset.status=r.trial_status;
  document.querySelector('.trial-selection').dataset.status=r.trial_status;
  inputFor('preform.thickness_override').value=r.model_thickness.toFixed(2);
  const zTolerance=toleranceSuffix(r.design,'preform.thickness_override');$('thickness-tolerance-text').textContent=zTolerance?`${zTolerance} mm`:'公差未指定';
}
$('trial-choice').addEventListener('change',()=>{trialRecord.choice=$('trial-choice').value;invalidate();refreshPreview(true);markDirty();});
// Locking records the verified trial. It is written to storage immediately only
// when it is the sole change to an already saved project; otherwise it would
// silently persist unrelated edits or create a project, so the user saves.
$('trial-lock').addEventListener('click',()=>{
  const previous=structuredClone(trialRecord),wasDirty=projectDirty;
  try{
    if(trialRecord.locked)trialRecord={...emptyTrial(),choice:trialRecord.choice};
    else{const r=calculate(syncLinkedFields(formValues()));trialRecord={choice:trialRecord.choice,locked:true,value:r.model_thickness,signature:r.trial_signature,confirmed_at:new Date().toISOString()};}
    invalidate();refreshPreview(true);
    const action=trialRecord.locked?'試片已鎖定':'試片已解鎖';
    if(activeProjectId&&!wasDirty){if(!saveProject())throw new Error('試片結果無法儲存，已保留原鎖定狀態；請確認瀏覽器儲存空間。');projectMessage(`${action}並儲存`);}
    else markDirty(`${action}，尚未儲存；請按「儲存」${activeProjectId?'':'建立專案'}保存`);
    submitProjectModel();
  }catch(e){trialRecord=previous;projectDirty=wasDirty;refreshPreview();error(e.message);}
});
function renderMetrics(r){
  renderTrial(r);
  for(const[id,v,digits]of [['metric-l',r.boss_total_height,4],['metric-z',r.calculated_thickness,6],['metric-model',r.model_thickness,6],['metric-volume',r.solder_volume,3],['v-cavity',r.cavity_volume,3],['v-boss',r.boss_volume,3],['v-area',r.preform_area,3]])$(id).textContent=v.toFixed(digits);
  $('trials').textContent=r.trial_thicknesses.map(v=>v.toFixed(4)).join(' / ')+' mm';
  $('warnings').replaceChildren(...r.warnings.map(message=>{const li=document.createElement('li');li.textContent=message;return li;}));
  $('layout-summary').textContent=[['R',r.design.layout.border_width],['S',r.design.layout.epad_size],['T',r.design.layout.web_width],['V',r.design.layout.hole_clearance]].map(([name,value])=>formatDimension(name,value,{prefix:name==='V'?'⌀':''})).join(' / ');
  const maximum=r.pa_envelope?[r.pa_envelope.max_length,r.pa_envelope.max_width]:r.opening_chain.maximum;
  $('package-derived').replaceChildren();maximum.forEach((value,index)=>{if(index)$('package-derived').append('；');$('package-derived').append(formatDimension(index?'PA(Wmax)':'PA(Lmax)',value));formulaHelp($('package-derived'),index?'pa-wmax':'pa-lmax',index?'PA 最大寬度':'PA 最大長度');});
  $('copper-derived').textContent=formatDimension('HSK 槽深',r.heatsink_depth,{tolerance:'±0.05'});formulaHelp($('copper-derived'),'hsk-depth','HSK 深度');
  $('stack-derived').textContent=`L = C + 0.1 + 0.1 − SPH − 0.3 + K = ${r.boss_total_height.toFixed(4)} mm`;formulaHelp($('stack-derived'),'stack-total','中凸台總高');
  $('boss-derived').textContent=`中凸台下段高 = ${r.boss_lower_height.toFixed(4)} mm`;formulaHelp($('boss-derived'),'boss-lower','中凸台下段高度');$('boss-derived').append(`；中凸台總高 L = ${r.boss_total_height.toFixed(4)} mm`);formulaHelp($('boss-derived'),'boss-upper','小凸台頂面總高');
  $('opening-chain').textContent=`${r.design.pcb.opening_mode==='auto'?'自動':'建議'} ${formatDimension('M',r.recommended_opening[0])}；${formatDimension('N',r.recommended_opening[1])}（${r.design.pcb.opening_rule==='delta'?'Delta':'Ampleon'}）`;
  const gaps=r.gap_analysis;
  if(gaps){
    for(const axis of ['x','y'])for(const value of ['nominal','min','max']){
      const cell=$(`gap-${axis}-${value}`),number=gaps[axis][value];cell.textContent=number.toFixed(4);cell.classList.toggle('interference',number<0);
    }
    $('gap-state').textContent=gaps.overlap?'可能干涉':'尺寸範圍';$('gap-state').classList.toggle('interference',gaps.overlap);
    $('gap-assumptions').textContent='PA／PCB 開窗固定同心。單位 mm。';
    $('gap-analysis').dataset.interference=String(gaps.overlap);
  }
  for(const path of allPaths){const row=inputFor(path).closest('.dimension-row'),source=toleranceSource(r.design,path),manual=source==='手動設定';row.title=`${titleFor(path)}；公差 ${toleranceText(r.design,path)}；來源：${source}`;row.querySelector('.tolerance-source').title=manual?`手動設定${unknownTolerance(path)?'／原資料未指定':'／原始來源：'+sourceFor(path)}`:unknownTolerance(path)?'原資料未指定公差；分析暫按 0，解鎖後可輸入。':sourceFor(path);for(const input of row.querySelectorAll('.tolerance-input'))input.title=`${source}${manual&&unknownTolerance(path)?'／原資料未指定':''}；${input.dataset.toleranceSide==='minus'?'下':'上'}偏差（輸入非負值）`;}
  renderFormulaHelp(r);
}
function renderFormulaHelp(r){
  const d=r.design,b=d.pcb,p=d.package,c=d.copper,s=d.stack,t=d.preform,f=v=>Number(v.toFixed(6)).toString();
  setFormula('preform.chamfer',`Y = round(2 × J + √2 × 0.2828, 2)
= round(2 × ${f(c.pad_size)} + √2 × 0.2828, 2) = ${t.chamfer.toFixed(2)} mm
採第11頁的45°幾何關係；間隙基準依目前設計設定為0.2828 mm。
Y四捨五入到小數第二位，實際間隙 = ${f(r.corner_clearance)} mm。`);
  setFormula('preform.trial_delta','三款試片：Z − 0.15、Z、Z + 0.15 mm。增減量固定；製造公差另行設定。');
  const height=`L = C + A + B − SPH − D + K\n= ${f(b.thickness)} + ${f(s.lead_solder)} + ${f(s.board_solder)} − ${f(p.support_height)} − ${f(s.flange_gap)} + ${f(s.pad_height)} = ${f(r.boss_total_height)} mm\nA/B/D 為製程建議定值；調整 C、K，SPH 由 PA 帶入。`;
  for(const id of ['boss.total_height','metric-l','stack-total','boss-upper'])setFormula(id,height);
  for(const[index,key]of ['opening_length','opening_width'].entries()){
    const axis=index?'W':'L',pa=index?p.width:p.length,paTol=getTolerance(d,index?'package.width':'package.length'),windowTol=getTolerance(d,`pcb.${key}`),factor=r.opening_chain.factor,raw=r.opening_chain.raw[index],rounded=r.recommended_opening[index];
    setFormula(`pcb.${key}`,`${index?'N':'M'} = PA(${axis}) + PA 上偏差 + 貼片機能力常數 + 開窗下偏差${factor===.5?' / 2':''}，再向上取到 0.1 mm\n= ${f(pa)} + ${f(paTol.plus)} + ${f(r.opening_chain.placement_allowance??.066)} + ${f(windowTol.minus)}${factor===.5?' / 2':''} = ${f(raw)} → ${f(rounded)} mm\n常數來自 PPT 第8頁；下偏差補償開窗加工縮小，不作為貼片位置的尺寸公差。`,b.opening_mode==='auto');
    const value=index?r.boss_width:r.boss_length;
    setFormula(`boss.${index?'width':'length'}`,`${index?'H':'I'} = PA(${axis}) 向上取到 0.1 mm\n= ceil(${f(pa)} × 10) / 10 = ${f(value)} mm\n使用 PA 設計尺寸（Typ.），不加封裝公差。`,d.boss.size_mode==='auto');
    setFormula(`preform.${index?'width':'length'}`,`${index?'X':'W'} = 中凸台${index?'寬度 H':'長度 I'} = ${f(value)} mm\n錫片長寬跟隨中凸台；各自的製造公差仍分別設定。`);
    setFormula(index?'pa-wmax':'pa-lmax',`PA(${axis}max) = PA(${axis}) + 上偏差\n= ${f(pa)} + ${f(paTol.plus)} = ${f(pa+paTol.plus)} mm\n最大封裝外框以虛線表示。`);
  }
  setFormula('boss.center_from_left',`Xc 是從基座左外邊到中凸台中心的手動定位尺寸。\n按「置中」時計算 Xc = E / 2 = ${f(c.base_length)} / 2 = ${f(c.base_length/2)} mm。\n目前 Xc = ${f(d.boss.center_from_left)} mm；相對基座中心偏移 = ${f(r.boss_center[0])} mm。`);
  setFormula('boss.center_from_bottom',`Yc 是從基座下外邊到中凸台中心的手動定位尺寸。\n按「置中」時計算 Yc = F / 2 = ${f(c.base_width)} / 2 = ${f(c.base_width/2)} mm。\n目前 Yc = ${f(d.boss.center_from_bottom)} mm；相對基座中心偏移 = ${f(r.boss_center[1])} mm。`);
  setFormula('boss-lower',`中凸台下段高度 = L − K\n= ${f(r.boss_total_height)} − ${f(s.pad_height)} = ${f(r.boss_lower_height)} mm。`);
  setFormula('hsk-depth',`在 HSK（散熱器）對應銅塊的位置加工凹槽，容納銅塊基座。\n槽深設計值 = 銅塊基座厚度 G + 0.05 mm\n= ${f(c.base_thickness)} + 0.05 = ${f(r.heatsink_depth)} mm。\n此 HSK 槽深的加工公差為 ±0.05 mm；允許深度 ${f(r.heatsink_depth-.05)}～${f(r.heatsink_depth+.05)} mm。`);
  const cavity=`V₁₋₁ = [M × N + Aₒ] × (L + D − K)\nAₒ = 4 個外側半圓 = 4 × ½π × (${f(b.relief_diameter)} / 2)² = ${f(r.relief_area)} mm²（同側重疊時扣除）\n= [${f(b.opening_length)} × ${f(b.opening_width)} + ${f(r.relief_area)}] × ${f(r.copper_to_flange)} = ${f(r.cavity_volume)} mm³\n避空面積依 PCB 開孔實際輪廓（PPT 第7／9頁）；PPT 第12頁原式只計一個整圓。`;
  const boss=`V₂ = I × H × (L − K) + 4 × J² × K\n= ${f(r.boss_length)} × ${f(r.boss_width)} × ${f(r.boss_lower_height)} + 4 × ${f(c.pad_size)}² × ${f(s.pad_height)} = ${f(r.boss_volume)} mm³。`;
  const volume=`V₁ = V₁₋₁ − V₂\n= ${f(r.cavity_volume)} − ${f(r.boss_volume)} = ${f(r.solder_volume)} mm³。`;
  const area=`A₁ = W × X − 2 × Y²\n= ${f(t.length)} × ${f(t.width)} − 2 × ${f(t.chamfer)}² = ${f(r.preform_area)} mm²。`;
  const z=`Z = (V₁₋₁ − V₂) / A₁\n= (${f(r.cavity_volume)} − ${f(r.boss_volume)}) / ${f(r.preform_area)} = ${f(r.calculated_thickness)} mm\n依設計尺寸（Typ.）做體積扣除估算；最終厚度由製程切片選定。\n點選 ? 開啟全螢幕體積圖解與尺寸定位。`;
  setFormula('v-cavity',cavity);setFormula('v-boss',boss);setFormula('v-area',area);setFormula('metric-volume',volume);setFormula('metric-z',z);setFormula('metric-model',t.thickness_override===null?`模型 Z 自動採用計算 Z = ${f(r.calculated_thickness)} mm。\n點選 ? 開啟全螢幕體積圖解與尺寸定位。`:`模型 Z 使用目前選定試片 = ${f(r.model_thickness)} mm。\n計算 Z = ${f(r.calculated_thickness)} mm，保留作比較。\n點選 ? 開啟全螢幕體積圖解與尺寸定位。`);
  setFormula('trials',`三款試片厚度 = 計算 Z − 增減量、Z、Z + 增減量\n= ${f(r.calculated_thickness)} − ${f(t.trial_delta)}、${f(r.calculated_thickness)}、${f(r.calculated_thickness)} + ${f(t.trial_delta)}\n= ${r.trial_thicknesses.map(f).join(' / ')} mm。`);
  for(const axis of ['x','y']){
    const g=r.gap_analysis[axis],window=g.window,pa=g.pa;
    setFormula(`gap-${axis}-nominal`,`Typ. 單邊間隙 = (開窗設計尺寸 − PA 底座設計尺寸) / 2\n= (${f(window.nominal)} − ${f(pa.nominal)}) / 2 = ${f(g.nominal)} mm\nPA 與 PCB 開窗固定同心；此處計算尺寸公差的間隙範圍。`);
    setFormula(`gap-${axis}-min`,`最小單邊間隙 = (開窗最小尺寸 − PA 底座最大尺寸) / 2\n= (${f(window.min)} − ${f(pa.max)}) / 2 = ${f(g.min)} mm\n開窗最小 = 設計尺寸（Typ.） − 下偏差；PA 最大 = 設計尺寸（Typ.） + 上偏差。\nPA／PCB 開窗固定同心；負值表示可能干涉。`);
    setFormula(`gap-${axis}-max`,`最大單邊間隙 = (開窗最大尺寸 − PA 底座最小尺寸) / 2\n= (${f(window.max)} − ${f(pa.min)}) / 2 = ${f(g.max)} mm\n開窗最大 = 設計尺寸（Typ.） + 上偏差；PA 最小 = 設計尺寸（Typ.） − 下偏差。\nPA／PCB 開窗固定同心。`);
  }
  if(activeFormulaButton)showFormula(activeFormulaButton);
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
  result=null;refreshExportButtons();$('viewer').dataset.ready='false';
  const valid=refreshPreview(true);if(!valid)return;
  const current=revision;
  if(valid.results.trial_status==='stale'){error('設計尺寸已變更，請先解鎖舊試驗結果，再建立新試片模型。');return;}
  try{
    busy=true;$('generate').disabled=true;status('開始建立出圖模型…');
    const model=await requestModel(valid.results.design);
    if(current!==revision){status('參數已變更，請重新建立出圖模型');return;}
    result={...model,layout:valid.layout};draft={results:model.results,layout:valid.layout};
    try{syncProjectMetadata();}catch(e){projectMetadataValid=false;projectMessage(e.message,true);}
    viewer.setDesign(model.results,valid.layout,model.parts);renderMetrics(model.results);
    document.body.classList.add('ready');$('viewer').dataset.ready='true';$('preview-state').textContent='出圖模型已驗證';
    refreshExportButtons();status('銅塊／錫片：單一實體、體積與 STEP 回讀通過');
  }catch(e){if(current===revision){error(e.message);status('出圖模型建立失敗；可修正參數後重建');}}
  finally{busy=false;$('generate').disabled=false;if(rebuildQueued){rebuildQueued=false;$('design-form').requestSubmit();}}
});
// Output names: 專案名稱_Copper_Coin_日期 / 專案名稱_Solder_Preform_日期 /
// 專案名稱_Coin_Solder_Masker_日期 (file-names.js).
const fileName=(which,extension,suffix)=>outputFileName($('project-name').value,which,extension,{suffix});
// The 2D drawings (company format of drawing 348001J40001) share one template,
// fetched once on the first export. The cover and watermark choices are remembered.
const COVER_KEY='pa-copper-cad.drawing-cover',WATERMARK_KEY='pa-copper-cad.drawing-watermark';
let drawingTemplate=null;
function loadDrawingTemplate(){
  drawingTemplate??=fetch(base+DRAWING_TEMPLATE_PATH).then(response=>{
    if(!response.ok)throw new Error(`圖面範本下載失敗（${response.status}），請重新整理網站。`);
    return response.json();
  }).catch(e=>{drawingTemplate=null;throw e;});
  return drawingTemplate;
}
const remembered=(key,checkbox)=>{try{const stored=localStorage.getItem(key);if(stored!==null)$(checkbox).checked=stored==='1';}catch{/* storage unavailable: keep the default */}
  $(checkbox).addEventListener('change',event=>{try{localStorage.setItem(key,event.target.checked?'1':'0');}catch{/* not remembered */}});};
remembered(COVER_KEY,'drawing-cover');remembered(WATERMARK_KEY,'drawing-watermark');
const drawingText=(which,r,template,cover=$('drawing-cover').checked)=>(which==='preform'?preformDrawingText:copperDrawingText)(r,template,{cover});
const drawingDxf=(which,r,template)=>encodeDxf(drawingText(which,r,template)); // Big5 bytes, as the reference
let pdfModule=null;const loadPdf=()=>(pdfModule??=import('./dxf-pdf.js').catch(e=>{pdfModule=null;throw e;}));
/** The watermark for PDFs when 「浮水印」 is ticked; an error when none was uploaded. */
async function pdfWatermark(){
  const box=$('drawing-watermark');if(!box.checked||box.disabled)return null; // disabled: nothing uploaded yet
  const record=await watermarkStore.load();
  if(!record)throw new Error('尚未上傳浮水印檔案：請到「設定 → 浮水印」上傳，或取消勾選「浮水印」。');
  return (await loadPdf()).loadWatermark(record.bytes);
}
async function drawingPdfBytes(which,r,template,watermark){
  const{drawingPdf}=await loadPdf(),cover=$('drawing-cover').checked;
  return drawingPdf(drawingText(which,r,template,cover),template,{cover,watermark,appearance:watermarkStore.appearance(),title:fileName(which,'pdf').replace(/\.pdf$/,'')});
}
async function runExport(id,task){
  exportsRunning.add(id);refreshExportButtons();
  try{await task();}catch(e){error(e.message);}finally{exportsRunning.delete(id);refreshExportButtons();}
}
$('download-drawing').addEventListener('click',()=>runExport('download-drawing',async()=>{
  clearTimeout(previewTimer);const current=refreshPreview(true);if(!current)return;
  try{save(drawingDxf(part,current.results,await loadDrawingTemplate()),fileName(part,'dxf'));}
  catch(e){throw new Error(`2D 圖面產生失敗：${e.message}`);}
}));
$('download-drawing-pdf').addEventListener('click',()=>runExport('download-drawing-pdf',async()=>{
  clearTimeout(previewTimer);const current=refreshPreview(true);if(!current)return;
  try{const template=await loadDrawingTemplate(),watermark=await pdfWatermark();save(new Blob([await drawingPdfBytes(part,current.results,template,watermark)],{type:'application/pdf'}),fileName(part,'pdf'));}
  catch(e){throw new Error(`2D 圖面 PDF 產生失敗：${e.message}`);}
}));
function save(data, name) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('download-step').addEventListener('click', () => { if (result&&part!=='layout') save(result.parts[part].step, fileName(part,'step')); });
$('download-dxf').addEventListener('click', () => {
  if(part==='layout'){clearTimeout(previewTimer);const current=refreshPreview(true);if(current)save(layoutDxf(current.results,current.layout),fileName('layout','dxf'));return;}
  if (result) save(drawing(result.results, part), fileName(part,'dxf','outline'));
});
const json = obj => JSON.stringify(obj, null, 2) + '\n';
$('download-zip').addEventListener('click', () => runExport('download-zip', async () => {
  if (!result) return;
  const snapshot = result;
  try {
    const r = snapshot.results, files = {}, template = await loadDrawingTemplate(), watermark = await pdfWatermark().catch(() => null), sheet = { cover: $('drawing-cover').checked };
    files[fileName('layout','dxf')] = strToU8(layoutDxf(r, snapshot.layout));
    const drawings = {};
    for (const [name, model] of Object.entries(snapshot.parts)) {
      files[fileName(name,'dxf')] = drawingDxf(name, r, template);
      files[fileName(name,'pdf')] = await drawingPdfBytes(name, r, template, watermark);
      files[fileName(name,'step')] = new Uint8Array(await model.step.arrayBuffer());
      files[fileName(name,'stl')] = new Uint8Array(await model.stl.arrayBuffer());
      files[fileName(name,'dxf','outline')] = strToU8(drawing(r, name));
      const number = titleBlockPartNumber(r.design, name), view = name === 'preform' ? preformDrawingLayout(r) : drawingLayout(r);
      drawings[name] = { dxf: fileName(name,'dxf'), pdf: fileName(name,'pdf'), part_no: number.partNo, rev: number.rev, part_number: number.full || null, view_scale: view.label, ...(name === 'copper' ? { detail_scale: view.detail.label } : { drawn_thickness: drawnThickness(r) }) };
    }
    const report = { schema_version: 3, created_at_utc: new Date().toISOString(), engine: 'OpenCascade WebAssembly / Replicad', units: { length: 'mm', area: 'mm2', volume: 'mm3' },
      parameters: r.design, results: r, verification: snapshot.verification,
      cad_volumes_mm3: Object.fromEntries(Object.entries(snapshot.parts).map(([key, v]) => [key, v.volume])),
      native_prt: { status: 'not_generated', required_model_type: 'native_parametric_features', target: 'Creo Parametric 7.0.10.0 / Windows 11', reason: 'Requires local licensed Creo and real native parametric master models.' } };
    report.reference_geometry = { pcb: 'display_only', pa: 'display_only', note: 'PA casing/flange and six pins follow illustrative datasheet proportions; SPH fixes the lead reference plane. Only PA length, width, tolerance and SPH affect manufacturing calculations.' };
    report.layout = { file: fileName('layout','dxf'), ...layoutReport(snapshot.layout, r) };
    report.drawings = { format: 'Delta drawing format of 348001J40001 (DXF R2000, PDF A4)', cover_sheet: sheet.cover, sheets: sheet.cover ? 2 : 1, watermark: watermark ? 'behind page content' : 'none', ...drawings };
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
    save(zipSync(files, { level: 6 }), fileName('bundle','zip'));
  } catch (e) { throw new Error(`打包失敗：${e.message}`); }
}));

// ───── part numbers (料號): 10-character base + REV, per drawn part, lockable ─────
$('part-rev').replaceChildren(...REVISIONS.map(rev=>{const option=document.createElement('option');option.value=rev;option.textContent=`REV ${rev}`;return option;}));
function selectExportPart(value){
  part=value;$('export-part').value=value;renderPartNumber();refreshExportButtons();
}
function renderPartNumber(){
  const drawn=part!=='layout',group=$('part-number-group');group.hidden=!drawn;
  for(const id of ['drawing-cover','drawing-watermark'])$(id).closest('label').classList.toggle('inactive',!drawn);
  if(!drawn)return;
  const entry=partNumbers[part],input=$('part-no'),complete=entry.part_no.length===PART_NO_BASE_LENGTH;
  $('part-no-label').textContent=`${PART_LABELS[part]}料號`;
  if(input.value!==entry.part_no)input.value=entry.part_no;
  input.readOnly=entry.locked;input.setAttribute('aria-readonly',String(entry.locked));$('part-rev').value=entry.rev;$('part-rev').disabled=entry.locked;
  $('part-lock').textContent=entry.locked?'🔒':'🔓';$('part-lock').setAttribute('aria-pressed',String(entry.locked));
  $('part-lock').disabled=!entry.locked&&!complete;
  $('part-lock').title=entry.locked?'解鎖後可修改料號':complete?'鎖定料號（隨專案儲存）':'填滿前 10 碼後可鎖定';
  const full=fullPartNumber(entry),out=$('part-no-full');
  out.textContent=full?`= ${full}`:entry.part_no?`${entry.part_no.length}/10`:'';
  out.title=full?`料號 ${full}：PART NO. ${entry.part_no}，REV ${entry.rev}`:'料號共 12 碼＝前 10 碼＋REV 2 碼；空白時圖面顯示 XXXXXXXXXX';
  group.dataset.state=entry.locked?'locked':full?'complete':entry.part_no?'partial':'empty';
}
function partNumberChanged(message){
  for(const value of [result,draft])if(value?.results?.design)value.results.design.part_numbers=structuredClone(partNumbers);
  renderPartNumber();markDirty(message);
}
$('part-no').addEventListener('input',event=>{
  const entry=partNumbers[part];if(entry.locked||part==='layout')return;
  // A pasted full 12-character number fills the 10-character base and the REV.
  const all=event.target.value.toUpperCase().replace(/[^0-9A-Z]/g,''),full=all.length===PART_NO_BASE_LENGTH+2&&REVISIONS.includes(all.slice(-2));
  const clean=full?all.slice(0,PART_NO_BASE_LENGTH):cleanPartNo(all);if(event.target.value!==clean)event.target.value=clean;
  entry.part_no=clean;if(full)entry.rev=all.slice(-2);partNumberChanged();
});
$('part-rev').addEventListener('change',event=>{const entry=partNumbers[part];if(entry.locked||part==='layout')return;entry.rev=event.target.value;partNumberChanged();});
// Locking writes to storage at once only when it is the sole change to a saved project.
$('part-lock').addEventListener('click',()=>{
  if(part==='layout')return;
  const entry=partNumbers[part],wasDirty=projectDirty;
  if(!entry.locked&&entry.part_no.length!==PART_NO_BASE_LENGTH)return;
  entry.locked=!entry.locked;
  const action=`${PART_LABELS[part]}料號已${entry.locked?'鎖定':'解鎖'}`;
  if(activeProjectId&&!wasDirty){partNumberChanged();if(saveProject())projectMessage(`${action}並儲存`);}
  else partNumberChanged(`${action}，尚未儲存；請按「儲存」${activeProjectId?'':'建立專案'}保存`);
});

// ───── watermark (設定 → 浮水印) ─────
const watermarkStore=new WatermarkStore({sp:spSync});
async function renderWatermark(){
  const record=await watermarkStore.cached(),appearance=watermarkStore.appearance();
  $('settings-wm-file').textContent=record?`${record.name}（${record.kind.toUpperCase()}，${(record.size/1024).toFixed(0)} KB，${new Date(record.updated_at).toLocaleString('zh-TW',{hour12:false})}）`:'尚未上傳';
  const places=['此瀏覽器'];if(watermarkStore.folderName())places.push(`本機 ${watermarkStore.folderName()}/Watermark`);if(spSync.isEnabled())places.push('SharePoint PA_Copper_CAD/Watermark');
  $('settings-wm-location').textContent=places.join('、');
  $('settings-wm-folder').textContent=watermarkStore.folderName()??'未設定';
  for(const[key,id]of [['scale','wm-scale'],['opacity','wm-opacity'],['rotation','wm-rotation']])if(document.activeElement!==$(id))$(id).value=appearance[key];
  $('wm-remove').disabled=!record;
  const box=$('drawing-watermark');box.disabled=!record;box.closest('label').title=record?'2D 圖面 PDF 打上浮水印（置於圖面內容之下）':'尚未上傳浮水印：設定 → 浮水印';
  box.closest('label').classList.toggle('unavailable',!record);
}
const wmMessage=(text,failed=false)=>{const out=$('settings-wm-message');out.textContent=text;out.classList.toggle('save-error',failed);};
$('wm-upload').addEventListener('click',()=>$('wm-file').click());
$('wm-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  wmMessage('上傳中…');
  try{const{saved,notes}=await watermarkStore.upload(file);wmMessage(`已儲存到：${saved.join('、')}${notes.length?`｜${notes.join('；')}`:''}`,notes.length>0);$('drawing-watermark').checked=true;}
  catch(e){wmMessage(e.message,true);}
  renderWatermark();
});
$('wm-folder').addEventListener('click',async()=>{const r=await watermarkStore.pickFolder();if(r.ok){const record=await watermarkStore.cached();if(record){const{saved,notes}=await watermarkStore.store(record);wmMessage(`已寫入：${saved.join('、')}${notes.length?`｜${notes.join('；')}`:''}`,notes.length>0);}else{const got=await watermarkStore.refresh();wmMessage(got.record?'已從本機資料夾讀取浮水印':'已設定本機資料夾');}}else if(r.reason!=='cancelled')wmMessage(r.message||'無法開啟資料夾',true);$('wm-folder-reconnect').hidden=true;renderWatermark();});
$('wm-folder-reconnect').addEventListener('click',async()=>{const r=await watermarkStore.reconnectFolder();$('wm-folder-reconnect').hidden=r.ok;if(r.ok)await watermarkStore.refresh();renderWatermark();});
$('wm-refresh').addEventListener('click',async()=>{wmMessage('讀取中…');try{const{record,found}=await watermarkStore.refresh({interactive:spSync.isEnabled()});wmMessage(record?`目前使用 ${record.name}${found.length?`（已比對 ${found.map(v=>v==='local'?'本機資料夾':'SharePoint').join('、')}）`:''}`:'資料夾中沒有浮水印檔案');}catch(e){wmMessage(e.message,true);}renderWatermark();});
$('wm-remove').addEventListener('click',async()=>{const{notes}=await watermarkStore.remove();wmMessage(notes.length?`已移除（${notes.join('；')}）`:'已移除浮水印檔案',notes.length>0);renderWatermark();});
const appearanceInputs=['wm-scale','wm-opacity','wm-rotation'];
for(const id of appearanceInputs)$(id).addEventListener('change',async()=>{const appearance=await watermarkStore.saveAppearance({scale:$('wm-scale').value,opacity:$('wm-opacity').value,rotation:$('wm-rotation').value});wmMessage(`外觀：相對頁面 ${appearance.scale}%、不透明度 ${appearance.opacity}%、旋轉 ${appearance.rotation}°`);renderWatermark();});
$('wm-defaults').addEventListener('click',async()=>{const appearance=await watermarkStore.saveAppearance({});wmMessage(`已恢復預設：相對頁面 ${appearance.scale}%、不透明度 ${appearance.opacity}%、旋轉 ${appearance.rotation}°`);renderWatermark();});
$('settings-open').addEventListener('click',renderWatermark);
(async()=>{const folder=await watermarkStore.tryRestoreFolder();$('wm-folder-reconnect').hidden=!folder.needsPermission;if(folder.needsPermission)$('settings-wm-folder').textContent=`${folder.name}（需要重新授權）`;await renderWatermark();
  // A newer watermark in the Watermark folders (another computer uploaded one) replaces this browser's copy.
  watermarkStore.refresh({interactive:false}).then(renderWatermark,()=>{});})();


initializeProjects();updateToleranceLock();refreshPreview();viewer.setView('iso');storageUI.start();
// The JavaScript preview is shown first; the OpenCascade WebAssembly engine
// (several MB) is fetched and the export model built once the page is idle.
const buildWhenIdle=()=>submitProjectModel();
if('requestIdleCallback' in window)requestIdleCallback(buildWhenIdle,{timeout:1500});else setTimeout(buildWhenIdle,200);
