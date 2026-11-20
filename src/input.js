// Bounded, main-thread game input. These hooks never press an OS key/button.
const pulseData=Memory.alloc(256);pulseData.writeByteArray(new Uint8Array(256));
const inputOriginals=Memory.alloc(32*Process.pointerSize);inputOriginals.writeByteArray(new Uint8Array(32*Process.pointerSize));
const inputBindings=[],inputAddresses=new Set();
const inputKinds={GetKey:'key',GetKeyInt:'key',GetKeyDown:'key_down',GetKeyDownInt:'key_down',GetKeyUp:'key_up',GetKeyUpInt:'key_up',GetMouseButton:'mouse',GetMouseButtonDown:'mouse_down',GetMouseButtonUp:'mouse_up',GetAxis:'axis',GetAxisRaw:'axis',GetButton:'button',GetButtonDown:'button_down',GetButtonUp:'button_up',get_anyKey:'any',get_anyKeyDown:'any_down'};
let inputC=`
 extern unsigned int pulse_data[];extern void *originals[];extern unsigned int thread_id(void);
 int enabled(void){return pulse_data[0] && pulse_data[1]==thread_id();}
 int requested(int key){for(unsigned int i=0;i<pulse_data[5];i++)if(pulse_data[6+i]==(unsigned int)key)return 1;return 0;}
 int text_is(void *text,const char *name){if(!text)return 0;int n=*(int *)((char *)text+16);unsigned short *p=(unsigned short *)((char *)text+20);int i=0;for(;name[i];i++)if(i>=n||p[i]!=(unsigned char)name[i])return 0;return i==n;}
`;
for(const [name,kind] of Object.entries(inputKinds)){
 const address=method('UnityEngine.Input',name,kind.startsWith('any')?0:1).info.readPointer();if(inputAddresses.has(String(address)))continue;
 inputAddresses.add(String(address));const index=inputBindings.length,fn='input_'+index;
 if(kind.startsWith('axis'))inputC+=`float ${fn}(void *text,void *info){if(enabled()){if(text_is(text,"Horizontal")){pulse_data[28]++;return ((float *)(pulse_data+22))[0];}if(text_is(text,"Vertical")){pulse_data[28]++;return ((float *)(pulse_data+23))[0];}}return ((float (*)(void *,void *))originals[${index}])(text,info);}\n`;
 else if(kind.startsWith('button'))inputC+=`unsigned char ${fn}(void *text,void *info){if(enabled()&&(text_is(text,"Fire1")||text_is(text,"Fire2")||text_is(text,"Jump"))){unsigned int mask=text_is(text,"Fire2")?2:1;int held=text_is(text,"Jump")?requested(32):(pulse_data[3]&mask)!=0;if(held){pulse_data[28]++;return ${kind==='button_down'?'pulse_data[2]==1':kind==='button_up'?'pulse_data[2]==3':'pulse_data[2]!=3'};}}return ((unsigned char (*)(void *,void *))originals[${index}])(text,info);}\n`;
 else if(kind.startsWith('any'))inputC+=`unsigned char ${fn}(void *info){if(enabled()&&(pulse_data[3]||pulse_data[5])&&${kind==='any_down'?'pulse_data[2]==1':'pulse_data[2]!=3'}){pulse_data[28]++;return 1;}return ((unsigned char (*)(void *))originals[${index}])(info);}\n`;
 else inputC+=`unsigned char ${fn}(int value,void *info){if(enabled()&&${kind.startsWith('mouse')?'value>=0&&value<3&&(pulse_data[3]&(1u<<value))':'requested(value)'}){pulse_data[28]++;return ${kind.endsWith('_down')?'pulse_data[2]==1':kind.endsWith('_up')?'pulse_data[2]==3':'pulse_data[2]!=3'};}return ((unsigned char (*)(int,void *))originals[${index}])(value,info);}\n`;
 inputBindings.push({address,fn,index});
}
const inputModule=new CModule(inputC,{pulse_data:pulseData,originals:inputOriginals,thread_id:Process.getModuleByName('kernel32.dll').getExportByName('GetCurrentThreadId')});
for(const binding of inputBindings)inputOriginals.add(binding.index*Process.pointerSize).writePointer(Interceptor.replaceFast(binding.address,inputModule[binding.fn]));
Interceptor.flush();
globalThis.fusionInputResources={inputModule,inputOriginals,pulseData};
let nativePulse=null,lastInputResult=null;
const GAME_KEYS={up:273,down:274,right:275,left:276,w:119,a:97,s:115,d:100,space:32,q:113,e:101,r:114,z:122,x:120,c:99,shift:304,ctrl:306};
function nativeInputStatus(){return {active:!!nativePulse,last:lastInputResult,read_count:pulseData.add(112).readU32(),request_id:nativePulse?.id||null,frames_remaining:nativePulse?.frames||0,stage:pulseData.readU32()?['none','down','held','up'][pulseData.add(8).readU32()]:null,override_released:pulseData.readU32()===0,held_os_inputs:0};}
function clearNativeInput(reason='released'){if(nativePulse)lastInputResult={request_id:nativePulse.id,read_count:pulseData.add(112).readU32(),reason};pulseData.writeU32(0);nativePulse=null;}
function scheduleNativeInput(q,world=null){
 if(nativePulse)throw Error('Previous bounded native input is still active');
 const keys=q.keys||[],buttons=q.buttons||[];
 if(!Array.isArray(keys)||keys.length>12||!keys.every(key=>Object.hasOwn(GAME_KEYS,key)))throw Error('Unsupported gameplay keys');
 if(!Array.isArray(buttons)||!buttons.every(button=>['left','right','middle'].includes(button)))throw Error('Unsupported mouse buttons');
 const frames=q.frames??Math.max(1,q.path?.length||1);if(!Number.isInteger(frames)||frames<1||frames>120)throw Error('frames must be 1..120');
 if(world&&(!Array.isArray(world)||world.length!==3||!world.every(n=>Number.isFinite(n)&&Math.abs(n)<100000)))throw Error('Invalid world position');
 const path=q.path||[];if(!Array.isArray(path)||path.length>32||!path.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<100000&&Math.abs(p.y)<100000))throw Error('Invalid bounded pointer path');
 let screen=null,screens=[];if(world||path.length){const camera=call('UnityEngine.Camera','get_main',nil);screens=path.length?path.map(p=>call('UnityEngine.Camera','WorldToScreenPoint',camera,[p.x,p.y,0])):[call('UnityEngine.Camera','WorldToScreenPoint',camera,world)];screen=screens[0];}
 pulseData.writeByteArray(new Uint8Array(256));pulseData.add(4).writeU32(Process.getCurrentThreadId());pulseData.add(8).writeU32(1);
 pulseData.add(12).writeU32(buttons.reduce((mask,name)=>mask|(1<<['left','right','middle'].indexOf(name)),0));
 pulseData.add(20).writeU32(keys.length);keys.forEach((key,i)=>pulseData.add(24+i*4).writeU32(GAME_KEYS[key]));
 pulseData.add(88).writeFloat(Number(keys.includes('d')||keys.includes('right'))-Number(keys.includes('a')||keys.includes('left')));
 pulseData.add(92).writeFloat(Number(keys.includes('w')||keys.includes('up'))-Number(keys.includes('s')||keys.includes('down')));
 if(screen){screen.forEach((n,i)=>pulseData.add(96+i*4).writeFloat(n));pulseData.add(108).writeU32(1);}
 nativePulse={id:q.id||SESSION+':input:'+Date.now(),frames,total:frames,screens,epoch,status:status(),expires:Date.now()+3500};pulseData.writeU32(1);
 return {status:'input_scheduled',...nativeInputStatus()};
}
function requestNativeInputRelease(reason='released'){
 if(!nativePulse)return true;if(!nativePulse.releasing){nativePulse.releasing=true;nativePulse.releaseReason=reason;nativePulse.frames=0;pulseData.add(8).writeU32(3);}return false;
}
function tickNativeInput(){if(!nativePulse)return;
 if(nativePulse.releasing){if(nativeInputQuiescent())clearNativeInput(nativePulse.releaseReason);return;}
 if(!controlled||playerLocked||nativePulse.epoch!==epoch||nativePulse.status!==status()||Date.now()>nativePulse.expires){requestNativeInputRelease('transition_or_deadline');return;}
 if(pulseData.add(8).readU32()===3){if(nativeInputQuiescent())clearNativeInput('completed');else requestNativeInputRelease('completed');return;}nativePulse.frames--;
 if(nativePulse.screens.length>1){const progress=Math.min(1,(nativePulse.total-nativePulse.frames)/Math.max(1,nativePulse.total-1))*(nativePulse.screens.length-1),index=Math.min(nativePulse.screens.length-2,Math.floor(progress)),fraction=progress-index;
  for(let i=0;i<3;i++)pulseData.add(96+i*4).writeFloat(nativePulse.screens[index][i]*(1-fraction)+nativePulse.screens[index+1][i]*fraction);}
 pulseData.add(8).writeU32(nativePulse.frames<=0?3:2);
}
