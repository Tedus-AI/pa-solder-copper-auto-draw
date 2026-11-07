import clipping from 'polygon-clipping';
import {holeCenters} from './hole-corners.js';

// Manufacturing preview/profile precision. Volume integration below uses the
// analytic arcs, not the chord approximation used for drawing the profile.
export const COPPER_CHORD_TOLERANCE=.0001;
const close=points=>[...points,points[0]];
const circleSegments=r=>Math.max(32,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-COPPER_CHORD_TOLERANCE/r))/4)*4);
const circlePoint=(x,y,r,i,n)=>[Number((x+r*Math.cos(2*Math.PI*i/n)).toFixed(12)),Number((y+r*Math.sin(2*Math.PI*i/n)).toFixed(12))];
export function copperCircle(x,y,r){
  const n=circleSegments(r);
  return [[close(Array.from({length:n},(_,i)=>circlePoint(x,y,r,i,n)))]];
}
export function copperRoundedRectangle(w,h,r){
  // Use the exact same angular grid as full holes. Coincident corner/hole arcs
  // then cancel instead of leaving tiny polygonal slivers at tangency.
  const full=circleSegments(r),n=full/4;
  const points=[];
  for(const[x,y,quadrant]of[[w/2-r,h/2-r,0],[-w/2+r,h/2-r,1],[-w/2+r,-h/2+r,2], [w/2-r,-h/2+r,3]])
    for(let i=0;i<=n;i++)points.push(circlePoint(x,y,r,quadrant*n+i,full));
  return [[close(points)]];
}
export function roundedBaseDistance(x,y,c){
  const qx=Math.abs(x)-(c.base_length/2-c.corner_radius),qy=Math.abs(y)-(c.base_width/2-c.corner_radius);
  return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-c.corner_radius;
}

function circleIntersectionXs(a,ar,b,br){
  const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy);
  if(d<1e-12||d>ar+br||d<Math.abs(ar-br))return[];
  const t=(ar*ar-br*br+d*d)/(2*d),h=Math.sqrt(Math.max(0,ar*ar-t*t));
  return[a[0]+t*dx/d-h*dy/d,a[0]+t*dx/d+h*dy/d];
}
function integrate(fn,a,b,epsilon,depth=22){
  const mid=(a+b)/2,fa=fn(a),fm=fn(mid),fb=fn(b),whole=(b-a)*(fa+4*fm+fb)/6;
  const refine=(a,b,fa,fm,fb,whole,eps,remaining)=>{
    const m=(a+b)/2,l=(a+m)/2,r=(m+b)/2,fl=fn(l),fr=fn(r);
    const left=(m-a)*(fa+4*fl+fm)/6,right=(b-m)*(fm+4*fr+fb)/6,diff=left+right-whole;
    if(remaining<=0||Math.abs(diff)<=15*eps)return left+right+diff/15;
    return refine(a,m,fa,fl,fm,left,eps/2,remaining-1)+refine(m,b,fm,fr,fb,right,eps/2,remaining-1);
  };
  return refine(a,b,fa,fm,fb,whole,epsilon,depth);
}
function removedArea(c,centers,radius){
  const x=c.base_length/2,y=c.base_width/2,R=c.corner_radius;
  const breaks=[-x,x,-x+R,x-R];
  for(const center of centers){
    breaks.push(center[0]-radius,center[0],center[0]+radius);
    for(const sy of[-y,y]){
      const dy=sy-center[1];
      if(Math.abs(dy)<radius){const span=Math.sqrt(radius*radius-dy*dy);breaks.push(center[0]-span,center[0]+span);}
    }
    for(const sx of[-1,1])for(const sy of[-1,1])breaks.push(...circleIntersectionXs(center,radius,[sx*(x-R),sy*(y-R)],R));
  }
  for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++)breaks.push(...circleIntersectionXs(centers[i],radius,centers[j],radius));
  const points=[...new Set(breaks.filter(v=>v>=-x&&v<=x))].sort((a,b)=>a-b);
  const lengthAt=px=>{
    const ax=Math.abs(px),dy=ax<=x-R?R:Math.sqrt(Math.max(0,R*R-(ax-x+R)**2)),half=y-R+dy;
    const intervals=[];
    for(const[cx,cy]of centers){
      const hx=px-cx;if(Math.abs(hx)>=radius)continue;
      const h=Math.sqrt(Math.max(0,radius*radius-hx*hx)),lo=Math.max(-half,cy-h),hi=Math.min(half,cy+h);
      if(hi>lo)intervals.push([lo,hi]);
    }
    intervals.sort((a,b)=>a[0]-b[0]);let result=0,last=-Infinity;
    for(const[lo,hi]of intervals){result+=Math.max(0,hi-Math.max(lo,last));last=Math.max(last,hi);}
    return result;
  };
  let result=0;
  const epsilon=Math.max(1,c.base_length*c.base_width)*1e-11/Math.max(1,points.length-1);
  for(let i=1;i<points.length;i++)if(points[i]-points[i-1]>1e-12)result+=integrate(lengthAt,points[i-1],points[i],epsilon);
  return result;
}

export function copperFootprint(c){
  const outer=copperRoundedRectangle(c.base_length,c.base_width,c.corner_radius),radius=c.hole_diameter/2;
  const centers=holeCenters(c);
  const holes=centers.map(([x,y])=>copperCircle(x,y,radius));
  const profile=clipping.difference(outer,...holes);
  const signedDistances=centers.map(([x,y])=>roundedBaseDistance(x,y,c));
  const closed_holes=signedDistances.map(distance=>distance<-radius-1e-8);
  const hole_conditions=signedDistances.map(distance=>distance<-radius-1e-8?'enclosed':Math.abs(distance+radius)<=1e-8?'tangent_inside':distance>radius+1e-8?'outside':Math.abs(distance-radius)<=1e-8?'tangent_outside':'breakout');
  const outer_area=c.base_length*c.base_width-(4-Math.PI)*c.corner_radius**2;
  const separate=centers.every((a,i)=>centers.slice(i+1).every(b=>Math.hypot(a[0]-b[0],a[1]-b[1])>=2*radius));
  const removed=closed_holes.every(Boolean)&&separate?centers.length*Math.PI*radius**2:removedArea(c,centers,radius);
  const coords=profile.flatMap(poly=>poly[0]);
  const bounds=coords.length?coords.reduce((b,[x,y])=>({minX:Math.min(b.minX,x),maxX:Math.max(b.maxX,x),minY:Math.min(b.minY,y),maxY:Math.max(b.maxY,y)}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity}):null;
  return {outer,holes,centers,profile,area:Math.max(0,outer_area-removed),outer_area,removed_area:removed,bounds,closed_holes,hole_conditions,
    breakouts:hole_conditions.filter(v=>v==='breakout').length,outside_holes:hole_conditions.filter(v=>v==='outside'||v==='tangent_outside').length,
    tangent_holes:hole_conditions.filter(v=>v.startsWith('tangent')).length,chord_tolerance:COPPER_CHORD_TOLERANCE};
}
