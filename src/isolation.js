'use strict';
// Installed before process resume. Redirect only this child's LocalLow root and
// Unity PlayerPrefs key; never copy or edit the player's existing progress.
const isolationStrings=[];
let persistentHook=null,managedPersistentHook=null,pathModule=null;
const moduleObserver=Process.attachModuleObserver({onAdded(module){
  if(module.name!=='GameAssembly.dll')return;
  const init=module.getExportByName('il2cpp_init');
  Interceptor.attach(init,{onLeave(){
    try{
      const resolve=new NativeFunction(module.getExportByName('il2cpp_resolve_icall'),'pointer',['pointer']);
      const path=Memory.allocUtf8String(ISOLATED_LOW);
      isolationStrings.push(path); // Native CModule symbols do not own JS allocations.
      const target=resolve(Memory.allocUtf8String('UnityEngine.Application::get_persistentDataPath()'));
      if(target.isNull())throw Error('persistentDataPath icall unavailable');
      // A native replacement remains effective inside nested runtime_invoke.
      // JS NativeCallbacks can be bypassed during a reentrant Frida callback.
      pathModule=new CModule('extern void *create_string(const char *); extern const char saved_path[]; void *persistent(void *unused) { return create_string(saved_path); }',{
        create_string:module.getExportByName('il2cpp_string_new'),saved_path:path
      });
      persistentHook=pathModule.persistent;
      Interceptor.replace(target,persistentHook);
      const domain=new NativeFunction(module.getExportByName('il2cpp_domain_get'),'pointer',[]);
      const assemblies=new NativeFunction(module.getExportByName('il2cpp_domain_get_assemblies'),'pointer',['pointer','pointer']);
      const image=new NativeFunction(module.getExportByName('il2cpp_assembly_get_image'),'pointer',['pointer']);
      const fromName=new NativeFunction(module.getExportByName('il2cpp_class_from_name'),'pointer',['pointer','pointer','pointer']);
      const method=new NativeFunction(module.getExportByName('il2cpp_class_get_method_from_name'),'pointer',['pointer','pointer','int']);
      const count=Memory.alloc(8),all=assemblies(domain(),count);let getter=ptr(0);
      for(let i=0;i<count.readU64().toNumber();i++){
        const k=fromName(image(all.add(i*8).readPointer()),Memory.allocUtf8String('UnityEngine'),Memory.allocUtf8String('Application'));
        if(!k.isNull()){getter=method(k,Memory.allocUtf8String('get_persistentDataPath'),0);break;}
      }
      if(getter.isNull())throw Error('Managed persistentDataPath getter unavailable');
      managedPersistentHook=pathModule.persistent;
      Memory.patchCode(getter.readPointer(),16,code=>{
        const writer=new X86Writer(code,{pc:getter.readPointer()});
        writer.putMovRegAddress('rax',managedPersistentHook);writer.putJmpReg('rax');writer.flush();
      });
      // IL2CPP reflection invocation uses the MethodInfo virtual entry, which
      // can differ from the compiled entry used by ordinary game calls.
      getter.writePointer(managedPersistentHook);
      getter.add(Process.pointerSize).writePointer(managedPersistentHook);
      Interceptor.flush();send({isolation_ready:true,path:ISOLATED_LOW});
    }catch(e){send({isolation_error:String(e)});}
  }});
}});
const shell=Process.getModuleByName('shell32.dll');
const ole=Process.getModuleByName('ole32.dll');
const alloc=new NativeFunction(ole.getExportByName('CoTaskMemAlloc'),'pointer',['uint64']);
Interceptor.attach(shell.getExportByName('SHGetKnownFolderPath'),{
  onEnter(args){this.output=null;try{
    if(args[0].readByteArray(16) && args[0].readU32()===0xa520a1a4)this.output=args[3];
  }catch(_){}},
  onLeave(result){if(this.output && result.toInt32()===0){
    const p=alloc((ISOLATED_LOW.length+1)*2);p.writeUtf16String(ISOLATED_LOW);this.output.writePointer(p);
  }}
});
for(const name of ['RegOpenKeyExW','RegCreateKeyExW']){
  Interceptor.attach(Process.getModuleByName('advapi32.dll').getExportByName(name),{
    onEnter(args){if(args[1].isNull())return;const s=args[1].readUtf16String();
      if(s.toLowerCase().includes('lanpiaopiao') && s.toLowerCase().includes('plantsvszombiesrh')){
        const p=Memory.allocUtf16String(s.replace(/PlantsVsZombiesRH/gi,'PlantsVsZombiesRH-AIBridge'));
        isolationStrings.push(p);args[1]=p;
      }
    }
  });
}
rpc.exports={loadBridge(source){(0,eval)(source);}};
