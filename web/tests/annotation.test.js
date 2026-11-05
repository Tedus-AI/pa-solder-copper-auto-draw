import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationLayout, featureLeader, overlaps } from '../src/annotation-layout.js';

test('outside rails never place dimension text on model or view controls',()=>{
  const bounds={left:100,right:620,top:130,bottom:400},obstacles=[{left:700,right:830,top:10,bottom:125}];
  for(const[a,b]of [[[100,200],[620,200]],[[150,200],[150,202]],[[400,200],[400,200]],[[200,150],[210,240]],[[200,150],[400,240]]]){
    const result=annotationLayout({a,b,bounds,width:900,height:600,labelWidth:140,labelHeight:65,obstacles});
    assert.ok(result.label);assert.equal(overlaps(result.label,bounds,8),false);
    assert.equal(overlaps(result.label,obstacles[0],5),false);
    assert.ok(result.label.left>=9&&result.label.right<=891&&result.label.top>=9&&result.label.bottom<=576);
  }
});
test('narrow viewport routes a vertical dimension to a label below the part',()=>{
  const bounds={left:40,right:310,top:100,bottom:230};
  const r=annotationLayout({a:[200,170],b:[200,150],bounds,width:350,height:360,labelWidth:140});
  assert.ok(r.label);assert.equal(overlaps(r.label,bounds),false);assert.equal(r.side,'bottom');
  assert.ok(r.leader.length>0);
});
test('extreme zoom omits overlay text and leaves the separate dimension dock readable',()=>{
  const r=annotationLayout({a:[0,0],b:[500,500],bounds:{left:-100,right:1000,top:-200,bottom:900},width:500,height:500});
  assert.equal(r.label,null);assert.equal(r.side,'dock');
});

test('radius and diameter leaders follow the feature direction and then avoid the part',()=>{
  const bounds={left:100,right:600,top:100,bottom:400};
  for(const [a,b]of [[[550,150],[580,120]],[[550,150],[560,150]],[[150,350],[120,380]],[[150,150],[120,120]]]){
    for(const [side,label]of [['bottom',{left:300,right:440,top:450,bottom:480}],['right',{left:650,right:790,top:200,bottom:230}],['top',{left:300,right:440,top:30,bottom:60}],['left',{left:-70,right:70,top:200,bottom:230}]]){
      const route=featureLeader(a,b,bounds,label,side);assert.ok(route.length>=3);
      const exit=route[1];assert.ok(Math.abs((exit[0]-b[0])*(b[1]-a[1])-(exit[1]-b[1])*(b[0]-a[0]))<1e-6);
      for(let i=1;i<route.length-1;i++)for(const t of[0,.25,.5,.75,1]){
        const x=route[i][0]*(1-t)+route[i+1][0]*t,y=route[i][1]*(1-t)+route[i+1][1]*t;
        assert.ok(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom,'Leader re-entered the model');
      }
    }
  }
});
