const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const choice={isNull:()=>false,equals:p=>p===choice},nil={isNull:()=>true,equals:()=>false};
let current=choice,accept=false;
const context=vm.createContext({nil,requireControl(){},
 enumName:()=>'Shop',
 board:()=>({isNull:()=>false}),valueList:()=>[1,2],list:()=>[],
 read(_p,_type,name){return name==='itemChoice'?current:name==='health'?10:name==='thePoints'?100:nil;},
 call(_type,name){if(name==='get_ShopInputBlocked')return false;if(name==='TakeItemChoice'&&accept)current=nil;return nil;}
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/rogue.js'),'utf8'),context);
context.rogueContext=()=>({manager:{},run:{},id:'rogue'});
const run=()=>vm.runInContext("rogueAction({transaction_id:'item-choice-1',rogue_id:'rogue',action:'choose_item',max_spend:0,index:1})",context);
assert.equal(run().status,'rejected_by_game');
accept=true;assert.equal(run().status,'Committed');
assert.throws(run,/No matching native item choice/);
let pending=false,opened=false,selected=0;
const menu={};
context.alive=p=>p===menu;
const originalRead=context.read,originalCall=context.call;
context.read=(p,type,name)=>name==='menu'?menu:originalRead(p,type,name);
context.snapshotChoice=()=>({choice_id:'pending-choice'});
context.choiceAction=(q,expectedMenu)=>{assert.equal(expectedMenu,menu);assert.equal(q.action,'option');if(q.choice_id!=='pending-choice')throw Error('Stale choice_id');selected++;};
context.call=(type,name,...args)=>name==='get_ChoicePending'?pending:name==='IsChoiceItem'?true:name==='OpenChoiceItem'?opened:originalCall(type,name,...args);
context.rogueItemTarget=()=>({field:'items',value:105,index:1});
const reward=()=>vm.runInContext("rogueAction({transaction_id:'reward-choice-1',rogue_id:'rogue',action:'choose_reward',max_spend:0,choice_id:'pending-choice',index:1})",context);
assert.throws(reward,/No pending native reward choice/);assert.equal(selected,0);
pending=true;
assert.throws(()=>vm.runInContext("rogueAction({transaction_id:'reward-choice-2',rogue_id:'rogue',action:'choose_reward',max_spend:0,choice_id:'old-choice',index:1})",context),/Stale choice_id/);
assert.equal(reward().status,'choice_requested');assert.equal(selected,1);
const open=()=>vm.runInContext("rogueAction({transaction_id:'open-choice-item',rogue_id:'rogue',action:'open_item',max_spend:0,inventory_id:'choice-item'})",context);
assert.equal(open().status,'rejected_by_game');opened=true;assert.equal(open().status,'choice_opened');
console.log('Void native item-choice callbacks require a confirmed state change.');
