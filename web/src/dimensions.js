import { dimensionSpecs, formatDimension } from './dimension-format.js';
import { getTolerance, toleranceSuffix, toleranceText, toleranceSource } from './tolerances.js';
export { dimensionLabel } from './dimension-format.js';

export function referenceLevels(r){const d=r.design,base=d.copper.base_thickness;return{base,boss:base+r.boss_lower_height,pad:base+r.boss_total_height,pcbBottom:base+d.stack.board_solder,pcbTop:base+d.stack.board_solder+d.pcb.thickness,flange:base+r.copper_to_flange,lead:base+r.copper_to_flange+d.package.support_height};}
export function dimensionFor(key,r,layout){
 const d=r.design,c=d.copper,p=d.package,b=d.pcb,l=d.layout,z=referenceLevels(r),I=r.boss_length,H=r.boss_width,[cx,cy]=r.boss_center||[0,0];
 const hx=c.base_length/2-c.hole_edge_offset,hy=c.base_width/2-c.hole_edge_offset,padX=(I-c.pad_size)/2,padY=(H-c.pad_size)/2;
 const pinX=4.445*p.length/20.57,pinY=-Math.min(p.width/2+4.83*p.width/9.78-.2,Math.max(p.width/2+.5,b.opening_width/2+.5));
 const radiusCandidates=[[1,1],[1,-1],[-1,1],[-1,-1]].map(([sx,sy])=>{const a=[sx*(c.base_length/2-c.corner_radius),sy*(c.base_width/2-c.corner_radius),z.base];return{a,b:[a[0]+sx*c.corner_radius/Math.SQRT2,a[1]+sy*c.corner_radius/Math.SQRT2,z.base]};});
 const visibleRadiusCandidates=radiusCandidates.filter(candidate=>[-1,1].every(sign=>Math.hypot(candidate.b[0]-sign*hx,candidate.b[1]-sign*hy)>c.hole_diameter/2+1e-6));
 const radiusDatum=visibleRadiusCandidates[0]||radiusCandidates[0];
 const candidates=layout?.cells.filter(cell=>cell.full)||[],cell=candidates.find(cell=>candidates.some(other=>Math.abs(other.y-cell.y)<1e-6&&Math.abs(other.x-cell.x-layout.pitch)<1e-6))||candidates[0]||{x:cx,y:cy+b.opening_width/2+2};
 const v=(a,b,mode,value,note='',offset=[0,0,1.5])=>({a,b,mode,value,note,offset,key});
 const map={
 'package.length':()=>v([-p.length/2,-p.width/2,z.flange],[p.length/2,-p.width/2,z.flange],'assembly',p.length,'PA 金屬底座長度'),
 'package.width':()=>v([p.length/2,-p.width/2,z.flange],[p.length/2,p.width/2,z.flange],'assembly',p.width,'PA 金屬底座寬度'),
 'package.support_height':()=>v([pinX,p.width/2,z.flange],[pinX,p.width/2,z.lead],'assembly',p.support_height,'SPH：PA 金屬底座底面 → PIN 底面'),
 'pcb.opening_length':()=>v([-b.opening_length/2,0,z.pcbTop],[b.opening_length/2,0,z.pcbTop],'assembly',b.opening_length,'PCB 開孔長度 M'),
 'pcb.opening_width':()=>v([0,-b.opening_width/2,z.pcbTop],[0,b.opening_width/2,z.pcbTop],'assembly',b.opening_width,'PCB 開孔寬度 N'),
 'pcb.thickness':()=>v([b.opening_length/2+2,0,z.pcbBottom],[b.opening_length/2+2,0,z.pcbTop],'assembly',b.thickness,'PCB 板厚 C'),
 'pcb.relief_diameter':()=>v([b.opening_length/2,b.opening_width/2-b.relief_diameter,z.pcbTop],[b.opening_length/2,b.opening_width/2,z.pcbTop],'assembly',b.relief_diameter,'角部避空孔徑 O：讓刀具／圓角留空'),
 'copper.base_length':()=>v([-c.base_length/2,-c.base_width/2,z.base],[c.base_length/2,-c.base_width/2,z.base],'copper',c.base_length,'基座長度 E'),
 'copper.base_width':()=>v([-c.base_length/2,-c.base_width/2,z.base],[-c.base_length/2,c.base_width/2,z.base],'copper',c.base_width,'基座寬度 F'),
 'copper.base_thickness':()=>v([c.base_length/2,0,0],[c.base_length/2,0,z.base],'copper',c.base_thickness,'基座厚度 G'),
 'copper.corner_radius':()=>v(radiusDatum.a,radiusDatum.b,'copper',c.corner_radius,'圓角半徑 R：取未被孔切除的角部，以徑向單箭頭就近引出'),
 'copper.hole_diameter':()=>v([hx-c.hole_diameter/2,hy,z.base],[hx+c.hole_diameter/2,hy,z.base],'copper',c.hole_diameter,'吊掛孔徑 D；孔徑大於角部肉厚時顯示實際破邊'),
 'copper.hole_edge_offset':()=>v([hx,hy,z.base],[c.base_length/2,hy,z.base],'copper',c.hole_edge_offset,'孔中心至基座直邊基準 C，與圓角 R 獨立'),
 'copper.pad_size':()=>v([padX-c.pad_size/2,padY-c.pad_size/2,z.pad],[padX+c.pad_size/2,padY-c.pad_size/2,z.pad],'copper',c.pad_size,'四角小凸台邊長 J'),
 'boss.length':()=>v([-I/2,-H/2,z.boss],[I/2,-H/2,z.boss],'copper',I,'中凸台長度 I；自動時依 PA 名義長度向上取至 0.1 mm'),
 'boss.width':()=>v([I/2,-H/2,z.boss],[I/2,H/2,z.boss],'copper',H,'中凸台寬度 H'),
 'boss.total_height':()=>v([padX,padY,z.base],[padX,padY,z.pad],'copper',r.boss_total_height,'L 包含 K；中凸台本體高度 = L − K'),
 'boss.center_from_left':()=>v([-c.base_length/2,cy,z.base],[cx,cy,z.base],'copper',d.boss.center_from_left,'左側基準邊至中凸台中心 Xc'),
 'boss.center_from_bottom':()=>v([cx,-c.base_width/2,z.base],[cx,cy,z.base],'copper',d.boss.center_from_bottom,'下側基準邊至中凸台中心 Yc'),
 'stack.lead_solder':()=>v([pinX,pinY,z.pcbTop],[pinX,pinY,z.lead],'assembly',d.stack.lead_solder,'PIN 底面與 PCB 頂面間錫厚 A'),
 'stack.board_solder':()=>v([c.base_length/2-2,0,z.base],[c.base_length/2-2,0,z.pcbBottom],'assembly',d.stack.board_solder,'基座頂面與 PCB 底面間錫厚 B'),
 'stack.flange_gap':()=>v([pinX,-p.width/2,z.boss],[pinX,-p.width/2,z.flange],'assembly',d.stack.flange_gap,'中凸台平面到 PA 金屬底座底面 D'),
 'stack.pad_height':()=>v([padX,padY,z.boss],[padX,padY,z.pad],'copper',d.stack.pad_height,'小凸台高度 K；中凸台本體高度 = L − K'),
 'preform.length':()=>v([-I/2,-H/2,0],[I/2,-H/2,0],'preform',I,'錫片名義長度 W = 中凸台 I；製造公差獨立'),
 'preform.width':()=>v([I/2,-H/2,0],[I/2,H/2,0],'preform',H,'錫片名義寬度 X = 中凸台 H；製造公差獨立'),
 'preform.chamfer':()=>v([-I/2,-H/2,0],[-I/2+d.preform.chamfer,-H/2,0],'preform',d.preform.chamfer,'45° 削角的直角邊長 Y'),
 'preform.trial_delta':()=>v([0,0,r.calculated_thickness],[0,0,r.calculated_thickness+d.preform.trial_delta],'preform',d.preform.trial_delta,'試片增減量，非 Z 製造公差'),
 'preform.thickness_override':()=>v([I/2,0,0],[I/2,0,r.model_thickness],'preform',r.model_thickness,d.preform.thickness_override===null?'自動採體積計算錫厚 Z':'指定錫厚 Z'),
 'layout.border_width':()=>v([c.base_length/2,0,z.base],[c.base_length/2+l.border_width,0,z.base],'layout',l.border_width,'外框綠漆寬 R'),
 'layout.epad_size':()=>v([cell.x-l.epad_size/2,cell.y-l.epad_size/2,z.base],[cell.x+l.epad_size/2,cell.y-l.epad_size/2,z.base],'layout',l.epad_size,'E-PAD 開窗邊長 S'),
 'layout.web_width':()=>v([cell.x+l.epad_size/2,cell.y,z.base],[cell.x+l.epad_size/2+l.web_width,cell.y,z.base],'layout',l.web_width,'相鄰 E-PAD 間綠漆筋 T'),
 'layout.hole_clearance':()=>v([hx-l.hole_clearance/2,hy,z.base],[hx+l.hole_clearance/2,hy,z.base],'layout',l.hole_clearance,'定位孔 E-PAD 避讓直徑 V'),
 };
 const dimension=map[key]?.();if(!dimension)return null;
 const movePoint=a=>[a[0]+cx,a[1]+cy,a[2]],relative=key.startsWith('package.')||key.startsWith('pcb.')||['boss.length','boss.width','boss.total_height','copper.pad_size','stack.lead_solder','stack.flange_gap','stack.pad_height'].includes(key);
 if(relative){dimension.a=movePoint(dimension.a);dimension.b=movePoint(dimension.b);}
 dimension.kind=dimensionSpecs[key]?.kind||'linear';dimension.view=key==='package.support_height'?'right':Math.abs(dimension.b[2]-dimension.a[2])>1e-8?'front':'top';
 if(key==='copper.corner_radius')dimension.radiusCandidates=visibleRadiusCandidates;
 dimension.tolerance=getTolerance(d,key);dimension.toleranceSuffix=toleranceSuffix(d,key);dimension.toleranceSource=toleranceSource(d,key);
 dimension.toleranceLabel=`${dimensionSpecs[key]?.name||key} 公差 = ${toleranceText(d,key)}`;
 if(key==='package.support_height'){dimension.datums=['下端：PA 底面','上端：PIN 底面'];dimension.referenceSegments=[[[pinX,-p.width/2,z.flange],[pinX,p.width/2,z.flange]],[[pinX,p.width/2+4.83*p.width/9.78,z.lead],[pinX,9.4*p.width/9.78*.44,z.lead]]].map(segment=>segment.map(movePoint));}
 return dimension;
}
