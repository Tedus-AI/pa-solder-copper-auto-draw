import { octagon } from './design.js';
import { formatDimension } from './dimension-format.js';
import { copperFootprint } from './copper-geometry.js';
import { toleranceSuffix } from './tolerances.js';

export function drawing(r, part) {
  const out = [], put = (...pairs) => pairs.forEach(v => out.push(String(v)));
  const entity = (type, layer, subclass, ...pairs) => put(0, type, 100, 'AcDbEntity', 8, layer, 100, subclass, ...pairs);
  const dimension=(name,value,options={})=>formatDimension(name,value,{cad:true,...options});
  const tolerance=key=>toleranceSuffix(r.design,key).replaceAll('−','-');
  const size=(name,value,key,options={})=>dimension(name,value,{tolerance:tolerance(key),...options});
  const line = (a, b, layer = 'DIM') => entity('LINE', layer, 'AcDbLine', 10, a[0], 20, a[1], 30, 0, 11, b[0], 21, b[1], 31, 0, ...(layer==='CENTER'?[48,.5]:[]));
  const text = (s, x, y, h = 1, layer = 'NOTES', rotation = 0, centered = false) => entity('TEXT', layer, 'AcDbText', 10, x, 20, y, 30, 0, 40, h, 1, s, 50, rotation, 72, centered?1:0, 11, x, 21, y, 31, 0, 100, 'AcDbText', 73, 0);
  const poly = (points, layer = 'OUTLINE') => {
    entity('LWPOLYLINE', layer, 'AcDbPolyline', 90, points.length, 70, 1);
    for (const [x, y, bulge = 0] of points) put(10, x, 20, y, 42, bulge);
  };
  const rect = (x, y, w, h, layer) => poly([[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]], layer);
  const arrow=(tip,direction,length=.8)=>{
    const n=Math.hypot(...direction),u=direction.map(v=>v/n),base=[tip[0]+u[0]*length,tip[1]+u[1]*length],normal=[-u[1]*.22,u[0]*.22];
    const a=[base[0]+normal[0],base[1]+normal[1]],b=[base[0]-normal[0],base[1]-normal[1]];
    entity('SOLID','DIM','AcDbTrace',10,tip[0],20,tip[1],30,0,11,a[0],21,a[1],31,0,12,b[0],22,b[1],32,0,13,b[0],23,b[1],33,0);
  };
  const centerMark=(center,r,extra=.9)=>{line([center[0]-r-extra,center[1]],[center[0]+r+extra,center[1]],'CENTER');line([center[0],center[1]-r-extra],[center[0],center[1]+r+extra],'CENTER');};
  const dim = (a, b, offset, label, vertical = false) => {
    const p1 = vertical ? [offset, a[1]] : [a[0], offset], p2 = vertical ? [offset, b[1]] : [b[0], offset];
    line(a, p1); line(b, p2); line(p1, p2);
    for (const [p, dir] of [[p1, 1], [p2, -1]]) {
      if (vertical) { line(p, [p[0] - .2, p[1] + dir * .6]); line(p, [p[0] + .2, p[1] + dir * .6]); }
      else { line(p, [p[0] + dir * .6, p[1] - .2]); line(p, [p[0] + dir * .6, p[1] + .2]); }
    }
    text(label, (p1[0] + p2[0]) / 2 + (vertical?-.8:0), (p1[1] + p2[1]) / 2 + (vertical?0:.8), .85, 'DIM', vertical?90:0, true);
  };
  put(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1024', 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC');
  put(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 5, '10', 330, '0', 100, 'AcDbSymbolTable', 70, 2, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0);
  put(0,'LTYPE',2,'CENTER',70,0,3,'Center: long dash, gap, short dash, gap',72,65,73,4,40,4,49,2.4,74,0,49,-.6,74,0,49,.4,74,0,49,-.6,74,0,0,'ENDTAB');
  const layers = ['0', 'OUTLINE', 'BOSS', 'PAD', 'HOLES', 'SIDE', 'DIM', 'NOTES','CENTER'];
  put(0, 'TABLE', 2, 'LAYER', 5, '20', 330, '0', 100, 'AcDbSymbolTable', 70, layers.length);
  layers.forEach((name, i) => put(0, 'LAYER', 2, name, 70, 0, 62, name==='CENTER'?8:i % 7 + 1, 6, name==='CENTER'?'CENTER':'CONTINUOUS'));
  put(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  const c = r.design.copper, I = r.boss_length, H = r.boss_width;
  const [bx,by]=r.boss_center||[0,0];
  const notes = [];
  if (part === 'copper') {
    const x = c.base_length / 2, y = c.base_width / 2, R = c.corner_radius, b = Math.tan(Math.PI / 8);
    const footprint=copperFootprint(c),separate=Math.hypot(footprint.centers[0][0]-footprint.centers[1][0],footprint.centers[0][1]-footprint.centers[1][1])>c.hole_diameter+1e-8;
    if(footprint.closed_holes.every(Boolean)&&separate){
      poly([[-x + R, -y], [x - R, -y, b], [x, -y + R], [x, y - R, b], [x - R, y], [-x + R, y, b], [-x, y - R], [-x, -y + R, b]]);
      for(const[hx,hy]of footprint.centers)entity('CIRCLE','HOLES','AcDbCircle',10,hx,20,hy,30,0,40,c.hole_diameter/2);
    }else{
      // Broken holes are open notches in the true outer profile, not complete
      // circles drawn over material that no longer exists.
      for(const polygon of footprint.profile)polygon.forEach((ring,i)=>poly(ring.slice(0,-1),i?'HOLES':'OUTLINE'));
    }
    rect(bx, by, I, H, 'BOSS');
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) rect(bx+sx * (I - c.pad_size) / 2, by+sy * (H - c.pad_size) / 2, c.pad_size, c.pad_size, 'PAD');
    dim([-x, y], [x, y], y + 5, size('E',c.base_length,'copper.base_length'));
    dim([-x, -y], [-x, y], -x - 5, size('F',c.base_width,'copper.base_width'), true);
    dim([bx-I / 2, by], [bx+I / 2, by], y + 2, size('I',I,'boss.length'));
    dim([bx, by-H / 2], [bx, by+H / 2], x + 5, size('H',H,'boss.width'), true);
    dim([-x,by],[bx,by],-y-5,size('Xc',bx+x,'boss.center_from_left'));
    dim([bx,-y],[bx,by],-x-10,size('Yc',by+y,'boss.center_from_bottom'),true);
    const radiusLabel=size('R',R,'copper.corner_radius',{quantity:4,minDigits:2});
    const diameterLabel=size('D',c.hole_diameter,'copper.hole_diameter',{quantity:2,featureSymbol:'⌀',prefix:'',minDigits:2});
    // Put the radius arrow on an actual surviving arc. A broken drilling cut
    // can remove the first corner, in which case the adjacent upper arc is used.
    const candidates=[[1,1],[-1,1],[1,-1],[-1,-1]].map(([sx,sy])=>{
      const center=[sx*(x-R),sy*(y-R)],direction=[sx/Math.SQRT2,sy/Math.SQRT2],tip=[center[0]+direction[0]*R,center[1]+direction[1]*R];
      return{sx,sy,center,direction,tip};
    });
    const corner=candidates.find(({tip})=>footprint.centers.every(([hx,hy])=>Math.hypot(tip[0]-hx,tip[1]-hy)>c.hole_diameter/2+1e-7));
    if(corner){
      // The arrow touches the arc from outside. The slanted value follows the
      // same straight leader; no line or centre mark is drawn inside the part.
      const{direction,tip}=corner,length=Math.max(8,radiusLabel.replaceAll('%%p','±').length*.48);
      const start=tip.map((v,i)=>v+direction[i]*3.5),end=start.map((v,i)=>v+direction[i]*(length+.5));
      line(tip,end);arrow(tip,direction);
      let angle=Math.atan2(direction[1],direction[0])*180/Math.PI,anchor=start;
      if(angle>90||angle< -90){angle+=angle>90?-180:180;anchor=end;}
      const radians=angle*Math.PI/180,normal=[-Math.sin(radians),Math.cos(radians)];
      text(radiusLabel,anchor[0]+normal[0]*.65,anchor[1]+normal[1]*.65,.85,'DIM',angle);
    }
    for(const center of footprint.centers)centerMark(center,c.hole_diameter/2);
    // A horizontal diametral line through the nearby upper hole avoids the
    // separate upper radius leader and the H dimension below it.
    const hole=footprint.centers[1],radius=c.hole_diameter/2,diameterA=[hole[0]-radius,hole[1]],diameterB=[hole[0]+radius,hole[1]],outside=c.hole_diameter<2;
    line(diameterA,diameterB);arrow(diameterA,[outside?-1:1,0],Math.min(.8,Math.max(.4,radius*.4)));arrow(diameterB,[outside?1:-1,0],Math.min(.8,Math.max(.4,radius*.4)));
    if(outside)line([diameterA[0]-1,diameterA[1]],[diameterB[0]+1,diameterB[1]]);
    const knee=[x+3,hole[1]],shelf=Math.max(8,diameterLabel.replaceAll('%%c','⌀').replaceAll('%%p','±').length*.48);
    line(diameterB,knee);line(knee,[knee[0]+shelf,knee[1]]);text(diameterLabel,knee[0]+.2,knee[1]+.7,.85,'DIM');
    const g = c.base_thickness, low = r.boss_lower_height, k = r.design.stack.pad_height, j = c.pad_size;
    const profile = (cx, baseline, base, boss,offset) => {
      const e = base / 2, w = boss / 2,center=cx+offset;
      poly([[cx - e, baseline], [cx + e, baseline], [cx + e, baseline + g], [center + w, baseline + g], [center + w, baseline + g + low + k],
        [center + w - j, baseline + g + low + k], [center + w - j, baseline + g + low], [center - w + j, baseline + g + low],
        [center - w + j, baseline + g + low + k], [center - w, baseline + g + low + k], [center - w, baseline + g], [cx - e, baseline + g]], 'SIDE');
    };
    profile(0, -y - 16, c.base_length, I,bx); profile(x + c.base_width / 2 + 20, -y - 16, c.base_width, H,by);
    notes.push(`COPPER / ${r.design.name} / mm / views 1:1`, `${size('G',g,'copper.base_thickness')}; ${radiusLabel}`, `${diameterLabel} THRU; ${size('C',c.hole_edge_offset,'copper.hole_edge_offset')}`,
      size('CuH(L)',r.boss_total_height,'boss.total_height'), `${size('J',j,'copper.pad_size',{quantity:4,minDigits:2})}; ${size('K',k,'stack.pad_height',{quantity:4,minDigits:2})}`,
      `${size('Xc',bx+x,'boss.center_from_left')}; ${size('Yc',by+y,'boss.center_from_bottom')}`,
      footprint.closed_holes.every(Boolean)?'Mounting holes enclosed by the rounded base.':`Open corner cuts = ${footprint.breakouts}; tool misses = ${footprint.outside_holes}; tangencies = ${footprint.tangent_holes}; profile chord <= ${footprint.chord_tolerance} mm`,
      'Finish: electroless Ni <1.5um; matte Sn 1.5-3.5um', 'E/F require thermal and RF approval', dimension('HSK depth',r.heatsink_depth,{tolerance:'±0.05'}),
      'Unspecified tolerances are not manufacturing zero limits; see report.json.');
  } else {
    poly(octagon(I, H, r.design.preform.chamfer));
    dim([-I / 2, 0], [I / 2, 0], H / 2 + 4, size('W',I,'preform.length'));
    dim([0, -H / 2], [0, H / 2], -I / 2 - 4, size('X',H,'preform.width'), true);
    rect(0, -H / 2 - 10, I, r.model_thickness, 'SIDE');
    notes.push(`SOLDER PREFORM / ${r.design.name} / mm / views 1:1`, `45deg chamfer: ${size('Y',r.design.preform.chamfer,'preform.chamfer',{quantity:4,minDigits:2})}`,
      size('Z',r.model_thickness,'preform.thickness_override',{digits:6}), 'SAC305: 96.5Sn3Ag0.5Cu, coated with 0.5% F8 flux', dimension('A1',r.preform_area,{digits:6,unit:'mm2'}),
      `Trial Z = ${r.trial_thicknesses.map(v => v.toFixed(6)).join(' / ')} mm`, 'See report.json; final thickness selected by sectioning');
  }
  const startX = part === 'copper' ? c.base_length / 2 + 30 : I / 2 + 12;
  notes.forEach((v, i) => text(v, startX, 15 - i * 2, .9));
  put(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}
