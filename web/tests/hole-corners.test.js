import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import {calculate,defaults,nativeJob} from '../src/design.js';
import {holeCorners,holeCenters,holeMask} from '../src/hole-corners.js';
import {layoutGeometry,rectangle} from '../src/layout.js';
import {drawing} from '../src/dxf.js';
import {volumeGuideGeometry,scaledSection,sectionIntervals} from '../src/volume-guide.js';
test('all 15 corner selections preserve real holes, volume, E-PAD exclusions and native job mask',()=>{
 for(let mask=1;mask<16;mask++){
  const d=structuredClone(defaults);d.copper.hole_corners=Object.keys(holeCorners).filter((_,i)=>mask&(1<<i));const r=calculate(d),g=layoutGeometry(r),n=d.copper.hole_corners.length;
  assert.equal(g.centers.length,n);assert.equal(holeMask(d.copper),mask);
  const outer=40*30-(4-Math.PI)*9;assert.ok(Math.abs(r.copper_volume-((outer-n*Math.PI*1.5**2)*3+r.boss_volume))<1e-7);
  assert.equal((drawing(r,'copper').match(/\nCIRCLE\n/g)||[]).length,n);
  for(const [x,y]of holeCenters(d.copper))assert.equal(clipping.intersection(g.pads,rectangle(x,y,.1,.1)).length,0);
  assert.equal(nativeJob(r).native_parameters.copper.HOLE_MASK??9,mask);
 }
 for(const corners of [[],['bad'],['top_left','top_left']])assert.throws(()=>calculate({...defaults,copper:{...defaults.copper,hole_corners:corners}}));
});
test('2D and 3D share true units, selected four-pad heights and exact section intervals',()=>{
 const r=calculate(defaults),g=volumeGuideGeometry(r),svg=scaledSection(r,g);
 assert.equal(svg.match(/data-scale-x="([^"]+)/)[1],svg.match(/data-scale-z="([^"]+)/)[1]);
 const pads=g.records.find(v=>v.part==='pads');assert.equal(pads.polygons.length,4);assert.equal(pads.height,.15);
 assert.equal(sectionIntervals(pads.polygons,g.cutY).length,2);
 assert.equal(g.records.find(v=>v.part==='pcb').z,3.1);
 assert.ok(Math.abs(g.records.find(v=>v.part==='pa-flange').z-3.63)<1e-9);
});
