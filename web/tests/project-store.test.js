import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserProjectStore, PROJECT_STORAGE_KEY } from '../src/project-store.js';
import { calculate, defaults } from '../src/design.js';

function memoryStorage(){
  const values=new Map();
  return {values,blocked:false,getItem(key){return values.get(key)??null;},setItem(key,value){if(this.blocked)throw new Error('QuotaExceededError');values.set(key,value);}};
}
test('a saved project restores complete parameters and tolerances in a new store instance',()=>{
  const storage=memoryStorage(),store=new BrowserProjectStore({storage}),d=structuredClone(defaults);
  d.project={name:'基地台專案 A',pa_model:'PA 型號/780-M1P'};d.pcb.thickness=2.1;d.tolerances['copper.corner_radius']={minus:.03,plus:.04};
  const design=calculate(d).design,record=store.save(design);
  design.project.name='尚未儲存的修改';record.design.pcb.thickness=9;
  const restored=new BrowserProjectStore({storage}).active();
  assert.equal(restored.design.project.name,'基地台專案 A');assert.equal(restored.design.pcb.thickness,2.1);
  assert.deepEqual(restored.design.tolerances['copper.corner_radius'],{minus:.03,plus:.04});
  assert.equal(restored.design.name,defaults.name);assert.equal(store.list().length,1);
  const editable=store.get(restored.id);editable.design.package.length=99;assert.equal(store.get(restored.id).design.package.length,20.57);
});
test('save updates one record, save-as preserves it, and active selection and deletion survive reload',()=>{
  const storage=memoryStorage(),store=new BrowserProjectStore({storage});
  const first=store.save(defaults),changed=structuredClone(defaults);changed.project.name='更新 A';
  const updated=store.save(changed,{id:first.id});
  assert.equal(updated.id,first.id);assert.equal(updated.created_at,first.created_at);assert.equal(store.list().length,1);
  const second=store.save({...changed,project:{...changed.project,name:'另存 B'}});
  assert.notEqual(second.id,first.id);assert.equal(store.list().length,2);assert.equal(store.get(first.id).design.project.name,'更新 A');
  store.activate(first.id);assert.equal(new BrowserProjectStore({storage}).active().id,first.id);
  store.remove(second.id);assert.equal(store.active().id,first.id);assert.equal(store.list().length,1);
  store.remove(first.id);assert.equal(store.active(),null);assert.deepEqual(store.list(),[]);
});
test('failed writes do not discard previous projects or claim to save a new active record',()=>{
  const storage=memoryStorage(),store=new BrowserProjectStore({storage}),first=store.save(defaults);
  const before=storage.getItem(PROJECT_STORAGE_KEY);storage.blocked=true;
  assert.throws(()=>store.save({...defaults,project:{name:'失敗',pa_model:''}}),/尚未儲存/);
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY),before);assert.equal(store.active().id,first.id);
});
test('unreadable and unsupported stored data stay intact instead of being silently overwritten',()=>{
  for(const raw of ['{broken',JSON.stringify({schema_version:2,projects:[]})]){
    const storage=memoryStorage();storage.values.set(PROJECT_STORAGE_KEY,raw);
    const store=new BrowserProjectStore({storage});assert.throws(()=>store.save(defaults),/未被覆寫/);assert.equal(storage.getItem(PROJECT_STORAGE_KEY),raw);
  }
  const unavailable=new BrowserProjectStore({storage:{getItem(){throw new Error('SecurityError');}}});
  assert.throws(()=>unavailable.active(),/尚未儲存/);
});
