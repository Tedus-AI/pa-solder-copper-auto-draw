import test from 'node:test';
import assert from 'node:assert/strict';
import{calculate,defaults,nativeJob}from'../src/design.js';
import{inspectorRows}from'../src/calculation-guide.js';
import{cameraView}from'../src/camera-views.js';
test('45-degree diagonal keeps the 0.2828 mm target within two-decimal rounding perpendicular distance for changing pads',()=>{
 for(const J of [.8,1.5,2]){const d=structuredClone(defaults);d.copper.pad_size=J;d.preform.chamfer=3.4;d.preform.trial_delta=.05;const r=calculate(d),Y=r.design.preform.chamfer;assert.ok(Math.abs((Y-2*J)/Math.sqrt(2)-.2828)<=.005/Math.sqrt(2));assert.equal(r.design.preform.trial_delta,.15);assert.ok(Math.abs(r.solder_volume-r.calculated_thickness*r.preform_area)<1e-9);}
});
test('all trial selections drive export, locks persist and altered geometry makes the record stale',()=>{
 for(const[choice,delta]of[['lower',-.15],['middle',0],['upper',.15]]){const d=structuredClone(defaults);d.trial_result.choice=choice;const before=calculate(d);assert.ok(Math.abs(before.model_thickness-before.calculated_thickness-delta)<1e-12);d.trial_result={choice,locked:true,value:before.model_thickness,signature:before.trial_signature,confirmed_at:'2026-11-07T00:00:00Z'};const r=calculate(d);assert.equal(r.trial_status,'locked');assert.equal(calculate(JSON.parse(JSON.stringify(r.design))).trial_status,'locked');assert.equal(nativeJob(r).native_parameters.preform.PREFORM_Z,r.model_thickness);d.copper.pad_size=1.6;const changed=calculate(d);assert.equal(changed.trial_status,'stale');assert.equal(changed.design.trial_result.value,r.model_thickness);}
});
test('inspector lists physical dimensions with inline units and flipped iso is a 180 degree rotation',()=>{
 const rows=inspectorRows(calculate(defaults));assert.equal(rows.length,13);assert.ok(rows.every(r=>r.unit==='mm'));assert.ok(!rows.some(r=>['Z','V₁','V₂','A₁','V₁₋₁'].includes(r.symbol)));
 const a=cameraView('iso',10),b=cameraView('iso-bottom',10);assert.deepEqual(b.offset,[a.offset[0],-a.offset[1],-a.offset[2]]);assert.deepEqual(b.up,[0,0,-1]);
});
