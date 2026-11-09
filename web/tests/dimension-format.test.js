import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, fields, calculate } from '../src/design.js';
import { dimensionFor } from '../src/dimensions.js';
import { dimensionSpecs, dimensionLabel, formatDimension } from '../src/dimension-format.js';
import { drawing } from '../src/dxf.js';
import { layoutGeometry, layoutDxf } from '../src/layout.js';

test('every numeric field has explicit notation with equals and mm',()=>{
  const keys=Object.entries(fields).flatMap(([group,[,names]])=>Object.keys(names).map(key=>`${group}.${key}`));
  assert.deepEqual(Object.keys(dimensionSpecs).sort(),keys.sort());
  const r=calculate(defaults),g=layoutGeometry(r);
  for(const key of keys){
    const label=dimensionLabel(dimensionFor(key,r,g));
    assert.match(label,/^.+ = (?:±|⌀)?[\d.]+(?: (?:±[\d.]+|\+[\d.]+\/−[\d.]+))? mm$/);assert.ok(!label.startsWith('Δ'));
  }
});
test('PA, coded, descriptive, diameter and tolerance formats follow the requested convention',()=>{
  for(const[key,value,expected]of [
    ['package.length',20.57,'PA(L) = 20.57 mm'],['package.width',9.78,'PA(W) = 9.78 mm'],
    ['package.support_height',1.57,'SPH = 1.57 mm'],['copper.base_length',40,'E = 40 mm'],
    ['copper.corner_radius',3,'4-R = 3.00 mm'],['copper.hole_diameter',3,'2-⌀D = 3.00 mm'],
    ['pcb.relief_diameter',2,'4-⌀O = 2.00 mm'],['layout.hole_clearance',4,'2-⌀V = 4.00 mm'],
    ['boss.length',20.6,'I = 20.6 mm'],['boss.width',9.8,'H = 9.8 mm'],['boss.total_height',.48,'L = 0.48 mm'],
    ['boss.center_from_left',20,'Xc = 20 mm'],['preform.length',20.6,'W = 20.6 mm'],['preform.trial_delta',.05,'試片厚度增減量 = ±0.05 mm'],
  ])assert.equal(dimensionLabel({key,value}),expected);
  assert.throws(()=>dimensionLabel({key:'unmapped',value:1}),/Missing dimension/);
  assert.equal(formatDimension('微小公差',.000001), '微小公差 = 0.000001 mm');
  assert.equal(dimensionLabel({key:'copper.hole_diameter',value:3.005}),'2-⌀D = 3.005 mm','Minimum decimal precision must not discard an entered size');
});
test('radius and diameter use distinct measurement geometry',()=>{
  const r=calculate(defaults);
  assert.equal(dimensionFor('copper.corner_radius',r).kind,'radius');
  for(const key of['copper.hole_diameter','pcb.relief_diameter','layout.hole_clearance'])assert.equal(dimensionFor(key,r).kind,'diameter');
  assert.equal(dimensionFor('layout.border_width',r).kind,'linear','Layout R is a width, not a radius');
});
test('downloaded drawing notation retains codes, units and CAD glyphs',()=>{
  const r=calculate(defaults),copper=drawing(r,'copper'),preform=drawing(r,'preform'),layout=layoutDxf(r,layoutGeometry(r));
  assert.ok(copper.includes('E = 40 %%p0.2 mm'));assert.ok(copper.includes('2-%%cD = 3.00 mm'));
  assert.ok(copper.includes('4-R = 3.00 mm'));
  assert.ok(copper.includes('L = 0.48 +0/-0.1 mm'));
  assert.ok(preform.includes('W = 20.6 %%p0.1 mm'));assert.ok(preform.includes('4-Y = 3.40 +0.2/-0 mm'));
  assert.ok(layout.includes('\n20.00 mm\n'));assert.ok(layout.includes('\n15.00 mm\n'));assert.ok(!layout.includes('%%cV'));
});
