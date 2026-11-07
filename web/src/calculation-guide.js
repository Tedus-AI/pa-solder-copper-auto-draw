import {volumeGuideGeometry,scaledSection,VolumeGuide3D} from './volume-guide.js';
// The guide reads the same calculated result used by preview and export.
// PDF p12 defines an equivalent relief area; do not replace it with mesh area.
const f=(value,digits=4)=>Number(value).toFixed(digits).replace(/\.?0+$/,'')||'0';
const svgText=(x,y,text,extra='')=>`<text x="${x}" y="${y}" ${extra}>${text}</text>`;
export function calculationWorksheet(r){
  const {pcb:b,copper:c,stack:s,preform:t}=r.design;
  return [
    ['M','PCB 開窗長度',b.opening_length,20.9,'mm','左側 PCB 開孔'],
    ['N','PCB 開窗寬度',b.opening_width,10.1,'mm','左側 PCB 開孔'],
    ['O','避空孔徑',b.relief_diameter,2,'mm','依第12頁使用等效圓面積'],
    ['h','基座至 PA 底面高度',r.copper_to_flange,.63,'mm','L + D − K（第6頁）'],
    ['V₁₋₁','容腔體積',r.cavity_volume,134.966,'mm³','[M × N + π × (O / 2)²] × h'],
    ['H','中凸台寬度',r.boss_width,9.8,'mm','中凸台設計尺寸'],
    ['I','中凸台長度',r.boss_length,20.6,'mm','中凸台設計尺寸'],
    ['J','小凸台邊長',c.pad_size,1.5,'mm','共4個 J × J'],
    ['K','小凸台高度',s.pad_height,.15,'mm','中凸台上的局部高度'],
    ['L','中凸台總高',r.boss_total_height,.48,'mm','C + A + B − SPH − D + K'],
    ['V₂','銅凸台占用體積',r.boss_volume,67.970,'mm³','H × I × (L − K) + 4 × J² × K'],
    ['V₁','所需錫量',r.solder_volume,66.996,'mm³','V₁₋₁ − V₂'],
    ['W','錫片長度',t.length,20.6,'mm','跟隨中凸台 I'],
    ['X','錫片寬度',t.width,9.8,'mm','跟隨中凸台 H'],
    ['Y','45° 削角尺寸',t.chamfer,3.4,'mm','Y = round(2J + √2 × 0.2828, 2) mm'],
    ['A₁','削角後錫片面積',r.preform_area,178.760,'mm²','W × X − 4 × (Y² / 2)'],
    ['Z','計算錫厚',r.calculated_thickness,.3748,'mm','V₁ / A₁'],
    ['ΔZ','試片厚度增減量',t.trial_delta,.15,'mm','固定增減0.15 mm'],
  ].map(([symbol,label,value,reference,unit,formula])=>({symbol,label,value,reference,unit,formula}));
}
function areaDiagram(r){
  const {length:w,width:x,chamfer:y}=r.design.preform,k=Math.min(230/w,98/x),ww=w*k,hh=x*k,yy=y*k,left=(300-ww)/2,top=(150-hh)/2;
  const points=[[left+yy,top],[left+ww-yy,top],[left+ww,top+yy],[left+ww,top+hh-yy],[left+ww-yy,top+hh],[left+yy,top+hh],[left,top+hh-yy],[left,top+yy]].map(p=>p.join(',')).join(' ');
  return `<svg viewBox="0 0 300 158" role="img" aria-label="錫片長方形 W 乘 X，扣掉四角各 Y 平方除以二的三角形"><rect x="${left}" y="${top}" width="${ww}" height="${hh}" fill="#f9e5d5" stroke="#ae7154" stroke-dasharray="4 3"/><polygon points="${points}" fill="#a6c9d1" stroke="#326778"/>
  ${svgText(150,18,`W = ${f(w)} mm`,'text-anchor="middle"')}${svgText(150,153,`X = ${f(x)} mm · Y = ${y.toFixed(2)} mm`,'text-anchor="middle"')}${svgText(150,80,'A₁：削角後面積','text-anchor="middle"')}
  </svg>`;
}
const rowKeys={M:'pcb.opening_length',N:'pcb.opening_width',O:'pcb.relief_diameter',h:'h',H:'boss.width',I:'boss.length',J:'copper.pad_size',K:'stack.pad_height',L:'boss.total_height',W:'preform.length',X:'preform.width',Y:'preform.chamfer','ΔZ':'preform.trial_delta'};
export const inspectorRows=r=>calculationWorksheet(r).filter(row=>rowKeys[row.symbol]).map(row=>({...row,key:rowKeys[row.symbol]}));
function guideContent(r){
 const {pcb:b,copper:c,stack:s,preform:t}=r.design;
 const rows=inspectorRows(r).map(row=>`<tr><td><button type="button" data-guide-dimension="${row.key}" title="${row.formula}"><b>${row.symbol}</b> ${row.label}</button></td><td>${row.symbol==='Y'?row.value.toFixed(2):f(row.value,6)} ${row.unit}</td></tr>`).join('');
 return `<div class="guide-workspace"><section class="guide-explanation"><div class="guide-summary"><span>錫量 V₁ = <b>${f(r.solder_volume,3)} mm³</b></span><span>面積 A₁ = <b>${f(r.preform_area,3)} mm²</b></span><strong>計算 Z = ${f(r.calculated_thickness,6)} mm</strong></div>
 <div class="guide-layers" role="group" aria-label="體積圖解顯示"><button type="button" data-guide-layer="all" aria-pressed="true">組裝剖面</button><button type="button" data-guide-layer="cavity" aria-pressed="false">容腔 V₁₋₁</button><button type="button" data-guide-layer="copper" aria-pressed="false">銅凸台 V₂</button><button type="button" data-guide-layer="solder" aria-pressed="false">錫料 V₁</button></div>
 <div class="guide-geometry"><div class="guide-section-column"><div id="guide-section" data-layer="all"></div><label class="guide-zoom">等比放大 <input id="guide-section-zoom" type="range" min="1" max="6" step=".25" value="1"><output id="guide-zoom-value">1×</output></label></div><div class="guide-isometric"><div id="guide-volume-3d"></div><p class="guide-caption"><span class="volume-key cavity-key">藍：容腔</span> <span class="volume-key solder-key">紅：錫料</span> · 所選體積實體呼吸，其餘零件半透明</p></div></div>
 <div class="guide-area">${areaDiagram(r)}<p><b>A₁ = W × X − 2 × Y²</b><br>= ${f(t.length)} × ${f(t.width)} − 2 × ${t.chamfer.toFixed(2)}²<br>= ${f(r.preform_area,3)} mm²</p><p>45°削角自動跟隨小凸台 J<br><b>Y = round(2J + √2 × 0.2828, 2)</b><br>間隙基準 <b>0.2828 mm</b>，Y 取小數第二位<br>取位後實際間隙 ${f(r.corner_clearance,6)} mm</p></div>
 <div class="guide-steps"><article><h3>① 容腔 V₁₋₁</h3><p>銅塊基座上表面至 PA 底面的空間。</p><code>h = L + D − K = ${f(r.copper_to_flange)} mm<br>V₁₋₁ = [M × N + π(O/2)²] × h<br>= ${f(r.cavity_volume,3)} mm³</code></article><article><h3>② 扣掉銅凸台 V₂</h3><code>V₂ = H × I × (L − K) + 4J²K<br>= ${f(r.boss_volume,3)} mm³<br>V₁ = V₁₋₁ − V₂ = ${f(r.solder_volume,3)} mm³</code><p>扣除中凸台及四個小凸台。</p></article><article><h3>③ 錫量除以錫片面積</h3><code>Z = V₁ / A₁<br>= ${f(r.solder_volume,3)} / ${f(r.preform_area,3)}<br>= ${f(r.calculated_thickness,6)} mm</code><p>三款試片：${r.trial_thicknesses.map(v=>f(v,4)).join('／')} mm<br>目前模型：<b>${f(r.model_thickness,6)} mm</b> · ${r.trial_status==='locked'?'已鎖定驗證結果':r.trial_status==='stale'?'尺寸變更，需重新驗證':'未鎖定'}</p></article></div>
 <p class="guide-source">圖面使用實際比例；薄層可等比放大，標籤固定保留在畫面內。錫量依 PDF 第12頁的等效避空面積 π(O/2)² 計算，與實際四個側向半圓輪廓分別處理。</p></section>
 <aside class="guide-inspector"><div class="guide-inspector-heading"><strong>尺寸定位</strong><button id="guide-dimension-reset" type="button">等角 ↗</button></div><div id="guide-inspector-label">點選下方尺寸，在圖中定位</div><div id="guide-dimension-3d"></div><div class="guide-table-scroll"><table class="guide-table"><thead><tr><th>尺寸／用途</th><th>目前數值</th></tr></thead><tbody>${rows}</tbody></table></div><p class="guide-caption">點選尺寸定位 · 拖曳旋轉／滾輪縮放</p></aside></div>`;
}
export function createCalculationGuide(getResult){
 const dialog=document.createElement('dialog');dialog.id='calculation-guide';dialog.setAttribute('aria-labelledby','calculation-guide-title');
 dialog.innerHTML='<header class="guide-heading"><div><h2 id="calculation-guide-title">錫片厚度：體積扣除圖解</h2><p>使用目前專案尺寸 · 等比例剖面／等角3D／尺寸定位</p></div><button type="button" id="calculation-guide-close" aria-label="關閉錫厚圖解">×</button></header><div id="calculation-guide-content"></div>';
 document.body.append(dialog);let viewer,inspector,observer,r,geometry,zoom=1;
 const cleanup=()=>{observer?.disconnect();viewer?.dispose();inspector?.dispose();viewer=inspector=null;};dialog.addEventListener('close',cleanup);
 dialog.querySelector('#calculation-guide-close').addEventListener('click',()=>dialog.close());
 const drawSection=()=>{const el=dialog.querySelector('#guide-section');if(!el?.clientWidth||!el?.clientHeight)return;el.innerHTML=scaledSection(r,geometry,{width:el.clientWidth,height:el.clientHeight,zoom});};
 dialog.addEventListener('click',event=>{const layer=event.target.closest('[data-guide-layer]');if(layer){dialog.querySelector('#guide-section').dataset.layer=layer.dataset.guideLayer;viewer.select(layer.dataset.guideLayer);dialog.querySelectorAll('[data-guide-layer]').forEach(b=>b.setAttribute('aria-pressed',String(b===layer)));}const dimension=event.target.closest('[data-guide-dimension]');if(dimension){dialog.querySelector('#guide-inspector-label').textContent=inspector.selectDimension(dimension.dataset.guideDimension);dialog.querySelectorAll('[data-guide-dimension]').forEach(b=>{b.setAttribute('aria-pressed',String(b===dimension));b.closest('tr').classList.toggle('selected',b===dimension);});}});
 return()=>{cleanup();r=getResult();geometry=volumeGuideGeometry(r);zoom=1;dialog.querySelector('#calculation-guide-content').innerHTML=guideContent(r);dialog.showModal();viewer=new VolumeGuide3D(dialog.querySelector('#guide-volume-3d'),r,geometry);inspector=new VolumeGuide3D(dialog.querySelector('#guide-dimension-3d'),r,geometry,{inspector:true});observer=new ResizeObserver(drawSection);observer.observe(dialog.querySelector('#guide-section'));drawSection();dialog.querySelector('#guide-section-zoom').addEventListener('input',e=>{zoom=Number(e.target.value);dialog.querySelector('#guide-zoom-value').textContent=`${zoom}×`;drawSection();});dialog.querySelector('#guide-dimension-reset').addEventListener('click',()=>inspector.resetView());};
}
