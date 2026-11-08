import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, calculate, ceilTenth, nativeJob, octagon } from '../src/design.js';
import { drawing } from '../src/dxf.js';
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('PDF volume subtraction with fixed 0.2828 mm corner clearance', () => {
  const r = calculate(defaults);
  near(r.boss_total_height, .48); near(r.copper_to_flange, .63);
  near(r.boss_volume, 67.9704); near(r.cavity_volume, 136.945107, .0005);
  near(r.preform_area, 178.76); near(r.calculated_thickness, .385850899214); near(r.relief_area, 2*Math.PI);
  near(r.solder_volume, r.calculated_thickness * r.preform_area);
  assert.deepEqual(r.recommended_opening, [20.9, 10.1]);
  near(r.corner_clearance, .282842712474619);
});
test('ceiling and selected upper trial thickness', () => {
  assert.equal(ceilTenth(20.57), 20.6); assert.equal(ceilTenth(20.6), 20.6); assert.equal(ceilTenth(20.60001), 20.7);
  const d = structuredClone(defaults); d.trial_result.choice = 'upper';
  const r = calculate(d); near(r.model_thickness,r.calculated_thickness+.15);
});
for (const [group, key, value] of [['package', 'length', NaN], ['pcb', 'thickness', true], ['pcb', 'opening_length', 20], ['copper', 'base_width', 8], ['copper', 'base_thickness', 2.9], ['copper', 'pad_size', 4], ['copper', 'hole_edge_offset', 25], ['stack', 'flange_gap', .1], ['preform', 'thickness_override', -1]]) {
  test(`invalid ${group}.${key} rejected`, () => { const d = structuredClone(defaults); d.pcb.opening_mode='manual';d[group][key] = value; assert.throws(() => calculate(d)); });
}
test('name and unknown settings rejected', () => {
  assert.throws(() => calculate({ ...defaults, name: '../../bad' }));
  assert.throws(() => calculate({ ...defaults, surprise: true }));
});
test('project metadata preserves human names independently of native CAD names',()=>{
  const d=structuredClone(defaults);d.project={name:'  基地台 PA 專案 A  ',pa_model:' PA型號/780 M1P '};
  const r=calculate(d);assert.deepEqual(r.design.project,{name:'基地台 PA 專案 A',pa_model:'PA型號/780 M1P'});
  assert.equal(r.design.name,'pa_780_m1p');assert.deepEqual(nativeJob(r).design.project,r.design.project);
  const old=structuredClone(defaults);delete old.project;assert.deepEqual(calculate(old).design.project,defaults.project);
  for(const project of [null,[],{name:''},{name:null},{pa_model:1},{name:'a\nb'},{name:'a'.repeat(101)},{surprise:true}])assert.throws(()=>calculate({...defaults,project}),/專案|型號/);
  assert.equal(calculate({...defaults,project:{name:'測試',pa_model:''}}).design.project.pa_model,'');
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
  d.tolerances['package.length']={minus:.327,plus:.327};d.tolerances['package.width']={minus:.327,plus:.327};const tolerance=calculate(d);
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

test('relief area equals the drawn PCB cutout outline, including overlapping same-side half-discs', async () => {
  const { pcbCutout, area } = await import('../src/layout.js');
  const { reliefArea } = await import('../src/design.js');
  for (const [N, O] of [[10.1, 2], [10.1, 4], [6, 2.5], [6, 4]]) {
    const d = structuredClone(defaults); d.pcb.opening_mode = 'manual'; d.pcb.opening_width = N; d.pcb.relief_diameter = O;
    const b = d.pcb, r = { design: d, boss_center: [0, 0] };
    const exact = b.opening_length * N + reliefArea(b);
    // Polygon chords (<=0.001 mm) slightly under-fill each arc (~4e-5 relative).
    assert.ok(Math.abs(area(pcbCutout(r)) - exact) < exact * 1e-4, `N=${N} O=${O}`);
  }
  const overlap = { opening_width: 6, relief_diameter: 4 };
  assert.ok(reliefArea(overlap) < 2 * Math.PI * 4);
});

test('cavity uses the four outward relief half-discs, not one PDF p12 circle', () => {
  const r = calculate(defaults), b = r.design.pcb;
  near(r.cavity_volume, (b.opening_length * b.opening_width + 2 * Math.PI * (b.relief_diameter / 2) ** 2) * r.copper_to_flange);
});

test('off-centre boss and unused placement_accuracy are reported as warnings', () => {
  const d = structuredClone(defaults); d.boss.center_from_left = 20.3;
  assert.ok(calculate(d).warnings.some(w => /未置中/.test(w)));
  assert.ok(!calculate(defaults).warnings.some(w => /未置中/.test(w)));
  const legacy = structuredClone(defaults); legacy.pcb.placement_accuracy = .1;
  assert.ok(calculate(legacy).warnings.some(w => /placement_accuracy/.test(w)));
  legacy.pcb.placement_accuracy = .066;
  assert.ok(!calculate(legacy).warnings.some(w => /placement_accuracy/.test(w)));
});

test('locked trial needs an ISO 8601 confirmation time and tolerance pairs may carry a source note', () => {
  const d = structuredClone(defaults), r = calculate(d);
  d.trial_result = { choice: 'middle', locked: true, value: r.model_thickness, signature: r.trial_signature, confirmed_at: 'yesterday' };
  assert.throws(() => calculate(d), /ISO 8601/);
  d.trial_result.confirmed_at = '2026-11-08T09:30:00+08:00';
  assert.equal(calculate(d).trial_status, 'locked');
  const t = structuredClone(defaults); t.tolerances = { 'package.length': { minus: .1, plus: .2, source: 'datasheet rev B' } };
  assert.equal(calculate(t).design.tolerances['package.length'].plus, .2);
  t.tolerances['package.length'].source = 3;
  assert.throws(() => calculate(t), /公差格式/);
});

test('hole diameter must stay below half of the short base side', () => {
  const d = structuredClone(defaults); d.copper.hole_diameter = 15;
  assert.throws(() => calculate(d), /短邊的一半/);
});
