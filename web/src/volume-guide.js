import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import clipping from 'polygon-clipping';
import {layoutGeometry,rectangle,roundedRectangle} from './layout.js';
import {octagon} from './design.js';
import {dimensionFor,dimensionLabel,referenceLevels} from './dimensions.js';
import {cameraView} from './camera-views.js';
import {paReference} from './pa-reference.js';
import {ARROW_LENGTH,ARROW_HALF_WIDTH,OUTSIDE_TAIL} from './dimension-arrows.js';
const MIN_DIMENSION_PX=70;
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
  this.resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);const a=w/h;Object.assign(this.camera,{left:-this.extent*a/2,right:this.extent*a/2,top:this.extent/2,bottom:-this.extent/2});this.camera.updateProjectionMatrix();};this.observer=new ResizeObserver(this.resize);this.observer.observe(el);this.resize();this.resetView();this.select('all');
  if(inspector){this.overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');this.overlay.classList.add('guide-dimension-overlay');el.append(this.overlay);this.overlay.style.display="none";}
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const render=t=>{this.frame=requestAnimationFrame(render);this.controls.update();const pulse=this.inspector?0:reduce?.4:.08+1.1*(.5+.5*Math.sin(t/220));for(const {mesh}of this.objects)mesh.material.emissiveIntensity=mesh.userData.selected?pulse:0;this.renderer.render(this.scene,this.camera);this.renderDimension();};this.frame=requestAnimationFrame(render);
 }
 resetView(view='iso'){const{offset,up}=cameraView(view,this.extent*2);this.camera.up.set(...up);this.camera.position.copy(this.center).add(new THREE.Vector3(...offset));this.camera.zoom=1;this.camera.lookAt(this.center);this.controls.target.copy(this.center);this.camera.updateProjectionMatrix();this.controls.update();}
 select(mode){this.mode=mode;this.el.dataset.volume=mode;
  for(const {mesh,edge,rec}of this.objects){const dimension=mode==='dimension',chosen=dimension?component(rec)===this.dimension.component:rec.role===mode,all=mode==='all';
   mesh.visible=edge.visible=dimension?chosen:rec.role==='reference'||rec.role==='copper'||chosen||all&&!['cavity','preform'].includes(rec.role);
   const opacity=chosen?1:all?(rec.role==='solder'?.65:rec.part==='pcb'?.25:.85):.1;
   mesh.userData.selected=chosen;Object.assign(mesh.material,{transparent:opacity<1,opacity,depthWrite:opacity===1});mesh.material.emissive.setHex(chosen?rec.color:0);edge.material.opacity=chosen?.9:.16;mesh.material.needsUpdate=true;
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
 }
 selectDimension(key){
  const r=this.r,[x,y]=r.boss_center,z=referenceLevels(r);
  let d=key==='h'?{a:[x+r.boss_length/2,y,z.base],b:[x+r.boss_length/2,y,z.flange],value:r.copper_to_flange,view:'front',component:'cavity',label:`h = ${r.copper_to_flange.toFixed(4)} mm`}:dimensionFor(key,r,layoutGeometry(r));
  if(key!=='h'){d={...d,component:key.startsWith('pcb.')?'pcb':key.startsWith('preform.')?'preform':'copper',label:dimensionLabel(d)};if(key.startsWith('preform.')){d.a=d.a.map((v,i)=>v+[x,y,z.boss][i]);d.b=d.b.map((v,i)=>v+[x,y,z.boss][i]);}}
  this.dimension=d;this.el.dataset.dimension=key;this.select('dimension');this.fitVisible(d.view);this.zoomToSmallDimension();this.overlay.style.display="block";return d.label;
 }
 // Thin features (K = 0.15 mm, h, O) project to a few pixels when the whole
 // part is in view, so their arrow tips cannot visibly land on the edges.
 // Zoom about the dimension until it spans MIN_DIMENSION_PX, keeping the part
 // around it as context.
 zoomToSmallDimension(){
  if(!this.dimension||!this.el.clientWidth)return;
  this.camera.updateMatrixWorld(true);
  const screen=p=>{const v=new THREE.Vector3(...p).project(this.camera);return[v.x*this.el.clientWidth/2,v.y*this.el.clientHeight/2];};
  const [a,b]=[this.dimension.a,this.dimension.b].map(screen),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(length>=MIN_DIMENSION_PX||length<1e-6)return;
  const mid=new THREE.Vector3(...this.dimension.a.map((v,i)=>(v+this.dimension.b[i])/2)),shift=mid.clone().sub(this.controls.target);
  this.camera.position.add(shift);this.controls.target.copy(mid);this.camera.lookAt(mid);
  this.camera.zoom=Math.min(this.controls.maxZoom,this.camera.zoom*MIN_DIMENSION_PX/length);
  this.camera.updateProjectionMatrix();this.controls.update();
  this.el.dataset.dimensionZoom=this.camera.zoom.toFixed(2);
 }
 renderDimension(){
  if(!this.overlay||!this.dimension)return;
  const w=this.el.clientWidth,h=this.el.clientHeight;this.overlay.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const [a,b]=[this.dimension.a,this.dimension.b].map(p=>{const v=new THREE.Vector3(...p).project(this.camera);return[(v.x+1)*w/2,(1-v.y)*h/2];});
  this.overlay.replaceChildren(...dimensionGraphics(a,b).map(([tag,attributes])=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attributes))node.setAttribute(k,v);return node;}));
 }
 dispose(){cancelAnimationFrame(this.frame);this.observer.disconnect();this.controls.dispose();for(const {mesh,edge}of this.objects){mesh.geometry.dispose();mesh.material.dispose();edge.geometry.dispose();edge.material.dispose();}this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();this.overlay?.remove();}
}
