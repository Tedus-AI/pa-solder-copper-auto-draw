// Screen-space dimension rails. Text never sits on projected model geometry.
// If a manual zoom/pan leaves no free space, the external dimension dock keeps
// the value visible and the in-canvas text is omitted rather than covering CAD.
export const overlaps=(a,b,gap=0)=>a.left<b.right+gap&&a.right>b.left-gap&&a.top<b.bottom+gap&&a.bottom>b.top-gap;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const rect=(x,y,w,h)=>({left:x-w/2,right:x+w/2,top:y-h/2,bottom:y+h/2});

// A feature leader first follows the true radial/diametral direction, then
// takes the shorter route around the part to its outside value. It must not
// turn back through the part just to reach a label below the drawing.
export function featureLeader(a,b,bounds,label,side) {
  if(!label)return [];
  const box={left:bounds.left-12,right:bounds.right+12,top:bounds.top-12,bottom:bounds.bottom+12};
  const cx=(label.left+label.right)/2,cy=(label.top+label.bottom)/2;
  let dx=b[0]-a[0],dy=b[1]-a[1];if(Math.hypot(dx,dy)<.05){dx=cx-b[0];dy=cy-b[1];}
  const distances=[];
  if(dx>1e-8)distances.push((box.right-b[0])/dx);if(dx< -1e-8)distances.push((box.left-b[0])/dx);
  if(dy>1e-8)distances.push((box.bottom-b[1])/dy);if(dy< -1e-8)distances.push((box.top-b[1])/dy);
  const distance=Math.min(...distances.filter(v=>v>=0));if(!Number.isFinite(distance))return [];
  const exit=[b[0]+dx*distance,b[1]+dy*distance];
  const horizontal=side==='top'||side==='bottom';
  const attach=horizontal?[clamp(cx,box.left,box.right),side==='top'?box.top:box.bottom]:[side==='left'?box.left:box.right,clamp(cy,box.top,box.bottom)];
  const anchor=horizontal?[cx,side==='top'?label.bottom:label.top]:[side==='left'?label.right:label.left,cy];
  const w=box.right-box.left,h=box.bottom-box.top,p=2*(w+h);
  const parameter=point=>Math.abs(point[1]-box.top)<1e-5?point[0]-box.left:Math.abs(point[0]-box.right)<1e-5?w+point[1]-box.top:Math.abs(point[1]-box.bottom)<1e-5?w+h+box.right-point[0]:2*w+h+box.bottom-point[1];
  const start=parameter(exit),end=parameter(attach),clockwise=(end-start+p)%p,sign=clockwise<=p/2?1:-1,length=sign===1?clockwise:p-clockwise;
  const corners=[[0,[box.left,box.top]],[w,[box.right,box.top]],[w+h,[box.right,box.bottom]],[2*w+h,[box.left,box.bottom]]]
    .map(([t,point])=>({point,distance:((t-start)*sign+p)%p})).filter(c=>c.distance>1e-5&&c.distance<length-1e-5).sort((a,b)=>a.distance-b.distance);
  return [b,exit,...corners.map(c=>c.point),attach,anchor];
}

export function annotationLayout({a,b,bounds,width,height,labelWidth=120,labelHeight=30,obstacles=[]}) {
  const vertical=Math.abs(b[1]-a[1])>Math.abs(b[0]-a[0]);
  const orientation=vertical?'vertical':'horizontal',gap=22,margin=9;
  const valid=box=>box.left>=margin&&box.right<=width-margin&&box.top>=margin&&box.bottom<=height-24&&
    !overlaps(box,bounds,8)&&!obstacles.some(o=>overlaps(box,o,5));
  const candidates=[];
  const add=(aa,bb,x,y,side,leader=[])=>{
    const label=rect(x,y,labelWidth,labelHeight);
    if(valid(label))candidates.push({a,b,aa,bb,label,orientation,side,leader,collapsed:Math.hypot(b[0]-a[0],b[1]-a[1])<2});
  };
  if(vertical){
    for(const side of ['right','left']){
      const direction=side==='right'?1:-1,x=(direction===1?bounds.right:bounds.left)+direction*gap;
      const y=clamp((a[1]+b[1])/2,labelHeight/2+margin,height-24-labelHeight/2);
      add([x,a[1]],[x,b[1]],x+direction*(labelWidth/2+10),y,side);
    }
  }else{
    for(const side of ['bottom','top']){
      const direction=side==='bottom'?1:-1,y=(direction===1?bounds.bottom:bounds.top)+direction*gap;
      const x=clamp((a[0]+b[0])/2,labelWidth/2+margin,width-labelWidth/2-margin);
      add([a[0],y],[b[0],y],x,y+direction*(labelHeight/2+10),side);
    }
  }
  if(candidates.length)return candidates[0];
  // Narrow windows can keep a vertical rail beside the part and place its text
  // below the part. The elbow follows free space outside the model bounds.
  const x=clamp((a[0]+b[0])/2,labelWidth/2+margin,width-labelWidth/2-margin);
  for(const side of ['bottom','top']){
    const direction=side==='bottom'?1:-1,edge=direction===1?bounds.bottom:bounds.top;
    const y=edge+direction*(gap+labelHeight/2+10);
    const railX=bounds.right+gap,aa=vertical?[railX,a[1]]:[a[0],edge+direction*gap],bb=vertical?[railX,b[1]]:[b[0],edge+direction*gap];
    add(aa,bb,x,y,side,vertical?[[railX,(a[1]+b[1])/2],[railX,y],[x+labelWidth/2,y]]:[]);
  }
  return candidates[0]||{a,b,aa:a,bb:b,label:null,orientation,side:'dock',leader:[],collapsed:true};
}
