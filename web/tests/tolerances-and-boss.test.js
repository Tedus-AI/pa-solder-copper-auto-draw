import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, defaults, fields, nativeJob } from '../src/design.js';
import { getTolerance, toleranceDefaults, toleranceSource, toleranceText } from '../src/tolerances.js';
import { copperFootprint, roundedBaseDistance } from '../src/copper-geometry.js';
import { dimensionFor, referenceLevels } from '../src/dimensions.js';
import { layoutGeometry } from '../src/layout.js';
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);

test('source tolerances preserve asymmetric signs and distinguish unknown from zero',()=>{
 for(const [key,pair]of [['copper.base_length',[.2,.2]],['copper.base_thickness',[.1,0]],['boss.length',[.05,.05]],['stack.pad_height',[.05,.05]],['preform.length',[.1,.1]],['preform.chamfer',[0,.2]],['preform.thickness_override',[.02,.02]]])assert.deepEqual(Object.values(getTolerance(defaults,key)),pair);
 assert.equal(toleranceDefaults['package.support_height'].source,'未指定');assert.match(toleranceText(defaults,'copper.corner_radius'),/未指定/);
 const d=structuredClone(defaults);d.tolerances['copper.corner_radius']={minus:.1,plus:.2};assert.equal(toleranceSource(d,'copper.corner_radius'),'手動設定');
 const keys=Object.entries(fields).flatMap(([g,[,names]])=>Object.keys(names).map(k=>`${g}.${k}`));assert.deepEqual(Object.keys(toleranceDefaults).sort(),keys.sort());
});
test('centered gap uses independent PA and PCB dimensional limits, without placement subtraction',()=>{
 const r=calculate(defaults),g=r.gap_analysis;
 near(g.x.min,.0515);near(g.x.max,.2785);near(g.y.min,.0465);near(g.y.max,.2735);
 const d=structuredClone(defaults);d.pcb.opening_mode='manual';d.tolerances['package.length']={minus:.3,plus:.4};d.tolerances['pcb.opening_length']={minus:.15,plus:.2};const changed=calculate(d);
 near(changed.gap_analysis.x.min,(20.9-.15-20.57-.4)/2);near(changed.gap_analysis.x.max,(20.9+.2-20.57+.3)/2);assert.equal(changed.gap_analysis.overlap,true);
 assert.equal(Object.hasOwn(fields.pcb[1],'placement_accuracy'),false);assert.equal(Object.hasOwn(fields.pcb[1],'opening_tolerance'),false);assert.equal(Object.hasOwn(fields.package[1],'max_tolerance'),false);
});
test('legacy tolerance files migrate, modern per-axis tolerances take priority',()=>{
 const d=structuredClone(defaults);delete d.tolerances;d.package.max_tolerance=.2;d.pcb.opening_tolerance=.15;const legacy=calculate(d);
 assert.deepEqual(getTolerance(legacy.design,'package.length'),{minus:.2,plus:.2});assert.deepEqual(getTolerance(legacy.design,'pcb.opening_width'),{minus:.15,plus:.15});
 d.tolerances={'package.width':{minus:.05,plus:.07}};const modern=calculate(d);assert.deepEqual(getTolerance(modern.design,'package.width'),{minus:.05,plus:.07});
 const invalid=structuredClone(defaults);invalid.tolerances['package.length'].minus=-.1;assert.throws(()=>calculate(invalid),/公差/);
});
test('automatic opening compensates the undersize limit of asymmetric PCB tolerances',()=>{
 const d=structuredClone(defaults);d.tolerances['pcb.opening_length']={minus:.2,plus:0};
 const delta=calculate(d);near(delta.design.pcb.opening_length,21);near(delta.opening_chain.pcb_tolerances[0],.2);near(delta.gap_analysis.x.min,.0515);
 d.pcb.opening_rule='ampleon';const ampleon=calculate(d);near(ampleon.design.pcb.opening_length,20.9);near(ampleon.opening_chain.raw[0],20.697+.066+.2/2);
});
test('rounded corner, edge datum and hole size are independent and breakouts are real',()=>{
 const base=calculate(defaults);const d=structuredClone(defaults);d.copper.hole_edge_offset=1;const broken=calculate(d),profile=copperFootprint(d.copper);
 assert.equal(broken.hole_breakouts,2);assert.equal(profile.closed_holes.every(v=>!v),true);assert.equal(profile.profile.length,1);assert.equal(profile.profile[0].length,1);
 const radius=dimensionFor('copper.corner_radius',broken);assert.ok(profile.centers.every(([x,y])=>Math.hypot(radius.b[0]-x,radius.b[1]-y)>d.copper.hole_diameter/2),'Radius must point to a surviving arc, not an arc removed by the hole');
 assert.ok(profile.area>1200-(4-Math.PI)*9-2*Math.PI*1.5**2,'Outside portions of the tool circle cannot remove material twice');
 near(broken.copper_volume,profile.area*3+broken.boss_volume);assert.ok(broken.copper_volume>base.copper_volume);
 d.copper.hole_edge_offset=3;d.copper.hole_diameter=1;const valid=calculate(d);assert.equal(valid.hole_breakouts,0);d.copper.hole_diameter=6;assert.equal(calculate(d).hole_tangencies,2);d.copper.hole_diameter=6.2;assert.equal(calculate(d).hole_breakouts,2);
 near(roundedBaseDistance(19,14,d.copper),Math.SQRT2*2-3);
});
test('boss has independent source-toleranced dimensions, relative XY placement and correct K stack',()=>{
 const original=calculate(defaults),d=structuredClone(defaults);d.boss.center_from_left=23;d.boss.center_from_bottom=17;
 const shifted=calculate(d);assert.deepEqual(shifted.boss_center,[3,2]);near(shifted.copper_volume,original.copper_volume);near(shifted.model_thickness,original.model_thickness);near(shifted.gap_analysis.x.min,original.gap_analysis.x.min);
 const dim=dimensionFor('boss.center_from_left',shifted);near(Math.hypot(...dim.a.map((v,i)=>v-dim.b[i])),23);
 const pg=layoutGeometry(shifted);near(pg.cells[0].x/pg.pitch-3/pg.pitch,Math.round((pg.cells[0].x-3)/pg.pitch));
 const q=dimensionFor('package.length',shifted);near((q.a[0]+q.b[0])/2,3);
 const job=nativeJob(shifted);assert.equal(job.native_parameters.copper.BOSS_X,3);assert.equal(job.native_parameters.copper.BOSS_Y,2);
 d.boss.size_mode='manual';d.boss.length=20.8;d.boss.width=10;const manual=calculate(d);near(manual.design.preform.length,20.8);near(manual.design.preform.width,10);assert.notEqual(manual.model_thickness,original.model_thickness);
 d.stack.pad_height=.2;const pads=calculate(d);near(pads.boss_total_height,.53);near(pads.boss_lower_height,.33);
 const z=referenceLevels(pads);near(z.pad-z.boss,.2);near(z.lead-z.pcbTop,.1);
 d.boss.center_from_left=35;assert.throws(()=>calculate(d),/凸台/);
});
test('PPT p6 L always regenerates from PCB thickness and K with fixed process values',()=>{
 const d=structuredClone(defaults);d.boss.total_height=9;near(calculate(d).boss_total_height,.48);
 d.pcb.thickness=2.2;near(calculate(d).boss_total_height,.68);d.stack.pad_height=.2;near(calculate(d).boss_total_height,.73);
 d.boss.height_mode='manual';assert.throws(()=>calculate(d),/第六頁/);
});
