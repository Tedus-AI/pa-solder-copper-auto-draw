import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, defaults } from '../src/design.js';
import { calculationWorksheet } from '../src/calculation-guide.js';

test('worksheet reproduces PDF p13 volume subtraction and distinguishes trial increment',()=>{
  const rows=calculationWorksheet(calculate(defaults)),row=symbol=>rows.find(r=>r.symbol===symbol);
  for(const [symbol,value]of [['h',.63],['V₁₋₁',134.966],['V₂',67.970],['V₁',66.996],['A₁',178.76]])assert.ok(Math.abs(row(symbol).value-value)<.0005);
  assert.ok(Math.abs(row('Z').value-.374779052203)<.00005);
  assert.equal(row('ΔZ').reference,.15);assert.equal(row('ΔZ').value,.15);
});
test('worksheet follows current dimensions and keeps computed Z independent of model override',()=>{
  const d=structuredClone(defaults);d.pcb.thickness=2.1;d.stack.pad_height=.18;d.trial_result.choice='upper';
  const r=calculate(d),rows=calculationWorksheet(r),row=s=>rows.find(v=>v.symbol===s);
  assert.ok(Math.abs(row('h').value-.73)<1e-10);assert.ok(Math.abs(row('L').value-.61)<1e-10);
  assert.equal(row('Z').value,r.calculated_thickness);assert.notEqual(row('Z').value,r.model_thickness);
  assert.equal(row('h').reference,.63);
});
