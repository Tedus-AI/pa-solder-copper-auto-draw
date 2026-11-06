import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import { calculate, defaults, fields } from '../src/design.js';
import { layoutGeometry, layoutDxf, area } from '../src/layout.js';
import { dimensionFor, referenceLevels } from '../src/dimensions.js';
const r=calculate(defaults),g=layoutGeometry(r);
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);

test('PPT p9 defaults and centered E-PAD pitch',()=>{
  assert.deepEqual(r.design.layout,{border_width:1,epad_size:1.5,web_width:.3,hole_clearance:4});
  near(g.pitch,1.8);assert.ok(g.cells.length>200);
  for(const cell of g.cells){near(cell.x/g.pitch,Math.round(cell.x/g.pitch));near(cell.y/g.pitch,Math.round(cell.y/g.pitch));}
  for(const margin of g.boundary_margins)near(margin,0,.001);
});
test('mask and exposed E-PADs partition the printable region without overlap',()=>{
  const printable=clipping.difference(g.outer,g.cutout,...g.holes);
  near(area(g.mask)+area(g.pads),area(printable),1e-5);
  near(area(clipping.intersection(g.mask,g.pads)),0);
  near(area(clipping.intersection(g.pads,g.cutout)),0);
  for(const clearance of g.clearances)near(area(clipping.intersection(g.pads,clearance)),0);
});
test('outer R mask band and hole D-to-V annulus are covered',()=>{
  const ring=clipping.difference(g.outer,g.copper);
  near(area(clipping.intersection(g.mask,ring)),area(ring));
  for(let i=0;i<2;i++){
    const annulus=clipping.difference(g.clearances[i],g.holes[i],g.cutout);
    near(area(clipping.intersection(g.mask,annulus)),area(annulus));
  }
});
test('mask settings cannot alter copper/preform manufacturing volumes',()=>{
  const d=structuredClone(defaults);d.layout.epad_size=2;d.layout.web_width=.4;d.layout.border_width=1.5;
  const changed=calculate(d),cg=layoutGeometry(changed);
  near(changed.copper_volume,r.copper_volume);near(changed.model_thickness,r.model_thickness);
  assert.notEqual(cg.cells.length,g.cells.length);
});
test('Layout DXF encodes mm, distinct polarity layers and hatch holes',()=>{
  const text=layoutDxf(r,g);
  for(const layer of ['SOLDER_MASK','EPAD_OPENING','PCB_CUTOUT','COPPER_BOUNDARY','MASK_BOUNDARY','HOLE_CLEARANCE','MOUNT_HOLE'])assert.ok(text.includes(`\n2\n${layer}\n`));
  assert.ok(text.includes('$INSUNITS\n70\n4'));assert.ok(text.includes('\nHATCH\n'));
  assert.ok(text.includes('green covered area'));assert.ok(text.endsWith('0\nEOF\n'));
});
test('invalid keepout and excessively dense array rejected',()=>{
  const d=structuredClone(defaults);d.layout.hole_clearance=2;assert.ok(calculate(d).warnings.some(w=>w.includes('避讓')));
  d.layout.hole_clearance=4;d.layout.epad_size=.01;d.layout.web_width=.01;assert.throws(()=>layoutGeometry(calculate(d)),/12000/);
});
test('reference assembly stack exactly preserves A B C D K and SPH',()=>{
  const z=referenceLevels(r);
  near(z.pcbBottom-z.base,defaults.stack.board_solder);
  near(z.pcbTop-z.pcbBottom,defaults.pcb.thickness);
  near(z.lead-z.pcbTop,defaults.stack.lead_solder);
  near(z.flange-z.boss,defaults.stack.flange_gap);
  near(z.pad-z.boss,defaults.stack.pad_height);
  near(z.lead-z.flange,defaults.package.support_height);
});
test('every numeric cell maps to an actual dimension segment of the correct length',()=>{
  for(const[group,[,names]]of Object.entries(fields))for(const key of Object.keys(names)){
    const dim=dimensionFor(`${group}.${key}`,r,g);assert.ok(dim,`${group}.${key}`);
    near(Math.hypot(...dim.a.map((n,i)=>n-dim.b[i])),dim.value);
    assert.ok(['assembly','copper','preform','layout'].includes(dim.mode));
  }
});
