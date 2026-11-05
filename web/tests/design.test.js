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
  test(`invalid ${group}.${key} rejected`, () => { const d = structuredClone(defaults); d[group][key] = value; assert.throws(() => calculate(d)); });
}
test('name and unknown settings rejected', () => {
  assert.throws(() => calculate({ ...defaults, name: '../../bad' }));
  assert.throws(() => calculate({ ...defaults, surprise: true }));
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
