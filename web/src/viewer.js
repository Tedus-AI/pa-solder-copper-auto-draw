import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { octagon } from './design.js';
import { dimensionFor, referenceLevels } from './dimensions.js';
import { paReference } from './pa-reference.js';
import { cameraView } from './camera-views.js';

const vec = p => new THREE.Vector3(...p);
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
    this.mode='assembly';this.refs={copper:true,preform:true,pcb:true,pa:true};this.exploded=false;this.key=null;this.scale=50;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(35,1,.01,10000);this.camera.up.set(0,0,1);
    this.target=new THREE.Vector3();this.models=new THREE.Group();this.annotation=new THREE.Group();this.scene.add(this.models,this.annotation);
    this.pulseMaterials=[];this.pins=[];this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0,0);
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;container.prepend(this.renderer.domElement);
      this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;
      this.controls.addEventListener('start',()=>this.markView('custom'));
      this.controls.minDistance=.15;this.controls.maxDistance=3000;
      this.scene.add(new THREE.HemisphereLight(0xffffff,0xb2bba3,2.3));
      for(const[position,intensity]of[[[20,-25,50],3],[[-30,20,15],1.4]]){const light=new THREE.DirectionalLight(0xffffff,intensity);light.position.set(...position);this.scene.add(light);}
      const grid=new THREE.GridHelper(100,20,0xd9dfcf,0xe6eadf);grid.rotation.x=Math.PI/2;grid.position.z=-.08;this.scene.add(grid);
      new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();if(width&&height){this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);}}).observe(container);
      const animate=t=>{
        requestAnimationFrame(animate);
        const pulse=this.reduced?.85:.35+.65*(1+Math.sin(t/1000*Math.PI*1.4))/2;
        this.pulseMaterials.forEach(m=>m.opacity=pulse);this.pins.forEach(o=>o.scale.setScalar(.8+.3*pulse));
        this.controls.update();this.renderer.render(this.scene,this.camera);
      };requestAnimationFrame(animate);
    } catch {this.renderer=null;}
  }

  setDesign(r,layout,parts=null) {
    this.r=r;this.layout=layout;this.parts=parts;this.renderModels();
    if(this.key)this.selectDimension(this.key,false);
  }
  mesh(geometry,color,opacity=1,component='copper') {
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.46,metalness:component==='copper'?.45:.15,transparent:opacity<1,opacity,depthWrite:opacity>=.9,side:THREE.DoubleSide}));
    mesh.userData.component=component;this.models.add(mesh);
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,28),new THREE.LineBasicMaterial({color,transparent:true,opacity:Math.min(.5,opacity+.12)}));edge.position.copy(mesh.position);edge.userData.component=component;this.models.add(edge);
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
  cadPart(name,z,opacity=1) {
    const data=this.parts?.[name];if(!data)return false;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.mesh.vertices,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.mesh.normals,3));geometry.setIndex(data.mesh.triangles);geometry.translate(0,0,z);
    this.mesh(geometry,name==='copper'?0xbb7d4b:0xa5b2b4,opacity,name);return true;
  }

  renderModels() {
    if(!this.r)return;
    dispose(this.models);this.models.clear();
    const r=this.r,d=r.design,c=d.copper,p=d.package,z=referenceLevels(r),layout=this.layout;
    const assembly=this.mode==='assembly', mask=this.mode==='layout';
    const solderZ=assembly?z.boss+(this.exploded?3:0):0;
    if(this.mode!=='preform'&&this.refs.copper) {
      if(!this.cadPart('copper',0,mask?.2:1)) {
        this.extrude(layout.copperProfile,c.base_thickness,0,0xbb7d4b,mask?.2:1);
        this.box([r.boss_length,r.boss_width,r.boss_lower_height],[0,0,z.base+r.boss_lower_height/2],0xbb7d4b,mask?.2:1);
        for(const x of[-1,1])for(const y of[-1,1])this.box([c.pad_size,c.pad_size,d.stack.pad_height],[x*(r.boss_length-c.pad_size)/2,y*(r.boss_width-c.pad_size)/2,z.boss+d.stack.pad_height/2],0xbb7d4b,mask?.2:1);
      }
    }
    if((this.mode==='preform'||assembly)&&this.refs.preform) {
      if(!this.cadPart('preform',solderZ,assembly?.58:1)) {
        const ring=octagon(r.boss_length,r.boss_width,d.preform.chamfer);ring.push(ring[0]);
        this.extrude([[ring]],r.model_thickness,solderZ,0xa5b2b4,assembly?.58:1,'preform');
      }
    }
    if(assembly) {
      if(this.refs.pcb)this.extrude(layout.board,d.pcb.thickness,z.pcbBottom+(this.exploded?6:0),0x338868,.25,'pcb');
      if(this.refs.pa) {
        const shift=z.flange+(this.exploded?12:0),pa=paReference(p),f=pa.flange;
        const flange=new THREE.Shape(),x=f.length/2,y=f.width/2,q=f.radius;
        flange.moveTo(-x+q,-y);flange.lineTo(x-q,-y);flange.quadraticCurveTo(x,-y,x,-y+q);flange.lineTo(x,y-q);flange.quadraticCurveTo(x,y,x-q,y);flange.lineTo(-x+q,y);flange.quadraticCurveTo(-x,y,-x,y-q);flange.lineTo(-x,-y+q);flange.quadraticCurveTo(-x,-y,-x+q,-y);
        const geometry=new THREE.ExtrudeGeometry(flange,{depth:f.depth,bevelEnabled:false,curveSegments:16});geometry.translate(0,0,shift);this.mesh(geometry,0xc5ccd0,.78,'pa');
        for(const [body,color]of [[pa.body,0x3d4650],[pa.lid,0x59636a]]){
          const ring=[...body.profile,body.profile[0]];this.extrude([[ring]],body.depth,shift+body.bottom,color,.87,'pa');
        }
        for(const pin of pa.pins)this.box(pin.size,[pin.center[0],pin.center[1],shift+pin.center[2]],0xc7ad67,.95,'pa');
        if(this.key==='package.max_tolerance') {
          const [ml,mw]=pa.maximum,points=[[-ml/2,-mw/2],[ml/2,-mw/2],[ml/2,mw/2],[-ml/2,mw/2],[-ml/2,-mw/2]].map(([px,py])=>new THREE.Vector3(px,py,shift));
          const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:0xe05b32,dashSize:.4,gapSize:.22,depthTest:false}));line.computeLineDistances();line.userData.component='pa';this.models.add(line);
        }
      }
    }
    if(mask) {this.plane(layout.mask,z.base+.025,0x277b53,'mask');this.plane(layout.pads,z.base+.028,0xc4c9c1,'epad');}
    this.scale=this.mode==='preform'?Math.max(r.boss_length,r.boss_width):Math.max(c.base_length,c.base_width)+(assembly?10:4);
    const top=assembly?Math.max(z.pcbTop,z.flange+paReference(p).totalHeight)+(this.exploded?12:0):this.mode==='preform'?r.model_thickness:z.pad;
    this.target.set(0,0,top/2);
    this.el.dataset.referenceParts=assembly?[...(this.refs.pcb?['pcb']:[]),...(this.refs.pa?['pa']:[])].join(','):'';
    this.el.dataset.viewMode=this.mode;
    this.el.dataset.referenceOpening=String(layout.cutout.length>0);
    // Report the components actually present in the scene, including all edge objects.
    this.el.dataset.visibleComponents=[...new Set(this.models.children.map(o=>o.userData.component))].sort().join(',');
    this.onMode(this.mode,this.refs,this.exploded);
    document.getElementById('viewer-placeholder').hidden=true;
    if(!this.renderer)this.renderFallback();
  }
  renderFallback() {
    this.el.querySelector('svg')?.remove();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`${-this.scale/2-3} ${-this.scale/2-3} ${this.scale+6} ${this.scale+6}`);svg.style.cssText='width:100%;height:100%;position:absolute';
    for(const mesh of this.models.children.filter(o=>o.isMesh)){
      // Project the actual reference/model triangles so the fallback follows visibility too.
      const positions=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
      const count=index?index.count:positions.count;
      const path=[];
      for(let i=0;i<count;i+=3){const pts=[];for(let j=0;j<3;j++){const k=index?index.getX(i+j):i+j;pts.push([positions.getX(k)+mesh.position.x,-positions.getY(k)-mesh.position.y]);}path.push('M'+pts.map(p=>p.join(',')).join(' L')+' Z');}
      const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',path.join(' '));p.setAttribute('fill','#'+mesh.material.color.getHexString());p.setAttribute('fill-opacity',String(mesh.material.opacity));svg.append(p);
    }this.el.prepend(svg);
  }
  setMode(mode,fit=true) {
    this.mode=mode;this.clearAnnotation();this.key=null;this.renderModels();if(fit)this.setView(mode==='layout'?'top':'iso');
  }
  setReference(component,visible){this.refs[component]=visible;this.key=null;this.clearAnnotation();this.renderModels();}
  setExploded(value){this.exploded=value;this.key=null;this.clearAnnotation();this.renderModels();this.setView('iso');}
  setView(view='iso') {
    this.markView(view);
    if(!this.renderer)return;
    this.controls.target.copy(this.target);
    // Recreate controls when the up axis changes; OrbitControls caches that axis.
    this.controls.dispose();
    const {offset,up}=cameraView(view,this.scale);this.camera.up.set(...up);
    this.camera.position.copy(this.target).add(vec(offset));this.camera.lookAt(this.target);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.copy(this.target);
    this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.minDistance=.15;this.controls.maxDistance=3000;
    this.controls.addEventListener('start',()=>this.markView('custom'));this.controls.update();
  }
  markView(view){this.el.dataset.cameraView=view;document.querySelectorAll('[data-camera-view]').forEach(el=>{if(el.tagName==='BUTTON')el.setAttribute('aria-pressed',String(el.dataset.cameraView===view));});}
  clearAnnotation(){dispose(this.annotation);this.annotation.clear();this.pulseMaterials=[];this.pins=[];this.el.dataset.dimension='';this.onDimension(null);}
  selectDimension(key,fit=true) {
    if(!this.r)return;
    const dimension=dimensionFor(key,this.r,this.layout);if(!dimension)return;
    this.key=key;this.exploded=false;
    if(fit){
      if(key.startsWith('package.')||key.startsWith('stack.'))this.refs.pa=true;
      if(key.startsWith('pcb.')||key.startsWith('stack.'))this.refs.pcb=true;
      if(dimension.mode==='copper'||dimension.mode==='layout'||key.startsWith('stack.'))this.refs.copper=true;
      if(dimension.mode==='preform')this.refs.preform=true;
    }
    if(this.mode!==dimension.mode){this.mode=dimension.mode;this.renderModels();if(fit)this.setView(this.mode==='layout'?'top':'iso');}
    else if(fit){this.renderModels();}
    this.clearAnnotation();this.key=key;this.el.dataset.dimension=key;this.el.dataset.pulse=this.reduced?'static':'breathing';
    const a=vec(dimension.a),b=vec(dimension.b),offset=vec(dimension.offset),aa=a.clone().add(offset),bb=b.clone().add(offset);
    const color=0xe05b32,mat=new THREE.LineBasicMaterial({color,transparent:true,opacity:1,depthTest:false,depthWrite:false});this.pulseMaterials.push(mat);
    const line=(points)=>{const obj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),mat);obj.renderOrder=30;this.annotation.add(obj);};
    line([a,aa]);line([b,bb]);line([aa,bb]);
    const distance=aa.distanceTo(bb),direction=bb.clone().sub(aa).normalize();
    const arrowLength=Math.max(.006,Math.min(distance*.28,this.scale*.018));
    for(const[position,sign]of distance>1e-8?[[aa,1],[bb,-1]]:[]) {
      const material=new THREE.MeshBasicMaterial({color,transparent:true,depthTest:false,depthWrite:false});this.pulseMaterials.push(material);
      const cone=new THREE.Mesh(new THREE.ConeGeometry(arrowLength*.28,arrowLength,12),material);cone.position.copy(position).addScaledVector(direction,sign*arrowLength/2);cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().multiplyScalar(-sign));cone.renderOrder=30;this.annotation.add(cone);
    }
    for(const position of[a,b]) {
      const material=new THREE.MeshBasicMaterial({color,transparent:true,depthTest:false,depthWrite:false});this.pulseMaterials.push(material);
      const dot=new THREE.Mesh(new THREE.SphereGeometry(this.scale*.006,12,8),material);dot.position.copy(position);dot.renderOrder=31;this.annotation.add(dot);this.pins.push(dot);
    }
    const symbols={'copper.base_length':'E','copper.base_width':'F','copper.base_thickness':'G','copper.corner_radius':'R','copper.hole_diameter':'ØD','copper.hole_edge_offset':'C','copper.pad_size':'J','stack.lead_solder':'A','stack.board_solder':'B','stack.flange_gap':'D','stack.pad_height':'K','pcb.opening_length':'M','pcb.opening_width':'N','pcb.relief_diameter':'ØO','pcb.thickness':'C','package.support_height':'SPH','preform.chamfer':'Y','preform.thickness_override':'Z','preform.trial_delta':'±Δ','layout.border_width':'R','layout.epad_size':'S','layout.web_width':'T','layout.hole_clearance':'ØV'};
    const label=`${symbols[key]||'Δ'}  ${Number(dimension.value.toFixed(4))} mm`;
    const canvas=document.createElement('canvas');canvas.width=440;canvas.height=92;
    const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(255,250,241,.97)';ctx.beginPath();ctx.roundRect(4,4,432,84,14);ctx.fill();ctx.strokeStyle='#e05b32';ctx.lineWidth=3;ctx.stroke();ctx.font='600 29px system-ui';ctx.fillStyle='#b54824';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,220,47);
    const texture=new THREE.CanvasTexture(canvas),sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false}));sprite.position.copy(aa.clone().add(bb).multiplyScalar(.5)).add(new THREE.Vector3(0,0,this.scale*.045));sprite.scale.set(this.scale*.24,this.scale*.05,1);sprite.renderOrder=32;this.annotation.add(sprite);
    this.onDimension({...dimension,label});
    if(!this.renderer){const el=document.getElementById('dimension-label');if(el)el.classList.add('fallback-pulse');}
  }
}
