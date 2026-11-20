const MINIGAMES=[
 {type:'.Board',name:'vasebreaker',fields:[],actions:['break_pot'],when:()=>gridItems().some(p=>derivedFrom(p,'.ScaryPot'))},
 {type:'.BejeweledManager',name:'bejeweled',fields:['combo','bejeweledTimer','fakeMoving','maxColumn'],actions:['swap']},
 {type:'.ChessManager',name:'chess',fields:['playerRound','restMoveTimes'],actions:['chess_move','advance_turn']},
 {type:'.Game2048Manager',name:'2048',fields:['range','over','stop','isAnimating'],actions:['move']},
 {type:'.SnakeManager',name:'snake',fields:['direction','moveTimer','restPresent','change'],keys:['up','down','left','right','w','a','s','d']},
 {type:'.BilliardManager',name:'billiards',fields:[],pointer:true,buttons:['left']},
 {type:'.BrickManager',name:'bricks',fields:['graveCount','max','level'],pointer:true,buttons:['left'],keys:['left','right','a','d','space']},
 {type:'.PaddleController',name:'paddle',fields:['speed','boundaryX','mouse'],pointer:true,keys:['left','right','a','d']},
 {type:'.BubbleGameManager',name:'bubbles',fields:['maxColumn','maxRow','clearing','punishCount','difficulty'],pointer:true,buttons:['left','right']},
 {type:'.FruitNinjaManager',name:'fruit_ninja',fields:['isGameOver','rogue','comboCount','lastWave'],pointer:true,buttons:['left']},
 {type:'.Zuma',name:'zuma',fields:['gameOver','summonBallCount','maxBallCount','isBomb'],pointer:true,buttons:['left','right'],keys:['space']},
 {type:'.PlayerShootingManager',name:'shooting',fields:['moneyProduction','lastWave','moneyWave'],pointer:true,buttons:['left','right'],keys:['w','a','s','d','up','down','left','right','space','r','q','e','shift']},
 {type:'.DrawCardManager',name:'draw_cards',fields:['up','upName','pullCountSinceLastUlti'],actions:['native_ui']},
 {type:'.FlagGameManager',name:'flags',fields:['timer'],actions:['plant','move_plant']},
 {type:'.GodManager',name:'plant_evolution',fields:['custom','toggle'],actions:['plant','native_ui']},
 {type:'.LightShadowManager',name:'light_shadow',fields:['timer'],actions:['switch_world','native_ui']},
 {type:'.MinesweeperManager',name:'minesweeper',fields:['totalMines','revealedSafeCells','totalSafeCells','wined','hasGenerated'],actions:['break_pot']},
 {type:'.TowerManager',name:'tower_defense',fields:[],actions:['plant','tower_upgrade','tower_shoot']},
 {type:'.HoverGardenManager',name:'hover_garden',fields:['phase'],pointer:true,buttons:['left','right'],actions:['plant','native_ui']}
];
function minigameTargets(){return MINIGAMES.flatMap(spec=>nativeObjects(spec.type).filter(p=>!spec.when||spec.when(p)).map(p=>({spec,p})));}
function minigameToken(p){return SESSION+':game:'+epoch+':'+String(p);}
function minigameObserve(){const games=minigameTargets().map(({spec,p})=>({game_id:minigameToken(p),kind:spec.name,entity_id:String(p),state:primitiveView(p,spec.type,spec.fields),actions:spec.actions||[],input:{keys:spec.keys||[],buttons:spec.buttons||[],pointer:!!spec.pointer,max_frames:120}}));
 const state={battle_id:battleId(),games,input:nativeInputStatus(),items:[]};
 for(const [type,fields] of [['.Chess',['chessType']],['.BilliardBall',['theBallType','v']],['.BilliardRod',['force','forcing','currentForce','clicking']],['.BubbleGameItem',['bubbleType','theRow','theColumn','odd','onShooter','dying']],['.FruitObject',['fruitType','scoreValue','isSliced']],['.ZumaBall',['theBallType','theBallStatus','progress']],['.Player',['currentHealth','maxHealth','level','towards']],['.PlayerWeapon',['theWeaponType','magazine','maxMagazine','shootTimer','shootInterval','loadingTimer','loadingInterval','level','evolution']]]){
  for(const p of nativeObjects(type))state.items.push({entity_id:String(p),class:fullClassName(p.readPointer()),position:position(p),...primitiveView(p,type,fields),...(type==='.Chess'?{row:call('.Chess','get_Row',p)+1,column:call('.Chess','get_Column',p)+1}:{})});
 }
 // Reveal only information the player has uncovered; never export the mine grid.
 for(const p of nativeObjects('.MinesweeperCell')){const revealed=read(p,'.MinesweeperCell','isRevealed'),pot=read(p,'.MinesweeperCell','scaryPot');state.items.push({entity_id:String(p),class:'.MinesweeperCell',row:read(p,'.MinesweeperCell','row')+1,column:read(p,'.MinesweeperCell','col')+1,pot_id:alive(pot)?String(pot):null,revealed,number:revealed?read(p,'.MinesweeperCell','surroundingMines'):null});}
 for(const {spec,p} of minigameTargets()){
  const game=games.find(g=>g.entity_id===String(p));game.position=position(p);
  if(spec.name==='2048'){const field=schemaOf(spec.type).fields.find(f=>f.name==='UpgradeRoute');game.upgrade_route=valueList(field.flags&16?staticRead(spec.type,'UpgradeRoute'):read(p,spec.type,'UpgradeRoute'));}
  if(spec.name==='snake'){
   const head=read(p,spec.type,'head'),food=read(p,spec.type,'present');game.body=[];let current=head;const seen=new Set();
   while(alive(current)&&!seen.has(String(current))&&game.body.length<100){seen.add(String(current));game.body.push(plantView(current));current=read(current,'.Plant','snakeNext');}
   game.food=alive(food)?plantView(food):null;
  }
  if(spec.name==='billiards'){const white=read(p,spec.type,'whiteBall');game.white_ball=alive(white)?String(white):null;}
  if(spec.name==='flags')game.flags=list(read(p,spec.type,'flags')).filter(alive).map(flag=>({entity_id:String(flag),position:position(flag),...primitiveView(flag,'.ContestedFlag')}));
  if(spec.name==='chess'&&game.state.playerRound&&game.state.restMoveTimes>0){
   game.legal_moves=[];let checked=0;const b=board(),rows=read(b,'.Board','rowNum'),columns=read(b,'.Board','columnNum');
   for(const chess of nativeObjects('.Chess')){const r=call('.Chess','get_Row',chess)+1,c=call('.Chess','get_Column',chess)+1;
    const cells=[];for(let row=1;row<=rows;row++)for(let column=1;column<=columns;column++)if(row!==r||column!==c)cells.push({row,column,d:Math.abs(row-r)+Math.abs(column-c)});
    cells.sort((a,b)=>a.d-b.d);for(const cell of cells){if(checked++>=256)break;if(call('.Chess','TryMove',chess,cell.column-1,cell.row-1))game.legal_moves.push({entity_id:String(chess),row:cell.row,column:cell.column});}
   }
  }
 }
 for(const type of ['.BrickBall','.PaddleController','.BallLauncher'])for(const p of nativeObjects(type)){
  const body=component(p,'UnityEngine.Rigidbody2D');state.items.push({entity_id:String(p),class:type,position:position(p),...primitiveView(p,type),velocity:body.isNull()?null:call('UnityEngine.Rigidbody2D','get_velocity',body)});
 }
 state.pots=gridItems().filter(p=>derivedFrom(p,'.ScaryPot')).map(gridItemView);state.tower_menus=nativeObjects('.TowerUpgradeMenu').map(p=>{
  const plant=read(p,'.TowerUpgradeMenu','plant'),offered=[];for(let branch=1;branch<=3;branch++){
   const button=read(p,'.TowerUpgradeMenu','upgrade'+branch);if(!button.isNull()&&call('UnityEngine.GameObject','get_activeInHierarchy',button))offered.push(branch);
  }
  const basicCost=read(p,'.TowerUpgradeMenu','basicCost'),unupgraded=alive(plant)&&read(plant,'.TowerPlant','upgradeType')===0;
  return {menu_id:String(p),interactable:call('.BaseMenu','get_Interactable',p),state:primitiveView(p,'.TowerUpgradeMenu'),texts:textsAt(p),
          offered_branches:offered,first_branch_cost:unupgraded?Math.trunc(basicCost/100)*10:null,can_shoot:alive(plant)&&call('.TowerPlant','Shootable',plant)};
 });return state;
}
function minigameTarget(q){const target=minigameTargets().find(({p})=>minigameToken(p)===q.game_id);if(!target)throw Error('Stale or inactive game_id');return target;}
function minigameInput(q){requireControl(q);if(board().isNull()||phase()!=='running')throw Error('Battle is not running');const {spec}=minigameTarget(q);if(!spec.pointer&&!spec.keys?.length)throw Error('This game uses explicit actions or native UI');
 if((q.keys||[]).some(key=>!spec.keys?.includes(key))||(q.buttons||[]).some(button=>!spec.buttons?.includes(button)))throw Error('Inputs are not offered by this native minigame');
 if((q.x!==undefined||q.path?.length)&&!spec.pointer)throw Error('Pointer input is unavailable for this game');if(nativeSelectionBusy())throw Error('Release native selection before minigame input');
 return scheduleNativeInput(q,q.x===undefined?null:[q.x,q.y,0]);}
function minigameAction(q){requireControl(q);const {spec,p}=minigameTarget(q);if(board().isNull()||q.battle_id!==battleId())return {status:'rejected_by_game',reason:'battle_changed'};if(phase()!=='running')return {status:'rejected_by_game',reason:'battle_not_running'};
 if(q.action==='switch_world'&&spec.name==='light_shadow'){call(spec.type,'SwitchWorld',p);return {status:'native_action_requested'};}
 if(q.action==='swap'&&spec.name==='bejeweled'){
  const current=plants(),first=current.find(p=>String(p)===q.entity_id),second=current.find(p=>String(p)===q.other_entity_id);
  if(!first||!second)return {status:'rejected_by_game',reason:'observed_piece_expired'};
  const a=plantView(first),b=plantView(second),same=(v,s)=>!s||['row','column','plant_type'].every(k=>v[k]===s[k]);
  if(!same(a,q.first_snapshot)||!same(b,q.second_snapshot))return {status:'rejected_by_game',reason:'observed_piece_changed'};
  if(Math.abs(a.row-b.row)+Math.abs(a.column-b.column)!==1)return {status:'rejected_by_game',reason:'pieces_no_longer_adjacent'};
  if(read(p,spec.type,'fakeMoving'))return {status:'rejected_by_game',reason:'native_animation_active'};
  const result=call(spec.type,'TryExchangePlant',p,first,second);return {status:result?'Committed':'rejected_by_game'};
 }
 if(q.action==='chess_move'&&spec.name==='chess'){if(!read(p,spec.type,'playerRound'))throw Error('Not the player turn');cell(q);const chess=findObserved(nativeObjects('.Chess'),q.entity_id,'chess piece');if(!call('.Chess','TryMove',chess,q.column-1,q.row-1))return {status:'rejected_by_game',reason:'native_chess_rule'};return movePlant({...q,entity_id:String(read(chess,'.Chess','plant'))});}
 if(q.action==='advance_turn'&&spec.name==='chess'){if(!read(p,spec.type,'playerRound'))throw Error('Not the player turn');call(spec.type,'MoveNext',p);return {status:'turn_step_requested',moves_remaining:read(p,spec.type,'restMoveTimes')};}
 if(q.action==='move'&&spec.name==='2048'){if(read(p,spec.type,'over')||read(p,spec.type,'stop')||read(p,spec.type,'isAnimating'))return {status:'rejected_by_game',reason:'native_board_not_ready'};const names={up:'MoveUpWithAnimation',down:'MoveDownWithAnimation',left:'MoveLeftWithAnimation',right:'MoveRightWithAnimation'};if(!Object.hasOwn(names,q.direction))throw Error('Invalid direction');const routine=call(spec.type,names[q.direction],p);invoke('UnityEngine.MonoBehaviour','StartCoroutine',p,[routine],['System.Collections.IEnumerator']);return {status:'move_requested'};}
 if(q.action==='break_pot'&&['minesweeper','vasebreaker'].includes(spec.name)){const pot=findObserved(gridItems().filter(p=>derivedFrom(p,'.ScaryPot')),q.entity_id,'pot');return interact({...q,entity_id:String(pot)});}
 if((q.action==='tower_upgrade'||q.action==='tower_shoot')&&spec.name==='tower_defense'){const menu=oneObject('.TowerUpgradeMenu');if(!call('.BaseMenu','get_Interactable',menu))throw Error('Native tower menu is blocked');if(q.action==='tower_upgrade'){
  if(![1,2,3].includes(q.branch))throw Error('Choose an observed native branch 1..3');const button=read(menu,'.TowerUpgradeMenu','upgrade'+q.branch);
  if(button.isNull()||!call('UnityEngine.GameObject','get_activeInHierarchy',button))return {status:'rejected_by_game',reason:'branch_not_offered'};
  call('.TowerUpgradeMenu','Select'+q.branch,menu);
 }else {const plant=read(menu,'.TowerUpgradeMenu','plant');if(!alive(plant)||!call('.TowerPlant','Shootable',plant))return {status:'rejected_by_game',reason:'tower_not_ready'};call('.TowerUpgradeMenu','Shoot',menu);}return {status:'native_action_requested'};}
 throw Error('Action is not offered by the current minigame');}

function nativeInputQuiescent(){
 for(const p of nativeObjects('.BilliardRod'))if(read(p,'.BilliardRod','forcing')||read(p,'.BilliardRod','clicking'))return false;
 for(const p of nativeObjects('.FruitBlade'))if(read(p,'.FruitBlade','clicking'))return false;
 return true;
}
