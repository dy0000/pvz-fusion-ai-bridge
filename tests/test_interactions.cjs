const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const cannon={toString:()=>'cannon',equals:p=>p===cannon},mouse={},target={};
let selected=false,ready=true,fired=0,releases=0,clicked=0,layers=1;
const context=vm.createContext({operations:[]});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/mechanisms.js'),'utf8'),context);
Object.assign(context,{
 gameplayGuard(){},targetPlant:()=>cannon,plantView:()=>({row:2,column:2}),cell(){},
 inspectCell:()=>({plants:Array(layers).fill(cannon)}),derivedFrom:()=>true,
 singleton:()=>mouse,alive:p=>!!p,plants:()=>[cannon],gridItems:()=>[],
 withCell:(_q,action)=>action(mouse),
 clearOwnSelection(){selected=false;context.ownsSelection=false;releases++;},
 read:(_p,_type,name)=>name==='cannonPlant'?{equals:p=>selected&&p===cannon}:selected?target:null,
 call(type,name){
  assert.equal(type,'.Mouse','special abilities must pass through the native mouse dispatch');
  if(name==='LeftClickWithNothing'){clicked++;selected=ready;}
  if(name==='LeftClickWithSomeThing'){assert.equal(selected,true);fired++;}
 }
});
const run=code=>vm.runInContext(code,context);
assert.equal(run("fire({entity_id:'cannon',row:3,column:6}).status"),'fire_requested');
assert.equal(fired,1);assert.equal(releases,1);
ready=false;
assert.equal(run("fire({entity_id:'cannon',row:3,column:6}).status"),'rejected_by_game');
assert.equal(fired,1);assert.equal(releases,2);
run("interact({entity_id:'cannon'})");assert.equal(clicked,3);
layers=2;
assert.throws(()=>run("interact({entity_id:'cannon'})"),/ambiguous/);
assert.equal(clicked,3);assert.equal(releases,4);
// Native readiness can include an event cooldown shorter than the base fullCD.
{
 let row=2,column=2,point,allowed=true,picked=false,uses=0;
 const plant={},moveContext=vm.createContext({ownsSelection:false,gameplayGuard(){},cell(){},
  targetPlant:()=>plant,plantView:()=>({row,column}),inspectCell:()=>({plants:[plant]}),
  oneObject:()=>({}),toolView:()=>({CD:5,fullCD:10,avaliable:true}),singleton:()=>({}),alive:()=>true,
  withCell(q,action){point=q;return action({});},
  clearOwnSelection(){moveContext.ownsSelection=false;picked=false;},
  read(_p,_type,name){return name==='isZombie'?false:name==='thePlantOnGlove'?{equals:p=>picked&&p===plant}:name==='thePlantRow'?row-1:column-1;},
  call(_type,name){if(name==='OnClick')return allowed;if(name==='Use'){picked=true;uses++;}if(name==='TryToSetPlantByGlove'){row=point.row;column=point.column;}}
 });
 const source=fs.readFileSync(path.join(__dirname,'../src/mechanisms.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('function movePlant('),source.indexOf('function disassemble(')),moveContext);
 assert.equal(vm.runInContext("movePlant({entity_id:'plant',row:3,column:5}).status",moveContext),'Committed');
 allowed=false;
 assert.equal(vm.runInContext("movePlant({entity_id:'plant',row:3,column:6}).status",moveContext),'rejected_by_game');
 assert.equal(uses,1);
}
// Caller-supplied fields cannot bypass the ordinary shop option budget guard.
const shop={equals:p=>p===shop};
context.requireControl=()=>{};context.nativeObjects=type=>type==='.MultipleChoiceMenu3'?[shop]:[];
context.snapshotChoice=()=>({choice_id:'shop',kind:'menu3',blocked:false,commands:[],options:[{index:1,enabled:true}]});
context.rogueContext=()=>({run:{}});context.enumName=()=>'Shop';
assert.throws(()=>run("choiceAction({choice_id:'shop',action:'option',index:1,budgeted:true})"),/budgeted rogue_action/);
context.foreignMenu={};
assert.throws(()=>run("choiceAction({choice_id:'shop',action:'option',index:1},foreignMenu)"),/Unrelated native reward menu/);
// Cannon subclasses expose the native readiness from their CobCannon base.
{
 let isCannon=true,ready=true;
 const nil={isNull:()=>true},p={readPointer:()=>({})};
 const viewContext=vm.createContext({p,nil,fullClassName:()=>isCannon?'.FireCannon':'.CabbageCannon',
  enumName:()=> 'Default',call:(_type,name)=>name==='get_Active',component:()=>nil,
  derivedFrom:(_p,type)=>isCannon&&type==='.CobCannon',primitiveView:()=>({volley:3}),
  read(_p,type,name){if(type==='.CobCannon')return name==='avaliable'?ready:false;return -1;}
 });
 const source=fs.readFileSync(path.join(__dirname,'../src/mechanisms.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('function extraPlantView('),source.indexOf('function extraZombieView(')),viewContext);
 const view=()=>vm.runInContext('extraPlantView(p)',viewContext);
 assert.equal(view().cannon.ready,true);assert.equal(view().cannon.first_load,false);
 ready=false;assert.equal(view().cannon.ready,false);
 isCannon=false;assert.equal(view().cannon,undefined);
}
// A disappearing/reused match-three pointer must never exchange a different tile.
{
 const first={toString:()=>'first'},second={toString:()=>'second'};let current=[first,second],swaps=0;
 const boardPointer={isNull:()=>false};
 const views=new Map([[first,{row:1,column:1,plant_type:0}],[second,{row:1,column:2,plant_type:1}]]);
 const swapContext=vm.createContext({requireControl(){},minigameTarget:()=>({spec:{name:'bejeweled'},p:{}}),
  board:()=>boardPointer,battleId:()=>'battle',phase:()=>'running',plants:()=>current,
  plantView:p=>views.get(p),read:()=>false,call(){swaps++;return true;}
 });
 const source=fs.readFileSync(path.join(__dirname,'../src/minigames.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('function minigameAction('),source.indexOf('function nativeInputQuiescent(')),swapContext);
 const action={action:'swap',battle_id:'battle',entity_id:'first',other_entity_id:'second',
               first_snapshot:{row:1,column:1,plant_type:9},second_snapshot:{row:1,column:2,plant_type:1}};
 swapContext.q=action;
 assert.equal(vm.runInContext('minigameAction(q).reason',swapContext),'observed_piece_changed');
 current=[first];assert.equal(vm.runInContext('minigameAction(q).reason',swapContext),'observed_piece_expired');
 assert.equal(swaps,0);
 current=[first,second];action.first_snapshot.plant_type=0;
 assert.equal(vm.runInContext('minigameAction(q).status',swapContext),'Committed');assert.equal(swaps,1);
}
console.log('Native ability/cannon dispatch, exact selection, layered targets, and swap snapshots passed.');
