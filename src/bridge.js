let controlled=false,playerLocked=false,ownsSelection=false,autoCollect=false,epoch=0,boardKey='',menuRevision=0,lastMenuKey='',menuTargets=new Map();
let disposed=false,collectAt=0;
const pointerData=Memory.alloc(32);pointerData.writeByteArray(new Uint8Array(32));
const pointerOriginal=Memory.alloc(8);pointerOriginal.writePointer(nil);
const pointerModule=new CModule(`
 typedef struct {float x,y,z;} Vec3;
 extern unsigned int pointer_data[]; extern unsigned int pulse_data[]; extern void *original_entry;
 extern unsigned int thread_id(void);
 Vec3 *read_pointer(Vec3 *out,void *info) {
   if(pointer_data[0] && pointer_data[1]==thread_id()) {
     float *p=(float *)(pointer_data+2);out->x=p[0];out->y=p[1];out->z=p[2];return out;
   }
   if(pulse_data[0] && pulse_data[1]==thread_id() && pulse_data[27]){pulse_data[28]++;float *p=(float *)(pulse_data+24);out->x=p[0];out->y=p[1];out->z=p[2];return out;}
   return ((Vec3 *(*)(Vec3 *,void *))original_entry)(out,info);
 }
`,{pointer_data:pointerData,pulse_data:pulseData,original_entry:pointerOriginal,thread_id:Process.getModuleByName('kernel32.dll').getExportByName('GetCurrentThreadId')});
globalThis.fusionNativeResources={pointerModule,pointerData,pointerOriginal};
pointerOriginal.writePointer(Interceptor.replaceFast(method('UnityEngine.Input','get_mousePosition',0).info.readPointer(),pointerModule.read_pointer));
Interceptor.flush();
function withPoint(world,action){const screen=call('UnityEngine.Camera','WorldToScreenPoint',call('UnityEngine.Camera','get_main',nil),world),mouse=singleton('.Mouse'),saved=[];
 if(alive(mouse))for(const [name,value] of [['mouseX',world[0]],['mouseY',world[1]]]){const offset=fieldSpec('.Mouse',name).offset;saved.push([offset,mouse.add(offset).readFloat()]);mouse.add(offset).writeFloat(value);}
 pointerData.add(4).writeU32(Process.getCurrentThreadId());screen.forEach((n,i)=>pointerData.add(8+i*4).writeFloat(n));pointerData.writeU32(1);
 try{return action();}finally{pointerData.writeU32(0);for(const [offset,value] of saved)mouse.add(offset).writeFloat(value);}
}
const resolveIcall=api('resolve_icall','pointer',['pointer']);
const backgroundSetter=resolveIcall(Memory.allocUtf8String('UnityEngine.Application::set_runInBackground(System.Boolean)'));
if(backgroundSetter.isNull())throw Error('Native background setting unavailable');
new NativeFunction(backgroundSetter,'void',['bool'])(1);
const enumNames=new Map();
const rawEnumName=enumName;
enumName=(full,value)=>{const key=full+':'+value;if(!enumNames.has(key))enumNames.set(key,rawEnumName(full,value));return enumNames.get(key);};
function board(){const p=singleton('.Board'),key=alive(p)?String(p):'none';if(key!==boardKey){boardKey=key;epoch++;autoCollect=false;}return alive(p)?p:nil;}
function battleId(){board();return SESSION+':'+epoch;}
function status(){return enumName('.GameStatus',staticRead('.GameAPP','theGameStatus'));}
function phase(){const b=board();if(b.isNull())return 'menu';if(read(b,'.Board','over'))return 'finished';const s=status();return s==='Selecting'?'selection':s==='Pause'||s==='OpenOptions'?'paused':s==='InGame'?'running':'transition';}
function requireControl(q,battle=false){if(!controlled||playerLocked||disposed)throw Error('AI does not own control');if(nativeInputStatus().active)throw Error('Wait for the bounded native input to finish or release control');if(battle&&(q.battle_id!==battleId()||board().isNull()))throw Error('Stale or missing battle_id');}
function nativeSelection(){const m=singleton('.Mouse');return alive(m)?read(m,'.Mouse','mouseItemType'):0;}
function nativeSelectionBusy(){const m=singleton('.Mouse');return nativeSelection()!==0||alive(m)&&alive(read(m,'.Mouse','theItemOnMouse'));}
function clearOwnSelection(){const m=singleton('.Mouse');if(ownsSelection&&alive(m)){call('.Mouse','PutDownItem',m);if(nativeSelectionBusy()&&!alive(read(m,'.Mouse','theItemOnMouse')))call('.Mouse','ClearItemOnMouse',m,false);}const released=!ownsSelection||!nativeSelectionBusy();if(released)ownsSelection=false;return released;}
function release(){controlled=false;autoCollect=false;requestNativeInputRelease();pointerData.writeU32(0);const selection_released=clearOwnSelection();return {controlled,auto_collect:false,selection_released,native_selection:nativeSelection(),native_selection_busy:nativeSelectionBusy(),held_os_inputs:0,input_override_released:nativeInputStatus().override_released,player_locked:playerLocked};}
function cards(){return objects('.CardUI').filter(active);}
function cardView(p){return {card_id:String(p),name:enumName('.PlantType',read(p,'.CardUI','thePlantType')),plant_type:read(p,'.CardUI','thePlantType'),cost:read(p,'.CardUI','theSeedCost'),cooldown:Math.max(0,read(p,'.CardUI','fullCD')-read(p,'.CardUI','CD')),full_cooldown:read(p,'.CardUI','fullCD'),available:read(p,'.CardUI','isAvailable'),selected:read(p,'.CardUI','isSelected'),on_bank:read(p,'.CardUI','onCardBank'),disabled:read(p,'.CardUI','disabled'),level:read(p,'.CardUI','thePlantLevel'),...extraCardView(p)};}
function plants(){const b=board();if(b.isNull())return [];return list(read(read(b,'.Board','boardEntity'),'.BoardEntity','plantArray')).filter(alive);}
function plantView(p){return {entity_id:String(p),name:enumName('.PlantType',read(p,'.Plant','thePlantType')),plant_type:read(p,'.Plant','thePlantType'),row:read(p,'.Plant','thePlantRow')+1,column:read(p,'.Plant','thePlantColumn')+1,health:read(p,'.Plant','thePlantHealth'),max_health:read(p,'.Plant','thePlantMaxHealth'),shield:read(p,'.Plant','theShieldHealth'),level:read(p,'.Plant','theLevel'),position:position(p),...extraPlantView(p)};}
function zombieView(p){return {entity_id:String(p),name:enumName('.ZombieType',read(p,'.Zombie','theZombieType')),row:read(p,'.Zombie','theZombieRow')+1,health:read(p,'.Zombie','theHealth'),max_health:read(p,'.Zombie','theMaxHealth'),armor1:read(p,'.Zombie','theFirstArmorHealth'),armor2:read(p,'.Zombie','theSecondArmorHealth'),ally:read(p,'.Zombie','isMindControlled'),position:position(p),...extraZombieView(p)};}
function suns(){return objects('.CoinSun').filter(p=>active(p)&&[0,1].includes(read(p,'.CoinSun','theMoveType')));}
function observe(){const start=Date.now(),b=board(),result={game:'PVZ-Fusion',version:'0.4.0',battle_id:battleId(),phase:phase(),native_status:status(),controlled,player_locked:playerLocked,auto_collect:autoCollect,native_selection:nativeSelection(),native_selection_busy:nativeSelectionBusy(),cards:cards().map(cardView)};
 if(result.phase==='selection'){
  const ui=singleton('.InGameUI');
  if(alive(ui)){
   const slots=call('.InGameUI','get_CardSlotManager',ui);
   if(!slots.isNull())result.card_capacity=call('.CardSlotManager','get_MaxCardCount',slots);
  }
 }
 if(!b.isNull())Object.assign(result,{sun:read(b,'.Board','theSun'),rows:read(b,'.Board','rowNum'),columns:read(b,'.Board','columnNum'),wave:read(b,'.Board','theWave'),max_wave:read(b,'.Board','theMaxWave'),plants:plants().map(plantView),zombies:list(read(b,'.Board','zombieArray')).filter(alive).map(zombieView),suns:suns().map(p=>({sun_id:String(p),value:read(p,'.CoinSun','sunPrice'),position:position(p)})),level:staticRead('.GameAPP','theBoardLevel'),level_type:enumName('.LevelType',staticRead('.GameAPP','theBoardType'))});
 if(!b.isNull()){
  const manager=call('.GridManager','get_Instance',nil),centers=[],terrain=[],system=read(b,'.Board','gridSystem');
  for(let row=0;row<result.rows;row++)for(let column=0;column<result.columns;column++){
   centers.push({row:row+1,column:column+1,position:call('.GridManager','GetGridCenter',manager,column,row)});
   if(!system.isNull()){const grid=call('.GridSystem','GetGrid',system,column,row);if(!grid.isNull()){
    const water=read(grid,'.BoardGrid','waterLevel'),kind=enumName('.BoxType',read(grid,'.BoardGrid','boxType'));
    if(water>0||kind==='Water'||kind==='Roof'||kind==='Roof2')terrain.push({row:row+1,column:column+1,water_level:water,box_type:kind});
   }}
  }
  result.grid_centers=centers;result.terrain=terrain;
 }
 Object.assign(result,observeExtra(b));
 result.captured_at_unix_ms=Date.now();result.snapshot_ms=Date.now()-start;return result;
}
function hierarchy(p){let t=call('UnityEngine.Component','get_transform',p),names=[];for(let i=0;i<24&&!t.isNull();i++){names.unshift(objectName(t));t=call('UnityEngine.Transform','get_parent',t);}return names.join('/');}
function nativeMethods(full){const it=Memory.alloc(8);it.writePointer(nil);const result=[];for(;;){const m=A.methods(klass(full),it);if(m.isNull())break;result.push({name:A.methodName(m).readCString(),parameters:Array.from({length:A.pc(m)},(_,i)=>A.typeName(A.pt(m,i)).readCString())});}return result;}
function startButton(p){call('.StartGameBtn','OnMouseDown',p);call('.StartGameBtn','OnMouseUp',p);}
const menuButtonSpecs=[['.UIButton','native'],['.TheButton','event'],['.InGameBtn','ingame'],['UnityEngine.UI.Button','unity'],['.StartGameBtn','start'],['.UIBtn','uibtn'],['.NormalBtn','legacy'],['.Advanture_Btn','legacy'],['.PauseMenu_Btn','legacy'],['.LoseMenuBtn','legacy']];
function menu(){const entries=[];menuTargets=new Map();const modalPaths=nativeModalPaths();
 const textNodes=objects('TMPro.TextMeshProUGUI').filter(active).map(p=>({name:objectName(p),path:hierarchy(p),text:call('TMPro.TMP_Text','get_text',p)}));
 for(const [baseType,kind] of menuButtonSpecs)for(const p of objects(baseType).filter(active)){
  const full=fullClassName(p.readPointer()),name=objectName(p),path=hierarchy(p),label=textNodes.filter(t=>t.path.startsWith(path+'/')).map(t=>t.text).join('\n');
  if(/https?|updateurl|exit$|delete|removeplayer|donate|debug|cheat|passall|unlock|reset|充值|删除|解锁|重置/i.test(name+' '+path)||derivedFrom(p,'.OptionBtn'))continue;
  let enabled=['ingame','start','uibtn','legacy'].includes(kind)?true:kind==='unity'?call('UnityEngine.UI.Selectable','IsInteractable',p):call(full,'get_Interactable',p);
  if(kind==='native'&&call(full,'get_MenuInputBlocked',p))enabled=false;
  const lockState=derivedFrom(p,'.UIButton_mainMenu')?call('.UIButton_mainMenu','get_State',p):null;if(lockState!==null&&lockState!==0)enabled=false;
  const economic=economicMenuButton(p,label),id=kind+':'+String(p);
  const metadata=baseType==='.Advanture_Btn'?{level_type:enumName('.LevelType',read(p,'.Advanture_Btn','levelType')),level_number:read(p,'.Advanture_Btn','buttonNumber')}:lockState!==null?{native_lock_state:lockState}:{};
  const modalBlocked=modalPaths.length>0&&!modalPaths.some(root=>path===root||path.startsWith(root+'/'));entries.push({action_id:id,name,label,path,enabled:!!enabled&&!economic&&!modalBlocked,economic,modal_blocked:modalBlocked,...metadata});if(enabled&&!economic&&!modalBlocked)menuTargets.set(id,{p,full,kind});
 }
 const key=JSON.stringify(entries);if(key!==lastMenuKey){lastMenuKey=key;menuRevision++;}
 return {menu_id:SESSION+':menu:'+menuRevision,phase:phase(),modal_paths:modalPaths,actions:entries,texts:textNodes};
}
function pressNativeButton(target){const {p,full,kind}=target;
 if(kind==='start'){startButton(p);return;}if(kind==='event'){call(full,'OnPointerDown',p,nil);call(full,'OnPointerUp',p,nil);call(full,'OnPointerClick',p,nil);return;}if(kind==='unity'){call(full,'Press',p);return;}
 const has=name=>{try{method(full,name,0);return true;}catch(_){return false;}};
 if(has('OnMouseDown'))call(full,'OnMouseDown',p);
 if(has('OnMouseUpAsButton'))call(full,'OnMouseUpAsButton',p);else if(has('OnMouseUp'))call(full,'OnMouseUp',p);else throw Error('Native button callback is unavailable');
}
function findObserved(items,id,label){const p=items.find(p=>String(p)===id);if(!p)throw Error('Stale or unavailable '+label);return p;}
function cell(q){const b=board();if(!Number.isInteger(q.row)||!Number.isInteger(q.column)||q.row<1||q.column<1||q.row>read(b,'.Board','rowNum')||q.column>read(b,'.Board','columnNum'))throw Error('Cell outside current board');return {column:q.column-1,row:q.row-1};}
function withCell(q,action){const c=cell(q),m=singleton('.Mouse');if(!alive(m))throw Error('Native mouse unavailable');
 const center=call('.GridManager','GetGridCenter',call('.GridManager','get_Instance',nil),c.column,c.row),changes={theMouseRow:c.row,theMouseColumn:c.column,theBoxXofMouse:center[0],theBoxYofMouse:center[1],mouseX:center[0],mouseY:center[1]},saved={};
 for(const [name,value] of Object.entries(changes)){saved[name]=read(m,'.Mouse',name);const f=fieldSpec('.Mouse',name);if(f.type==='System.Single')m.add(f.offset).writeFloat(value);else m.add(f.offset).writeS32(value);}
 try{return withPoint(center,()=>action(m,c));}finally{for(const [name,value] of Object.entries(saved)){const f=fieldSpec('.Mouse',name);if(f.type==='System.Single')m.add(f.offset).writeFloat(value);else m.add(f.offset).writeS32(value);}}
}
function inspectCell(q){cell(q);const b=board(),g=call('.GridSystem','GetGrid',read(b,'.Board','gridSystem'),q.column-1,q.row-1);return {row:q.row,column:q.column,box_type:enumName('.BoxType',read(g,'.BoardGrid','boxType')),water_level:read(g,'.BoardGrid','waterLevel'),pit_count:read(g,'.BoardGrid','pitNum'),grave_count:read(g,'.BoardGrid','graveNum'),pot_count:read(g,'.BoardGrid','potNum'),lily_count:read(g,'.BoardGrid','lilyNum'),plants:list(read(g,'.BoardGrid','plantList')).filter(alive).map(plantView)};}
function plant(q){requireControl(q,true);if(phase()!=='running')throw Error('Battle is not running');const c=findObserved(cards(),q.card_id,'card');const view=cardView(c);cell(q);
 if(view.source==='bank'&&(view.disabled||view.cooldown>0||view.cost>read(board(),'.Board','theSun')))return {status:'rejected',reason:'cost_cooldown_or_disabled',card:view};
 if(nativeSelectionBusy())throw Error('Native selection already in use');const before=plants().map(plantView),sunBefore=read(board(),'.Board','theSun');let released=false;
 try{ownsSelection=true;call('.Mouse','ClickOnCard',singleton('.Mouse'),c);if(!nativeSelectionBusy())return {status:'rejected_by_game',reason:'card_not_selected'};
  withCell(q,m=>call('.Mouse','TryToSetPlantByCard',m));
 }finally{released=clearOwnSelection();}
 const after=plants().map(plantView),changed=after.filter(p=>p.row===q.row&&p.column===q.column&&!before.some(old=>old.entity_id===p.entity_id&&old.plant_type===p.plant_type));
 return {status:changed.length?'Committed':'rejected_by_game',plants:changed,sun_before:sunBefore,sun_after:read(board(),'.Board','theSun'),selection_released:released};
}
function recipes(q){if(q.mode==='disassemble'){if(!Number.isInteger(q.first_type))throw Error('Observed plant type required');const parents=Memory.alloc(8);parents.writeS32(-1);parents.add(4).writeS32(-1);const possible=call('.MixData','TryGetDisMix',nil,q.first_type,parents);return {possible,first_type:q.first_type,parents:possible?[parents.readS32(),parents.add(4).readS32()]:[]};}const values=[q.first_type,q.second_type];if(!values.every(Number.isInteger))throw Error('Plant types must be observed integers');const out=Memory.alloc(4);out.writeS32(-1);const possible=q.mode==='random'?call('.MixData','TryGetRandomMix',nil,...values,out):call('.MixData','TryGetMix',nil,...values,out,false);return {first_type:q.first_type,second_type:q.second_type,possible,result_type:possible?out.readS32():null,result_name:possible?enumName('.PlantType',out.readS32()):null};}
function collectSun(p){const m=singleton('.Mouse');if(nativeSelectionBusy()||!alive(m))throw Error('Native selection in use');const before=read(p,'.CoinSun','theMoveType');
 try{ownsSelection=true;withPoint(position(p),()=>call('.Mouse','LeftClickWithNothing',m));}finally{clearOwnSelection();}
 return {sun_id:String(p),mode_before:before,mode_after:alive(p)?read(p,'.CoinSun','theMoveType'):null};}
const operations=['capabilities','observe','menu','attach','detach','stop','menu_action','choose_card','start_battle','plant','fusion_recipe','inspect_cell','collect','auto_collect','shovel','diagnostics'];
function handle(q){
 switch(q.op){
 case 'capabilities':return {game:'PVZ-Fusion',game_version:'4.1',bridge_version:'0.4.0',operations,realtime:true,port:47634,os_input:false,save_isolation:true,save_path:call('UnityEngine.Application','get_persistentDataPath',nil),save_actual:call('.SaveInfo','GetDataPath',singleton('.SaveInfo')),features:['glove','disassembly','active_abilities','cannons','layered_terrain','conveyor_and_falling_cards','rogue_shop_quality_equipment','minigames','tutorial_and_rewards'],limits:['Only active native controls are used. Native unlocks, cooldowns and prices apply.','Per-scenario live verification is recorded separately; no cheats or automatic result/next-level commits.']};
 case 'observe':return observe();case 'menu':return menu();
 case 'diagnostics':if(q.equipment_recipe_audit)return {recipe_count:nativeEquipmentRecipes().length,eligible:equipmentDrops().map(equipmentDropView)};if(q.classes){if(!Array.isArray(q.classes)||q.classes.length>80||!q.classes.every(n=>typeof n==='string'&&n.length<220))throw Error('Invalid diagnostic class list');return {schemas:q.classes.map(name=>{try{return classSchema(name);}catch(e){return {name,error:String(e)};}})};}return {sun_states:objects('.CoinSun').filter(active).map(p=>({id:String(p),mode:read(p,'.CoinSun','theMoveType'),value:read(p,'.CoinSun','sunPrice')})),buttons:objects('.InGameBtn').filter(active).map(p=>({id:String(p),name:objectName(p),number:read(p,'.InGameBtn','buttonNumber'),path:hierarchy(p)})),components:objects('UnityEngine.MonoBehaviour').filter(active).map(p=>({name:objectName(p),class:A.classNs(p.readPointer()).readCString()+'.'+A.className(p.readPointer()).readCString(),path:hierarchy(p)})).filter(p=>/start|ready|rock|确定|confirm/i.test(p.name)),init_ready:alive(singleton('.InitBoard'))?read(singleton('.InitBoard'),'.InitBoard','ready'):null,save_actual:call('.SaveInfo','GetDataPath',singleton('.SaveInfo'))};
 case '__close_game':if(controlled||ownsSelection)throw Error('Release before closing');call('UnityEngine.Application','Quit',nil);return {closing:true};
 case 'attach':if(playerLocked||disposed||!clearOwnSelection())throw Error('Player lock or unreleased selection');controlled=true;return {controlled:true,mode:'realtime'};
 case 'detach':case 'stop':return release();
 case 'menu_action':{requireControl(q);const current=menu();if(q.menu_id!==current.menu_id)throw Error('Stale menu_id');const target=menuTargets.get(q.action_id);if(!target)throw Error('Unavailable menu action');const {p,full,kind}=target;
   pressNativeButton(target);
   menuRevision++;lastMenuKey='';return {status:'navigation_requested'};}
 case 'choose_card':{requireControl(q,true);if(phase()!=='selection')throw Error('Not selecting cards');const p=findObserved(cards(),q.card_id,'card'),before=read(p,'.CardUI','isSelected');if(q.selected===undefined||q.selected!==before)call('.CardUI','OnMouseDown',p);return {status:'requested',card:cardView(p)};}
 case 'start_battle':{requireControl(q,true);if(phase()!=='selection')throw Error('Not selecting cards');const full='.StartGameBtn',targets=objects(full).filter(active);if(targets.length!==1)throw Error('Native start button is unavailable or ambiguous');startButton(targets[0]);return {status:'navigation_requested'};}
 case 'plant':return plant(q);case 'fusion_recipe':return recipes(q);
 case 'inspect_cell':if(q.battle_id!==battleId())throw Error('Stale battle_id');return inspectCell(q);
 case 'collect':{requireControl(q,true);if(!Array.isArray(q.sun_ids)||!q.sun_ids.length||q.sun_ids.length>128)throw Error('Provide 1..128 sun_ids');const observed=suns(),targets=q.sun_ids.map(id=>findObserved(observed,id,'sun'));const results=targets.map(collectSun);return {status:'requested',count:results.length,results};}
 case 'auto_collect':requireControl(q,true);if(typeof q.enabled!=='boolean')throw Error('enabled must be boolean');autoCollect=q.enabled;return {enabled:autoCollect};
 case 'shovel':{requireControl(q,true);if(phase()!=='running')throw Error('Battle is not running');if(nativeSelectionBusy())throw Error('Native selection already in use');const p=findObserved(plants(),q.entity_id,'plant'),v=plantView(p),s=singleton('.Shovel');if(inspectCell(v).plants.length>1)return {status:'rejected_by_game',reason:'ambiguous_native_layers',cell:inspectCell(v)};if(!active(s))throw Error('Shovel unavailable');let result;
   try{ownsSelection=true;withCell(v,m=>{result=call('.Shovel','OnClick',s,m);if(result)call('.Shovel','Use',s,m);});}finally{clearOwnSelection();}
   return {status:!plants().some(item=>String(item)===q.entity_id)?'Committed':'rejected_by_game',native_result:result};}
 default:return extensionDispatch(q);
 }
}
function tick(){if(disposed)return;tickNativeInput();
 for(const key of [289,290,291])if(call('UnityEngine.Input','GetKeyDown',nil,key)){
   if(key===291)playerLocked=false;else{playerLocked=true;release();if(key===289&&phase()==='running')call('.UIMgr','EnterPauseMenu',nil);}
 }
 board();if(controlled&&autoCollect&&!nativeInputStatus().active&&phase()==='running'&&!nativeSelectionBusy()&&Date.now()-collectAt>150){collectAt=Date.now();suns().forEach(collectSun);}
}
Interceptor.attach(method('.Board','Awake',0).info.readPointer(),{onEnter(){epoch++;clearNativeInput();autoCollect=false;menuRevision++;}});
Interceptor.attach(method('.Board','OnDestroy',0).info.readPointer(),{onEnter(){epoch++;clearNativeInput();autoCollect=false;ownsSelection=false;menuRevision++;}});
installDispatcher(handle,tick);
rpc.exports={request(q){if(!operations.includes(q.op))throw Error('Unsupported operation');return dispatch(q);},dispose(){return dispatch({op:'detach'});},closeGame(){return dispatch({op:'__close_game'});}};
