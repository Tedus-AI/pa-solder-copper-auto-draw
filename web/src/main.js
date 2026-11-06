import './style.css';
import { zipSync, strToU8 } from 'fflate';
import { parse, stringify } from 'yaml';
import { defaults, fields, calculate, nativeJob, openingRecommendation, ceilTenth } from './design.js';
import { toleranceDefaults, getTolerance, toleranceText, toleranceSource } from './tolerances.js';
import { faceViews } from './camera-views.js';
import { formatDimension } from './dimension-format.js';
import { drawing } from './dxf.js';
import { layoutGeometry, layoutDxf } from './layout.js';
import { CADViewer } from './viewer.js';

const $ = id => document.getElementById(id), base = import.meta.env.BASE_URL;
let worker, pending, counter=0, revision=0, result=null, draft=null, part='copper', busy=false, previewTimer;
let layoutKey='', cachedLayout=null, tolerancesUnlocked=false;
const downloadButtons=['download-zip','download-dxf','download-step'];
const formulaButtons=new Map();let activeFormulaButton=null;
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
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();showFormula(button);});
    formulaButtons.set(id,button);
  }
  if(container&&button.parentElement!==container)container.append(button);return button;
}
function setFormula(id,text,visible=true){const button=formulaButtons.get(id);if(!button)return;button.dataset.formula=text;button.hidden=!visible;if(!visible&&activeFormulaButton===button)hideFormula();}
window.addEventListener('resize',hideFormula);
document.addEventListener('scroll',()=>{
  if(!activeFormulaButton)return;
  const rect=activeFormulaButton.getBoundingClientRect();
  // A tap can finish scrolling its focused control after the click event.
  // Keep an on-screen formula anchored instead of immediately dismissing it.
  if(rect.bottom<0||rect.top>innerHeight)hideFormula();else showFormula(activeFormulaButton);
},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideFormula();});document.addEventListener('pointerdown',event=>{if(!event.target.closest('.formula-help')&&!formulaTooltip.contains(event.target))hideFormula();});

$('creo-guide').href=`${base}WINDOWS_CREO7.md`;
// Compact visible labels retain the full quantity name in their formula help.
for(const[id,label]of [['metric-z','計算 Z ='],['metric-model','模型 Z ='],['metric-volume','錫量 V₁ =']])$(id).parentElement.querySelector('span').firstChild.textContent=label;
const toleranceLegend=$('tolerance-status').parentElement.querySelector('small');toleranceLegend.title=toleranceLegend.textContent;toleranceLegend.textContent='−／＋偏差；* 原資料未指定，空白暫按 0';

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
const compactCaptions={'boss.center_from_left':'距左邊 Xc','boss.center_from_bottom':'距下邊 Yc','preform.thickness_override':'指定錫厚 Z','stack.board_solder':'銅塊／PCB 錫厚 B'};
const unknownTolerance=path=>/未指定|未提供|unknown/i.test(sourceFor(path));
const uiGroups=[
  {id:'package',title:'PA 封裝',paths:groupPaths('package'),open:true},
  {id:'pcb',title:'PCB 開孔',paths:groupPaths('pcb'),open:true},
  {id:'copper',title:'銅塊基座',paths:groupPaths('copper').filter(path=>path!=='copper.pad_size'),open:true},
  {id:'boss',title:'中凸台／四角小凸台',paths:[...groupPaths('boss'),'copper.pad_size','stack.pad_height'].filter(hasPath),open:true},
  {id:'stack',title:'高度堆疊',paths:groupPaths('stack').filter(path=>path!=='stack.pad_height'),open:true},
  {id:'preform',title:'錫片設計',paths:groupPaths('preform'),open:false},
  {id:'layout',title:'綠漆／E-PAD',paths:groupPaths('layout'),open:false},
];
const controlColumns=[0,1].map(index=>{const column=document.createElement('div');column.className='control-column';column.dataset.column=index;$('fields').append(column);return column;});
for(const group of uiGroups){
  if(!group.paths.length)continue;
  const details=document.createElement('details');details.className='control-group';details.open=group.open;details.dataset.group=group.id;details.style.order=String(uiGroups.indexOf(group));
  const summary=document.createElement('summary');summary.textContent=group.title;details.append(summary);
  const grid=document.createElement('div');grid.className='field-grid tolerance-grid';
  const head=document.createElement('div');head.className='dimension-head';head.innerHTML='<span>尺寸 · mm</span><span>名義值</span><span>− 公差</span><span>＋ 公差</span>';grid.append(head);
  for(const path of group.paths){
    const[g,key]=path.split('.'),title=titleFor(path),row=document.createElement('div');row.className='dimension-row';row.dataset.dimension=path;
    const caption=document.createElement('label');caption.htmlFor=path.replace('.','-');caption.title=title;const captionText=document.createElement('span');captionText.className='dimension-caption';captionText.textContent=(compactCaptions[path]||title).replace(/ ±$/,'')+' =';caption.append(captionText);
    const source=document.createElement('span');source.className='tolerance-source'+(unknownTolerance(path)?' unspecified':'');source.textContent=unknownTolerance(path)?'*':'·';source.title=unknownTolerance(path)?'資料未指定公差；分析暫按 0，解鎖後可手動輸入。':sourceFor(path);caption.append(source);row.append(caption);
    if(['pcb.opening_length','pcb.opening_width','boss.length','boss.width','boss.total_height','preform.length','preform.width','boss.center_from_left','boss.center_from_bottom'].includes(path))formulaHelp(caption,path,title);
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
  if(group.id==='pcb'){
    const links=document.createElement('div');links.className='linked-controls';links.innerHTML='<label><input id="pcb-auto" type="checkbox" checked>開窗 M/N 自動計算</label><select id="pcb-rule" aria-label="PCB 開窗設計規則"><option value="delta">Delta</option><option value="ampleon">Ampleon</option></select><p id="opening-chain"></p>';details.append(links);
    const analysis=document.createElement('div');analysis.id='gap-analysis';analysis.className='gap-analysis';
    analysis.innerHTML='<div class="gap-heading"><strong>PA 底座／PCB 開窗單邊間隙</strong><span id="gap-state"></span></div><table><thead><tr><th>方向</th><th>名義</th><th>最小</th><th>最大</th></tr></thead><tbody><tr><th>X</th><td><span id="gap-x-nominal">—</span></td><td><span id="gap-x-min">—</span></td><td><span id="gap-x-max">—</span></td></tr><tr><th>Y</th><td><span id="gap-y-nominal">—</span></td><td><span id="gap-y-min">—</span></td><td><span id="gap-y-max">—</span></td></tr></tbody></table><p id="gap-assumptions">PA／PCB 同心，未含偏心及貼片位置誤差；mm。</p>';
    details.append(analysis);for(const axis of ['x','y'])for(const kind of ['nominal','min','max'])formulaHelp(analysis.querySelector(`#gap-${axis}-${kind}`).parentElement,`gap-${axis}-${kind}`,`${axis.toUpperCase()} ${kind==='nominal'?'名義':kind==='min'?'最小':'最大'}單邊間隙`);
  }
  if(group.id==='boss'){
    const links=document.createElement('div');links.className='linked-controls boss-links';links.innerHTML='<label><input id="boss-size-auto" type="checkbox" checked>I/H 跟隨 PA</label><span class="fixed-height-note">L 由 C／K／SPH 自動計算</span><button id="boss-center" type="button">置中</button><p id="boss-derived"></p>';details.append(links);
  }
  if(['package','copper','stack'].includes(group.id)){
    const hint=document.createElement('p');hint.className='group-hint';hint.id=`${group.id}-derived`;details.append(hint);
  }
  controlColumns[['pcb','boss','preform'].includes(group.id)?1:0].append(details);
}
for(const[id,label]of [['metric-cuh','凸台總高'],['metric-z','計算錫厚'],['metric-model','模型錫厚'],['metric-volume','所需錫量']])formulaHelp($(id).parentElement.querySelector('span'),id,label);
for(const[id,label]of [['v-cavity','容腔體積'],['v-boss','凸台體積'],['v-area','錫片面積'],['trials','三款試片厚度']]){const button=formulaHelp(null,id,label);$(id).insertAdjacentElement('afterend',button);}
function updateToleranceLock(){
  document.querySelectorAll('.tolerance-input').forEach(input=>{input.readOnly=!tolerancesUnlocked;input.setAttribute('aria-readonly',String(!tolerancesUnlocked));});
  $('tolerance-unlock').textContent=tolerancesUnlocked?'鎖定公差':'解鎖公差';$('tolerance-unlock').setAttribute('aria-pressed',String(tolerancesUnlocked));
  $('tolerance-status').textContent=tolerancesUnlocked?'可修改上下公差':'公差已鎖定';
  $('design-form').classList.toggle('tolerances-unlocked',tolerancesUnlocked);
}
function formValues(){
  const d=structuredClone(defaults);d.name=$('name').value.trim();d.tolerances={};
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
  d.pcb.opening_mode=$('pcb-auto').checked?'auto':'manual';d.pcb.opening_rule=$('pcb-rule').value;
  d.boss.size_mode=$('boss-size-auto').checked?'auto':'manual';d.boss.height_mode='auto';
  return d;
}
function fill(d){
  $('name').value=d.name;
  for(const path of allPaths){const[group,key]=path.split('.');inputFor(path).value=d[group][key]??'';const pair=getTolerance(d,path);for(const sign of ['minus','plus'])$(`tol-${path.replace('.','-')}-${sign}`).value=unknownTolerance(path)&&pair[sign]===0?'':pair[sign];}
  $('pcb-auto').checked=d.pcb.opening_mode==='auto';$('pcb-rule').value=d.pcb.opening_rule;
  $('boss-size-auto').checked=d.boss.size_mode==='auto';
  tolerancesUnlocked=false;updateToleranceLock();syncLinkedFields(d);
}
function derivedValue(path,value,readonly,title){const input=inputFor(path);if(!input)return;input.readOnly=readonly;input.setAttribute('aria-readonly',String(readonly));input.title=title||'';if(readonly){input.value=Number(value.toFixed(6));const[group,key]=path.split('.');return[key,value,group];}}
function syncLinkedFields(d){
  const auto=d.pcb.opening_mode==='auto',chain=openingRecommendation(d);
  for(const[i,key]of ['opening_length','opening_width'].entries()){
    const path=`pcb.${key}`;derivedValue(path,chain.rounded[i],auto,auto?'自動依 PA 上公差與本欄開窗下公差推導；取消自動可修改名義值。':'手動開窗尺寸');if(auto)d.pcb[key]=chain.rounded[i];
  }
  const sizeAuto=d.boss.size_mode==='auto';d.boss.height_mode='auto';
  for(const key of ['lead_solder','board_solder','flange_gap']){d.stack[key]=defaults.stack[key];derivedValue(`stack.${key}`,d.stack[key],true,'製程建議定值；L 由 PCB 板厚 C、小凸台高度 K 與 PA 支撐高度 SPH 自動計算。');}
  for(const [key,value]of [['length',ceilTenth(d.package.length)],['width',ceilTenth(d.package.width)]]){derivedValue(`boss.${key}`,value,sizeAuto,'I/H 依 PA 標稱尺寸向上取至 0.1 mm；取消跟隨可修改。');if(sizeAuto)d.boss[key]=value;}
  const height=d.pcb.thickness+d.stack.lead_solder+d.stack.board_solder-d.package.support_height-d.stack.flange_gap+d.stack.pad_height;
  derivedValue('boss.total_height',height,true,'L 自動計算；調整 PCB 板厚 C 或小凸台高度 K，SPH 從 PA 封裝帶入。');d.boss.total_height=height;
  for(const key of ['length','width']){derivedValue(`preform.${key}`,d.boss[key],true,'錫片長寬跟隨中凸台 I/H。');d.preform[key]=d.boss[key];}
  return d;
}
function status(text){$('status').textContent=text;}
function error(message){$('error').textContent=message;$('error').hidden=!message;}
function layoutFor(r){
  const c=r.design.copper,b=r.design.pcb;
  const key=JSON.stringify([c.base_length,c.base_width,c.corner_radius,c.hole_diameter,c.hole_edge_offset,b.opening_length,b.opening_width,b.relief_diameter,r.boss_center,r.design.layout]);
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
$('boss-size-auto').addEventListener('change',()=>{clearTimeout(previewTimer);refreshPreview(true);});
$('boss-center').addEventListener('click',()=>{inputFor('boss.center_from_left').value=Number(inputFor('copper.base_length').value)/2;inputFor('boss.center_from_bottom').value=Number(inputFor('copper.base_width').value)/2;invalidate();refreshPreview(true);});
$('tolerance-unlock').addEventListener('click',()=>{tolerancesUnlocked=!tolerancesUnlocked;updateToleranceLock();});
$('design-form').addEventListener('focusin',event=>{
  if(event.target.type==='number'){
    clearTimeout(previewTimer);refreshPreview();if(event.target.classList.contains('tolerance-input'))viewer.selectTolerance(event.target.dataset.fieldKey);else viewer.selectDimension(event.target.name);
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
$('dimension-fit').addEventListener('click',()=>{if(viewer.key){if(viewer.toleranceFocus===viewer.key)viewer.selectTolerance(viewer.key);else viewer.selectDimension(viewer.key);}});
$('help-open').addEventListener('click',()=>$('help-dialog').showModal());
$('help-close').addEventListener('click',()=>$('help-dialog').close());
$('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog'))$('help-dialog').close();});
function renderMetrics(r){
  for(const[id,v,digits]of [['metric-cuh',r.boss_total_height,4],['metric-z',r.calculated_thickness,6],['metric-model',r.model_thickness,6],['metric-volume',r.solder_volume,3],['v-cavity',r.cavity_volume,3],['v-boss',r.boss_volume,3],['v-area',r.preform_area,3]])$(id).textContent=v.toFixed(digits);
  $('trials').textContent=r.trial_thicknesses.map(v=>v.toFixed(4)).join(' / ')+' mm';
  $('warnings').replaceChildren(...r.warnings.map(message=>{const li=document.createElement('li');li.textContent=message;return li;}));
  $('layout-summary').textContent=[['R',r.design.layout.border_width],['S',r.design.layout.epad_size],['T',r.design.layout.web_width],['V',r.design.layout.hole_clearance]].map(([name,value])=>formatDimension(name,value,{prefix:name==='V'?'⌀':''})).join(' / ');
  const maximum=r.pa_envelope?[r.pa_envelope.max_length,r.pa_envelope.max_width]:r.opening_chain.maximum;
  $('package-derived').replaceChildren();maximum.forEach((value,index)=>{if(index)$('package-derived').append('；');$('package-derived').append(formatDimension(index?'PA(Wmax)':'PA(Lmax)',value));formulaHelp($('package-derived'),index?'pa-wmax':'pa-lmax',index?'PA 最大寬度':'PA 最大長度');});
  $('copper-derived').textContent=formatDimension('HSK 深度',r.heatsink_depth);formulaHelp($('copper-derived'),'hsk-depth','HSK 深度');$('copper-derived').append('；孔位由兩相鄰外邊定位');
  $('stack-derived').textContent=`L = C + 0.1 + 0.1 − SPH − 0.3 + K = ${r.boss_total_height.toFixed(4)} mm`;formulaHelp($('stack-derived'),'stack-total','凸台總高');
  $('boss-derived').textContent=`中凸台下段高 = ${r.boss_lower_height.toFixed(4)} mm`;formulaHelp($('boss-derived'),'boss-lower','中凸台下段高度');$('boss-derived').append(`；總高 L = ${r.boss_total_height.toFixed(4)} mm`);formulaHelp($('boss-derived'),'boss-upper','小凸台頂面總高');
  $('opening-chain').textContent=`${r.design.pcb.opening_mode==='auto'?'自動':'建議'} ${formatDimension('M',r.recommended_opening[0])}；${formatDimension('N',r.recommended_opening[1])}（${r.design.pcb.opening_rule==='delta'?'Delta':'Ampleon'}）`;
  const gaps=r.gap_analysis;
  if(gaps){
    for(const axis of ['x','y'])for(const value of ['nominal','min','max']){
      const cell=$(`gap-${axis}-${value}`),number=gaps[axis][value];cell.textContent=number.toFixed(4);cell.classList.toggle('interference',number<0);
    }
    $('gap-state').textContent=gaps.overlap?'可能干涉':'尺寸範圍';$('gap-state').classList.toggle('interference',gaps.overlap);
    $('gap-assumptions').textContent='PA／PCB 同心；未含偏心及貼片位置誤差。單位 mm。';
    $('gap-analysis').dataset.interference=String(gaps.overlap);
  }
  for(const path of allPaths){const row=inputFor(path).closest('.dimension-row'),source=toleranceSource(r.design,path),manual=source==='手動設定';row.title=`${titleFor(path)}；公差 ${toleranceText(r.design,path)}；來源：${source}`;row.querySelector('.tolerance-source').title=manual?`手動設定${unknownTolerance(path)?'／原資料未指定':'／原始來源：'+sourceFor(path)}`:unknownTolerance(path)?'原資料未指定公差；分析暫按 0，解鎖後可輸入。':sourceFor(path);for(const input of row.querySelectorAll('.tolerance-input'))input.title=`${source}${manual&&unknownTolerance(path)?'／原資料未指定':''}；${input.dataset.toleranceSide==='minus'?'下':'上'}偏差（輸入非負值）`;}
  renderFormulaHelp(r);
}
function renderFormulaHelp(r){
  const d=r.design,b=d.pcb,p=d.package,c=d.copper,s=d.stack,t=d.preform,f=v=>Number(v.toFixed(6)).toString();
  const height=`L = C + A + B − SPH − D + K\n= ${f(b.thickness)} + ${f(s.lead_solder)} + ${f(s.board_solder)} − ${f(p.support_height)} − ${f(s.flange_gap)} + ${f(s.pad_height)} = ${f(r.boss_total_height)} mm\nA/B/D 為製程建議定值；調整 C、K，SPH 由 PA 帶入。`;
  for(const id of ['boss.total_height','metric-cuh','stack-total','boss-upper'])setFormula(id,height);
  for(const[index,key]of ['opening_length','opening_width'].entries()){
    const axis=index?'W':'L',pa=index?p.width:p.length,paTol=getTolerance(d,index?'package.width':'package.length'),windowTol=getTolerance(d,`pcb.${key}`),factor=r.opening_chain.factor,raw=r.opening_chain.raw[index],rounded=r.recommended_opening[index];
    setFormula(`pcb.${key}`,`${index?'N':'M'} = PA(${axis}) + PA 上偏差 + 貼片機能力常數 + 開窗下偏差${factor===.5?' / 2':''}，再向上取到 0.1 mm\n= ${f(pa)} + ${f(paTol.plus)} + ${f(r.opening_chain.placement_allowance??.066)} + ${f(windowTol.minus)}${factor===.5?' / 2':''} = ${f(raw)} → ${f(rounded)} mm\n常數來自 PPT 第8頁；下偏差補償開窗加工縮小，不作為貼片位置的尺寸公差。`,b.opening_mode==='auto');
    const value=index?r.boss_width:r.boss_length;
    setFormula(`boss.${index?'width':'length'}`,`${index?'H':'I'} = PA(${axis}) 向上取到 0.1 mm\n= ceil(${f(pa)} × 10) / 10 = ${f(value)} mm\n使用 PA 標稱尺寸，不加封裝公差。`,d.boss.size_mode==='auto');
    setFormula(`preform.${index?'width':'length'}`,`${index?'X':'W'} = 中凸台${index?'寬度 H':'長度 I'} = ${f(value)} mm\n錫片長寬跟隨中凸台；各自的製造公差仍分別設定。`);
    setFormula(index?'pa-wmax':'pa-lmax',`PA(${axis}max) = PA(${axis}) + 上偏差\n= ${f(pa)} + ${f(paTol.plus)} = ${f(pa+paTol.plus)} mm\n最大封裝外框以虛線表示。`);
  }
  setFormula('boss.center_from_left',`Xc 是從基座左外邊到中凸台中心的手動定位尺寸。\n按「置中」時計算 Xc = E / 2 = ${f(c.base_length)} / 2 = ${f(c.base_length/2)} mm。\n目前 Xc = ${f(d.boss.center_from_left)} mm；相對基座中心偏移 = ${f(r.boss_center[0])} mm。`);
  setFormula('boss.center_from_bottom',`Yc 是從基座下外邊到中凸台中心的手動定位尺寸。\n按「置中」時計算 Yc = F / 2 = ${f(c.base_width)} / 2 = ${f(c.base_width/2)} mm。\n目前 Yc = ${f(d.boss.center_from_bottom)} mm；相對基座中心偏移 = ${f(r.boss_center[1])} mm。`);
  setFormula('boss-lower',`中凸台下段高度 = L − K\n= ${f(r.boss_total_height)} − ${f(s.pad_height)} = ${f(r.boss_lower_height)} mm。`);
  setFormula('hsk-depth',`HSK 名義深度 = G + 0.05\n= ${f(c.base_thickness)} + 0.05 = ${f(r.heatsink_depth)} mm\nPPT 第3頁另指定 HSK 配合深度公差 ±0.05 mm。`);
  const cavity=`V₁₋₁ = [M × N + π × (O / 2)²] × (L + D − K)\n= [${f(b.opening_length)} × ${f(b.opening_width)} + π × (${f(b.relief_diameter)} / 2)²] × ${f(r.copper_to_flange)} = ${f(r.cavity_volume)} mm³\n依 PPT 第12頁的等效體積公式。`;
  const boss=`V₂ = I × H × (L − K) + 4 × J² × K\n= ${f(r.boss_length)} × ${f(r.boss_width)} × ${f(r.boss_lower_height)} + 4 × ${f(c.pad_size)}² × ${f(s.pad_height)} = ${f(r.boss_volume)} mm³。`;
  const volume=`V₁ = V₁₋₁ − V₂\n= ${f(r.cavity_volume)} − ${f(r.boss_volume)} = ${f(r.solder_volume)} mm³。`;
  const area=`A₁ = W × X − 2 × Y²\n= ${f(t.length)} × ${f(t.width)} − 2 × ${f(t.chamfer)}² = ${f(r.preform_area)} mm²。`;
  const z=`Z = (V₁₋₁ − V₂) / A₁\n= (${f(r.cavity_volume)} − ${f(r.boss_volume)}) / ${f(r.preform_area)} = ${f(r.calculated_thickness)} mm\n為名義體積扣除估算；最終厚度由製程切片選定。`;
  setFormula('v-cavity',cavity);setFormula('v-boss',boss);setFormula('v-area',area);setFormula('metric-volume',volume);setFormula('metric-z',z);setFormula('metric-model',z,t.thickness_override===null);
  setFormula('trials',`三款試片厚度 = 計算 Z − 增減量、Z、Z + 增減量\n= ${f(r.calculated_thickness)} − ${f(t.trial_delta)}、${f(r.calculated_thickness)}、${f(r.calculated_thickness)} + ${f(t.trial_delta)}\n= ${r.trial_thicknesses.map(f).join(' / ')} mm。`);
  for(const axis of ['x','y']){
    const g=r.gap_analysis[axis],window=g.window,pa=g.pa;
    setFormula(`gap-${axis}-nominal`,`名義單邊間隙 = (開窗名義尺寸 − PA 底座名義尺寸) / 2\n= (${f(window.nominal)} − ${f(pa.nominal)}) / 2 = ${f(g.nominal)} mm\n假設 PA 與 PCB 開窗同心，未含偏心或貼片位置誤差。`);
    setFormula(`gap-${axis}-min`,`最小單邊間隙 = (開窗最小尺寸 − PA 底座最大尺寸) / 2\n= (${f(window.min)} − ${f(pa.max)}) / 2 = ${f(g.min)} mm\n開窗最小 = 名義 − 下偏差；PA 最大 = 名義 + 上偏差。\n假設同心，未含位置誤差；負值表示可能干涉。`);
    setFormula(`gap-${axis}-max`,`最大單邊間隙 = (開窗最大尺寸 − PA 底座最小尺寸) / 2\n= (${f(window.max)} − ${f(pa.min)}) / 2 = ${f(g.max)} mm\n開窗最大 = 名義 + 上偏差；PA 最小 = 名義 − 下偏差。\n假設同心，未含位置誤差。`);
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


updateToleranceLock();refreshPreview();viewer.setView('iso');$('design-form').requestSubmit();
