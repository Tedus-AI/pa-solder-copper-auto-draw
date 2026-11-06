import test from 'node:test';
import assert from 'node:assert/strict';
import { paReference } from '../src/pa-reference.js';
import { cameraView, faceViews, createCADCamera } from '../src/camera-views.js';
import { Vector3 } from 'three';
import { calculate, defaults } from '../src/design.js';
import { referenceLevels, dimensionFor } from '../src/dimensions.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('datasheet PA outline has a flange, chamfered casing and six side pins without an extra lid',()=>{
  const pa=paReference(defaults.package);
  assert.equal(pa.flange.length,20.57);assert.equal(pa.flange.width,9.78);near(pa.flange.depth,1.02);near(pa.totalHeight,3.78);
  assert.equal(pa.body.profile.length,8);assert.equal(pa.lid,undefined);
  assert.equal(pa.pins.length,6);assert.equal(pa.pins.filter(p=>p.center[1]>0).length,4);assert.equal(pa.pins.filter(p=>p.center[1]<0).length,2);
  for(const p of pa.pins){near(p.center[2]-p.size[2]/2,1.57);assert.ok(Math.abs(p.center[1])+p.size[1]/2>pa.flange.width/2);}
});

test('CAD projection keeps equal screen scale at different depths in every view',()=>{
  for(const view of [...faceViews,'iso']){
    const camera=createCADCamera(),{offset,up}=cameraView(view,50);
    camera.up.set(...up);camera.position.set(...offset);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    assert.equal(camera.isOrthographicCamera,true);
    const along=new Vector3(...offset).normalize().multiplyScalar(20);
    const a=new Vector3(2,3,1).project(camera),b=new Vector3(2,3,1).add(along).project(camera);
    near(a.x,b.x);near(a.y,b.y);
  }
});

test('SPH endpoints coincide with metal flange bottom and actual pin underside',()=>{
  for(const p of[defaults.package,{length:24,width:12,support_height:1.4,max_tolerance:.2}]){
    const r=calculate({...defaults,package:p}),z=referenceLevels(r),dim=dimensionFor('package.support_height',r),pa=paReference(p);
    assert.equal(dim.view,'right');near(dim.a[2],z.flange);near(dim.b[2]-dim.a[2],p.support_height);
    const contains=pa.pins.filter(pin=>Math.abs(pin.center[0]-dim.b[0])<=pin.size[0]/2&&Math.abs(pin.center[1]-dim.b[1])<=pin.size[1]/2);
    assert.ok(contains.length>0,'Upper endpoint must be on a real illustrative pin');
    near(dim.b[2],z.flange+contains[0].center[2]-contains[0].size[2]/2);
    assert.notEqual(dim.a[2],z.flange+pa.flange.depth,'SPH starts at the bottom, not the top of the flange');
    assert.deepEqual(dim.datums,['下端：PA 底面','上端：PIN 底面']);
  }
});
test('PA input changes resize the reference without inventing manufacturing inputs',()=>{
  const p={...defaults.package,length:24,width:12,support_height:1.4,max_tolerance:.2},pa=paReference(p),r=calculate({...defaults,package:p}),z=referenceLevels(r);
  assert.deepEqual(pa.maximum,[24.2,12.2]);assert.equal(pa.flange.length,24);assert.equal(pa.flange.width,12);
  for(const pin of pa.pins)near(z.flange+pin.center[2]-pin.size[2]/2,z.pcbTop+defaults.stack.lead_solder);
  near(pa.totalHeight,pa.flange.depth+pa.body.depth);
  assert.ok(pa.body.profile.every(([x,y])=>Math.abs(x)<p.length/2&&Math.abs(y)<p.width/2));
  const changedTolerance=paReference({...p,max_tolerance:.4});assert.deepEqual(changedTolerance.pins,pa.pins);assert.deepEqual(changedTolerance.maximum,[24.4,12.4]);
});
test('six canonical face views are perpendicular pairs with valid up axes',()=>{
  for(const view of faceViews){
    const {offset,up}=cameraView(view,50);near(Math.hypot(...offset),105);near(offset.reduce((sum,v,i)=>sum+v*up[i],0),0);
    assert.equal(offset.filter(v=>v!==0).length,1);
  }
  for(const [a,b]of [['top','bottom'],['left','right'],['front','back']]){
    assert.deepEqual(cameraView(a,50).offset.map(v=>-v||0),cameraView(b,50).offset.map(v=>v||0));
  }
});
