import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import clipping from 'polygon-clipping';
import {layoutGeometry,rectangle,roundedRectangle} from './layout.js';
import {paReference} from './pa-reference.js';
export function volumeGuideGeometry(r){
 const d=r.design,c=d.copper,s=d.stack,[x,y]=r.boss_center,g=layoutGeometry(r),base=c.base_thickness,h=r.copper_to_flange,low=r.boss_lower_height,L=r.boss_total_height;
 const boss=rectangle(x,y,r.boss_length,r.boss_width),pads=[];
 for(const sx of[-1,1])for(const sy of[-1,1])pads.push(...rectangle(x+sx*(r.boss_length-c.pad_size)/2,y+sy*(r.boss_width-c.pad_size)/2,c.pad_size,c.pad_size));
 const records=[],add=(part,role,polygons,z,height,color)=>{if(height>1e-9&&polygons.length)records.push({part,role,polygons,z,height,color});};
 add('base','reference',g.copperProfile,0,base,0xbd814c);
 add('pcb','reference',g.board,base+s.board_solder,d.pcb.thickness,0x348467);
 add('boss','copper',boss,base,low,0xd28e4f);add('pads','copper',pads,base+low,s.pad_height,0xf1bf79);
 add('cavity','cavity',g.cutout,base,h,0xe76e58);
 add('solder-low','solder',clipping.difference(g.cutout,boss),base,low,0xe76e58);
 add('solder-pads','solder',clipping.difference(g.cutout,pads),base+low,s.pad_height,0xe76e58);
 add('solder-top','solder',g.cutout,base+L,h-L,0xe76e58);
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
export function scaledSection(r,geometry){
 const c=r.design.copper,extent=c.base_length+10,maxZ=Math.max(...geometry.records.map(v=>v.z+v.height)),k=Math.min(440/extent,150/maxZ),origin=280,bottom=220;
 const rects=geometry.records.flatMap(rec=>sectionIntervals(rec.polygons,geometry.cutY).map(([a,b])=>`<rect data-volume-role="${rec.role}" data-part="${rec.part}" x="${origin+a*k}" y="${bottom-(rec.z+rec.height)*k}" width="${(b-a)*k}" height="${rec.height*k}" fill="#${rec.color.toString(16)}" stroke="#526658" stroke-width=".4"/>`)).join('');
 const baseY=bottom-c.base_thickness*k,flangeY=baseY-r.copper_to_flange*k,paLeft=origin+(r.boss_center[0]-r.design.package.length/2)*k,baseRight=origin+c.base_length*k/2;
 return `<svg viewBox="0 0 560 278" role="img" data-scale-x="${k}" data-scale-z="${k}" data-focus-x="${origin+r.boss_center[0]*k}" data-focus-y="${baseY-r.copper_to_flange*k/2}" aria-label="真實尺寸比例剖面，水平與垂直採同一縮放比例"><g class="guide-section-parts">${rects}</g><path d="M40 ${baseY}H520M40 ${flangeY}H520" stroke="#6e8190" stroke-dasharray="4 3" stroke-width=".6"/><path d="M${paLeft} ${flangeY}L80 95H35M${baseRight} ${baseY}L495 249H535" stroke="#5a4940" fill="none"/><text x="35" y="82">PA 底面</text><text x="250" y="264" text-anchor="middle">銅塊基座上表面</text><text x="280" y="26" text-anchor="middle">真比例剖面 · h = ${r.copper_to_flange.toFixed(4)} mm · L = ${r.boss_total_height.toFixed(4)} mm</text><text x="280" y="47" text-anchor="middle">剖切 Y = ${geometry.cutY.toFixed(3)} mm（穿過兩個小凸台）</text></svg>`;
}
function shapes(polys){return polys.map(poly=>{const s=new THREE.Shape(poly[0].map(p=>new THREE.Vector2(...p)));s.holes=poly.slice(1).map(ring=>new THREE.Path(ring.map(p=>new THREE.Vector2(...p))));return s;});}
export class VolumeGuide3D{
 constructor(el,r,geometry){
  this.el=el;this.mode='all';this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#f5f8f1');this.group=new THREE.Group();this.scene.add(this.group);
  this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));el.append(this.renderer.domElement);
  this.scene.add(new THREE.HemisphereLight(0xffffff,0x827762,2));const light=new THREE.DirectionalLight(0xffefd6,3);light.position.set(30,-30,60);this.scene.add(light);
  this.objects=[];
  for(const rec of geometry.records){const shape=new THREE.ExtrudeGeometry(shapes(rec.polygons),{depth:rec.height,bevelEnabled:false});shape.translate(0,0,rec.z);const mat=new THREE.MeshStandardMaterial({color:rec.color,roughness:.48,metalness:.25,side:THREE.DoubleSide});const mesh=new THREE.Mesh(shape,mat);mesh.userData=rec;this.group.add(mesh);const edge=new THREE.LineSegments(new THREE.EdgesGeometry(shape,22),new THREE.LineBasicMaterial({color:0x4a493b,transparent:true,opacity:.6}));this.group.add(edge);this.objects.push({mesh,edge,rec});}
  const box=new THREE.Box3().setFromObject(this.group),center=box.getCenter(new THREE.Vector3());this.extent=box.getSize(new THREE.Vector3()).length()*.76;
  this.camera=new THREE.OrthographicCamera();this.camera.up.set(0,0,1);this.camera.position.copy(center).add(new THREE.Vector3(1,-1,1).multiplyScalar(this.extent*3));this.camera.near=.01;this.camera.far=this.extent*30;this.camera.lookAt(center);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.copy(center);this.controls.enableDamping=true;
  this.resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);const a=w/h;Object.assign(this.camera,{left:-this.extent*a/2,right:this.extent*a/2,top:this.extent/2,bottom:-this.extent/2});this.camera.updateProjectionMatrix();};this.observer=new ResizeObserver(this.resize);this.observer.observe(el);this.resize();this.select('all');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const render=t=>{this.frame=requestAnimationFrame(render);this.controls.update();const pulse=reduce?.2:.12+.28*(.5+.5*Math.sin(t/240));for(const {mesh,rec}of this.objects)mesh.material.emissiveIntensity=rec.role===this.mode?pulse:0;this.renderer.render(this.scene,this.camera);};this.frame=requestAnimationFrame(render);
 }
 select(mode){this.mode=mode;this.el.dataset.volume=mode;for(const {mesh,edge,rec}of this.objects){const chosen=rec.role===mode,all=mode==='all';mesh.visible=edge.visible=rec.role==='reference'||rec.role==='copper'||chosen||all&&rec.role!=='cavity';const opacity=chosen?1:all?(rec.role==='solder'?.65:rec.part==='pcb'?.25:.85):.1;Object.assign(mesh.material,{transparent:opacity<1,opacity,depthWrite:opacity===1});mesh.material.emissive.setHex(chosen?rec.color:0);edge.material.opacity=chosen?.8:.18;mesh.material.needsUpdate=true;}this.el.dataset.selectedOpacity=mode==='all'?'mixed':'1';}
 dispose(){cancelAnimationFrame(this.frame);this.observer.disconnect();this.controls.dispose();for(const {mesh,edge}of this.objects){mesh.geometry.dispose();mesh.material.dispose();edge.geometry.dispose();edge.material.dispose();}this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}
