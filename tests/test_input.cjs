const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function memory(size){const bytes=new Uint8Array(size);const pointer=offset=>({
 add(n){return pointer(offset+n);},writeByteArray(values){bytes.set(values,offset);},
 writeU32(n){new DataView(bytes.buffer).setUint32(offset,n,true);},readU32(){return new DataView(bytes.buffer).getUint32(offset,true);},
 writeFloat(n){new DataView(bytes.buffer).setFloat32(offset,n,true);},writePointer(){},toString(){return String(offset);}
 });return pointer(0);}
let now=1000,quiescent=true;
const context=vm.createContext({SESSION:'input-test',controlled:true,playerLocked:false,epoch:1,
 Date:{now:()=>now},Memory:{alloc:memory},
 Process:{pointerSize:8,getCurrentThreadId:()=>7,getModuleByName:()=>({getExportByName:()=>0})},
 method:(full,name)=>({info:{readPointer:()=>({toString:()=>name})}}),
 CModule:function(){return new Proxy({}, {get:()=>0});},Interceptor:{replaceFast:()=>0,flush(){}},
 status:()=>'InGame',nativeInputQuiescent:()=>quiescent
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/input.js'),'utf8'),context);
const run=code=>vm.runInContext(code,context);
assert.throws(()=>run("scheduleNativeInput({keys:['F8']})"),/Unsupported/);
assert.throws(()=>run("scheduleNativeInput({frames:121})"),/1..120/);
run("scheduleNativeInput({id:'gesture',keys:['left'],frames:2})");
assert.equal(run('nativeInputStatus().stage'),'down');
assert.throws(()=>run('scheduleNativeInput({})'),/still active/);
run('tickNativeInput()');assert.equal(run('nativeInputStatus().stage'),'held');
run('tickNativeInput()');assert.equal(run('nativeInputStatus().stage'),'up');
quiescent=false;run('tickNativeInput()');assert.equal(run('nativeInputStatus().override_released'),false);
quiescent=true;run('tickNativeInput()');assert.equal(run('nativeInputStatus().override_released'),true);
run("scheduleNativeInput({keys:['w'],frames:120})");now+=4000;
run('tickNativeInput()');assert.equal(run('nativeInputStatus().stage'),'up');
run('tickNativeInput()');assert.equal(run('nativeInputStatus().override_released'),true);
run("scheduleNativeInput({keys:['w'],frames:120})");
run('requestNativeInputRelease()');run('tickNativeInput()');assert.equal(run('nativeInputStatus().active'),false);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/minigames.js'),'utf8'),context);
context.requireControl=()=>{};context.board=()=>({isNull:()=>false});
context.phase=()=>'paused';context.minigameTarget=()=>({spec:{pointer:true,keys:['w']}});
assert.throws(()=>run("minigameInput({game_id:'current',keys:['w']})"),/not running/);
assert.equal(run('nativeInputStatus().active'),false);
// A successful chess rule check alone does not prove that its plant moved.
context.phase=()=>'running';context.cell=()=>{};context.battleId=()=>'current';
context.minigameTarget=()=>({spec:{name:'chess',type:'.ChessManager'},p:'manager'});
context.nativeObjects=()=>['piece'];context.findObserved=(items,id)=>items.find(item=>item===id);
context.read=(_p,_type,name)=>name==='playerRound'?true:'plant';
context.call=()=>true;
let movedTarget;
context.movePlant=q=>{movedTarget=q.entity_id;return {status:'rejected_by_game'};};
assert.equal(run("minigameAction({game_id:'chess',battle_id:'current',action:'chess_move',entity_id:'piece',row:1,column:2}).status"),'rejected_by_game');
assert.equal(movedTarget,'plant');
console.log('Bounded native input, deadline, and verified input release passed.');
