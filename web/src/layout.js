import clipping from 'polygon-clipping';
import { formatDimension } from './dimension-format.js';
import { copperFootprint } from './copper-geometry.js';
import { toleranceSuffix } from './tolerances.js';

// Curved clipping boundaries use a maximum 0.001 mm chord deviation. The same
// polygons drive the reference viewer and the Layout DXF (no guessed outlines).
export const CHORD_TOLERANCE = .001;
const close = p => [...p, p[0]];
export const rectangle = (x, y, w, h) => [[close([[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2]])]];
export function circle(x, y, r) {
  const n = Math.max(24, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1-CHORD_TOLERANCE/r)) / 4) * 4);
  return [[close(Array.from({ length: n }, (_, i) => [x+r*Math.cos(2*Math.PI*i/n), y+r*Math.sin(2*Math.PI*i/n)]))]];
}
export function roundedRectangle(w, h, r) {
  const n = Math.max(6, Math.ceil(Math.PI / 2 / Math.acos(Math.max(-1, 1-CHORD_TOLERANCE/r))));
  const points = [];
  for (const [x,y,start] of [[w/2-r,h/2-r,0],[-w/2+r,h/2-r,Math.PI/2],[-w/2+r,-h/2+r,Math.PI],[w/2-r,-h/2+r,Math.PI*1.5]])
    for (let i=0;i<=n;i++) points.push([x+r*Math.cos(start+i*Math.PI/2/n),y+r*Math.sin(start+i*Math.PI/2/n)]);
  return [[close(points)]];
}
export function pcbCutout(r) {
  const b = r.design.pcb, radius = b.relief_diameter/2;
  const [cx,cy]=r.boss_center||[0,0];
  const pieces = [rectangle(cx,cy,b.opening_length,b.opening_width)];
  // p7/p9 show four outward side semicircles. The p12 solder calculation uses
  // its stated effective pi*r² term independently; do not change that formula.
  for (const x of [-1,1]) for (const y of [-1,1]) pieces.push(circle(cx+x*b.opening_length/2,cy+y*(b.opening_width/2-radius),radius));
  return clipping.union(...pieces);
}
export function area(polygons) {
  const ringArea = ring => Math.abs(ring.reduce((sum,p,i) => {const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2);
  return polygons.reduce((sum,polygon)=>sum+ringArea(polygon[0])-polygon.slice(1).reduce((s,ring)=>s+ringArea(ring),0),0);
}

export function layoutGeometry(r) {
  const c=r.design.copper,l=r.design.layout,b=r.design.pcb;
  const [cx,cy]=r.boss_center||[0,0],footprint=copperFootprint(c);
  const pitch=l.epad_size+l.web_width;
  const nx=Math.ceil((c.base_length/2+Math.abs(cx))/pitch)+1, ny=Math.ceil((c.base_width/2+Math.abs(cy))/pitch)+1;
  if ((2*nx+1)*(2*ny+1)>12000) throw new Error('E-PAD 格數超過12000，請縮小基座範圍或放大格距。');
  const copper=footprint.outer;
  const outer=roundedRectangle(c.base_length+2*l.border_width,c.base_width+2*l.border_width,c.corner_radius+l.border_width);
  const cutout=pcbCutout(r);
  const centers=footprint.centers;
  const clearances=centers.map(([x,y])=>circle(x,y,l.hole_clearance/2));
  const holes=footprint.holes;
  const allowed=clipping.difference(copper,cutout,...clearances,...holes);
  const pads=[],cells=[];
  for(let ix=-nx;ix<=nx;ix++) for(let iy=-ny;iy<=ny;iy++) {
    const x=cx+ix*pitch,y=cy+iy*pitch;
    if(Math.abs(x)-l.epad_size/2>c.base_length/2 || Math.abs(y)-l.epad_size/2>c.base_width/2) continue;
    const window=clipping.intersection(rectangle(x,y,l.epad_size,l.epad_size),allowed);
    if(!window.length || area(window)<1e-8) continue;
    pads.push(...window); cells.push({x,y,full:Math.abs(area(window)-l.epad_size**2)<1e-6});
  }
  // V marks the diameter excluded from E-PADs. Green mask retains the V-to-D
  // annulus around each real mounting hole, as illustrated on slide 9.
  if(!pads.length)throw new Error('目前尺寸未留下可用 E-PAD，請檢查基座、開孔與格距。');
  const mask=clipping.difference(outer,cutout,...holes,pads);
  const board=clipping.difference(rectangle(0,0,c.base_length+10,c.base_width+10),cutout,...holes);
  const marginX=c.base_length/2-Math.max(...pads.flatMap(p=>p[0].map(v=>Math.abs(v[0]))));
  const marginY=c.base_width/2-Math.max(...pads.flatMap(p=>p[0].map(v=>Math.abs(v[1]))));
  return {copper,copperProfile:footprint.profile,copperFootprint:footprint,outer,cutout,clearances,holes,centers,pads,cells,mask,board,pitch,origin:[cx,cy],
    chord_tolerance:CHORD_TOLERANCE,epad_area:area(pads),mask_area:area(mask),
    boundary_margins:[marginX,marginY],
    notes:[
      'PPT p9: R=outer green-mask band, S=nominal square E-PAD, T=green web, U=PCB cutout, V=E-PAD exclusion diameter.',
      'Grid centers follow the PCB opening/main-boss center; edge/corner windows are clipped to the true copper profile, including hole breakouts. A boundary falling in a web may leave an edge web; Layout must confirm edge treatment.',
      'Green mask retains the annulus between actual mounting hole D and E-PAD exclusion V. Layer polarity is explicit in the DXF.',
      'PCB relief outline follows p7/p9 side semicircles; solder volume retains the p12 effective pi*r² formula.',
      'R outer band is interpreted outside the copper boundary per p9 illustration. Curved clipping chord tolerance is 0.001 mm.',
    ]};
}

export function layoutDxf(r,g=layoutGeometry(r)) {
  const out=[], put=(...v)=>v.forEach(x=>out.push(String(x)));
  const dimension=(name,value,key,extra={})=>formatDimension(name,value,{cad:true,tolerance:key?toleranceSuffix(r.design,key).replaceAll('−','-'):'',...extra});
  put(0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1024',9,'$INSUNITS',70,4,9,'$MEASUREMENT',70,1,0,'ENDSEC',0,'SECTION',2,'TABLES');
  put(0,'TABLE',2,'LTYPE',5,'10',330,'0',100,'AcDbSymbolTable',70,1,0,'LTYPE',2,'CONTINUOUS',70,0,3,'Solid line',72,65,73,0,40,0,0,'ENDTAB');
  const layers={SOLDER_MASK:3,EPAD_OPENING:8,PCB_CUTOUT:1,COPPER_BOUNDARY:30,MASK_BOUNDARY:3,HOLE_CLEARANCE:2,MOUNT_HOLE:1,NOTES:7};
  put(0,'TABLE',2,'LAYER',5,'20',330,'0',100,'AcDbSymbolTable',70,Object.keys(layers).length+1,0,'LAYER',2,'0',70,0,62,7,6,'CONTINUOUS');
  for(const [name,color]of Object.entries(layers))put(0,'LAYER',2,name,70,0,62,color,6,'CONTINUOUS');
  put(0,'ENDTAB',0,'ENDSEC',0,'SECTION',2,'ENTITIES');
  const poly=(ring,layer)=>{const points=ring.slice(0,-1);put(0,'LWPOLYLINE',100,'AcDbEntity',8,layer,100,'AcDbPolyline',90,points.length,70,1);for(const[x,y]of points)put(10,x,20,y);};
  const hatch=(polygon,layer)=>{
    put(0,'HATCH',100,'AcDbEntity',8,layer,100,'AcDbHatch',10,0,20,0,30,0,210,0,220,0,230,1,2,'SOLID',70,1,71,0,91,polygon.length);
    polygon.forEach((ring,i)=>{const points=ring.slice(0,-1);put(92,i===0?3:2,72,0,73,1,93,points.length);for(const[x,y]of points)put(10,x,20,y);put(97,0);});
    put(75,0,76,1,98,0);
  };
  for(const polygon of g.mask){polygon.forEach(ring=>poly(ring,'SOLDER_MASK'));hatch(polygon,'SOLDER_MASK');}
  for(const polygon of g.pads){polygon.forEach(ring=>poly(ring,'EPAD_OPENING'));hatch(polygon,'EPAD_OPENING');}
  for(const [shapes,layer]of [[g.copperProfile,'COPPER_BOUNDARY'],[g.outer,'MASK_BOUNDARY'],[g.cutout,'PCB_CUTOUT']])for(const polygon of shapes)polygon.forEach(ring=>poly(ring,layer));
  for(const[x,y]of g.centers)for(const[layer,d]of [['HOLE_CLEARANCE',r.design.layout.hole_clearance],['MOUNT_HOLE',r.design.copper.hole_diameter]])put(0,'CIRCLE',100,'AcDbEntity',8,layer,100,'AcDbCircle',10,x,20,y,30,0,40,d/2);
  const l=r.design.layout, notes=[`LAYOUT / ${r.design.name} / mm / 1:1 / PPT p9`,`SOLDER_MASK = green covered area; EPAD_OPENING = exposed pad / mask opening`,
    [['R',l.border_width,'layout.border_width'],['S',l.epad_size,'layout.epad_size'],['T',l.web_width,'layout.web_width'],['Pitch',g.pitch]].map(([name,value,key])=>dimension(name,value,key)).join('; '),
    `U = PCB window: ${dimension('M',r.design.pcb.opening_length,'pcb.opening_length')}; ${dimension('N',r.design.pcb.opening_width,'pcb.opening_width')}; ${dimension('V',l.hole_clearance,'layout.hole_clearance',{prefix:'⌀'})}`,
    `Origin = copper base center; PCB/E-PAD center X = ${(g.origin||[0,0])[0]} mm; Y = ${(g.origin||[0,0])[1]} mm; cells = ${g.cells.length}`,
    'V excludes E-PADs; green annulus remains between actual hole D and V.',
    'Reference layers COPPER_BOUNDARY / PCB_CUTOUT / HOLE_CLEARANCE are not mask polygons.',
    'P7 relief outline and p12 effective-volume formula are retained independently.',
    'Outer R band is outside copper outline. Curved clipping chord deviation <=0.001mm.',
    'Edge landing in a web: confirm edge treatment with Layout before manufacture.'];
  notes.push('Unspecified tolerances are not manufacturing zero limits; see report.json.');
  notes.forEach((text,i)=>put(0,'TEXT',100,'AcDbEntity',8,'NOTES',100,'AcDbText',10,r.design.copper.base_length/2+l.border_width+4,20,18-i*1.7,30,0,40,.8,1,text,100,'AcDbText'));
  put(0,'ENDSEC',0,'EOF');return out.join('\n')+'\n';
}
