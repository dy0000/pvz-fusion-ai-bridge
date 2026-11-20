const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8');
const pointer=(value=1)=>({isNull:()=>value===0,add(){return this;},writeU32(){},writePointer(){},writeByteArray(){},readPointer(){return this;},toString:()=>String(value)});
let heldSelection=1,allowRelease=false,emptyItem=false,borrowedItem=false,key=0,releases=0,shovelAllowed=false,shovelUses=0,shovelPlants=[];
const context=vm.createContext({
 SESSION:'test',nil:pointer(0),enumName:()=>'',pulseData:pointer(),
 nativeInputStatus:()=>({active:false,override_released:true}),clearNativeInput(){},requestNativeInputRelease(){return true;},tickNativeInput(){},
 Memory:{alloc:()=>pointer(),allocUtf8String:()=>pointer()},
 Process:{getModuleByName:()=>({getExportByName:()=>pointer()}),getCurrentThreadId:()=>1},
 CModule:function(){this.read_pointer=pointer();},
 NativeFunction:function(){return ()=>{};},
 api:()=>()=>pointer(),method:()=>({info:pointer()}),
 Interceptor:{replaceFast:()=>pointer(),flush(){},attach(){}},
 installDispatcher(){},rpc:{},
 singleton:()=>pointer(),alive:p=>!p.isNull(),
 read:(_p,_type,name)=>name==='theItemOnMouse'?pointer(borrowedItem||heldSelection!==0&&!emptyItem?1:0):heldSelection,
 call(full,name,self,...values){
   if(name==='PutDownItem'){releases++;if(allowRelease)heldSelection=0;}
   if(name==='ClearItemOnMouse')heldSelection=0;
   if(name==='GetKeyDown')return values[0]===key;
   if(full==='.Shovel'&&name==='OnClick')return shovelAllowed;
   if(full==='.Shovel'&&name==='Use'){shovelUses++;shovelPlants=[];}
 }
});
vm.runInContext(source,context);
const run=code=>vm.runInContext(code,context);
// Nested metadata names omit the leading dot on their root declaring type.
{
 const root=pointer(11),child=pointer(12),nil=pointer(0);
 const classContext=vm.createContext({classes:new Map(),nil,
  Memory:{alloc:()=>({index:0,readU64:()=>({toNumber:()=>1}),writePointer(){this.index=0;}}),allocUtf8String:value=>value},
  A:{domain:()=>root,current:()=>root,assemblies:()=>({add:()=>({readPointer:()=>root})}),image:()=>root,
   klass:(_image,ns,name)=>ns===''&&name==='MainMenu'?root:nil,
   nested:(_parent,it)=>it.index++===0?child:nil,className:()=>({readCString:()=>'ButtonState'})}
 });
 const engine=fs.readFileSync(path.join(__dirname,'../src/engine.js'),'utf8');
 vm.runInContext(engine.slice(engine.indexOf('function klass('),engine.indexOf('function fullClassName(')),classContext);
 assert.equal(vm.runInContext("klass('MainMenu.ButtonState')",classContext),child);
 assert.equal(vm.runInContext("klass('MainMenu')",classContext),root);
}
// Point actions update both native cursor representations and restore on failure.
{
 const floats=new Map([[12,8],[16,9]]),writes=new Map();
 const mouse={add:offset=>({readFloat:()=>floats.get(offset),writeFloat:value=>floats.set(offset,value)})};
 const cursorContext=vm.createContext({
  nil:0,call:(_type,name)=>name==='WorldToScreenPoint'?[100,200,0]:0,
  singleton:()=>mouse,alive:()=>true,fieldSpec:(_type,name)=>({offset:name==='mouseX'?12:16}),
  Process:{getCurrentThreadId:()=>7},pointerData:{writeU32:value=>writes.set(0,value),add:offset=>({writeU32:value=>writes.set(offset,value),writeFloat:value=>writes.set(offset,value)})}
 });
 vm.runInContext(source.slice(source.indexOf('function withPoint('),source.indexOf('const resolveIcall=')),cursorContext);
 cursorContext.action=()=>{assert.equal(floats.get(12),2);assert.equal(floats.get(16),3);assert.equal(writes.get(0),1);return 42;};
 assert.equal(vm.runInContext('withPoint([2,3,0],action)',cursorContext),42);
 cursorContext.action=()=>{throw Error('native failure');};
 assert.throws(()=>vm.runInContext('withPoint([2,3,0],action)',cursorContext),/native failure/);
 assert.equal(floats.get(12),8);assert.equal(floats.get(16),9);assert.equal(writes.get(0),0);
}
// Borrowed player selection is preserved. Failed AI release retains ownership.
assert.equal(run('release().selection_released'),true);
assert.equal(releases,0);
run('ownsSelection=true;controlled=true');
assert.equal(run('release().selection_released'),false);
assert.equal(run('ownsSelection'),true);
allowRelease=true;
assert.equal(run('release().selection_released'),true);
assert.equal(run('ownsSelection'),false);
// Native unaffordable-card path leaves an enum without an item; clear only AI ownership.
allowRelease=false;emptyItem=true;heldSelection=1;
run('ownsSelection=true');
assert.equal(run('release().selection_released'),true);
assert.equal(heldSelection,0);
// Cannons can hold a native target while mouseItemType remains Nothing.
borrowedItem=true;
const beforeBorrowedRelease=releases;
assert.equal(run('nativeSelectionBusy()'),true);
assert.equal(run('release().selection_released'),true);
assert.equal(releases,beforeBorrowedRelease);
borrowedItem=false;
// A player stop cannot be undone by take_control; only the player's F10 resets it.
run("board=()=>nil;phase=()=>'menu';controlled=true");
key=289;run('tick()');
assert.equal(run('playerLocked'),true);
assert.throws(()=>run("handle({op:'attach'})"),/Player lock/);
key=291;run('tick()');
assert.equal(run("handle({op:'attach'}).controlled"),true);
// A failed native tool pickup must not execute its destructive use action.
const shovelPlant=pointer(501);shovelPlants=[shovelPlant];
Object.assign(context,{board:()=>pointer(1),phase:()=>'running',battleId:()=>'live',
 plants:()=>shovelPlants,plantView:()=>({row:3,column:3}),inspectCell:()=>({plants:shovelPlants}),active:()=>true,
 withCell:(_q,action)=>action(pointer(1))});
assert.equal(run("handle({op:'shovel',battle_id:'live',entity_id:'501'}).status"),'rejected_by_game');
assert.equal(shovelUses,0);
shovelAllowed=true;
assert.equal(run("handle({op:'shovel',battle_id:'live',entity_id:'501'}).status"),'Committed');
assert.equal(shovelUses,1);

(async()=>{
 const engine=fs.readFileSync(path.join(__dirname,'../src/engine.js'),'utf8');
 const timers=new Map();let hook,invoked=0;
 const queueContext=vm.createContext({
   Memory:{},method:()=>({info:pointer()}),send(){},
   Interceptor:{attach(address,callbacks){hook=callbacks;}},
   setTimeout(callback){timers.set(1,callback);return 1;},clearTimeout(id){timers.delete(id);}
 });
 vm.runInContext(engine.slice(engine.indexOf('const taskQueue=[];')),queueContext);
 queueContext.handler=()=>{invoked++;return 'done';};
 vm.runInContext('installDispatcher(handler)',queueContext);
 const cancelled=vm.runInContext("dispatch({op:'plant'})",queueContext);
 timers.get(1)();assert.equal((await cancelled).outcome,'not_started');hook.onLeave();assert.equal(invoked,0);
 const accepted=vm.runInContext("dispatch({op:'plant'})",queueContext);
 hook.onLeave();assert.equal((await accepted).result,'done');assert.equal(invoked,1);assert.equal(timers.size,0);
 console.log('Native ownership, player lock, and queue cancellation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
