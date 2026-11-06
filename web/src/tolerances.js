const entry=(minus,plus,source='未指定')=>({minus,plus,source});
export const toleranceDefaults={
  'package.length':entry(.127,.127,'PPT 第8頁上限 +0.127；下偏差依目前雙向公差設定'),
  'package.width':entry(.127,.127,'PPT 第8頁上限 +0.127；下偏差依目前雙向公差設定'),
  'package.support_height':entry(0,0),
  'pcb.opening_length':entry(.1,.1,'PPT 第7頁 M ±0.1 mm'),
  'pcb.opening_width':entry(.1,.1,'PPT 第7頁 N ±0.1 mm'),
  'pcb.thickness':entry(0,0),'pcb.relief_diameter':entry(0,0),
  'copper.base_length':entry(.2,.2,'PPT 第3頁 E ±0.2 mm'),
  'copper.base_width':entry(.2,.2,'PPT 第3頁 F ±0.2 mm'),
  'copper.base_thickness':entry(.1,0,'PPT 第3頁 G +0/−0.1 mm'),
  'copper.corner_radius':entry(0,0),'copper.hole_diameter':entry(0,0),
  'copper.hole_edge_offset':entry(.1,.1,'PPT 第3頁孔中心距邊 C ±0.1 mm'),
  'copper.pad_size':entry(.05,.05,'PPT 第4頁 J ±0.05 mm'),
  'boss.length':entry(.05,.05,'PPT 第4頁 I ±0.05 mm'),
  'boss.width':entry(.05,.05,'PPT 第4頁 H ±0.05 mm'),
  'boss.total_height':entry(.1,0,'PPT 第4頁 L(CuH) +0/−0.1 mm'),
  'boss.center_from_left':entry(0,0),'boss.center_from_bottom':entry(0,0),
  'stack.lead_solder':entry(0,0),'stack.board_solder':entry(0,0),'stack.flange_gap':entry(0,0),
  'stack.pad_height':entry(.05,.05,'PPT 第4頁 K ±0.05 mm'),
  'preform.length':entry(.1,.1,'PPT 第11頁 W ±0.1 mm'),
  'preform.width':entry(.1,.1,'PPT 第11頁 X ±0.1 mm'),
  'preform.chamfer':entry(0,.2,'PPT 第11頁 Y +0.2/−0 mm'),
  'preform.trial_delta':entry(0,0),
  'preform.thickness_override':entry(.02,.02,'PPT 第11頁 Z ±0.02 mm'),
  'layout.border_width':entry(0,0),'layout.epad_size':entry(0,0),'layout.web_width':entry(0,0),'layout.hole_clearance':entry(0,0),
};
const number=v=>Number(v.toFixed(6)).toString();
export const defaultTolerances=()=>Object.fromEntries(Object.entries(toleranceDefaults).map(([key,t])=>[key,{minus:t.minus,plus:t.plus}]));
export const getTolerance=(d,key)=>d.tolerances?.[key]??toleranceDefaults[key]??{minus:0,plus:0};
export function toleranceSuffix(d,key){const t=getTolerance(d,key);return t.minus===t.plus?(t.plus?`±${number(t.plus)}`:''):`+${number(t.plus)}/−${number(t.minus)}`;}
export function toleranceText(d,key){const suffix=toleranceSuffix(d,key);if(suffix)return suffix+' mm';return toleranceDefaults[key]?.source==='未指定'?'未指定（暫按 0）':'0 mm';}
export function toleranceSource(d,key){const t=getTolerance(d,key),original=toleranceDefaults[key];return !original||t.minus!==original.minus||t.plus!==original.plus?'手動設定':original.source;}
export function dimensionRange(d,key,value){const t=getTolerance(d,key);return{nominal:value,min:value-t.minus,max:value+t.plus};}
