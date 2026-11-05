import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, calculate, ceilTenth, nativeJob, octagon } from '../src/design.js';
import { drawing } from '../src/dxf.js';
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('PDF p13 example and volume conservation', () => {
  const r = calculate(defaults);
  near(r.boss_total_height, .48); near(r.copper_to_flange, .63);
  near(r.boss_volume, 67.9704); near(r.cavity_volume, 134.966, .0005);
  near(r.preform_area, 178.76); near(r.calculated_thickness, .3748, .00005);
  near(r.solder_volume, r.calculated_thickness * r.preform_area);
  assert.deepEqual(r.recommended_opening, [20.9, 10.1]);
  near(r.corner_clearance, .282842712474619);
});
test('ceiling and stock thickness override', () => {
  assert.equal(ceilTenth(20.57), 20.6); assert.equal(ceilTenth(20.6), 20.6); assert.equal(ceilTenth(20.60001), 20.7);
  const d = structuredClone(defaults); d.preform.thickness_override = .37;
  const r = calculate(d); assert.equal(r.model_thickness, .37); assert.notEqual(r.calculated_thickness, .37);
});
for (const [group, key, value] of [['package', 'length', NaN], ['pcb', 'thickness', true], ['pcb', 'opening_length', 20], ['copper', 'base_width', 8], ['copper', 'base_thickness', 2.9], ['copper', 'pad_size', 4], ['copper', 'hole_edge_offset', 1], ['stack', 'flange_gap', .1], ['preform', 'chamfer', 3], ['preform', 'trial_delta', 1], ['preform', 'thickness_override', -1]]) {
  test(`invalid ${group}.${key} rejected`, () => { const d = structuredClone(defaults); d.pcb.opening_mode='manual';d[group][key] = value; assert.throws(() => calculate(d)); });
}
test('name and unknown settings rejected', () => {
  assert.throws(() => calculate({ ...defaults, name: '../../bad' }));
  assert.throws(() => calculate({ ...defaults, surprise: true }));
});

test('PDF p8 automatic PA to PCB chain, Delta and Ampleon',()=>{
  const d=structuredClone(defaults),r=calculate(d);
  near(r.opening_chain.maximum[0],20.697);near(r.opening_chain.maximum[1],9.907);
  near(r.opening_chain.raw[0],20.863);near(r.opening_chain.raw[1],10.073);
  assert.deepEqual([r.design.pcb.opening_length,r.design.pcb.opening_width],[20.9,10.1]);
  d.pcb.opening_rule='ampleon';const a=calculate(d);
  near(a.opening_chain.raw[0],20.813);near(a.opening_chain.raw[1],10.023);
  d.package.length=20.62;d.package.width=9.83;
  d.pcb.opening_rule='delta';const delta=calculate(d);
  d.pcb.opening_rule='ampleon';const ampleon=calculate(d);
  assert.deepEqual(delta.recommended_opening,[21,10.2]);assert.deepEqual(ampleon.recommended_opening,[20.9,10.1]);
  assert.notEqual(delta.model_thickness,ampleon.model_thickness);
});
test('four PA fields propagate to the relevant manufacturing dimensions',()=>{
  const d=structuredClone(defaults),r=calculate(d);
  d.package.length=21.07;d.package.width=10.28;const larger=calculate(d);
  assert.equal(larger.boss_length,21.1);assert.equal(larger.boss_width,10.3);
  assert.deepEqual(larger.recommended_opening,[21.4,10.6]);
  assert.notEqual(larger.preform_area,r.preform_area);assert.notEqual(larger.solder_volume,r.solder_volume);
  d.package.max_tolerance=.327;const tolerance=calculate(d);
  assert.equal(tolerance.boss_length,larger.boss_length);assert.equal(tolerance.boss_width,larger.boss_width);
  assert.deepEqual(tolerance.recommended_opening,[21.6,10.8]);assert.ok(tolerance.solder_volume>larger.solder_volume);
  d.package.support_height=1.47;const sph=calculate(d);
  near(sph.boss_total_height,tolerance.boss_total_height+.1);assert.notEqual(sph.model_thickness,tolerance.model_thickness);
  assert.deepEqual([sph.design.copper.base_length,sph.design.copper.base_width],[40,30]);
});
test('manual and legacy openings survive changes and YAML normalization',()=>{
  const d=structuredClone(defaults);d.pcb.opening_mode='manual';d.pcb.opening_length=22;d.pcb.opening_width=11;
  d.package.max_tolerance=.2;
  const manual=calculate(d);assert.equal(manual.design.pcb.opening_length,22);assert.equal(manual.design.pcb.opening_width,11);
  delete d.pcb.opening_mode;const legacy=calculate(d);assert.equal(legacy.design.pcb.opening_mode,'manual');assert.equal(legacy.design.pcb.opening_length,22);
  assert.deepEqual(calculate(legacy.design),legacy);
  for(const [key,value]of [['opening_mode',false],['opening_rule','unknown']]){
    const bad=structuredClone(defaults);bad.pcb[key]=value;assert.throws(()=>calculate(bad));
  }
});
test('Creo job is native parametric and mathematically consistent', () => {
  const r = calculate(defaults), j = nativeJob(r);
  assert.equal(j.schema_version, 2); assert.equal(j.target.version, '7.0.10.0'); assert.equal(j.step_import_acceptable, false);
  near(j.expected.preform.volume, r.preform_area * r.model_thickness);
  near(j.expected.copper.bounds[2], 3.48); assert.equal(j.native_parameters.copper.PAD_H, .15);
});
test('DXF outlines preserve mm units, holes, pads and octagonal preform', () => {
  const r = calculate(defaults), cu = drawing(r, 'copper'), sn = drawing(r, 'preform');
  assert.ok(cu.includes('$INSUNITS\n70\n4')); assert.equal((cu.match(/\nCIRCLE\n/g) || []).length, 2);
  assert.equal((cu.match(/\n8\nPAD\n/g) || []).length, 4);
  assert.ok(sn.includes('90\n8\n70\n1')); assert.ok(sn.endsWith('0\nEOF\n')); assert.equal(octagon(20.6, 9.8, 3.4).length, 8);
});
