// Screen-space dimension rails. Text never sits on projected model geometry.
// If a manual zoom/pan leaves no free space, the external dimension dock keeps
// the value visible and the in-canvas text is omitted rather than covering CAD.
export const overlaps=(a,b,gap=0)=>a.left<b.right+gap&&a.right>b.left-gap&&a.top<b.bottom+gap&&a.bottom>b.top-gap;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const rect=(x,y,w,h)=>({left:x-w/2,right:x+w/2,top:y-h/2,bottom:y+h/2});

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
