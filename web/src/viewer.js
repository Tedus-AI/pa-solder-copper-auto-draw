import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { octagon } from './design.js';
import { dimensionFor, dimensionLabel, referenceLevels } from './dimensions.js';
import { paReference } from './pa-reference.js';
import { cameraView, createCADCamera } from './camera-views.js';
import { annotationLayout, overlaps } from './annotation-layout.js';

const vec = p => new THREE.Vector3(...p);
const svgNS='http://www.w3.org/2000/svg';
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
    this.mode='assembly';this.refs={copper:true,preform:true,pcb:true,pa:true};this.exploded=false;this.key=null;this.scale=50;
    this.scene=new THREE.Scene();this.camera=createCADCamera();this.camera.position.set(50,-60,50);
    this.target=new THREE.Vector3();this.models=new THREE.Group();this.scene.add(this.models);
    this.overlay=svgNode('svg',{'class':'dimension-overlay','aria-label':'尺寸定位標註'});container.append(this.overlay);
    this.activeDimension=null;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0,0);
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;container.prepend(this.renderer.domElement);
      this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;
      this.controls.addEventListener('start',()=>this.markView('custom'));
      this.controls.addEventListener('change',()=>this.updateAnnotation());
      this.controls.minDistance=.15;this.controls.maxDistance=3000;
      this.scene.add(new THREE.HemisphereLight(0xffffff,0xb2bba3,2.3));
      for(const[position,intensity]of[[[20,-25,50],3],[[-30,20,15],1.4]]){const light=new THREE.DirectionalLight(0xffffff,intensity);light.position.set(...position);this.scene.add(light);}
      const grid=new THREE.GridHelper(100,20,0xd9dfcf,0xe6eadf);grid.rotation.x=Math.PI/2;grid.position.z=-.08;this.scene.add(grid);
      new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();if(width&&height){this.renderer.setSize(width,height);this.fitCamera();}}).observe(container);
      const animate=()=>{
        requestAnimationFrame(animate);
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
    this.models.updateMatrixWorld(true);this.worldBounds=new THREE.Box3().setFromObject(this.models);
    if(!this.worldBounds.isEmpty())this.worldBounds.getCenter(this.target);
    this.el.dataset.referenceParts=assembly?[...(this.refs.pcb?['pcb']:[]),...(this.refs.pa?['pa']:[])].join(','):'';
    this.el.dataset.viewMode=this.mode;
    this.el.dataset.referenceOpening=String(layout.cutout.length>0);
    // Report the components actually present in the scene, including all edge objects.
    this.el.dataset.visibleComponents=[...new Set(this.models.children.map(o=>o.userData.component))].sort().join(',');
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
    let top=24;const bottom=d?(width<600?94:Math.max(90,this.labelHeight()+62)):32;
    const left=32,right=d&&vertical&&width>=600?this.labelWidth()+66:38;
    const usableW=Math.max(70,width-left-right),cx=left+usableW/2;
    const frame=()=>{const usableH=Math.max(55,height-top-bottom),units=Math.max(spanX/(usableW*.94),spanY/(usableH*.94),.001);return{units,cy:top+usableH/2};};
    let {units,cy}=frame();
    const origin=this.el.getBoundingClientRect(),cube=this.el.querySelector('.view-cube').getBoundingClientRect();
    const cubeBounds={left:cube.left-origin.left,right:cube.right-origin.left,top:cube.top-origin.top,bottom:cube.bottom-origin.top};
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
  markView(view){this.el.dataset.cameraView=view;document.querySelectorAll('[data-camera-view]').forEach(el=>{if(el.tagName==='BUTTON')el.setAttribute('aria-pressed',String(el.dataset.cameraView===view));});}
  clearAnnotation(){this.overlay.replaceChildren();this.activeDimension=null;this.el.dataset.dimension='';delete this.el.dataset.annotationLayout;this.onDimension(null);}
  labelWidth(){return this.activeDimension?.datums&&this.el.clientWidth>=600?150:Math.max(116,this.activeDimension?.label.length*8+20||116);}
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
    const layout=annotationLayout({a:this.project(d.a),b:this.project(d.b),bounds,width,height,labelWidth:this.labelWidth(),labelHeight:this.labelHeight(),obstacles});
    this.overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);this.overlay.replaceChildren();
    const line=(points,attributes={})=>{const node=svgNode('polyline',{points:points.map(p=>p.join(',')).join(' '),class:'dimension-line',...attributes});this.overlay.append(node);return node;};
    const markers=svgNode('g',{class:'dimension-markers'});
    for(const [a,b]of d.referenceSegments||[])line([this.project(a),this.project(b)],{class:'dimension-datum-line'});
    line([layout.a,layout.aa]);line([layout.b,layout.bb]);line([layout.aa,layout.bb]);
    if(layout.leader.length)line(layout.leader,{class:'dimension-leader'});
    const distance=Math.hypot(layout.bb[0]-layout.aa[0],layout.bb[1]-layout.aa[1]);
    if(distance>2){
      const u=[(layout.bb[0]-layout.aa[0])/distance,(layout.bb[1]-layout.aa[1])/distance],n=[-u[1],u[0]],outward=distance<22;
      for(const [p,sign]of [[layout.aa,1],[layout.bb,-1]]){
        const dir=sign*(outward?-1:1),base=[p[0]+u[0]*dir*7,p[1]+u[1]*dir*7];
        this.overlay.append(svgNode('polygon',{points:[p,[base[0]+n[0]*2.8,base[1]+n[1]*2.8],[base[0]-n[0]*2.8,base[1]-n[1]*2.8]].map(v=>v.join(',')).join(' '),class:'dimension-arrow'}));
      }
    }
    for(const p of[layout.a,layout.b]){
      markers.append(svgNode('circle',{cx:p[0],cy:p[1],r:7,class:'dimension-halo'}),svgNode('circle',{cx:p[0],cy:p[1],r:3,class:'dimension-point'}));
    }
    this.overlay.append(markers);
    if(layout.label){
      const box=layout.label,group=svgNode('g',{class:'dimension-value'}),cx=(box.left+box.right)/2;
      group.append(svgNode('rect',{x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top,rx:5}));
      const text=svgNode('text',{x:cx,y:box.top+21,class:'dimension-number'});text.textContent=d.label;group.append(text);
      if(d.datums&&width>=600)d.datums.forEach((value,i)=>{const text=svgNode('text',{x:cx,y:box.top+39+i*15,class:'dimension-datum-text'});text.textContent=value;group.append(text);});
      this.overlay.append(group);
    }
    this.el.dataset.annotationLayout=JSON.stringify({bounds,label:layout.label,a:layout.a,b:layout.b,side:layout.side,collapsed:layout.collapsed,worldA:d.a,worldB:d.b});
  }
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
    const changed=this.mode!==dimension.mode;this.mode=dimension.mode;
    this.clearAnnotation();this.key=key;this.activeDimension={...dimension,label:dimensionLabel(dimension)};
    this.el.dataset.dimension=key;this.el.dataset.pulse=this.reduced?'static':'breathing';
    if(changed||fit)this.renderModels();
    this.onDimension(this.activeDimension);
    if(fit)this.setView(dimension.view);else this.updateAnnotation();
  }
}
