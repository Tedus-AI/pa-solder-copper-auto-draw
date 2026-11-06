// One notation for screen callouts, summaries and DXF text. Symbols refer to
// the source drawing; descriptive names are used where no code was assigned.
export const dimensionSpecs = {
  'package.length': { name: 'PA(L)' },
  'package.width': { name: 'PA(W)' },
  'package.support_height': { name: 'SPH' },
  'pcb.opening_length': { name: 'M' },
  'pcb.opening_width': { name: 'N' },
  'pcb.thickness': { name: 'C' },
  'pcb.relief_diameter': { name: 'O', quantity:4, featureSymbol:'⌀', minDigits:2, kind: 'diameter' },
  'copper.base_length': { name: 'E' },
  'copper.base_width': { name: 'F' },
  'copper.base_thickness': { name: 'G' },
  'copper.corner_radius': { name: 'R', quantity:4, minDigits:2, kind: 'radius' },
  'copper.hole_diameter': { name: 'D', quantity:2, featureSymbol:'⌀', minDigits:2, kind: 'diameter' },
  'copper.hole_edge_offset': { name: 'C' },
  'copper.pad_size': { name: 'J', quantity:4, minDigits:2 },
  'boss.length': { name: 'I' },
  'boss.width': { name: 'H' },
  'boss.total_height': { name: 'L' },
  'boss.center_from_left': { name: 'Xc' },
  'boss.center_from_bottom': { name: 'Yc' },
  'stack.lead_solder': { name: 'A' },
  'stack.board_solder': { name: 'B' },
  'stack.flange_gap': { name: 'D' },
  'stack.pad_height': { name: 'K', quantity:4, minDigits:2 },
  'preform.length': { name: 'W' },
  'preform.width': { name: 'X' },
  'preform.chamfer': { name: 'Y', quantity:4, minDigits:2 },
  'preform.thickness_override': { name: 'Z' },
  'preform.trial_delta': { name: '試片厚度增減量', prefix: '±' },
  'layout.border_width': { name: 'R' },
  'layout.epad_size': { name: 'S' },
  'layout.web_width': { name: 'T' },
  'layout.hole_clearance': { name: 'V', quantity:2, featureSymbol:'⌀', minDigits:2, kind: 'diameter' },
};

export const formatNumber=(value,digits=4)=>{
  const rounded=Number(value.toFixed(digits));
  return rounded===0&&value!==0?Number(value.toPrecision(Math.max(1,digits))).toString():rounded.toString();
};
export function formatDimension(name,value,{prefix='',tolerance='',digits=4,minDigits=0,quantity=1,featureSymbol='',unit='mm',cad=false}={}) {
  let number=formatNumber(value,digits);
  if(minDigits&&!number.includes('e')){
    const [whole,fraction='']=number.split('.');
    number=`${whole}.${fraction.padEnd(minDigits,'0')}`;
  }
  const text=`${quantity>1?quantity+'-':''}${featureSymbol}${name} = ${prefix}${number}${tolerance?' '+tolerance:''} ${unit}`;
  return cad?text.replaceAll('⌀','%%c').replaceAll('±','%%p').replaceAll('−','-'):text;
}
export function dimensionLabel(dimension) {
  const spec=dimensionSpecs[dimension.key];
  if(!spec)throw new Error(`Missing dimension notation: ${dimension.key}`);
  return formatDimension(spec.name,dimension.value,{...spec,tolerance:dimension.toleranceSuffix||''});
}
