const schemaCache=new Map(),enumEntryCache=new Map();
function schemaOf(full){if(!schemaCache.has(full))schemaCache.set(full,classSchema(full));return schemaCache.get(full);}
function hasField(full,name){return schemaOf(full).fields.some(f=>f.name===name);}
function derivedFrom(p,full){let k=p.readPointer(),target=klass(full);while(!k.isNull()){if(k.equals(target))return true;k=A.parent(k);}return false;}
function component(p,full){return invoke('UnityEngine.Component','GetComponent',p,[A.typeObject(A.classType(klass(full)))],['System.Type']);}
function nativeObjects(full){return objects(full).filter(active);}
function oneObject(full){const found=nativeObjects(full);if(found.length!==1)throw Error('Native feature not active or ambiguous: '+full);return found[0];}
function valueList(p){if(p.isNull())return [];const a=p.add(16).readPointer(),n=p.add(24).readS32();if(n<0||n>10000||a.isNull())return [];return Array.from({length:n},(_,i)=>a.add(32+i*4).readS32());}
function enumEntries(full){if(!enumEntryCache.has(full)){const type=A.typeObject(A.classType(klass(full))),names=array(call('System.Enum','GetNames',nil,type)).map(str),values=call('System.Enum','GetValues',nil,type);enumEntryCache.set(full,names.map((name,i)=>({name,value:values.add(32+i*4).readS32()})));}return enumEntryCache.get(full);}
function primitiveView(p,full,names=null){const result={};if(p.isNull())return result;for(const f of schemaOf(full).fields){
 if(f.flags&16||names&&!names.includes(f.name))continue;
 if(['System.Boolean','System.Int32','System.UInt32','System.Int64','System.Single','System.Double','System.String','UnityEngine.Vector2','UnityEngine.Vector3','UnityEngine.Vector2Int'].includes(f.type))result[f.name]=read(p,full,f.name);
 else if(!f.type.includes('<')&&!f.type.includes('[')){try{if(A.enum(klass(f.type.startsWith('.')||f.type.includes('.')?f.type:'.'+f.type))){result[f.name]=read(p,full,f.name);result[f.name+'_name']=enumName(f.type.includes('.')?f.type:'.'+f.type,result[f.name]);}}catch(_){}}
 }return result;}
function textsAt(p){const t=call('UnityEngine.Component','get_transform',p),prefix=hierarchy(p)+'/';return nativeObjects('TMPro.TextMeshProUGUI').filter(x=>hierarchy(x).startsWith(prefix)).map(x=>call('TMPro.TMP_Text','get_text',x));}
function gameplayGuard(q){requireControl(q,true);if(phase()!=='running')throw Error('Battle is not running');if(nativeSelectionBusy())throw Error('Native selection is already in use');}
function targetPlant(id){return findObserved(plants(),id,'plant');}
function toolView(p){const full=fullClassName(p.readPointer());return {tool_id:String(p),name:objectName(p),class:full,...primitiveView(p,'.InGameTool',['fullCD','eventCooldown','CD','isPickUp','avaliable']),active:active(p)};}
function activeTools(){return nativeObjects('.InGameTool').map(toolView);}
function extraCardView(p){const full=fullClassName(p.readPointer()),path=hierarchy(p),dropped=derivedFrom(p,'.DroppedCard'),source=dropped?'falling':/Convey|Belt/i.test(path)?'conveyor':'bank';
 const result={class:full,source,card_kind:enumName('.CardBgType',read(p,'.CardUI','cardBgType')),seed_type:read(p,'.CardUI','theSeedType'),zombie_type:read(p,'.CardUI','theZombieType')};
 if(dropped)result.falling=primitiveView(p,'.DroppedCard',['isLand','lifeTime','existTime','flashing','fallByBoss']);
 const data=read(p,'.CardUI','travelRogueCard');if(!data.isNull()&&rogueContext())result.rogue=rogueCardView(data);return result;
}
function extraPlantView(p){const type=fullClassName(p.readPointer()),result={class:type,layer:enumName('PlaceRule.Layer',call('PlaceRule.PlaceManager','GetLayer',nil,read(p,'.Plant','thePlantType'))),native_status:enumName('.PlantStatus',read(p,'.Plant','theStatus')),active:call('.Plant','get_Active',p),first_parent:read(p,'.Plant','firstParent'),second_parent:read(p,'.Plant','secondParent')};
 if(type!=='.Plant')result.ability=primitiveView(p,type);
 if(derivedFrom(p,'.CobCannon'))result.cannon={ready:read(p,'.CobCannon','avaliable'),first_load:read(p,'.CobCannon','firstLoad')};
 const extension=component(p,'.TravelRoguePlant');if(!extension.isNull())result.rogue=roguePlantView(read(extension,'.TravelRoguePlant','data'));return result;
}
function extraZombieView(p){const type=fullClassName(p.readPointer());return {class:type,native_status:enumName('.ZombieStatus',read(p,'.Zombie','theStatus')),boss:/boss/i.test(type),details:type!=='.Zombie'?primitiveView(p,type):{}};}
function gridItems(){const b=board();return b.isNull()?[]:list(read(b,'.Board','griditemArray')).filter(alive);}
function gridItemView(p){const full=fullClassName(p.readPointer());return {entity_id:String(p),class:full,row:read(p,'.GridItem','theItemRow')+1,column:read(p,'.GridItem','theItemColumn')+1,kind:enumName('.GridItemType',read(p,'.GridItem','theItemType')),position:position(p)};}
function equipmentDrops(){return nativeObjects('.Bucket');}
let equipmentRecipeCache=null;
function actualField(k,names){for(const name of names){const f=A.field(k,Memory.allocUtf8String(name));if(!f.isNull())return {info:f,offset:A.offset(f).toNumber()};}return null;}
function nativeEquipmentRecipes(){
 if(equipmentRecipeCache)return equipmentRecipeCache;
 const dict=staticRead('.Bucket','Recipes');if(dict.isNull())return [];
 const k=dict.readPointer(),entriesField=actualField(k,['_entries','entries']),countField=actualField(k,['_count','count']);
 if(!entriesField||!countField)throw Error('Native equipment dictionary layout unavailable');
 const entries=dict.add(entriesField.offset).readPointer(),count=dict.add(countField.offset).readS32();
 if(entries.isNull()||count===0)return [];
 if(count<0||count>4096||entries.add(24).readU32()<count)throw Error('Invalid native equipment recipe count');
 const element=api('class_get_element_class','pointer',['pointer'])(entries.readPointer()),align=Memory.alloc(4),
       stride=api('class_value_size','int',['pointer','pointer'])(element,align),
       key=actualField(element,['key']),value=actualField(element,['value']),next=actualField(element,['next']);
 if(!key||!value||!next||stride<16||stride>128)throw Error('Native equipment entry layout unavailable');
 const tuple=A.fromType(A.fieldType(key.info)),first=actualField(tuple,['Item1']),second=actualField(tuple,['Item2']);
 if(!first||!second)throw Error('Native equipment tuple layout unavailable');
 const offset=f=>{const n=f.offset-Process.pointerSize*2;if(n<0||n+4>stride)throw Error('Invalid native equipment field offset');return n;};
 const keyOffset=offset(key),valueOffset=offset(value),nextOffset=offset(next),firstOffset=offset(first),secondOffset=offset(second),out=[];
 for(let i=0;i<count;i++){const entry=entries.add(32+i*stride);if(entry.add(nextOffset).readS32() < -1)continue;
  const hash=actualField(element,['hashCode']);if(hash&&entry.add(offset(hash)).readS32()===-1)continue;
  const a=entry.add(keyOffset+firstOffset).readS32(),b=entry.add(keyOffset+secondOffset).readS32(),result=entry.add(valueOffset).readS32();
  out.push({first_type:a,kind:enumName('.BucketType',b),result_type:result,result_name:enumName('.PlantType',result)});
 }
 equipmentRecipeCache=out;return out;
}
function equipmentDropView(p){const fertilizer=derivedFrom(p,'.Fertilize'),using=fertilizer&&read(p,'.Fertilize','isUsing'),target=fertilizer?read(p,'.Fertilize','theTargetPlant'):nil;
 const kind=fertilizer?'Fertilizer':enumName('.BucketType',read(p,'.Bucket','theBucketType'));
 let eligible=[],recipeError=null;
 if(!fertilizer)try{const recipes=nativeEquipmentRecipes().filter(r=>r.kind===kind);eligible=plants().flatMap(plant=>recipes.filter(r=>r.first_type===read(plant,'.Plant','thePlantType')).map(r=>({entity_id:String(plant),...r})));}catch(e){recipeError=String(e);}
 return {item_id:String(p),class:fullClassName(p.readPointer()),kind,ready:read(p,'.Bucket','isLand')&&!using,disappear:read(p,'.Bucket','disappear'),position:position(p),eligible_targets:eligible,recipe_error:recipeError,...(fertilizer?{using,target_entity_id:alive(target)?String(target):null,zombie:read(p,'.Fertilize','zombie')}:{})};}
function disassemblyRules(b){if(b.isNull())return {available:false,cost:null,reason:'not_in_battle'};const storage=fieldSpec('.Board','boardTag'),flag=fieldSpec('.Board.BoardTag','isDixMix'),special=!!b.add(storage.offset+flag.offset-Process.pointerSize*2).readU8(),developer=staticRead('.GameAPP','developerMode'),travel=call('.Lawnf','TravelAdvanced',nil,1014);return {available:special||developer||travel,cost:special||developer?0:500,special_mode:special,travel_buff:travel,reason:special?'native_disassembly_mode':developer?'native_developer_setting':travel?'travel_disassembly_buff':'native_mode_or_travel_buff_required'};}
function observeExtra(b){const result={input:nativeInputStatus(),tools:activeTools(),disassembly:disassemblyRules(b)};if(!b.isNull())Object.assign(result,{equipment_drops:equipmentDrops().map(equipmentDropView),grid_items:gridItems().map(gridItemView),points:read(b,'.Board','thePoints'),money:read(b,'.Board','theMoney'),can_start_next_wave:call('.Board','get_CanStartNextWave',b),auto_next_wave:call('.Board','get_AutoNextWaveEnabled',b),towards:enumName('.Towards',read(singleton('.InGameUI'),'.InGameUI','towards'))});return result;}
function placementCheck(q){if(q.battle_id!==battleId()||board().isNull())throw Error('Stale battle_id');cell(q);const card=findObserved(cards(),q.card_id,'card'),type=read(card,'.CardUI','thePlantType'),details=inspectCell(q),baseAllowed=call('PlaceRule.PlaceManager','CanPlace',nil,q.column-1,q.row-1,type);
 const fusion=details.plants.map(p=>({entity_id:p.entity_id,...recipes({first_type:p.plant_type,second_type:type})})).filter(r=>r.possible);
 return {native_allowed:baseAllowed?true:fusion.length?null:false,base_rule_allowed:baseAllowed,fusion_candidates:fusion,requires_native_attempt:!baseAllowed&&fusion.length>0,card:cardView(card),cell:details};}
function movePlant(q){gameplayGuard(q);const p=targetPlant(q.entity_id),before=plantView(p);if(inspectCell(before).plants.length>1)return {status:'rejected_by_game',reason:'ambiguous_native_layers'};const glove=oneObject('.Glove'),tool=toolView(glove);cell(q);
 if(read(glove,'.Glove','isZombie'))return {status:'rejected_by_game',reason:'plant_glove_not_ready',tool};
 let moved=false;try{ownsSelection=true;let accepted=false;withCell(before,m=>{accepted=call('.Glove','OnClick',glove,m);if(accepted)call('.Glove','Use',glove,m);});if(!accepted)return {status:'rejected_by_game',reason:'plant_glove_not_ready',tool};const m=singleton('.Mouse'),picked=read(m,'.Mouse','thePlantOnGlove');if(!picked.equals(p))return {status:'rejected_by_game',reason:'native_layer_not_selected'};
 withCell(q,m=>call('.Mouse','TryToSetPlantByGlove',m));moved=alive(p)&&read(p,'.Plant','thePlantRow')===q.row-1&&read(p,'.Plant','thePlantColumn')===q.column-1;
 }finally{clearOwnSelection();}return {status:moved?'Committed':'rejected_by_game',before,after:alive(p)?plantView(p):null,selection_released:!ownsSelection};
}
function disassemble(q){gameplayGuard(q);const p=targetPlant(q.entity_id),before=plantView(p),sun=read(board(),'.Board','theSun'),rules=disassemblyRules(board());const accepted=call('.Mouse','DisassemblePlant',singleton('.Mouse'),p,false);return {status:accepted?'Committed':'rejected_by_game',sun_before:sun,sun_after:read(board(),'.Board','theSun'),rules,reason:accepted?null:!rules.available?rules.reason:sun<rules.cost?'not_enough_sun':'native_restriction',before,falling_cards:cards().filter(c=>derivedFrom(c,'.DroppedCard')).map(cardView)};}
function equipDrop(q){gameplayGuard(q);const item=equipmentDrops().find(p=>String(p)===q.item_id),plant=plants().find(p=>String(p)===q.entity_id);
 if(!item||!plant)return {status:'rejected_by_game',reason:'equipment_or_plant_expired'};
 const drop=equipmentDropView(item),before=plantView(plant);
 if(!drop.ready)return {status:'rejected_by_game',reason:'equipment_still_falling'};
 if(inspectCell(before).plants.length!==1)return {status:'rejected_by_game',reason:'ambiguous_native_layers'};
 let released=false;
 try{ownsSelection=true;const mouse=singleton('.Mouse');withPoint(drop.position,()=>call('.Mouse','LeftClickWithNothing',mouse));
  if(!read(mouse,'.Mouse','theItemOnMouse').equals(call('UnityEngine.Component','get_gameObject',item)))return {status:'rejected_by_game',reason:'equipment_not_selected'};
  withCell(before,m=>call('.Mouse','LeftClickWithSomeThing',m));
 }finally{released=clearOwnSelection();}
 const after=plants().filter(p=>read(p,'.Plant','thePlantRow')===before.row-1&&read(p,'.Plant','thePlantColumn')===before.column-1).map(plantView);
 const changed=after.some(p=>p.entity_id!==before.entity_id||p.plant_type!==before.plant_type||p.health>before.health||p.shield>before.shield||p.level>before.level);
 const consumed=!equipmentDrops().some(p=>String(p)===q.item_id);
 if(!changed&&drop.kind==='Fertilizer'&&equipmentDrops().some(p=>derivedFrom(p,'.Fertilize')&&read(p,'.Fertilize','isUsing')&&read(p,'.Fertilize','theTargetPlant').equals(plant)))
  return {status:'fertilizer_requested',drop,before,after,consumed,selection_released:released};
 return {status:changed?'Committed':'unknown',reason:changed?null:'equipment_application_without_observed_plant_change',drop,before,after,consumed,selection_released:released};
}
function interact(q){if(q.item_id)return equipDrop(q);gameplayGuard(q);const before=plants().map(plantView);let result;
 try{ownsSelection=true;if(q.entity_id){const p=plants().find(p=>String(p)===q.entity_id)||gridItems().find(p=>String(p)===q.entity_id);if(!p)throw Error('Stale interact target');if(derivedFrom(p,'.Plant')){const view=plantView(p);if(inspectCell(view).plants.length>1)throw Error('Native click target has ambiguous plant layers');result=withCell(view,m=>call('.Mouse','LeftClickWithNothing',m));}else result=withCell(gridItemView(p),m=>call('.Mouse','LeftEvent',m));}
 else if(q.row!==undefined)result=withCell(q,m=>call('.Mouse','LeftClickWithNothing',m));else if(Number.isFinite(q.x)&&Number.isFinite(q.y))result=withPoint([q.x,q.y,0],()=>call('.Mouse','LeftClickWithNothing',singleton('.Mouse')));else throw Error('An observed entity, cell or explicit world position is required');
 }finally{clearOwnSelection();}return {status:'interaction_requested',native_result:result,before,after:plants().map(plantView),selection_released:!ownsSelection};}
function fire(q){gameplayGuard(q);const p=targetPlant(q.entity_id),before=plantView(p);cell(q);if(!derivedFrom(p,'.CobCannon')&&!/Cannon/i.test(fullClassName(p.readPointer())))throw Error('Target is not an observed cannon');
 let selected=false;try{ownsSelection=true;withCell(before,m=>call('.Mouse','LeftClickWithNothing',m));const m=singleton('.Mouse');selected=read(m,'.Mouse','cannonPlant').equals(p)&&alive(read(m,'.Mouse','theItemOnMouse'));if(!selected)return {status:'rejected_by_game',reason:'cannon_not_ready'};withCell(q,m=>call('.Mouse','LeftClickWithSomeThing',m));}finally{clearOwnSelection();}
 return {status:'fire_requested',entity_id:q.entity_id,target:{row:q.row,column:q.column},selection_released:!ownsSelection,after:alive(p)?plantView(p):null};}
function rewards(){return nativeObjects('.PrizeMgr').filter(p=>!read(p,'.PrizeMgr','isClicked')).map(p=>({reward_id:String(p),name:objectName(p),class:fullClassName(p.readPointer()),position:position(p),ready:read(p,'.PrizeMgr','isLand'),fake:read(p,'.PrizeMgr','fake')}));}
function nativeTip(){const p=call('Core.InGameText','get_Instance',nil);if(!alive(p))return null;const text=read(p,'Core.InGameText','textMesh');return {...primitiveView(p,'Core.InGameText',['used','timer']),text:text.isNull()?'':call('TMPro.TMP_Text','get_text',text)};}
function flow(){const b=board(),dialogs=nativeObjects('.BaseMenu').map(p=>({menu_type:fullClassName(p.readPointer()),name:objectName(p),id:String(p)})),reward=rewards();return {battle_id:battleId(),phase:phase(),native_status:status(),native_tip:nativeTip(),rewards:reward,dialogs,tutorials:nativeObjects('.TutorManager').map(p=>primitiveView(p,'.TutorManager',['id','progress','timer'])),quests:nativeObjects('.QuestNode').filter(p=>read(p,'.QuestNode','onTask')).map(p=>primitiveView(p,'.QuestNode',['id','questName','questDescription','questType','questTarget','target','completed'])),result:nativeObjects('.LevelResultMenu').map(p=>textsAt(p)),menu:menu(),can_start_next_wave:!b.isNull()&&call('.Board','get_CanStartNextWave',b)};}
function collectReward(q){requireControl(q);if(q.battle_id!==battleId())throw Error('Stale battle_id');const p=findObserved(nativeObjects('.PrizeMgr').filter(p=>!read(p,'.PrizeMgr','isClicked')),q.reward_id,'reward');if(!read(p,'.PrizeMgr','isLand'))return {status:'rejected_by_game',reason:'reward_still_falling'};withPoint(position(p),()=>call(fullClassName(p.readPointer()),'Click',p));const accepted=!active(p)||read(p,'.PrizeMgr','isClicked');return {status:accepted?'navigation_requested':'rejected_by_game',reward_id:q.reward_id,accepted};}
function snapshotChoice(p){const full=fullClassName(p.readPointer());if(derivedFrom(p,'.MultipleChoiceMenu3')){const page=call('.MultipleChoiceMenu3','get_Page',p),revision=call('.MultipleChoiceMenu3','get_InputRevision',p),size=call('.MultipleChoiceMenu3','get_PageSize',p);return {choice_id:SESSION+':choice:'+epoch+':'+String(p)+':'+revision+':'+page,kind:'menu3',title:call('.MultipleChoiceMenu3','get_Title',p),page:page+1,page_count:call('.MultipleChoiceMenu3','get_PageCount',p),blocked:call('.MultipleChoiceMenu3','get_InputBlocked',p),options:list(read(p,'.MultipleChoiceMenu3','options')).map((o,i)=>({index:i+1,visible:Math.floor(i/size)===page,...primitiveView(o,'.MultipleChoiceMenu3.Option',['title','text','plant','zombie','quality','enabled','sold','soldText','selected','secondaryText','secondaryEnabled'])})),commands:list(read(p,'.MultipleChoiceMenu3','commands')).map((o,i)=>({index:i+1,...primitiveView(o,'.MultipleChoiceMenu3.Command')}))};}
 return {choice_id:SESSION+':choice:'+epoch+':'+String(p)+':'+read(p,'.MultipleChoiceMenu','currentPage')+':'+read(p,'.MultipleChoiceMenu','refreshCount'),kind:'legacy',blocked:!call('.BaseMenu','get_Interactable',p),confirm_mode:read(p,'.MultipleChoiceMenu','confirmMode'),options:list(read(p,'.MultipleChoiceMenu','windows')).filter(active).map((w,i)=>({index:i+1,action_id:'native:'+String(w),title:call('TMPro.TMP_Text','get_text',read(w,'.BaseWindow','title')),text:call('TMPro.TMP_Text','get_text',read(w,'.BaseWindow','introduce'))}))};}
function choices(){return [...nativeObjects('.MultipleChoiceMenu3'),...nativeObjects('.MultipleChoiceMenu')].map(snapshotChoice);}
function choiceAction(q,budgetedMenu=null){if(!budgetedMenu)requireControl(q);const target=[...nativeObjects('.MultipleChoiceMenu3'),...nativeObjects('.MultipleChoiceMenu')].map(p=>({p,view:snapshotChoice(p)})).find(t=>t.view.choice_id===q.choice_id);if(!target)throw Error('Stale choice_id');const {p,view}=target;if(budgetedMenu&&!p.equals(budgetedMenu))throw Error('Unrelated native reward menu');if(view.blocked)throw Error('Native choice input is blocked');
 if(view.kind==='menu3'){const rc=rogueContext();if(!budgetedMenu&&rc&&enumName('.TravelRoguePhase',read(rc.run,'.TravelRogueRunData','phase'))==='Shop'){const command=view.commands.find(c=>c.index===q.index);if(q.action==='option'||q.action==='command'&&(!command||!/开始|开战|战斗|返回|退出|关闭|查看/.test(command.text)))throw Error('Use a budgeted rogue_action for shop transactions');}if(q.action==='option'||q.action==='command'){const options=q.action==='option'?view.options:view.commands,selected=options.find(o=>o.index===q.index);if(!selected||selected.enabled===false||selected.sold||selected.visible===false)throw Error('Native option unavailable');call('.MultipleChoiceMenu3',q.action==='option'?'ClickOption':'ClickCommand',p,q.index-1);}else if(q.action==='next'||q.action==='previous')call('.MultipleChoiceMenu3','TurnPage',p,q.action==='next'?1:-1);else throw Error('Unsupported choice action');}
 else if(q.action==='option'){const target=view.options.find(o=>o.index===q.index);if(!target)throw Error('Unavailable option');call('.MultipleChoiceMenu','SelectWindow',p,q.index-1);}else if(q.action==='confirm')call('.MultipleChoiceMenu','Confirm',p);else if(q.action==='cancel')call('.MultipleChoiceMenu','Cancel',p);else if(q.action==='next')call('.MultipleChoiceMenu','TurnPage',p);else throw Error('Unsupported legacy choice action');return {status:'navigation_requested'};
}
const extensionOperations=['mechanisms','placement_check','move_plant','disassemble','interact','fire','cycle_towards','next_wave','flow','collect_reward','choices','choice_action','minigame_observe','minigame_action','minigame_input','rogue_observe','rogue_action','purchase_receipt'];
operations.push(...extensionOperations);
function extensionDispatch(q){switch(q.op){case 'mechanisms':return {battle_id:battleId(),tools:activeTools(),minigames:minigameObserve(),rogue:rogueObserve(),flow:flow()};case 'placement_check':return placementCheck(q);case 'move_plant':return movePlant(q);case 'disassemble':return disassemble(q);case 'interact':return interact(q);case 'fire':return fire(q);
 case 'cycle_towards':gameplayGuard(q);const ui=singleton('.InGameUI'),directionButton=read(ui,'.InGameUI','changeTowards');if(!alive(directionButton)||!call('UnityEngine.GameObject','get_activeInHierarchy',directionButton))throw Error('Native direction control is not available');const before=enumName('.Towards',read(ui,'.InGameUI','towards'));call('.InGameUI','ChangeTowards',ui,directionButton);return {before,after:enumName('.Towards',read(ui,'.InGameUI','towards'))};
 case 'next_wave':gameplayGuard(q);if(!call('.Board','get_CanStartNextWave',board()))throw Error('Native next-wave control is not available');call('.Board','RequestNextWave',board());return {status:'wave_requested'};
 case 'flow':return flow();case 'collect_reward':return collectReward(q);case 'choices':return {choices:choices()};case 'choice_action':return choiceAction(q);case 'minigame_observe':return minigameObserve();case 'minigame_action':return minigameAction(q);case 'minigame_input':return minigameInput(q);case 'rogue_observe':return rogueObserve();case 'rogue_action':return rogueAction(q);default:throw Error('Unsupported operation');}}

function economicMenuButton(p,label){
 if(derivedFrom(p,'.ConfrimBtn')&&read(p,'.ConfrimBtn','buy'))return true;
 if(derivedFrom(p,'.TravelStoreBtn'))return true;
 const context=rogueContext();if(!context||enumName('.TravelRoguePhase',read(context.run,'.TravelRogueRunData','phase'))!=='Shop')return false;
 if(derivedFrom(p,'.BaseWindow'))return true;
 return /购买|刷新|升级商店|出售|售出|重铸|兑换|合成装备|^Buy|^Refresh|Upgrade shop/i.test(label);
}

function nativeModalPaths(){
 const notices=nativeObjects('.BaseMenu').filter(p=>/NoticePauseMenu/.test(objectName(p)));if(notices.length)return notices.map(hierarchy);
 const top=list(call('.UIResourcesLoader','Peak',staticRead('.GameAPP','UIManager'))).filter(active);
 return top.filter(p=>/Pause|Confirm|Warning|ReName|Lose|Result|MultipleChoice|Almanac|UIConfig|Menu_check/i.test(objectName(p))).map(hierarchy);
}
