import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { octagon } from './design.js';
import { dimensionFor, dimensionLabel, referenceLevels } from './dimensions.js';
import { paReference } from './pa-reference.js';
import { cameraView, createCADCamera } from './camera-views.js';
import { annotationLayout, featureLeader, overlaps } from './annotation-layout.js';

const vec = p => new THREE.Vector3(...p);
const svgNS='http://www.w3.org/2000/svg';
const copperTones=[0x9f6039,0xcd8b50,0xf3c07d];
const svgNode=(tag,attributes={})=>{const node=document.createElementNS(svgNS,tag);for(const[key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;};
function corners(box){const points=[];for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z));return points;}
function shapes(polygons) {
  return polygons.map(polygon=>{
    const shape=new THREE.Shape(polygon[0].slice(0,-1).map(p=>new THREE.Vector2(...p)));
    shape.holes=polygon.slice(1).map(ring=>new THREE.Path(ring.slice(0,-1).map(p=>new THREE.Vector2(...p))));
    return shape;
  });
}
function dispose(group) {
  const materials=new Set(),geometries=new Set();
  group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>{m.map?.dispose();m.dispose();});
}

export class CADViewer {
  constructor(container,onMode=()=>{},onDimension=()=>{}) {
    this.el=container;this.onMode=onMode;this.onDimension=onDimension;
    this.mode='assembly';this.refs={copper:true,preform:true,pcb:true,pa:true,epad:false};this.exploded=false;this.key=null;this.toleranceFocus=null;this.scale=50;this.lastOrthographicView='top';
    this.scene=new THREE.Scene();this.camera=createCADCamera();this.camera.position.set(50,-60,50);
    this.target=new THREE.Vector3();this.models=new THREE.Group();this.scene.add(this.models);
    this.overlay=svgNode('svg',{'class':'dimension-overlay','aria-label':'尺寸定位標註'});container.append(this.overlay);
    this.textMeasure=document.createElement('canvas').getContext('2d');this.textMeasure.font='650 13px system-ui, sans-serif';
    this.activeDimension=null;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0,0);
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;container.prepend(this.renderer.domElement);
      this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
      this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
      // Self-contained studio reflections keep the metal colored; no remote
      // HDR or image asset is fetched by the CAD workspace.
      try{const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(this.renderer);this.scene.environment=pmrem.fromScene(room,.045,0.1,100,{size:128}).texture;this.scene.environmentIntensity=.72;room.dispose();pmrem.dispose();}catch{}
      this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;
      this.controls.addEventListener('start',()=>this.markView('custom'));
      this.controls.addEventListener('change',()=>this.updateAnnotation());
      this.controls.minDistance=.15;this.controls.maxDistance=3000;
      this.scene.add(new THREE.HemisphereLight(0xf6fbff,0x9a7e60,1.55));
      for(const[position,intensity,color]of[[[30,-42,65],3.2,0xffefdb],[[-40,15,30],1.2,0xdcecff],[[15,50,25],1.5,0xffffff]]){const light=new THREE.DirectionalLight(color,intensity);light.position.set(...position);this.scene.add(light);if(!this.keyLight){this.keyLight=light;light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0001;light.shadow.normalBias=.035;}}
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(240,240),new THREE.ShadowMaterial({color:0x34413a,opacity:.18}));ground.position.z=-.14;ground.receiveShadow=true;this.scene.add(ground);
      const grid=new THREE.GridHelper(100,20,0xcbd6c6,0xe3e8dd);grid.rotation.x=Math.PI/2;grid.position.z=-.15;this.scene.add(grid);
      new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();if(width&&height){this.renderer.setSize(width,height);this.fitCamera();}}).observe(container);
      const animate=()=>{
        requestAnimationFrame(animate);
        this.controls.update();this.renderer.render(this.scene,this.camera);
      };requestAnimationFrame(animate);
    } catch {this.renderer=null;}
  }

  setDesign(r,layout,parts=null) {
    this.r=r;this.layout=layout;this.parts=parts;this.renderModels();
    if(this.key)this.selectDimension(this.key,false,{tolerance:this.toleranceFocus===this.key});
  }
  mesh(geometry,color,opacity=1,component='copper') {
    const makeMaterial=value=>new THREE.MeshStandardMaterial({color:value,roughness:component==='copper'?.34:component==='preform'?.28:.52,metalness:component==='copper'?.64:component==='preform'?.72:component==='pa'?.35:.05,envMapIntensity:1.05,transparent:opacity<1,opacity,depthWrite:opacity>=.9,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,Array.isArray(color)?color.map(makeMaterial):makeMaterial(color));
    mesh.castShadow=opacity>=.9&&component!=='pcb';mesh.receiveShadow=true;
    mesh.userData.component=component;this.models.add(mesh);
    const edgeColor=component==='copper'?0x4e301e:component==='pa'?0x2a3540:component==='preform'?0x5e6970:0x365747;
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,24),new THREE.LineBasicMaterial({color:edgeColor,transparent:true,opacity:Math.min(.86,opacity+.08)}));edge.position.copy(mesh.position);edge.userData.component=component;this.models.add(edge);
    return {mesh,edge};
  }
  box(size,center,color,opacity=1,component='copper') {
    const pair=this.mesh(new THREE.BoxGeometry(...size),color,opacity,component);pair.mesh.position.set(...center);pair.edge.position.copy(pair.mesh.position);return pair.mesh;
  }
  extrude(polys,depth,z,color,opacity=1,component='copper') {
    const geometry=new THREE.ExtrudeGeometry(shapes(polys),{depth,bevelEnabled:false,curveSegments:24});geometry.translate(0,0,z);
    return this.mesh(geometry,color,opacity,component).mesh;
  }
  plane(polys,z,color,component) {
    const geometry=new THREE.ShapeGeometry(shapes(polys));geometry.translate(0,0,z);
    return this.mesh(geometry,color,1,component).mesh;
  }
  cadPart(name,z,opacity=1,x=0,y=0) {
    const data=this.parts?.[name];if(!data)return false;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.mesh.vertices,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.mesh.normals,3));geometry.setIndex(data.mesh.triangles);geometry.translate(x,y,z);
    if(name==='copper'){
      const positions=geometry.getAttribute('position'),indices=geometry.index,base=this.r.design.copper.base_thickness,bossTop=base+this.r.boss_lower_height;
      let last=-1;
      for(let i=0;i<indices.count;i+=3){const height=(positions.getZ(indices.getX(i))+positions.getZ(indices.getX(i+1))+positions.getZ(indices.getX(i+2)))/3;
        const level=height>bossTop+1e-5?2:height>base+1e-5?1:0;
        if(level===last)geometry.groups.at(-1).count+=3;else{geometry.addGroup(i,3,level);last=level;}
      }
    }
    this.mesh(geometry,name==='copper'?copperTones:0xc5cdd1,opacity,name);return true;
  }

  renderModels() {
    if(!this.r)return;
    dispose(this.models);this.models.clear();
    const r=this.r,d=r.design,c=d.copper,p=d.package,z=referenceLevels(r),layout=this.layout,center=r.boss_center||[0,0];
    const assembly=this.mode==='assembly', mask=this.mode==='layout'&&this.refs.epad;
    const solderZ=assembly?z.boss+(this.exploded?3:0):0;
    if(this.mode!=='preform'&&this.refs.copper) {
      if(!this.cadPart('copper',0,mask?.2:1)) {
        this.extrude(layout.copperProfile,c.base_thickness,0,copperTones[0],mask?.2:1);
        this.box([r.boss_length,r.boss_width,r.boss_lower_height],[center[0],center[1],z.base+r.boss_lower_height/2],copperTones[1],mask?.2:1);
        for(const x of[-1,1])for(const y of[-1,1])this.box([c.pad_size,c.pad_size,d.stack.pad_height],[center[0]+x*(r.boss_length-c.pad_size)/2,center[1]+y*(r.boss_width-c.pad_size)/2,z.boss+d.stack.pad_height/2],copperTones[2],mask?.2:1);
      }
    }
    if((this.mode==='preform'||assembly)&&this.refs.preform) {
      const [sx,sy]=assembly?center:[0,0];
      if(!this.cadPart('preform',solderZ,assembly?.7:1,sx,sy)) {
        const ring=octagon(r.boss_length,r.boss_width,d.preform.chamfer).map(([x,y])=>[x+sx,y+sy]);ring.push(ring[0]);
        this.extrude([[ring]],r.model_thickness,solderZ,0xc5cdd1,assembly?.7:1,'preform');
      }
    }
    if(assembly) {
      if(this.refs.pcb)this.extrude(layout.board,d.pcb.thickness,z.pcbBottom+(this.exploded?6:0),0x338868,.25,'pcb');
      if(this.refs.pa) {
        const shift=z.flange+(this.exploded?12:0),pa=paReference(p,r.pa_envelope),f=pa.flange;
        const flange=new THREE.Shape(),x=f.length/2,y=f.width/2,q=f.radius;
        flange.moveTo(-x+q,-y);flange.lineTo(x-q,-y);flange.quadraticCurveTo(x,-y,x,-y+q);flange.lineTo(x,y-q);flange.quadraticCurveTo(x,y,x-q,y);flange.lineTo(-x+q,y);flange.quadraticCurveTo(-x,y,-x,y-q);flange.lineTo(-x,-y+q);flange.quadraticCurveTo(-x,-y,-x+q,-y);
        const geometry=new THREE.ExtrudeGeometry(flange,{depth:f.depth,bevelEnabled:false,curveSegments:16});geometry.translate(center[0],center[1],shift);this.mesh(geometry,0xbe7a44,1,'pa').mesh.userData.feature='pa_flange';
        const body=pa.body,ring=[...body.profile,body.profile[0]].map(([px,py])=>[px+center[0],py+center[1]]);
        const bevel=Math.min(.065*p.support_height/1.57,body.depth/8);
        const bodyGeometry=new THREE.ExtrudeGeometry(shapes([[ring]]),{depth:body.depth-2*bevel,bevelEnabled:true,bevelSegments:2,bevelSize:bevel,bevelThickness:bevel,steps:1});bodyGeometry.translate(0,0,shift+body.bottom+bevel);
        this.mesh(bodyGeometry,0x343f48,1,'pa').mesh.userData.feature='pa_body';
        for(const pin of pa.pins)this.box(pin.size,[center[0]+pin.center[0],center[1]+pin.center[1],shift+pin.center[2]],0xd9ae48,1,'pa').userData.feature='pa_pin';
        if(this.activeDimension?.kind==='envelope'||this.key==='package.max_tolerance') {
          const [ml,mw]=pa.maximum,points=[[-ml/2,-mw/2],[ml/2,-mw/2],[ml/2,mw/2],[-ml/2,mw/2],[-ml/2,-mw/2]].map(([px,py])=>new THREE.Vector3(px+center[0],py+center[1],shift));
          const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:0xe05b32,dashSize:.4,gapSize:.22,depthTest:false}));line.computeLineDistances();line.userData.component='pa';line.userData.annotation='pa_envelope';this.models.add(line);
        }
      }
    }
    if(this.refs.epad&&(assembly||this.mode==='layout')) {this.plane(layout.mask,z.base+.025,0x277b53,'mask');this.plane(layout.pads,z.base+.028,0xc4c9c1,'epad');}
    this.scale=this.mode==='preform'?Math.max(r.boss_length,r.boss_width):Math.max(c.base_length,c.base_width)+(assembly?10:4);
    if(this.keyLight){const extent=Math.max(25,this.scale*.9),camera=this.keyLight.shadow.camera;Object.assign(camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.1,far:Math.max(300,this.scale*6)});camera.updateProjectionMatrix();this.keyLight.position.set(this.scale*.6,-this.scale*.85,this.scale*1.3);this.renderer.shadowMap.needsUpdate=true;}
    const top=assembly?Math.max(z.pcbTop,z.flange+paReference(p).totalHeight)+(this.exploded?12:0):this.mode==='preform'?r.model_thickness:z.pad;
    this.target.set(0,0,top/2);
    this.models.updateMatrixWorld(true);this.worldBounds=new THREE.Box3().setFromObject(this.models);
    if(!this.worldBounds.isEmpty())this.worldBounds.getCenter(this.target);
    this.el.dataset.referenceParts=assembly?[...(this.refs.pcb?['pcb']:[]),...(this.refs.pa?['pa']:[])].join(','):'';
    this.el.dataset.viewMode=this.mode;
    this.el.dataset.referenceOpening=String(layout.cutout.length>0);
    // Report the components actually present in the scene, including all edge objects.
    this.el.dataset.visibleComponents=[...new Set(this.models.children.map(o=>o.userData.component))].sort().join(',');
    this.el.dataset.copperShades=[...new Set(this.models.children.filter(o=>o.isMesh&&o.userData.component==='copper').flatMap(o=>(Array.isArray(o.material)?[...new Set(o.geometry.groups.map(g=>g.materialIndex))].map(i=>o.material[i]):[o.material]).map(m=>'#'+m.color.getHexString())))].join(',');
    this.el.dataset.paFeatures=[...new Set(this.models.children.map(o=>o.userData.feature).filter(Boolean))].join(',');
    this.onMode(this.mode,this.refs,this.exploded);
    document.getElementById('viewer-placeholder').hidden=true;
    if(!this.renderer)this.renderFallback();else this.fitCamera();
  }
  renderFallback() {
    this.el.querySelector('svg.model-fallback')?.remove();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`${-this.scale/2-3} ${-this.scale/2-3} ${this.scale+6} ${this.scale+6}`);svg.style.cssText='width:100%;height:100%;position:absolute';
    svg.classList.add('model-fallback');
    for(const mesh of this.models.children.filter(o=>o.isMesh)){
      // Project the actual reference/model triangles so the fallback follows visibility too.
      const positions=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
      const count=index?index.count:positions.count;
      const paths=new Map(),materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      for(let i=0;i<count;i+=3){const pts=[];for(let j=0;j<3;j++){const k=index?index.getX(i+j):i+j;pts.push([positions.getX(k)+mesh.position.x,-positions.getY(k)-mesh.position.y]);}const level=materials.length>1?(mesh.geometry.groups.find(g=>i>=g.start&&i<g.start+g.count)?.materialIndex||0):0;if(!paths.has(level))paths.set(level,[]);paths.get(level).push('M'+pts.map(p=>p.join(',')).join(' L')+' Z');}
      for(const [level,path]of[...paths].sort(([a],[b])=>a-b)){const material=materials[level],p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',path.join(' '));p.setAttribute('fill','#'+material.color.getHexString());p.setAttribute('fill-opacity',String(material.opacity));svg.append(p);}
    }this.el.prepend(svg);
  }
  setMode(mode,fit=true) {
    this.mode=mode;if(mode==='layout')this.refs.epad=true;this.toleranceFocus=null;this.clearAnnotation();this.key=null;this.renderModels();if(fit)this.setView(mode==='layout'?'top':'iso');
  }
  setReference(component,visible){this.refs[component]=visible;this.key=null;this.toleranceFocus=null;this.clearAnnotation();this.renderModels();}
  setExploded(value){this.exploded=value;this.key=null;this.toleranceFocus=null;this.clearAnnotation();this.renderModels();this.setView('iso');}
  setView(view='iso') {
    this.markView(view);
    if(!this.renderer)return;
    this.controls.dispose();
    const {offset,up}=cameraView(view,this.scale);this.camera.up.set(...up);
    this.camera.position.copy(this.target).add(vec(offset));this.camera.lookAt(this.target);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.copy(this.target);
    this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.minZoom=.05;this.controls.maxZoom=40;
    this.controls.addEventListener('start',()=>this.markView('custom'));
    this.controls.addEventListener('change',()=>this.updateAnnotation());
    this.fitCamera();this.controls.update();
  }
  fitCamera() {
    if(!this.renderer)return;
    const width=this.el.clientWidth,height=this.el.clientHeight;if(!width||!height)return;
    const direction=this.camera.position.clone().sub(this.controls.target).normalize();
    if(!direction.lengthSq())direction.set(1,-1.2,1).normalize();
    this.controls.target.copy(this.target);this.camera.position.copy(this.target).addScaledVector(direction,this.scale*2.1);this.camera.lookAt(this.target);this.camera.updateMatrixWorld(true);
    const points=this.worldBounds&&!this.worldBounds.isEmpty()?corners(this.worldBounds):[new THREE.Vector3(-20,-15,0),new THREE.Vector3(20,15,4)];
    const local=points.map(p=>p.clone().applyMatrix4(this.camera.matrixWorldInverse));
    const spanX=Math.max(...local.map(p=>p.x))-Math.min(...local.map(p=>p.x)),spanY=Math.max(...local.map(p=>p.y))-Math.min(...local.map(p=>p.y));
    const d=this.activeDimension;
    const av=d?vec(d.a).applyMatrix4(this.camera.matrixWorldInverse):null,bv=d?vec(d.b).applyMatrix4(this.camera.matrixWorldInverse):null;
    const vertical=d&&Math.abs(bv.y-av.y)>Math.abs(bv.x-av.x);
    const feature=d&&['radius','diameter','envelope'].includes(d.kind);
    let top=24;const bottom=d?(width<600?94:Math.max(90,this.labelHeight()+62)):32;
    if(d?.kind==='radius'&&width<600)top=Math.max(top,this.labelWidth()+26);
    const side=d&&(vertical||feature)&&width>=600?(feature&&bv.x<0?'left':'right'):null;
    const left=side==='left'?this.labelWidth()+66:32,right=side==='right'?this.labelWidth()+66:38;
    const usableW=Math.max(70,width-left-right),cx=left+usableW/2;
    const frame=()=>{const usableH=Math.max(55,height-top-bottom),units=Math.max(spanX/(usableW*.94),spanY/(usableH*.94),.001);return{units,cy:top+usableH/2};};
    let {units,cy}=frame();
    const origin=this.el.getBoundingClientRect(),cube=this.el.querySelector('.view-cube').getBoundingClientRect();
    const cubeBounds={left:cube.left-origin.left,right:cube.right-origin.left,top:cube.top-origin.top,bottom:cube.bottom-origin.top};
    if(feature&&side==='right'){
      const candidate={left:cx+spanX/units/2+22,right:cx+spanX/units/2+22+this.labelWidth(),top:cy-bv.y/units-this.labelHeight()/2,bottom:cy-bv.y/units+this.labelHeight()/2};
      if(overlaps(candidate,cubeBounds,8)){top=cubeBounds.bottom+this.labelHeight()/2+14;({units,cy}=frame());}
    }
    // Reserve the view cube only when it would cover the fitted model. Square
    // top views can use the full height in the broad desktop canvas.
    if(overlaps({left:cx-spanX/units/2,right:cx+spanX/units/2,top:cy-spanY/units/2,bottom:cy+spanY/units/2},cubeBounds,12)){
      top=cubeBounds.bottom+14;({units,cy}=frame());
    }
    this.camera.left=-cx*units;this.camera.right=(width-cx)*units;
    this.camera.top=cy*units;this.camera.bottom=-(height-cy)*units;this.camera.zoom=1;
    this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);
    this.el.dataset.projection=this.camera.isOrthographicCamera?'orthographic':'perspective';
    this.updateAnnotation();
  }
  markView(view){
    this.el.dataset.cameraView=view;
    if(['top','bottom','front','back','left','right'].includes(view))this.lastOrthographicView=view;
    document.querySelectorAll('[data-camera-view]').forEach(el=>{if(el.tagName==='BUTTON'){const active=el.dataset.cameraView===view;el.setAttribute('aria-pressed',String(active));el.classList.toggle('active',active);}});
    const orthographic=document.getElementById('view-orthographic');
    if(orthographic){const active=view!=='iso';orthographic.classList.toggle('active',active);orthographic.setAttribute('aria-pressed',String(active));}
  }
  clearAnnotation({keepEnvelope=false}={}){this.overlay.replaceChildren();this.activeDimension=null;this.el.dataset.dimension='';delete this.el.dataset.annotationLayout;if(!keepEnvelope){for(const child of [...this.models.children])if(child.userData.annotation==='pa_envelope'){this.models.remove(child);dispose(child);}if(this.worldBounds)this.worldBounds=new THREE.Box3().setFromObject(this.models);}this.onDimension(null);}
  labelWidth(){const measured=this.activeDimension?Math.ceil(this.textMeasure.measureText(this.activeDimension.label).width)+24:116;return Math.max(116,measured,this.activeDimension?.datums&&this.el.clientWidth>=600?150:0);}
  labelHeight(){return this.activeDimension?.datums&&this.el.clientWidth>=600?65:32;}
  project(point){const p=(point.isVector3?point.clone():vec(point)).project(this.camera);return[(p.x+1)*this.el.clientWidth/2,(1-p.y)*this.el.clientHeight/2];}
  updateAnnotation() {
    const d=this.activeDimension;if(!d||!this.renderer||!this.worldBounds||this.worldBounds.isEmpty())return;
    this.camera.updateMatrixWorld(true);
    const width=this.el.clientWidth,height=this.el.clientHeight;if(!width||!height)return;
    const projected=corners(this.worldBounds).map(p=>this.project(p));
    const bounds={left:Math.min(...projected.map(p=>p[0])),right:Math.max(...projected.map(p=>p[0])),top:Math.min(...projected.map(p=>p[1])),bottom:Math.max(...projected.map(p=>p[1]))};
    const origin=this.el.getBoundingClientRect(),cube=this.el.querySelector('.view-cube').getBoundingClientRect();
    const obstacles=[{left:cube.left-origin.left,right:cube.right-origin.left,top:cube.top-origin.top,bottom:cube.bottom-origin.top}];
    let candidates=d.kind==='radius'&&d.radiusCandidates?.length?d.radiusCandidates:[{a:d.a,b:d.b}];
    if(d.kind==='diameter'){
      // Equivalent holes share one nominal diameter. Choose the real hole and
      // a true in-plane diameter direction that gives the shortest available
      // leader, rather than forcing a vertical O line around the whole PCB.
      const centers=d.diameterCenters?.length?d.diameterCenters:[d.a.map((v,i)=>(v+d.b[i])/2)],radius=d.value/2;
      const first=Math.atan2(d.b[1]-d.a[1],d.b[0]-d.a[0]),angles=[first,...Array.from({length:8},(_,i)=>i*Math.PI/4)],seen=new Set();
      const directions=angles.map(angle=>[Math.cos(angle),Math.sin(angle)]).filter(u=>{const id=u.map(v=>v.toFixed(8)).join(',');if(seen.has(id))return false;seen.add(id);return true;});
      candidates=centers.flatMap(center=>directions.map(([x,y])=>({a:[center[0]-radius*x,center[1]-radius*y,center[2]],b:[center[0]+radius*x,center[1]+radius*y,center[2]]})));
    }
    const choices=candidates.map((world,index)=>{
      const layout=annotationLayout({a:this.project(world.a),b:this.project(world.b),bounds,width,height,labelWidth:this.labelWidth(),labelHeight:this.labelHeight(),obstacles,kind:d.kind});
      const path=d.kind==='radius'?layout.leader:['diameter','envelope'].includes(d.kind)?featureLeader(layout.a,layout.b,bounds,layout.label,layout.side):[];
      const length=path.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-path[i][0],p[1]-path[i][1]),0);
      return{world,index,layout,path,length,score:layout.label?length:Infinity};
    });
    const chosen=choices.sort((a,b)=>Math.abs(a.score-b.score)<1e-6?a.index-b.index:a.score-b.score)[0],layout=chosen.layout;
    this.overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);this.overlay.replaceChildren();
    const line=(points,attributes={})=>{const node=svgNode('polyline',{points:points.map(p=>p.join(',')).join(' '),class:'dimension-line',...attributes});this.overlay.append(node);return node;};
    const markers=svgNode('g',{class:'dimension-markers'});
    for(const [a,b]of d.referenceSegments||[])line([this.project(a),this.project(b)],{class:'dimension-datum-line'});
    const extension=(a,b)=>{const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1)return;const u=[(b[0]-a[0])/length,(b[1]-a[1])/length];line([[a[0]+u[0]*3,a[1]+u[1]*3],[b[0]+u[0]*4,b[1]+u[1]*4]],{class:'dimension-extension'});};
    const isRadius=d.kind==='radius',isDiameter=d.kind==='diameter',isEnvelope=d.kind==='envelope';
    if(isDiameter){
      // Thin chain lines identify the true drilled/cutout circle center. The
      // two axes live in its XY plane, so an isometric view projects them with
      // the feature instead of drawing an unrelated screen-space crosshair.
      const a=vec(chosen.world.a),b=vec(chosen.world.b),center=a.clone().add(b).multiplyScalar(.5),diameter=b.distanceTo(a);
      if(diameter>1e-10){
        const axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0)];
        axes.forEach((direction,index)=>{
          const from=this.project(center.clone().addScaledVector(direction,-diameter/2)),to=this.project(center.clone().addScaledVector(direction,diameter/2));
          const length=Math.hypot(to[0]-from[0],to[1]-from[1]);if(length<.5)return;
          const u=[(to[0]-from[0])/length,(to[1]-from[1])/length],extension=8,total=length+extension*2;
          line([[from[0]-u[0]*extension,from[1]-u[1]*extension],[to[0]+u[0]*extension,to[1]+u[1]*extension]],{
            class:'dimension-centerline','data-axis':index===0?'x':'y',fill:'none',stroke:'#687a70','stroke-width':.9,'stroke-dasharray':'10 3 1 3','stroke-dashoffset':(5-total/2)%17,'stroke-linecap':'butt',opacity:1,
          });
        });
      }
    }
    let arrowA=layout.aa,arrowB=layout.bb;
    if(isEnvelope){
      if(chosen.path.length)line(chosen.path,{class:'dimension-leader'});
    }else if(isRadius){
      // Outside-only radial leader, with its single arrow at the actual arc.
      // The construction centre can be hidden by a hole or boss and is not a
      // physical point to highlight on the part.
      arrowA=layout.aa;arrowB=layout.b;
      if(chosen.path.length)line(chosen.path,{class:'dimension-leader'});
    }else if(isDiameter){
      // Radius and diameter use the actual projected radial/diametral line,
      // rather than a horizontal component of that line labelled as a radius.
      arrowA=layout.a;arrowB=layout.b;line([arrowA,arrowB]);
      if(chosen.path.length)line(chosen.path,{class:'dimension-leader'});
    }else{
      extension(layout.a,layout.aa);extension(layout.b,layout.bb);line([layout.aa,layout.bb]);
      if(layout.leader.length)line(layout.leader,{class:'dimension-leader'});
    }
    const distance=Math.hypot(arrowB[0]-arrowA[0],arrowB[1]-arrowA[1]);
    if(!isEnvelope&&distance>.05){
      const u=[(arrowB[0]-arrowA[0])/distance,(arrowB[1]-arrowA[1])/distance],n=[-u[1],u[0]],outward=!isRadius&&distance<22;
      if(outward)line([[arrowA[0]-u[0]*11,arrowA[1]-u[1]*11],[arrowB[0]+u[0]*11,arrowB[1]+u[1]*11]]);
      for(const [p,sign]of isRadius?[[arrowB,-1]]:[[arrowA,1],[arrowB,-1]]){
        const dir=sign*(outward?-1:1),base=[p[0]+u[0]*dir*7,p[1]+u[1]*dir*7];
        this.overlay.append(svgNode('polygon',{points:[p,[base[0]+n[0]*2.8,base[1]+n[1]*2.8],[base[0]-n[0]*2.8,base[1]-n[1]*2.8]].map(v=>v.join(',')).join(' '),class:'dimension-arrow'}));
      }
    }
    for(const p of isEnvelope||isRadius?[layout.b]:[layout.a,layout.b]){
      markers.append(svgNode('circle',{cx:p[0],cy:p[1],r:7,class:'dimension-halo'}),svgNode('circle',{cx:p[0],cy:p[1],r:3,class:'dimension-point'}));
    }
    this.overlay.append(markers);
    if(layout.label){
      const box=layout.label,group=svgNode('g',{class:'dimension-value'}),cx=(box.left+box.right)/2;
      if(isRadius&&layout.textTransform){
        const t=layout.textTransform,local=layout.labelLocal;
        group.setAttribute('transform',`translate(${t.x} ${t.y}) rotate(${t.angle})`);
        group.append(svgNode('rect',{x:local.left,y:local.top,width:local.width,height:local.height,rx:5}));
        const text=svgNode('text',{x:0,y:5,class:'dimension-number'});text.textContent=d.label;group.append(text);
      }else{
        group.append(svgNode('rect',{x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top,rx:5}));
        const text=svgNode('text',{x:cx,y:box.top+21,class:'dimension-number'});text.textContent=d.label;group.append(text);
      }
      if(d.datums&&width>=600)d.datums.forEach((value,i)=>{const text=svgNode('text',{x:cx,y:box.top+39+i*15,class:'dimension-datum-text'});text.textContent=value;group.append(text);});
      this.overlay.append(group);
    }
    this.el.dataset.annotationLayout=JSON.stringify({bounds,label:layout.label,a:layout.a,b:layout.b,side:layout.side,collapsed:layout.collapsed,worldA:chosen.world.a,worldB:chosen.world.b,kind:d.kind,referenceCandidate:chosen.index,leaderLength:chosen.length,labelAngle:layout.textTransform?.angle||0,radiusLeaderStraight:isRadius,markerCount:isRadius||isEnvelope?1:2});
  }
  selectTolerance(key,fit=true){this.selectDimension(key,fit,{tolerance:true});}
  selectDimension(key,fit=true,{tolerance=false}={}) {
    if(!this.r)return;
    const envelopeVisible=this.models.children.some(o=>o.userData.annotation==='pa_envelope');
    const dimension=dimensionFor(key,this.r,this.layout);if(!dimension)return;
    if(tolerance)this.toleranceFocus=key;else if(fit||this.toleranceFocus!==key)this.toleranceFocus=null;
    if(this.toleranceFocus===key&&['package.length','package.width','package.max_tolerance'].includes(key)){
      dimension.kind='envelope';dimension.view='top';
      const center=this.r.boss_center||[0,0],p=this.r.design.package,maximum=this.r.pa_envelope;
      const length=maximum?.max_length??p.length+(p.max_tolerance||0),width=maximum?.max_width??p.width+(p.max_tolerance||0),height=referenceLevels(this.r).flange;
      const endpoint=key==='package.width'?[center[0],center[1]+width/2,height]:[center[0]+length/2,center[1],height];
      dimension.a=endpoint;dimension.b=[...endpoint];
    }
    this.key=key;this.exploded=false;
    if(fit){
      if(key.startsWith('package.')||key.startsWith('stack.'))this.refs.pa=true;
      if(key.startsWith('pcb.')||key.startsWith('stack.'))this.refs.pcb=true;
      if(dimension.mode==='copper'||dimension.mode==='layout'||key.startsWith('stack.'))this.refs.copper=true;
      if(dimension.mode==='preform')this.refs.preform=true;
      if(dimension.mode==='layout')this.refs.epad=true;
    }
    const changed=this.mode!==dimension.mode;this.mode=dimension.mode;
    this.clearAnnotation({keepEnvelope:true});this.key=key;this.activeDimension={...dimension,label:this.toleranceFocus===key?(dimension.toleranceLabel||dimensionLabel(dimension)):dimensionLabel(dimension)};
    this.el.dataset.dimension=key;this.el.dataset.pulse=this.reduced?'static':'breathing';
    if(changed||fit||envelopeVisible!==(dimension.kind==='envelope'))this.renderModels();
    this.onDimension(this.activeDimension);
    if(fit)this.setView(dimension.view);else this.updateAnnotation();
  }
}
