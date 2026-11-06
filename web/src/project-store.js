// Repository boundary for project persistence. A future HTTP-backed repository
// can implement these methods without changing the project controls.
export const PROJECT_STORAGE_KEY='pa-copper-cad.projects.v1';

export class BrowserProjectStore {
  constructor({storage,key=PROJECT_STORAGE_KEY}={}){this.storage=storage;this.key=key;}
  backend(){return this.storage??globalThis.localStorage;}
  read(){
    let raw;
    try{raw=this.backend().getItem(this.key);}catch{throw new Error('瀏覽器儲存不可用；目前內容尚未儲存。');}
    if(!raw)return{schema_version:1,active_id:null,projects:[]};
    try{
      const value=JSON.parse(raw);
      if(value.schema_version!==1||!Array.isArray(value.projects)||value.projects.some(p=>!p||typeof p.id!=='string'||!p.design||typeof p.design!=='object'))throw new Error();
      return value;
    }catch{throw new Error('瀏覽器中的專案資料無法讀取，現有資料未被覆寫。');}
  }
  write(value){
    try{this.backend().setItem(this.key,JSON.stringify(value));}
    catch{throw new Error('瀏覽器儲存失敗，可能已滿或被停用；目前內容尚未儲存。');}
  }
  list(){return structuredClone(this.read().projects).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));}
  get(id){return structuredClone(this.read().projects.find(p=>p.id===id)??null);}
  active(){const value=this.read();return structuredClone(value.projects.find(p=>p.id===value.active_id)??null);}
  activate(id){const value=this.read();if(!value.projects.some(p=>p.id===id))throw new Error('找不到這個已儲存的專案。');value.active_id=id;this.write(value);}
  save(design,{id=null}={}){
    const value=this.read(),existing=value.projects.find(p=>p.id===id),now=new Date().toISOString();
    const record={id:existing?.id??(globalThis.crypto?.randomUUID?.()??`project-${Date.now()}-${Math.random().toString(16).slice(2)}`),schema_version:1,created_at:existing?.created_at??now,updated_at:now,design:structuredClone(design)};
    const index=value.projects.findIndex(p=>p.id===record.id);if(index<0)value.projects.push(record);else value.projects[index]=record;
    value.active_id=record.id;this.write(value);return structuredClone(record);
  }
  remove(id){
    const value=this.read();value.projects=value.projects.filter(p=>p.id!==id);if(value.active_id===id)value.active_id=null;this.write(value);
  }
}
