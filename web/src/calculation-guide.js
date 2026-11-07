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
    ['h','Cu to flange 高度',r.copper_to_flange,.63,'mm','L + D − K（第6頁）'],
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
    ['Y','45° 削角尺寸',t.chamfer,3.4,'mm','4個直角三角形，各面積 Y² / 2'],
    ['A₁','削角後錫片面積',r.preform_area,178.760,'mm²','W × X − 4 × (Y² / 2)'],
    ['Z','計算錫厚',r.calculated_thickness,.3748,'mm','V₁ / A₁'],
    ['ΔZ','試片厚度增減量',t.trial_delta,.15,'mm','第12頁 ±0.05；第13頁表格 ±0.15'],
  ].map(([symbol,label,value,reference,unit,formula])=>({symbol,label,value,reference,unit,formula}));
}
function areaDiagram(r){
  const {length:w,width:x,chamfer:y}=r.design.preform,k=Math.min(230/w,98/x),ww=w*k,hh=x*k,yy=y*k,left=(300-ww)/2,top=(150-hh)/2;
  const points=[[left+yy,top],[left+ww-yy,top],[left+ww,top+yy],[left+ww,top+hh-yy],[left+ww-yy,top+hh],[left+yy,top+hh],[left,top+hh-yy],[left,top+yy]].map(p=>p.join(',')).join(' ');
  return `<svg viewBox="0 0 300 158" role="img" aria-label="錫片長方形 W 乘 X，扣掉四角各 Y 平方除以二的三角形"><rect x="${left}" y="${top}" width="${ww}" height="${hh}" fill="#f9e5d5" stroke="#ae7154" stroke-dasharray="4 3"/><polygon points="${points}" fill="#a6c9d1" stroke="#326778"/>
  ${svgText(150,18,`W = ${f(w)} mm`,'text-anchor="middle"')}${svgText(150,153,`X = ${f(x)} mm · Y = ${f(y)} mm`,'text-anchor="middle"')}${svgText(150,80,'A₁：削角後面積','text-anchor="middle"')}
  </svg>`;
}
function guideContent(r,geometry){
  const {pcb:b,copper:c,stack:s,preform:t}=r.design;
  const lower=r.boss_lower_height,small=4*c.pad_size**2*s.pad_height;
  const worksheet=calculationWorksheet(r).map(row=>`<tr class="${['V₁₋₁','V₂','V₁','A₁','Z'].includes(row.symbol)?'guide-derived':''}"><th>${row.symbol}<small>${row.label}</small></th><td>${f(row.value,row.symbol==='Z'?6:4)}</td><td>${row.unit}</td><td>${row.formula}</td><td>${f(row.reference,4)}</td></tr>`).join('');
  return `<div class="guide-summary"><span>所需錫量 V₁ = <b>${f(r.solder_volume,3)} mm³</b></span><span>錫片面積 A₁ = <b>${f(r.preform_area,3)} mm²</b></span><strong>計算 Z = ${f(r.calculated_thickness,6)} mm</strong></div>
  <section id="guide-diagram-pane"><div class="guide-geometry"><div><div class="guide-layers" role="group" aria-label="體積圖解顯示"><button type="button" data-guide-layer="all" aria-pressed="true">組裝剖面</button><button type="button" data-guide-layer="cavity" aria-pressed="false">容腔 V₁₋₁</button><button type="button" data-guide-layer="copper" aria-pressed="false">銅凸台 V₂</button><button type="button" data-guide-layer="solder" aria-pressed="false">錫料 V₁</button></div><div id="guide-section" data-layer="all">${scaledSection(r,geometry)}</div><p class="guide-caption">水平與高度採相同比例。薄層可用下方縮放查看；不單獨放大高度。</p><label class="guide-zoom">剖面縮放 <input id="guide-section-zoom" type="range" min="1" max="5" step=".25" value="1"></label></div><div class="guide-isometric"><div id="guide-volume-3d"></div><p class="guide-caption">等角3D · 滾輪縮放／拖曳旋轉<br>所選體積為實體並呼吸發光，其餘零件半透明</p></div></div><div class="guide-area">${areaDiagram(r)}<p><b>A₁ = W × X − 4 × (Y² / 2)</b><br>= ${f(t.length)} × ${f(t.width)} − 2 × ${f(t.chamfer)}²<br>= <strong>${f(r.preform_area,3)} mm²</strong></p><p>將所需錫料的體積攤成這片平面形狀，厚度就是 <b>Z = V₁ ÷ A₁</b>。</p></div>
  <div class="guide-steps"><article><h3>① 算容腔 V₁₋₁</h3><p>從銅塊基座上表面到 PA 底面，先視為尚未放入銅凸台的空間。</p><code>h = L + D − K<br>= ${f(r.boss_total_height)} + ${f(s.flange_gap)} − ${f(s.pad_height)} = ${f(r.copper_to_flange)} mm</code><code>V₁₋₁ = [M × N + π × (O/2)²] × h<br>= [${f(b.opening_length)} × ${f(b.opening_width)} + π × (${f(b.relief_diameter)}/2)²] × ${f(r.copper_to_flange)}<br>= ${f(r.cavity_volume,3)} mm³</code></article>
  <article><h3>② 扣掉銅凸台 V₂</h3><p>中凸台先算到 L − K，再加回四個小凸台。銅塊基座在容腔下方，不扣第二次。</p><code>V₂ = H × I × (L − K) + 4 × J² × K<br>= ${f(r.boss_width)} × ${f(r.boss_length)} × ${f(lower)} + ${f(small)}<br>= ${f(r.boss_volume,3)} mm³</code><code>V₁ = V₁₋₁ − V₂<br>= ${f(r.cavity_volume,3)} − ${f(r.boss_volume,3)}<br>= ${f(r.solder_volume,3)} mm³</code></article>
  <article><h3>③ 用錫量除以面積</h3><code>Z = V₁ / A₁<br>= ${f(r.solder_volume,3)} / ${f(r.preform_area,3)}<br>= ${f(r.calculated_thickness,6)} mm</code><p><b>計算 Z</b>：體積扣除的厚度初估。<br><b>模型 Z = ${f(r.model_thickness,6)} mm</b>：${t.thickness_override===null?'目前自動採用計算 Z。':'目前使用左側「指定錫厚 Z」的手動值；計算 Z 保留作比較。'}</p><p>以未加公差的設計尺寸估算，最終厚度依試片切片結果選定。</p></article></div>
  <p class="guide-source">依 PDF 第6、11、12頁：0.63 mm 是目前 h 的計算結果，會隨高度設定改變。避空面積沿用文件的 π(O/2)² 等效項，與3D顯示的局部半圓輪廓分別處理。</p></section>
  <section id="guide-table-pane" hidden><p class="guide-table-note">依 PDF 第13頁 Excel 表重排。左欄隨目前專案更新；最右欄保留 PDF 範例以便核對。數值顯示取位，計算使用完整精度。</p><div class="guide-table-scroll"><table class="guide-table"><thead><tr><th>變數／用途</th><th>目前數值</th><th>單位</th><th>來源／公式</th><th>PDF 範例</th></tr></thead><tbody>${worksheet}</tbody></table></div></section>
  <div class="guide-trials"><div><b>目前三款試片（Z ±${f(t.trial_delta)} mm）</b><span>${r.trial_thicknesses.map(v=>f(v,4)).join(' ／ ')} mm</span></div><p>第12頁建議增減 0.05 mm；第13頁 Excel 範例增減 0.15 mm，顯示約 0.22／0.37／0.52 mm。可在左側「試片厚度增減量」選定；錫片製造公差 ±0.02 mm 另行設定。</p></div>`;
}
export function createCalculationGuide(getResult){
  const dialog=document.createElement('dialog');dialog.id='calculation-guide';dialog.setAttribute('aria-labelledby','calculation-guide-title');
  dialog.innerHTML='<header class="guide-heading"><div><h2 id="calculation-guide-title">錫片厚度：體積扣除圖解</h2><p>依製程設計規範第6、11～13頁 · 使用目前專案的尺寸</p></div><button type="button" id="calculation-guide-close" aria-label="關閉錫厚圖解">×</button></header><nav class="guide-tabs" aria-label="計算說明模式"><button id="guide-diagram-tab" type="button" aria-pressed="true">體積圖解</button><button id="guide-table-tab" type="button" aria-pressed="false">Excel 計算表對照</button></nav><div id="calculation-guide-content"></div>';
  document.body.append(dialog);let viewer;
  dialog.addEventListener('close',()=>{viewer?.dispose();viewer=null;});
  dialog.querySelector('#calculation-guide-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();const button=event.target.closest('[data-guide-layer]');if(button){dialog.querySelector('#guide-section').dataset.layer=button.dataset.guideLayer;viewer?.select(button.dataset.guideLayer);dialog.querySelectorAll('[data-guide-layer]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}});
  const tab=name=>{for(const key of ['diagram','table']){dialog.querySelector(`#guide-${key}-pane`).hidden=key!==name;dialog.querySelector(`#guide-${key}-tab`).setAttribute('aria-pressed',String(key===name));}};
  for(const name of ['diagram','table'])dialog.querySelector(`#guide-${name}-tab`).addEventListener('click',()=>tab(name));
  return()=>{const r=getResult(),geometry=volumeGuideGeometry(r);viewer?.dispose();dialog.querySelector('#calculation-guide-content').innerHTML=guideContent(r,geometry);tab('diagram');dialog.showModal();viewer=new VolumeGuide3D(dialog.querySelector('#guide-volume-3d'),r,geometry);dialog.querySelector('#guide-section-zoom').addEventListener('input',e=>{const k=Number(e.target.value),svg=dialog.querySelector('#guide-section svg');svg.setAttribute('viewBox',`${Number(svg.dataset.focusX)*(1-1/k)} ${Number(svg.dataset.focusY)*(1-1/k)} ${560/k} ${278/k}`);});};
}
