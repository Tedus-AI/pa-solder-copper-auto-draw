import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import clipping from 'polygon-clipping';
import {layoutGeometry,rectangle,roundedRectangle} from './layout.js';
import {octagon} from './design.js';
import {dimensionFor,dimensionLabel,referenceLevels} from './dimensions.js';
import {cameraView} from './camera-views.js';
import {paReference} from './pa-reference.js';
import {ARROW_LENGTH,ARROW_HALF_WIDTH,OUTSIDE_TAIL} from './dimension-arrows.js';
const MIN_DIMENSION_PX=70,OPAQUE_DEPTH_WRITE=.8,FOCUS_GLOW=.55,DIMENSION_OFFSET=24;
// Inspector: the measured feature of each dimension is lit; the rest of its part
// stays visible, faded, for context.
const FOCUS_PARTS={'copper.pad_size':['pads'],'stack.pad_height':['pads'],'boss.width':['boss'],'boss.length':['boss'],'boss.total_height':['boss','pads']};
const SVG_NS='http://www.w3.org/2000/svg';
const svgNodes=specs=>specs.map(([tag,attributes,text])=>{const node=document.createElementNS(SVG_NS,tag);for(const[k,v]of Object.entries(attributes))node.setAttribute(k,v);if(text!==undefined)node.textContent=text;return node;});
/**
 * A dimension drawn as on a drawing: extension lines from the two measured points
 * (a small gap at the part), the dimension line offset away from the part (the
 * `away` point, e.g. the feature centre) and the symbol beside it.
 */
export function offsetDimensionGraphics(a,b,away,{offset=DIMENSION_OFFSET,symbol=''}={}){
 const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.5)return[];
 const u=[(b[0]-a[0])/length,(b[1]-a[1])/length],n=[-u[1],u[0]],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
 let side=Math.sign((mid[0]-away[0])*n[0]+(mid[1]-away[1])*n[1]);
 if(!side)side=(Math.abs(n[1])>=Math.abs(n[0])?Math.sign(n[1]):Math.sign(n[0]))||1; // below / right of the part
 const m=[n[0]*side,n[1]*side],at=(p,d)=>[p[0]+m[0]*d,p[1]+m[1]*d],a2=at(a,offset),b2=at(b,offset);
 const extension=p=>['polyline',{class:'guide-dimension-extension',points:[at(p,3),at(p,offset+5)].map(v=>v.join(',')).join(' ')}];
 const label=at([(a2[0]+b2[0])/2,(a2[1]+b2[1])/2],12);
 return[extension(a),extension(b),...dimensionGraphics(a2,b2),...(symbol?[['text',{class:'guide-dimension-text',x:label[0],y:label[1]+4},symbol]]:[])];
}
const circlePath=([x,y],r)=>`M${x-r} ${y}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0 ${-2*r} 0`;
/**
 * h in a section: h is the height between the copper base top and the PA bottom,
 * which only a cut through the assembly shows. Overview of section A–A through two
 * pads with the detail window, and the true-scale detail at the end of the boss with
 * h dimensioned between the two faces.
 */
export function sectionDetailSvg(r,geometry,{width=360,height=260}={}){
 const d=r.design,c=d.copper,G=c.base_thickness,h=r.copper_to_flange,[bx]=r.boss_center;
 const rows=geometry.records.flatMap(rec=>sectionIntervals(rec.polygons,geometry.cutY).map(([x0,x1])=>({rec,x0,x1})));
 const maxZ=Math.max(...geometry.records.map(v=>v.z+v.height)),xs=rows.map(v=>[v.x0,v.x1]).flat(),xmin=Math.min(...xs),xmax=Math.max(...xs);
 const flange=rows.filter(v=>v.rec.part==='pa-flange'),bossEnd=bx+r.boss_length/2,flangeEnd=flange.length?Math.max(...flange.map(v=>v.x1)):bossEnd;
 const xr=Math.max(bossEnd,flangeEnd),span=Math.max(2.6,5*h);
 const ovH=Math.max(58,Math.round(height*.3)),pad=8;
 const k0=Math.min((width-2*pad)/(xmax-xmin),(ovH-24)/maxZ),ox=x=>pad+(x-xmin)*k0+((width-2*pad)-(xmax-xmin)*k0)/2,oy=z=>ovH-6-z*k0;
 const area={x:pad,y:ovH+22,w:width-2*pad,h:height-ovH-30},win={x0:xr-span*.62,x1:xr+span*.38};
 const k=Math.min(area.w/(win.x1-win.x0),area.h/(h*2.4)),zc=G+h/2;
 const dx=x=>area.x+(x-win.x0)*k,dy=z=>area.y+area.h/2-(z-zc)*k;
 const fill=rec=>rec.role==='solder'?'#f2b8c4':rec.role==='cavity'?'none':`#${rec.color.toString(16).padStart(6,'0')}`;
 const draw=(X,Y,scale,cls)=>rows.filter(v=>v.rec.role!=='cavity').map(({rec,x0,x1})=>`<rect class="${cls}" data-part="${rec.part}" x="${X(x0)}" y="${Y(rec.z+rec.height)}" width="${Math.max(.5,(x1-x0)*scale)}" height="${Math.max(.5,rec.height*scale)}" fill="${fill(rec)}" fill-opacity="${rec.role==='solder'?.55:1}" stroke="#4d5e50" stroke-width=".5"/>`).join('');
 const winZ=[zc-area.h/2/k,zc+area.h/2/k];
 const xDim=xr+22/k,ext=6/k,top=G+h;
 const dim=dimensionGraphics([dx(xDim),dy(G)],[dx(xDim),dy(top)]).map(([tag,attributes])=>`<${tag} ${Object.entries(attributes).map(([key,v])=>`${key}="${v}"`).join(' ')}/>`).join('');
 const label=(x,y,text,anchor='start',cls='guide-section-label')=>`<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;
 const partLabel=(part,text)=>{const v=rows.find(row=>row.rec.part===part&&row.x1>win.x0&&row.x0<win.x1);if(!v)return'';const x=Math.max(win.x0,v.x0),x1=Math.min(win.x1,v.x1),z=v.rec.z+v.rec.height/2;if(Math.abs(v.rec.height*k)<11||(x1-x)*k<34)return'';return label(dx((x+x1)/2),dy(z)+4,text,'middle','guide-section-part');};
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="剖面 A–A：銅塊基座上表面到 PA 底面的高度 h" data-scale="${k}"><defs><clipPath id="guide-h-clip"><rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}"/></clipPath></defs>
 ${label(pad,13,'剖面 A–A（通過兩個小凸台）','start','guide-section-title')}
 <g class="guide-section-overview">${draw(ox,oy,k0,'ov')}<rect class="guide-detail-window" x="${ox(win.x0)}" y="${oy(winZ[1])}" width="${(win.x1-win.x0)*k0}" height="${(winZ[1]-winZ[0])*k0}"/></g>
 ${label(pad,ovH+15,`局部放大（真比例 ×${Math.round(k/k0)}）`,'start','guide-section-title')}
 <rect class="guide-detail-frame" x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" rx="3"/>
 <g clip-path="url(#guide-h-clip)">${draw(dx,dy,k,'detail')}
 <polyline class="guide-dimension-extension" points="${dx(flangeEnd)+3},${dy(top)} ${dx(xDim+ext)},${dy(top)}"/><polyline class="guide-dimension-extension" points="${dx(bossEnd)+3},${dy(G)} ${dx(xDim+ext)},${dy(G)}"/>
 ${dim}${partLabel('pa-flange','PA')}${partLabel('boss','中凸台')}${partLabel('base','銅塊基座')}${partLabel('pcb','PCB')}</g>
 ${label(dx(xDim)+8,(dy(G)+dy(top))/2+4,`h = ${h.toFixed(4)} mm`,'start','guide-dimension-text guide-h-value')}
 ${label(dx(xDim)+8,dy(top)-6,'PA 底面','start')}${label(dx(xDim)+8,dy(G)+14,'銅塊基座上表面','start')}
 </svg>`;
}
// Screen-space dimension graphics: arrow tips sit exactly on the measured
// points. When the projected distance is too short for two inside arrows,
// the arrows move outside both ends and point inward (drafting convention).
export function dimensionGraphics(a,b){
 const distance=Math.hypot(b[0]-a[0],b[1]-a[1]);if(distance<.5)return[];
 const u=[(b[0]-a[0])/distance,(b[1]-a[1])/distance],n=[-u[1],u[0]],outside=distance<2*ARROW_LENGTH+10;
 const arrow=(tip,direction)=>{const base=[tip[0]-direction[0]*ARROW_LENGTH,tip[1]-direction[1]*ARROW_LENGTH];
  return['polygon',{class:'guide-dimension-arrow',points:[tip,[base[0]+n[0]*ARROW_HALF_WIDTH,base[1]+n[1]*ARROW_HALF_WIDTH],[base[0]-n[0]*ARROW_HALF_WIDTH,base[1]-n[1]*ARROW_HALF_WIDTH]].map(p=>p.join(',')).join(' ')}];};
 const start=outside?[a[0]-u[0]*(ARROW_LENGTH+OUTSIDE_TAIL),a[1]-u[1]*(ARROW_LENGTH+OUTSIDE_TAIL)]:a;
 const end=outside?[b[0]+u[0]*(ARROW_LENGTH+OUTSIDE_TAIL),b[1]+u[1]*(ARROW_LENGTH+OUTSIDE_TAIL)]:b;
 // Inside: arrows point outward to each end. Outside: arrows point inward.
 const toA=outside?u:[-u[0],-u[1]],toB=outside?[-u[0],-u[1]]:u;
 return[['polyline',{class:'guide-dimension-line','data-arrows':outside?'outside':'inside',points:[start,end].map(p=>p.join(',')).join(' ')}],arrow(a,toA),arrow(b,toB)];
}
export function volumeGuideGeometry(r){
 const d=r.design,c=d.copper,s=d.stack,[x,y]=r.boss_center,g=layoutGeometry(r),base=c.base_thickness,h=r.copper_to_flange,low=r.boss_lower_height,L=r.boss_total_height;
 const boss=rectangle(x,y,r.boss_length,r.boss_width),pads=[];
 for(const sx of[-1,1])for(const sy of[-1,1])pads.push(...rectangle(x+sx*(r.boss_length-c.pad_size)/2,y+sy*(r.boss_width-c.pad_size)/2,c.pad_size,c.pad_size));
 const records=[],add=(part,role,polygons,z,height,color)=>{if(height>1e-9&&polygons.length)records.push({part,role,polygons,z,height,color});};
 add('base','reference',g.copperProfile,0,base,0xbd814c);
 add('pcb','reference',g.board,base+s.board_solder,d.pcb.thickness,0x348467);
 add('boss','copper',boss,base,low,0xd28e4f);add('pads','copper',pads,base+low,s.pad_height,0xf1bf79);
 add('cavity','cavity',g.cutout,base,h,0x4f87cf);
 add('solder-low','solder',clipping.difference(g.cutout,boss),base,low,0xdf657e);
 add('solder-pads','solder',clipping.difference(g.cutout,pads),base+low,s.pad_height,0xdf657e);
 add('solder-top','solder',g.cutout,base+L,h-L,0xdf657e);
 const p=paReference(d.package,r.pa_envelope),flange=p.flange,body=p.body;
 const move=polys=>polys.map(poly=>poly.map(ring=>ring.map(([a,b])=>[a+x,b+y])));
 add('pa-flange','reference',move(roundedRectangle(flange.length,flange.width,flange.radius)),base+h,flange.depth,0xb67945);
 add('pa-body','reference',[[[...body.profile,body.profile[0]].map(([a,b])=>[a+x,b+y])]],base+h+body.bottom,body.depth,0x414e58);
 for(const pin of p.pins)add('pin','reference',rectangle(x+pin.center[0],y+pin.center[1],pin.size[0],pin.size[1]),base+h+pin.center[2]-pin.size[2]/2,pin.size[2],0xd5ad4e);
 return {records,cutY:y+(r.boss_width-c.pad_size)/2,opening:g.cutout};
}
export function sectionIntervals(polygons,y){
 const segments=[];
 for(const poly of polygons){const xs=[];for(const ring of poly)for(let i=1;i<ring.length;i++){const [a,b]=[ring[i-1],ring[i]];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)segments.push([xs[i],xs[i+1]]);}
 return segments;
}
export function scaledSection(r,geometry,{width=560,height=278,zoom=1}={}){
 const c=r.design.copper,maxZ=Math.max(...geometry.records.map(v=>v.z+v.height)),k0=Math.min((width-100)/(c.base_length+10),(height-150)/maxZ),k=k0*zoom;
 const focusZ=c.base_thickness+r.copper_to_flange/2,focusY=height/2+(maxZ/2-focusZ)*k0,origin=width/2-r.boss_center[0]*k,bottom=focusY+focusZ*k;
 const clip={x:35,y:78,width:width-70,height:Math.max(40,height-126)};
 const rects=geometry.records.flatMap(rec=>sectionIntervals(rec.polygons,geometry.cutY).map(([a,b])=>`<rect data-volume-role="${rec.role}" data-part="${rec.part}" x="${origin+a*k}" y="${bottom-(rec.z+rec.height)*k}" width="${(b-a)*k}" height="${rec.height*k}" fill="#${rec.color.toString(16)}" stroke="#526658" stroke-width=".5"/>`)).join('');
 const baseY=bottom-c.base_thickness*k,flangeY=baseY-r.copper_to_flange*k;
 const paX=Math.max(clip.x+18,Math.min(width/2,origin+(r.boss_center[0]-r.design.package.length/2)*k+8));
 const baseX=Math.min(width-clip.x-18,origin+c.base_length*k/2-8);
 return `<svg viewBox="0 0 ${width} ${height}" data-scale-x="${k}" data-scale-z="${k}" data-zoom="${zoom}" role="img" aria-label="真實比例剖面；標籤固定在畫面內，水平與垂直等比縮放"><defs><clipPath id="guide-section-clip"><rect x="${clip.x}" y="${clip.y}" width="${clip.width}" height="${clip.height}"/></clipPath></defs><g clip-path="url(#guide-section-clip)"><g class="guide-section-parts">${rects}</g><path d="M35 ${baseY}H${width-35}M35 ${flangeY}H${width-35}" stroke="#526778" stroke-dasharray="4 3" fill="none"/></g><g class="guide-fixed-labels"><text x="${width/2}" y="22" text-anchor="middle">h = ${r.copper_to_flange.toFixed(4)} mm · L = ${r.boss_total_height.toFixed(4)} mm</text><text x="${width/2}" y="43" text-anchor="middle">真比例剖面 · 穿過兩個小凸台</text><text x="15" y="66">PA 底面</text><path d="M15 72H75L${paX} ${Math.max(clip.y,Math.min(clip.y+clip.height,flangeY))}" stroke="#633d26" fill="none"/><text x="${width-15}" y="${height-12}" text-anchor="end">銅塊基座上表面</text><path d="M${width-15} ${height-30}H${width-65}L${baseX} ${Math.max(clip.y,Math.min(clip.y+clip.height,baseY))}" stroke="#633d26" fill="none"/></g></svg>`;
}
function shapes(polys){return polys.map(poly=>{const s=new THREE.Shape(poly[0].map(p=>new THREE.Vector2(...p)));s.holes=poly.slice(1).map(ring=>new THREE.Path(ring.map(p=>new THREE.Vector2(...p))));return s;});}
const component=rec=>rec.part==='pcb'?'pcb':rec.part.startsWith('pa-')||rec.part==='pin'?'pa':['base','boss','pads'].includes(rec.part)?'copper':rec.role;
export class VolumeGuide3D{
 constructor(el,r,geometry,{inspector=false}={}){
  this.el=el;this.r=r;this.inspector=inspector;this.mode='all';this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#f5f8f1');this.group=new THREE.Group();this.scene.add(this.group);
  this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));el.append(this.renderer.domElement);
  this.scene.add(new THREE.HemisphereLight(0xffffff,0x827762,2));const light=new THREE.DirectionalLight(0xffefd6,3);light.position.set(30,-30,60);this.scene.add(light);
  const records=[...geometry.records];
  if(inspector){const [x,y]=r.boss_center,ring=octagon(r.boss_length,r.boss_width,r.design.preform.chamfer).map(([a,b])=>[a+x,b+y]);ring.push(ring[0]);records.push({part:'preform',role:'preform',polygons:[[ring]],z:r.design.copper.base_thickness+r.boss_lower_height,height:r.model_thickness,color:0x849bab});}
  this.objects=[];
  for(const rec of records){const shape=new THREE.ExtrudeGeometry(shapes(rec.polygons),{depth:rec.height,bevelEnabled:false});shape.translate(0,0,rec.z);const mat=new THREE.MeshStandardMaterial({color:rec.color,roughness:.48,metalness:.25,side:THREE.DoubleSide});const mesh=new THREE.Mesh(shape,mat);mesh.userData=rec;this.group.add(mesh);const edge=new THREE.LineSegments(new THREE.EdgesGeometry(shape,22),new THREE.LineBasicMaterial({color:0x4a493b,transparent:true,opacity:.6}));this.group.add(edge);this.objects.push({mesh,edge,rec});}
  const box=new THREE.Box3().setFromObject(this.group);this.center=box.getCenter(new THREE.Vector3());this.extent=box.getSize(new THREE.Vector3()).length()*.76;
  this.camera=new THREE.OrthographicCamera();this.camera.near=.01;this.camera.far=this.extent*30;
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.copy(this.center);this.controls.enableDamping=true;this.controls.minZoom=.3;this.controls.maxZoom=120;
  this.resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);const a=w/h;Object.assign(this.camera,{left:-this.extent*a/2,right:this.extent*a/2,top:this.extent/2,bottom:-this.extent/2});this.camera.updateProjectionMatrix();this.drawSection?.();};this.observer=new ResizeObserver(this.resize);this.observer.observe(el);this.resize();this.resetView();this.select('all');
  if(inspector){this.overlay=document.createElementNS(SVG_NS,'svg');this.overlay.classList.add('guide-dimension-overlay');el.append(this.overlay);this.overlay.style.display="none";
   this.geometry=geometry;this.section=document.createElement('div');this.section.className='guide-section-detail';this.section.hidden=true;el.append(this.section);}
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const render=t=>{this.frame=requestAnimationFrame(render);this.controls.update();const pulse=this.inspector?0:reduce?.4:.08+1.1*(.5+.5*Math.sin(t/220));for(const {mesh}of this.objects)mesh.material.emissiveIntensity=this.inspector?(mesh.userData.focus?FOCUS_GLOW:0):mesh.userData.selected?pulse:0;
   const w=el.clientWidth,h=el.clientHeight;this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,w,h);this.renderer.render(this.scene,this.camera);
   if(this.detail){
    // 局部放大: the same scene, from the main camera's direction, in the inset.
    const box=this.detail.rect,y=h-box.y-box.h;this.syncDetailCamera();
    this.renderer.setScissorTest(true);this.renderer.setScissor(box.x,y,box.w,box.h);this.renderer.setViewport(box.x,y,box.w,box.h);this.renderer.render(this.scene,this.detail.camera);
    this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,w,h);
   }
   this.renderDimension();};this.frame=requestAnimationFrame(render);
 }
 resetView(view='iso'){
  // Flush any orbit-damping momentum so the reset view does not drift.
  this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=true;
  this.el.dataset.cameraView=view;const{offset,up}=cameraView(view,this.extent*2);this.camera.up.set(...up);this.camera.position.copy(this.center).add(new THREE.Vector3(...offset));this.camera.zoom=1;this.camera.lookAt(this.center);this.controls.target.copy(this.center);this.camera.updateProjectionMatrix();this.controls.update();}
 select(mode){this.mode=mode;this.el.dataset.volume=mode;
  const focus=mode==='dimension'?this.dimension.focusParts:null;
  for(const {mesh,edge,rec}of this.objects){const dimension=mode==='dimension',chosen=dimension?component(rec)===this.dimension.component:rec.role===mode,all=mode==='all';
   mesh.visible=edge.visible=dimension?chosen:rec.role==='reference'||rec.role==='copper'||chosen||all&&!['cavity','preform'].includes(rec.role);
   const lit=!!(chosen&&focus?.includes(rec.part)),context=!!(chosen&&focus&&!lit);
   const opacity=context?.42:chosen?1:all?(rec.role==='solder'?.65:rec.part==='pcb'?.25:.85):.1;
   mesh.userData.selected=chosen;mesh.userData.focus=lit;
   // Transparent meshes are sorted by bounding-sphere centre, so a large part
   // (copper base) can be drawn after a small part above it (PA pins) at some
   // angles. Nearly opaque parts therefore write depth; only the see-through
   // PCB and solder layers skip it.
   Object.assign(mesh.material,{transparent:opacity<1,opacity,depthWrite:opacity>=OPAQUE_DEPTH_WRITE});mesh.material.emissive.setHex(lit?0xe8742f:chosen?rec.color:0);edge.material.opacity=lit?1:chosen?(context?.45:.9):.16;mesh.material.needsUpdate=true;
  }this.el.dataset.selectedOpacity=mode==='all'?'mixed':'1';
  this.el.dataset.visibleComponents=[...new Set(this.objects.filter(({mesh})=>mesh.visible).map(({rec})=>component(rec)))].sort().join(',');
 }
 fitVisible(view){
  this.resetView(view);
  const box=new THREE.Box3();for(const {mesh}of this.objects)if(mesh.visible)box.expandByObject(mesh);
  if(this.dimension)for(const p of[this.dimension.a,this.dimension.b])box.expandByPoint(new THREE.Vector3(...p));
  const center=box.getCenter(new THREE.Vector3());this.camera.position.add(center.clone().sub(this.controls.target));this.controls.target.copy(center);this.camera.lookAt(center);this.camera.updateMatrixWorld(true);
  const projected=new THREE.Box3();for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(this.camera.matrixWorldInverse));
  const size=projected.getSize(new THREE.Vector3());this.camera.zoom=Math.min(40,(this.camera.right-this.camera.left)/(Math.max(size.x,.1)*1.25),(this.camera.top-this.camera.bottom)/(Math.max(size.y,.1)*1.25));this.camera.updateProjectionMatrix();this.controls.update();
  if(this.inspector&&this.dimension&&!this.dimension.section)this.setupDetail(box,size);
 }
 /**
  * Locate a dimension. Thin features (K, J, L…) keep the whole part in view with
  * the feature lit and circled, and show the dimension in a 局部放大 inset; h,
  * a height only a cut shows, is drawn on a section of the assembly.
  */
 selectDimension(key,{symbol=''}={}){
  const r=this.r,[x,y]=r.boss_center,z=referenceLevels(r),I=r.boss_length,H=r.boss_width,J=r.design.copper.pad_size;
  this.el.dataset.dimension=key;this.detail=null;this.el.dataset.detail='false';delete this.el.dataset.dimensionZoom;
  if(key==='h'){
   this.dimension={key,section:true,component:'cavity',a:[x,y,z.base],b:[x,y,z.flange],label:`h = ${r.copper_to_flange.toFixed(4)} mm（剖面 A–A）`};
   this.select('dimension');this.showSection(true);return this.dimension.label;
  }
  this.showSection(false);
  let d=dimensionFor(key,r,layoutGeometry(r));
  d={...d,key,symbol,component:key.startsWith('pcb.')?'pcb':key.startsWith('preform.')?'preform':'copper',label:dimensionLabel(d),focusParts:FOCUS_PARTS[key]??null};
  if(key.startsWith('preform.')){d.a=d.a.map((v,i)=>v+[x,y,z.boss][i]);d.b=d.b.map((v,i)=>v+[x,y,z.boss][i]);}
  // Measured on the outside edges, so the offset dimension line clears the part.
  const edge={
   // K at the step of the pad's inner edge, drawn over the boss top beside it
   'stack.pad_height':[[x+I/2-J,y-H/2,z.boss],[x+I/2-J,y-H/2,z.pad]],
   'boss.total_height':[[x+I/2,y-H/2,z.base],[x+I/2,y-H/2,z.pad]],
   'copper.pad_size':[[x+I/2-J,y+H/2,z.pad],[x+I/2,y+H/2,z.pad]],
  }[key];
  if(edge)[d.a,d.b]=edge;
  if(key==='stack.pad_height')d.away=[x+I/2-J/2,y-H/2+J/2,(z.boss+z.pad)/2]; // away from the pad
  this.dimension=d;this.select('dimension');this.fitVisible(d.view);this.overlay.style.display="block";return d.label;
 }
 showSection(on){
  this.renderer.domElement.style.visibility=on?'hidden':'';this.section.hidden=!on;this.overlay.style.display=on?'none':'block';
  if(on){const draw=()=>{if(this.section.hidden)return;const w=this.el.clientWidth,h=this.el.clientHeight;if(w&&h)this.section.innerHTML=sectionDetailSvg(this.r,this.geometry,{width:w,height:h});};draw();this.drawSection=draw;}
  else{this.section.replaceChildren();this.drawSection=null;}
 }
 /**
  * When the dimension is too short to read with the whole part in view, keep the
  * part (lit feature) in one region and add an inset that magnifies the feature.
  */
 setupDetail(box,size){
  this.detail=null;this.el.dataset.detail='false';delete this.el.dataset.dimensionZoom;
  const W=this.el.clientWidth,H=this.el.clientHeight;if(!W||!H)return;
  this.camera.updateMatrixWorld(true);
  const screen=p=>{const v=new THREE.Vector3(...p).project(this.camera);return[(v.x+1)*W/2,(1-v.y)*H/2];};
  const [a,b]=[this.dimension.a,this.dimension.b].map(screen),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(length>=MIN_DIMENSION_PX||length<1e-6)return;
  const rect={w:Math.round(Math.min(W*.5,320)),h:Math.round(Math.min(H*.55,240))};rect.x=W-rect.w-6;rect.y=H-rect.h-6;
  // the part goes where it can be largest: above the inset, or left of it
  const fit=(w,h)=>Math.min(w/(Math.max(size.x,.1)*1.15),h/(Math.max(size.y,.1)*1.15));
  const upper={x:0,y:0,w:W,h:rect.y-4},left={x:0,y:0,w:rect.x-4,h:H};
  const region=fit(upper.w,upper.h)>=fit(left.w,left.h)?upper:left;
  const unitsAtZoom1=(this.camera.right-this.camera.left)/W,zoom=Math.min(40,fit(region.w,region.h)*unitsAtZoom1);
  const target=Math.max(52,Math.min(rect.w,rect.h)*.24),ratio=target/(length*zoom/this.camera.zoom);
  if(ratio<2.5)return; // nearly readable already: no inset
  this.camera.zoom=zoom;this.camera.updateProjectionMatrix();
  const per=unitsAtZoom1/this.camera.zoom,right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1);
  const shift=right.multiplyScalar(-(region.x+region.w/2-W/2)*per).add(up.multiplyScalar((region.y+region.h/2-H/2)*per));
  this.camera.position.add(shift);this.controls.target.add(shift);this.camera.updateMatrixWorld(true);this.controls.update();
  const units=per/ratio; // world units per inset pixel
  const camera=new THREE.OrthographicCamera(-rect.w/2*units,rect.w/2*units,rect.h/2*units,-rect.h/2*units,this.camera.near,this.camera.far);
  const centre=new THREE.Vector3(...this.dimension.a.map((v,i)=>(v+this.dimension.b[i])/2));
  this.detail={rect,camera,centre,ratio};this.syncDetailCamera();
  this.el.dataset.detail='true';this.el.dataset.dimensionZoom=ratio.toFixed(2);
 }
 syncDetailCamera(){
  const {camera,centre}=this.detail;camera.up.copy(this.camera.up);camera.quaternion.copy(this.camera.quaternion);
  camera.position.copy(centre).add(this.camera.position.clone().sub(this.controls.target));camera.updateMatrixWorld(true);
 }
 renderDimension(){
  if(!this.overlay||!this.dimension||this.dimension.section)return;
  const w=this.el.clientWidth,h=this.el.clientHeight;this.overlay.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const projector=(camera,box)=>p=>{const v=(p.isVector3?p.clone():new THREE.Vector3(...p)).project(camera);return[box.x+(v.x+1)*box.w/2,box.y+(1-v.y)*box.h/2];};
  const full={x:0,y:0,w,h},main=projector(this.camera,full),d=this.dimension,specs=[];
  const focusCentre=()=>{const box=new THREE.Box3();for(const {mesh}of this.objects)if(mesh.visible&&(!d.focusParts||mesh.userData.focus))box.expandByObject(mesh);return box.isEmpty()?null:box.getCenter(new THREE.Vector3());};
  const centre=d.away?new THREE.Vector3(...d.away):focusCentre();
  if(this.detail){
   const box=this.detail.rect,inset=projector(this.detail.camera,box),mid=main(this.detail.centre),radius=13;
   const corner=[Math.min(Math.max(mid[0],box.x),box.x+box.w),Math.min(Math.max(mid[1],box.y),box.y+box.h)],dist=Math.hypot(corner[0]-mid[0],corner[1]-mid[1])||1;
   const from=[mid[0]+(corner[0]-mid[0])/dist*radius,mid[1]+(corner[1]-mid[1])/dist*radius];
   specs.push(['path',{class:'guide-detail-mark',d:circlePath(mid,radius)}],['rect',{class:'guide-detail-frame',x:box.x,y:box.y,width:box.w,height:box.h,rx:4}]);
   if(dist>radius+2)specs.push(['polyline',{class:'guide-detail-leader',points:[from,corner].map(v=>v.join(',')).join(' ')}]);
   specs.push(['text',{class:'guide-detail-caption',x:box.x+7,y:box.y+15},`局部放大 ×${Math.round(this.detail.ratio)}`]);
   specs.push(...offsetDimensionGraphics(inset(d.a),inset(d.b),centre?inset(centre):[box.x+box.w/2,box.y+box.h/2],{symbol:d.symbol}));
  }else specs.push(...offsetDimensionGraphics(main(d.a),main(d.b),centre?main(centre):[w/2,h/2],{symbol:d.symbol}));
  this.overlay.replaceChildren(...svgNodes(specs));
 }
 dispose(){cancelAnimationFrame(this.frame);this.observer.disconnect();this.section?.remove();this.controls.dispose();for(const {mesh,edge}of this.objects){mesh.geometry.dispose();mesh.material.dispose();edge.geometry.dispose();edge.material.dispose();}this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();this.overlay?.remove();}
}
