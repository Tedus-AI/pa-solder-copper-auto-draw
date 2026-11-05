export function referenceLevels(r) {
  const d=r.design, base=d.copper.base_thickness;
  return {base,boss:base+r.boss_lower_height,pad:base+r.boss_total_height,
    pcbBottom:base+d.stack.board_solder,pcbTop:base+d.stack.board_solder+d.pcb.thickness,
    flange:base+r.copper_to_flange,lead:base+r.copper_to_flange+d.package.support_height};
}

export function dimensionFor(key,r,layout) {
  const d=r.design,c=d.copper,p=d.package,b=d.pcb,l=d.layout,z=referenceLevels(r),I=r.boss_length,H=r.boss_width;
  const hx=c.base_length/2-c.hole_edge_offset,hy=c.base_width/2-c.hole_edge_offset;
  const padX=(I-c.pad_size)/2,padY=(H-c.pad_size)/2;
  const candidates=layout?.cells.filter(cell=>cell.full)||[];
  const cell=candidates.find(cell=>candidates.some(other=>Math.abs(other.y-cell.y)<1e-6&&Math.abs(other.x-cell.x-layout.pitch)<1e-6))||candidates[0]||{x:0,y:b.opening_width/2+2};
  const v=(a,b,mode,value,note='',offset=[0,0,1.5])=>({a,b,mode,value,note,offset,key});
  const map={
    'package.length':()=>v([-p.length/2,-p.width/2,z.flange],[p.length/2,-p.width/2,z.flange],'assembly',p.length,'PA flange 長度',[0,-2,0]),
    'package.width':()=>v([p.length/2,-p.width/2,z.flange],[p.length/2,p.width/2,z.flange],'assembly',p.width,'PA flange 寬度',[2,0,0]),
    'package.max_tolerance':()=>v([p.length/2-p.max_tolerance/2,0,z.flange],[p.length/2+p.max_tolerance/2,0,z.flange],'assembly',p.max_tolerance,`PA 尺寸公差 ±${p.max_tolerance}；虛線為最大外框 ${(p.length+p.max_tolerance).toFixed(3)} × ${(p.width+p.max_tolerance).toFixed(3)} mm`,[3,0,2]),
    'package.support_height':()=>v([I/2,0,z.flange],[I/2,0,z.lead],'assembly',p.support_height,'flange 至引腳底面 SPH',[4,0,0]),
    'pcb.opening_length':()=>v([-b.opening_length/2,0,z.pcbTop],[b.opening_length/2,0,z.pcbTop],'assembly',b.opening_length,'PCB 開孔長度 M',[0,-b.opening_width/2-2,0]),
    'pcb.opening_width':()=>v([0,-b.opening_width/2,z.pcbTop],[0,b.opening_width/2,z.pcbTop],'assembly',b.opening_width,'PCB 開孔寬度 N',[b.opening_length/2+3,0,0]),
    'pcb.thickness':()=>v([b.opening_length/2+2,0,z.pcbBottom],[b.opening_length/2+2,0,z.pcbTop],'assembly',b.thickness,'PCB 板厚 C',[5,0,0]),
    'pcb.relief_diameter':()=>v([b.opening_length/2,b.opening_width/2-b.relief_diameter,z.pcbTop],[b.opening_length/2,b.opening_width/2,z.pcbTop],'assembly',b.relief_diameter,'PCB 開孔側向 relief 直徑 O',[2,0,1]),
    'pcb.placement_accuracy':()=>v([p.length/2,0,z.pcbTop],[p.length/2+b.placement_accuracy,0,z.pcbTop],'assembly',b.placement_accuracy,'放置精度：開孔建議值的增量',[3,0,3]),
    'pcb.opening_tolerance':()=>v([b.opening_length/2,0,z.pcbTop],[b.opening_length/2+b.opening_tolerance,0,z.pcbTop],'assembly',b.opening_tolerance,'PCB 開孔尺寸公差增量',[3,0,3]),
    'copper.base_length':()=>v([-c.base_length/2,-c.base_width/2,z.base],[c.base_length/2,-c.base_width/2,z.base],'copper',c.base_length,'銅塊基座長度 E',[0,-3,0]),
    'copper.base_width':()=>v([-c.base_length/2,-c.base_width/2,z.base],[-c.base_length/2,c.base_width/2,z.base],'copper',c.base_width,'銅塊基座寬度 F',[-3,0,0]),
    'copper.base_thickness':()=>v([c.base_length/2,0,0],[c.base_length/2,0,z.base],'copper',c.base_thickness,'銅塊基座厚度 G',[3,0,0]),
    'copper.corner_radius':()=>v([c.base_length/2-c.corner_radius,c.base_width/2-c.corner_radius,z.base],[c.base_length/2-c.corner_radius+c.corner_radius/Math.SQRT2,c.base_width/2-c.corner_radius+c.corner_radius/Math.SQRT2,z.base],'copper',c.corner_radius,'銅塊四角半徑 R',[1,1,1]),
    'copper.hole_diameter':()=>v([hx-c.hole_diameter/2,hy,z.base],[hx+c.hole_diameter/2,hy,z.base],'copper',c.hole_diameter,'吊掛／定位孔直徑 D',[0,0,1.5]),
    'copper.hole_edge_offset':()=>v([hx,hy,z.base],[c.base_length/2,hy,z.base],'copper',c.hole_edge_offset,'定位孔中心至基座外邊 C',[0,2,1]),
    'copper.pad_size':()=>v([padX-c.pad_size/2,padY-c.pad_size/2,z.pad],[padX+c.pad_size/2,padY-c.pad_size/2,z.pad],'copper',c.pad_size,'四角小凸台邊長 J',[0,-2,1]),
    'stack.lead_solder':()=>v([I/2+1,0,z.pcbTop],[I/2+1,0,z.lead],'assembly',d.stack.lead_solder,'引腳底面與 PCB 頂面間錫厚 A',[5,0,0]),
    'stack.board_solder':()=>v([c.base_length/2-2,0,z.base],[c.base_length/2-2,0,z.pcbBottom],'assembly',d.stack.board_solder,'銅塊頂面與 PCB 底面間錫厚 B',[5,0,0]),
    'stack.flange_gap':()=>v([I/2,0,z.boss],[I/2,0,z.flange],'assembly',d.stack.flange_gap,'大凸台平面到 PA flange 間距 D',[5,0,0]),
    'stack.pad_height':()=>v([padX,padY,z.boss],[padX,padY,z.pad],'copper',d.stack.pad_height,'小凸台高度 K',[2,1,0]),
    'preform.chamfer':()=>v([-I/2,-H/2,0],[-I/2+d.preform.chamfer,-H/2,0],'preform',d.preform.chamfer,'45° 削角的直角邊長 Y',[0,-2,1]),
    'preform.trial_delta':()=>v([0,0,r.calculated_thickness],[0,0,r.calculated_thickness+d.preform.trial_delta],'preform',d.preform.trial_delta,'試片厚度 ±Δ（非目前零件厚度）',[I/2+2,0,0]),
    'preform.thickness_override':()=>v([I/2,0,0],[I/2,0,r.model_thickness],'preform',r.model_thickness,d.preform.thickness_override===null?'自動採計算厚度 Z':'目前指定的錫片厚度',[2,0,0]),
    'layout.border_width':()=>v([c.base_length/2,0,z.base],[c.base_length/2+l.border_width,0,z.base],'layout',l.border_width,'Cu 外邊至外框綠漆邊界 R',[0,0,1]),
    'layout.epad_size':()=>v([cell.x-l.epad_size/2,cell.y-l.epad_size/2,z.base],[cell.x+l.epad_size/2,cell.y-l.epad_size/2,z.base],'layout',l.epad_size,'單格 E-PAD 開窗邊長 S',[0,-1,1]),
    'layout.web_width':()=>v([cell.x+l.epad_size/2,cell.y,z.base],[cell.x+l.epad_size/2+l.web_width,cell.y,z.base],'layout',l.web_width,'相鄰 E-PAD 間的綠漆筋 T',[0,0,1]),
    'layout.hole_clearance':()=>v([hx-l.hole_clearance/2,hy,z.base],[hx+l.hole_clearance/2,hy,z.base],'layout',l.hole_clearance,'定位孔 E-PAD 避讓直徑 V',[0,0,1]),
  };
  return map[key]?.()||null;
}
